import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AppState, Linking } from 'react-native';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';

import { nextCheckIn } from '@/features/habits/checkIn';
import { widgetHabitChanged, widgetTaskChanged } from '@/features/widget/render';
import { api } from '@/lib/api';
import { describeRecurrence, deviceTimeZone, formatDate, formatTime, Temporal } from '@/lib/dates';
import { nextOccurrence, occurrenceFloor, type Task } from '@/lib/shared';

import { cancelOccurrence } from './cancel';
import { completeOccurrence, postponeOccurrenceToTomorrow } from './complete';
import { leadAhead } from './lead';
import { loadReminderOverrides, type ReminderOverrides } from './overrides';
import {
  alertTime, BRIEFING_PREFIX, HABIT_PREFIX, HABIT_SNOOZE_PREFIX, parseBriefingReminderId, parseHabitReminderId,
  parseReminderId, planBriefingReminders, planHabitReminders, planReminders, type PlannedReminder,
  REMINDER_PREFIX, reminderId, type ReminderSettings, SNOOZE_PREFIX,
} from './plan';
import { loadReminderSettings } from './settings';

/**
 * The Android notification accent (small icon and action text). A native setting the theme cannot reach, so it is the
 * default blue accent from src/theme (and app.config.ts), for task and habit alerts alike.
 */
const NOTIFICATION_COLOR = '#2B66E0';

const CHANNEL = 'task-reminders';
const CATEGORY = 'task-actions';
const HABIT_CATEGORY = 'habit-actions';
export const LOG_HABIT = 'log';
export const SNOOZE_HABIT = 'snooze-habit';
export const COMPLETE = 'complete';
export const SNOOZE = 'snooze';
export const POSTPONE = 'postpone';
const SNOOZE_MINUTES = 15;
const HABIT_SNOOZE_MINUTES = 60;
const ASKED_KEY = 'dayframe-notification-permission-asked';

let prepared: Promise<void> | undefined;

/** The channel and the buttons; safe to call any number of times, from the app or a background task. */
export function prepareReminders(): Promise<void> {
  prepared ??= (async () => {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: '할 일 알림', description: '정해진 시간이 되면 알림을 보내 드립니다.', importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250], lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
    });
    await Notifications.setNotificationCategoryAsync(CATEGORY, [
      { identifier: COMPLETE, buttonTitle: '완료', options: { opensAppToForeground: false } },
      { identifier: SNOOZE, buttonTitle: SNOOZE_MINUTES + '분 뒤', options: { opensAppToForeground: false } },
      { identifier: POSTPONE, buttonTitle: '내일로', options: { opensAppToForeground: false } },
    ]);
    await Notifications.setNotificationCategoryAsync(HABIT_CATEGORY, [
      { identifier: LOG_HABIT, buttonTitle: '기록하기', options: { opensAppToForeground: false } },
      { identifier: SNOOZE_HABIT, buttonTitle: '1시간 뒤', options: { opensAppToForeground: false } },
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

/** What the alert says: the time, repeat and project, then notes and open subtasks, with 완료 · 15분 뒤 · 내일로 buttons. */
export function reminderContent(
  task: Task, occurrence: string, settings: ReminderSettings, context: ReminderContext, lead: number = settings.leadMinutes, at?: number,
): Notifications.NotificationContentInput {
  const due = Temporal.Instant.from(occurrence).toZonedDateTimeISO(task.timezone);
  const time = formatTime(due.hour * 60 + due.minute);
  const dueDay = due.toPlainDate();
  const alertDay = at === undefined ? dueDay : Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(task.timezone).toPlainDate();
  const when = task.all_day ? formatDate(dueDay, alertDay) + ' · 종일'
    : !dueDay.equals(alertDay) ? formatDate(dueDay, alertDay) + ' ' + time
      : lead ? leadAhead(lead) + ' · ' + time : time;
  const base = { title: task.title, sound: true, priority: 'high', color: NOTIFICATION_COLOR, data: { url: 'dayframe:///task/' + task.id } };
  const facts = [when, describeRecurrence(task.recurrence_rule, task.recurrence_mode), context.projectName(task) ? '#' + context.projectName(task) : null];
  const lines = [facts.filter(Boolean).join(' · ')];
  const notes = task.notes?.trim();
  if (notes) lines.push(notes.length > 140 ? notes.slice(0, 139) + '…' : notes);
  const subtasks = context.openSubtasks(task);
  if (subtasks) lines.push('하위 작업 ' + subtasks + '개 남음');
  return { ...base, body: lines.join('\n'), categoryIdentifier: CATEGORY };
}

function signature(item: { at: number }, content: Notifications.NotificationContentInput): string {
  return [item.at, content.title, content.body, content.categoryIdentifier ?? ''].join('|');
}

/** A habit with an alert time, as the app knows it right now. */
export interface HabitReminderInfo { id: string; name: string; time: string; timezone: string; doneThrough: string | null; progress: string }

/**
 * Makes the device's scheduled alerts match the task list: new and changed ones are scheduled,
 * the rest withdrawn. Alerts the system already holds unchanged are left alone.
 */
export async function syncReminders(
  tasks: Task[], settings: ReminderSettings, context: ReminderContext,
  extra: { overrides?: ReminderOverrides; habits?: HabitReminderInfo[] } = {},
): Promise<void> {
  await prepareReminders();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const own = extra.overrides?.tasks ?? {};
  const granted = (await reminderPermission()) === 'granted';
  const now = Date.now();
  const stepRepeat = (task: { id: string }, after: string) => {
    const full = byId.get(task.id)!;
    const floor = after === full.due_at ? occurrenceFloor(full, Temporal.Instant.from(after)) : Temporal.Instant.from(after);
    return nextOccurrence(full.recurrence_rule!, full.timezone, full.recurrence_anchor_at ?? full.due_at!, floor,
      full.all_day, full.recurrence_local_time, full.recurrence_mode);
  };
  const planned: (PlannedReminder & { lead?: number })[] = granted
    ? planReminders(tasks, settings, now, stepRepeat, { leadFor: (task) => own[task.id] })
    : [];
  const wanted = new Map<string, { item: { at: number }; content: Notifications.NotificationContentInput; signature: string; channel: string }>(
    planned.map((item) => {
      const lead = own[item.taskId];
      const content = reminderContent(byId.get(item.taskId)!, item.occurrence, settings, context, typeof lead === 'number' ? lead : settings.leadMinutes, item.at);
      return [item.id, { item, content, signature: signature(item, content), channel: CHANNEL }] as const;
    }));

  // Daily Today briefing digest (only on days with actual tasks).
  for (const briefing of granted ? planBriefingReminders(tasks, settings, now, deviceTimeZone(), stepRepeat) : []) {
    const total = briefing.todayCount + briefing.overdueCount;
    const title = briefing.overdueCount > 0 && briefing.todayCount > 0
      ? `오늘 할 일 ${briefing.todayCount}개 · 기한 지남 ${briefing.overdueCount}개`
      : briefing.overdueCount > 0
        ? `기한이 지난 할 일 ${briefing.overdueCount}개`
        : `오늘 할 일 ${briefing.todayCount}개`;
    const restCount = total - briefing.topTitles.length;
    const bodyLines = briefing.topTitles.map((t) => '• ' + t);
    if (restCount > 0) bodyLines.push(`외 ${restCount}개 더 있습니다`);
    const content: Notifications.NotificationContentInput = {
      title,
      body: bodyLines.join('\n'),
      sound: true,
      priority: 'high',
      color: NOTIFICATION_COLOR,
      data: { url: 'dayframe:///' },
    };
    wanted.set(briefing.id, { item: briefing, content, signature: signature(briefing, content), channel: CHANNEL });
  }

  // Habit alerts follow their own times and are not affected by the task alert switch.
  const habits = new Map((extra.habits ?? []).map((habit) => [habit.id, habit]));
  for (const item of granted ? planHabitReminders(extra.habits ?? [], now) : []) {
    const habit = habits.get(item.habitId)!;
    const content: Notifications.NotificationContentInput = {
      title: habit.name, body: item.date === Temporal.Now.plainDateISO(habit.timezone).toString() ? habit.progress : '오늘의 습관을 기록할 시간입니다.',
      sound: true, priority: 'high', color: NOTIFICATION_COLOR, categoryIdentifier: HABIT_CATEGORY, data: { url: 'dayframe:///habit/' + habit.id },
    };
    wanted.set(item.id, { item, content, signature: signature(item, content), channel: CHANNEL });
  }

  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  const kept = new Set<string>();
  for (const request of scheduled) {
    const id = request.identifier;
    // Habit data not loaded yet says nothing about habit alerts, so those already scheduled stay.
    if ((id.startsWith(HABIT_PREFIX) || id.startsWith(HABIT_SNOOZE_PREFIX)) && extra.habits === undefined) continue;
    if (id.startsWith(REMINDER_PREFIX) || id.startsWith(HABIT_PREFIX) || id.startsWith(BRIEFING_PREFIX)) {
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
    } else if (id.startsWith(HABIT_SNOOZE_PREFIX)) {
      const parsed = parseHabitReminderId(id);
      const habit = parsed ? habits.get(parsed.habitId) : undefined;
      if (!habit || (habit.doneThrough && Temporal.PlainDate.compare(Temporal.PlainDate.from(parsed!.date), Temporal.PlainDate.from(habit.doneThrough)) <= 0)) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      }
    }
  }
  for (const [id, { item, content, signature: sig, channel }] of wanted) {
    if (kept.has(id)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { ...content, data: { ...content.data, signature: sig } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: item.at, channelId: channel },
    }).catch(() => {});
  }
}

/** Withdraws every task, habit, and briefing alert, for signing out or turning alerts off. */
export async function clearReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled
    .filter((request) => [REMINDER_PREFIX, SNOOZE_PREFIX, HABIT_PREFIX, HABIT_SNOOZE_PREFIX, BRIEFING_PREFIX].some((prefix) => request.identifier.startsWith(prefix)))
    .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier).catch(() => {})));
}

type Response = Pick<Notifications.NotificationResponse, 'actionIdentifier'> & {
  notification: { request: { identifier: string; content?: { title?: string | null; body?: string | null } } };
};

/**
 * Handles 완료, 15분 뒤, 내일로, and 습관 기록하기/1시간 뒤 buttons. Runs identically in foreground or background.
 */
export async function handleReminderAction(response: Response): Promise<void> {
  const id = response.notification.request.identifier;
  if (parseBriefingReminderId(id)) {
    await Notifications.dismissNotificationAsync(id).catch(() => {});
    return;
  }
  const habit = parseHabitReminderId(id);
  if (habit) {
    await Notifications.dismissNotificationAsync(id).catch(() => {});
    if (response.actionIdentifier === SNOOZE_HABIT) {
      const content = response.notification.request.content ?? {};
      await prepareReminders();
      await Notifications.scheduleNotificationAsync({
        identifier: HABIT_SNOOZE_PREFIX + habit.habitId + '-' + habit.date,
        content: {
          title: content.title ?? '습관', body: content.body ?? '오늘의 습관을 기록할 시간입니다.',
          sound: true, priority: 'high', color: NOTIFICATION_COLOR,
          categoryIdentifier: HABIT_CATEGORY, data: { url: 'dayframe:///habit/' + habit.habitId },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: Date.now() + HABIT_SNOOZE_MINUTES * 60_000, channelId: CHANNEL },
      }).catch(() => {});
      return;
    }
    if (response.actionIdentifier === LOG_HABIT) await logHabitFromAlert(habit.habitId, habit.date);
    return;
  }
  const parsed = parseReminderId(id);
  if (!parsed) return;
  await Notifications.dismissNotificationAsync(id).catch(() => {});
  if (response.actionIdentifier === SNOOZE) {
    const content = response.notification.request.content ?? {};
    await prepareReminders();
    await Notifications.scheduleNotificationAsync({
      identifier: SNOOZE_PREFIX + id.replace(/^(task|snooze)-/, ''),
      content: {
        title: content.title ?? '할 일', body: content.body ?? '', sound: true, priority: 'high', color: NOTIFICATION_COLOR,
        categoryIdentifier: CATEGORY, data: { url: 'dayframe:///task/' + parsed.taskId },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: Date.now() + SNOOZE_MINUTES * 60_000, channelId: CHANNEL },
    }).catch(() => {});
    return;
  }
  if (response.actionIdentifier === POSTPONE) {
    const outcome = await postponeOccurrenceToTomorrow(parsed.taskId, parsed.occurrence);
    if (outcome.status === 'failed') {
      await Notifications.scheduleNotificationAsync({
        content: { title: '일정을 미루지 못했습니다', body: '인터넷 연결을 확인한 뒤 앱에서 일정을 변경해 주세요.', data: { url: 'dayframe:///task/' + parsed.taskId } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: CHANNEL },
      }).catch(() => {});
      return;
    }
    await cancelOccurrence(parsed.taskId, parsed.occurrence);
    if (outcome.status === 'done' && outcome.task.due_at) {
      const [settings, overrides] = await Promise.all([loadReminderSettings(), loadReminderOverrides()]);
      const own = overrides.tasks[outcome.task.id];
      if (settings.enabled && own !== 'off') {
        const at = alertTime(outcome.task, outcome.task.due_at, settings, own);
        if (at !== null && at > Date.now()) {
          const lead = typeof own === 'number' ? own : settings.leadMinutes;
          const content = reminderContent(
            outcome.task,
            outcome.task.due_at,
            settings,
            { projectName: () => undefined, openSubtasks: () => 0 },
            lead,
            at,
          );
          const nextId = reminderId(outcome.task.id, outcome.task.due_at);
          const sig = signature({ at }, content);
          await prepareReminders();
          await Notifications.scheduleNotificationAsync({
            identifier: nextId,
            content: { ...content, data: { ...content.data, signature: sig } },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
          }).catch(() => {});
        }
      }
    }
    await widgetTaskChanged(parsed.taskId, outcome.task);
    return;
  }
  if (response.actionIdentifier !== COMPLETE) return;
  const outcome = await completeOccurrence(parsed.taskId, parsed.occurrence);
  if (outcome.status === 'failed') {
    await Notifications.scheduleNotificationAsync({
      content: { title: '완료하지 못했습니다', body: '인터넷 연결을 확인한 뒤 앱에서 다시 완료해 주세요.', data: { url: 'dayframe:///task/' + parsed.taskId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: CHANNEL },
    }).catch(() => {});
    return;
  }
  await cancelOccurrence(parsed.taskId, parsed.occurrence);
  await widgetTaskChanged(parsed.taskId, outcome.task, { completed: outcome.status === 'done' });
}

/**
 * Listens while the app runs: a tap on an alert opens its task/habit/today screen, and a button pressed while the app
 * is in front is handled here (in the background the task registered in `src/background.ts` handles it instead).
 */
export function listenForReminders(
  open: (target: { taskId: string } | { habitId: string } | { today: true }) => void,
  changed: () => void,
): () => void {
  const respond = (response: Notifications.NotificationResponse) => {
    const id = response.notification.request.identifier;
    const task = parseReminderId(id);
    const habit = parseHabitReminderId(id);
    const briefing = parseBriefingReminderId(id);
    if (!task && !habit && !briefing) return;
    if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      if (briefing) open({ today: true });
      else if (task) open({ taskId: task.taskId });
      else open({ habitId: habit!.habitId });
    } else if (AppState.currentState === 'active') {
      void handleReminderAction(response).then(changed);
    }
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(respond);
  const launch = Notifications.getLastNotificationResponse();
  if (launch) {
    Notifications.clearLastNotificationResponse();
    if (launch.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      respond(launch);
    }
  }
  return () => subscription.remove();
}

/** The 기록하기 button: one check-in for that day, by the same rule as a tap in the app. */
async function logHabitFromAlert(habitId: string, date: string): Promise<void> {
  try {
    const [habits, logs] = await Promise.all([api.habits(), api.habitLogs(habitId)]);
    const habit = habits.find((item) => item.id === habitId);
    if (!habit || habit.archived_at) return;
    const day = Temporal.PlainDate.from(date);
    const weekStart = day.subtract({ days: day.dayOfWeek - 1 });
    const inPeriod = logs.filter((log) => (habit.cadence === 'weekly'
      ? Temporal.PlainDate.compare(Temporal.PlainDate.from(log.log_date), weekStart) >= 0 && Temporal.PlainDate.compare(Temporal.PlainDate.from(log.log_date), day) <= 0
      : log.log_date === date));
    const todayCount = logs.find((log) => log.log_date === date)?.count ?? 0;
    const progress = inPeriod.reduce((sum, log) => sum + log.count, 0);
    if (progress >= habit.target_count) return;
    const next = nextCheckIn(habit, todayCount, progress);
    if (!next.status) return;
    await api.setHabitLog(habitId, date, { status: next.status, count: next.count });
    await widgetHabitChanged(habitId, date, next.count, progress + next.count - todayCount);
  } catch {
    await Notifications.scheduleNotificationAsync({
      content: { title: '기록하지 못했습니다', body: '인터넷 연결을 확인한 뒤 앱에서 다시 기록해 주세요.', data: { url: 'dayframe:///habit/' + habitId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: CHANNEL },
    }).catch(() => {});
  }
}

/** The phone's own notification settings for this app: popup style, lock screen, sound. */
export async function openNotificationSettings(): Promise<void> {
  try {
    const IntentLauncher = await import('expo-intent-launcher');
    const Application = await import('expo-application');
    await IntentLauncher.startActivityAsync('android.settings.APP_NOTIFICATION_SETTINGS', {
      extra: { 'android.provider.extra.APP_PACKAGE': Application.applicationId ?? 'com.ggumtak.dayframe' },
    });
  } catch {
    await Linking.openSettings().catch(() => {});
  }
}
