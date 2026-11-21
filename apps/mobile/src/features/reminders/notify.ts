import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';

import { widgetTaskChanged } from '@/features/widget/render';
import { describeRecurrence, formatTime, Temporal } from '@/lib/dates';
import { nextOccurrence, type Task } from '@/lib/shared';

import { cancelOccurrence } from './cancel';
import { completeOccurrence } from './complete';
import { parseReminderId, planReminders, type PlannedReminder, REMINDER_PREFIX, type ReminderSettings, SNOOZE_PREFIX } from './plan';

const CHANNEL = 'task-reminders';
const CATEGORY = 'task-actions';
export const COMPLETE = 'complete';
export const SNOOZE = 'snooze';
const SNOOZE_MINUTES = 10;
const ASKED_KEY = 'dayframe-notification-permission-asked';

let prepared: Promise<void> | undefined;

/** The channel and the buttons; safe to call any number of times, from the app or a background task. */
export function prepareReminders(): Promise<void> {
  prepared ??= (async () => {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: '할 일 알림', description: '할 일의 시간이 되면 알려 줍니다.', importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250], lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
    });
    await Notifications.setNotificationCategoryAsync(CATEGORY, [
      { identifier: COMPLETE, buttonTitle: '완료', options: { opensAppToForeground: false } },
      { identifier: SNOOZE, buttonTitle: SNOOZE_MINUTES + '분 뒤에', options: { opensAppToForeground: false } },
    ]);
  })().catch(() => { prepared = undefined; });
  return prepared;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function reminderPermission(): Promise<PermissionState> {
  const status = await Notifications.getPermissionsAsync().catch(() => null);
  if (!status) return 'denied';
  return status.granted ? 'granted' : status.canAskAgain ? 'undetermined' : 'denied';
}

/** Asks once on its own; after that only when the person presses the button in settings. */
export async function requestReminderPermission(force = false): Promise<PermissionState> {
  const state = await reminderPermission();
  if (state !== 'undetermined') return state;
  if (!force && await AsyncStorage.getItem(ASKED_KEY).catch(() => null)) return state;
  await AsyncStorage.setItem(ASKED_KEY, '1').catch(() => {});
  const result = await Notifications.requestPermissionsAsync().catch(() => null);
  return result?.granted ? 'granted' : result?.canAskAgain ? 'undetermined' : 'denied';
}

export interface ReminderContext {
  projectName: (task: Task) => string | undefined;
  openSubtasks: (task: Task) => number;
}

function leadText(minutes: number): string {
  return minutes === 60 ? '1시간 후' : minutes + '분 후';
}

/** What the alert says. Brief: the title and the time. Detailed: also the repeat, project, notes and subtasks, with buttons. */
export function reminderContent(task: Task, occurrence: string, settings: ReminderSettings, context: ReminderContext): Notifications.NotificationContentInput {
  const due = Temporal.Instant.from(occurrence).toZonedDateTimeISO(task.timezone);
  const time = task.all_day ? '오늘 · 종일' : formatTime(due.hour * 60 + due.minute);
  const when = !task.all_day && settings.leadMinutes ? leadText(settings.leadMinutes) + ' · ' + time : time;
  const base = { title: task.title, sound: true, priority: 'high', color: '#3574F0', data: { url: 'dayframe:///task/' + task.id } };
  if (settings.style === 'brief') return { ...base, body: when };
  const facts = [when, describeRecurrence(task.recurrence_rule), context.projectName(task) ? '#' + context.projectName(task) : null];
  const lines = [facts.filter(Boolean).join(' · ')];
  const notes = task.notes?.trim();
  if (notes) lines.push(notes.length > 140 ? notes.slice(0, 139) + '…' : notes);
  const subtasks = context.openSubtasks(task);
  if (subtasks) lines.push('하위 작업 ' + subtasks + '개 남음');
  return { ...base, body: lines.join('\n'), categoryIdentifier: CATEGORY };
}

function signature(item: PlannedReminder, content: Notifications.NotificationContentInput): string {
  return [item.at, content.title, content.body, content.categoryIdentifier ?? ''].join('|');
}

/**
 * Makes the device's scheduled alerts match the task list: new and changed ones are scheduled,
 * the rest withdrawn. Alerts the system already holds unchanged are left alone.
 */
export async function syncReminders(tasks: Task[], settings: ReminderSettings, context: ReminderContext): Promise<void> {
  await prepareReminders();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const granted = (await reminderPermission()) === 'granted';
  const planned = granted ? planReminders(tasks, settings, Date.now(), (task, after) => {
    const full = byId.get(task.id)!;
    return nextOccurrence(full.recurrence_rule!, full.timezone, full.recurrence_anchor_at ?? full.due_at!, Temporal.Instant.from(after),
      full.all_day, full.recurrence_local_time);
  }) : [];
  const wanted = new Map(planned.map((item) => {
    const content = reminderContent(byId.get(item.taskId)!, item.occurrence, settings, context);
    return [item.id, { item, content, signature: signature(item, content) }] as const;
  }));

  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  const kept = new Set<string>();
  for (const request of scheduled) {
    const id = request.identifier;
    if (id.startsWith(REMINDER_PREFIX)) {
      const want = wanted.get(id);
      if (want && request.content.data?.signature === want.signature) kept.add(id);
      else await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    } else if (id.startsWith(SNOOZE_PREFIX)) {
      // A snoozed alert stays only while its occurrence is still open.
      const parsed = parseReminderId(id);
      const task = parsed ? byId.get(parsed.taskId) : undefined;
      if (!task || !task.due_at || Date.parse(task.due_at) !== Date.parse(parsed!.occurrence)) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      }
    }
  }
  for (const [id, { item, content, signature: sig }] of wanted) {
    if (kept.has(id)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { ...content, data: { ...content.data, signature: sig } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: item.at, channelId: CHANNEL },
    }).catch(() => {});
  }
}

/** Withdraws every task alert, for signing out or turning alerts off. */
export async function clearReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled
    .filter((request) => request.identifier.startsWith(REMINDER_PREFIX) || request.identifier.startsWith(SNOOZE_PREFIX))
    .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier).catch(() => {})));
}

type Response = Pick<Notifications.NotificationResponse, 'actionIdentifier'> & {
  notification: { request: { identifier: string; content?: { title?: string | null; body?: string | null } } };
};

/**
 * Handles the 완료 and 10분 뒤에 buttons. It runs in the app when it is open and in a background task
 * when it is not, and does the same thing either way.
 */
export async function handleReminderAction(response: Response): Promise<void> {
  const id = response.notification.request.identifier;
  const parsed = parseReminderId(id);
  if (!parsed) return;
  await Notifications.dismissNotificationAsync(id).catch(() => {});
  if (response.actionIdentifier === SNOOZE) {
    const content = response.notification.request.content ?? {};
    await prepareReminders();
    await Notifications.scheduleNotificationAsync({
      identifier: SNOOZE_PREFIX + id.replace(/^(task|snooze)-/, ''),
      content: {
        title: content.title ?? '할 일', body: content.body ?? '', sound: true, priority: 'high', color: '#3574F0',
        categoryIdentifier: CATEGORY, data: { url: 'dayframe:///task/' + parsed.taskId },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: Date.now() + SNOOZE_MINUTES * 60_000, channelId: CHANNEL },
    }).catch(() => {});
    return;
  }
  if (response.actionIdentifier !== COMPLETE) return;
  const outcome = await completeOccurrence(parsed.taskId, parsed.occurrence);
  if (outcome.status === 'failed') {
    await Notifications.scheduleNotificationAsync({
      content: { title: '완료하지 못했습니다', body: '연결이 없습니다. 앱에서 다시 완료해 주세요.', data: { url: 'dayframe:///task/' + parsed.taskId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: CHANNEL },
    }).catch(() => {});
    return;
  }
  await cancelOccurrence(parsed.taskId, parsed.occurrence);
  await widgetTaskChanged(parsed.taskId, outcome.task);
}

/**
 * Listens while the app runs: a tap on an alert opens its task, and a button pressed while the app is in
 * front is handled here (in the background the task registered in `src/background.ts` handles it instead).
 */
export function listenForReminders(open: (taskId: string) => void, changed: () => void): () => void {
  const respond = (response: Notifications.NotificationResponse) => {
    const parsed = parseReminderId(response.notification.request.identifier);
    if (!parsed) return;
    if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) open(parsed.taskId);
    else if (AppState.currentState === 'active') void handleReminderAction(response).then(changed);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(respond);
  // An alert tapped while the app was closed is what launched it.
  const launch = Notifications.getLastNotificationResponse();
  if (launch) {
    Notifications.clearLastNotificationResponse();
    respond(launch);
  }
  return () => subscription.remove();
}
