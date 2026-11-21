import { Platform } from 'react-native';

import ApkInstaller from '../../modules/apk-installer';
import { defaultReminderSettings, planReminders, reminderId } from '../features/reminders/plan';
import { widgetRows } from '../features/widget/items';
import { deviceTimeZone, formatDue, Temporal } from './dates';
import { uuid } from './ids';
import { analyzeTask, nextOccurrence } from './shared';

/**
 * Exercises the date engine on the device's own JavaScript runtime and logs one line for CI to read.
 * Only smoke-test builds call this (EXPO_PUBLIC_SELF_CHECK=1); it is how a build is proven to parse
 * Korean dates and cross time zones on a real Android runtime before anyone installs it.
 */
export function runSelfCheck(): void {
  const checks: Record<string, () => boolean> = {
    parser: () => {
      const { task, tokens } = analyzeTask({
        text: '내일 저녁 7시 운동 매주 월수금 #건강 @외출 p2', timezone: 'Asia/Seoul', now: '2026-11-22T09:00:00Z',
      });
      return task.due_at === '2026-11-23T10:00:00Z' && task.recurrence_rule === 'FREQ=WEEKLY;BYDAY=MO,WE,FR'
        && task.title === '운동' && task.project === '건강' && task.priority === 2 && tokens.length === 6;
    },
    daylightSaving: () => nextOccurrence('FREQ=DAILY', 'America/New_York', '2026-03-07T07:30:00Z',
      Temporal.Instant.from('2026-03-08T07:30:00Z'), false) === '2026-03-09T06:30:00Z',
    formatting: () => formatDue({ due_at: '2026-11-23T10:00:00Z', timezone: 'Asia/Seoul', all_day: false })?.endsWith('오후 7:00') === true,
    deviceZone: () => Temporal.Now.plainDateISO(deviceTimeZone()).year > 2000,
    ids: () => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid()),
    reminderPlan: () => planReminders([{
      id: '11111111-1111-4111-8111-111111111111', title: 'x', due_at: '2026-11-21T10:00:00Z', all_day: false, timezone: 'Asia/Seoul',
      completed_at: null, recurrence_rule: 'FREQ=DAILY',
    }], defaultReminderSettings, Date.parse('2026-11-21T09:00:00Z'), (_task, after) =>
      nextOccurrence('FREQ=DAILY', 'Asia/Seoul', '2026-11-21T10:00:00Z', Temporal.Instant.from(after), false)).length === 4,
    widgetRows: () => widgetRows([{
      id: 'a', title: '운동', due_at: '2026-11-21T10:00:00Z', all_day: false, timezone: 'Asia/Seoul', priority: 2, updated_at: '', recurrence_rule: null,
    }], Date.parse('2026-11-21T09:00:00Z'))[0]?.when === '오후 7:00',
    // The updater's native module must survive code shrinking and answer across the bridge.
    apkInstaller: () => Platform.OS !== 'android' || (!!ApkInstaller
      && typeof ApkInstaller.canInstallPackages() === 'boolean' && ApkInstaller.inspect('file:///missing.apk') === null),
  };
  const failed: string[] = [];
  for (const [name, check] of Object.entries(checks)) {
    try {
      if (!check()) failed.push(name);
    } catch (error) {
      failed.push(name + ' (' + (error instanceof Error ? error.message : String(error)) + ')');
    }
  }
  console.log('DAYFRAME_SELF_CHECK ' + (failed.length ? 'fail: ' + failed.join(', ') : 'ok'));
  if (Platform.OS === 'android') {
    void checkDownload();
    void checkBackground();
  }
}

/** Runs the updater's download path (redirect, progress events, shareable content URI) against a small public file. */
async function checkDownload(): Promise<void> {
  try {
    const { File, Paths } = await import('expo-file-system');
    const target = new File(Paths.cache, 'dayframe-self-check.bin');
    if (target.exists) target.delete();
    let events = 0;
    const file = await File.downloadFileAsync('https://github.com/expo/expo/raw/main/LICENSE', target, {
      idempotent: true, onProgress: () => { events += 1; },
    });
    const ok = file.exists && file.size > 0 && file.contentUri.startsWith('content://');
    console.log(`DAYFRAME_SELF_CHECK_DOWNLOAD ${ok ? 'ok' : 'fail'} bytes=${file.size} progressEvents=${events}`);
    file.delete();
  } catch (error) {
    console.log('DAYFRAME_SELF_CHECK_DOWNLOAD fail: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Proves on a real Android runtime what the phone needs from this build outside the app: a task alert is
 * scheduled through the same code the app uses and appears, and the widget draws for each theme.
 */
async function checkBackground(): Promise<void> {
  const failed: string[] = [];
  try {
    const { buildWidgetTree } = await import('react-native-android-widget/src/api/build-widget-tree');
    const { drawWidget } = await import('../features/widget/render');
    const { WIDGETS } = await import('../features/widget/names');
    const now = Date.parse('2026-11-21T09:00:00Z');
    const task = { id: 'a', title: '운동', all_day: false, timezone: 'Asia/Seoul', priority: 2 as const, updated_at: '', recurrence_rule: null };
    const full = {
      signedIn: true, notice: null,
      tasks: [{ ...task, due_at: '2026-11-21T10:00:00Z' }, { ...task, id: 'b', due_at: '2026-11-23T10:00:00Z' }],
      habits: [{ id: 'h', name: '물', cadence: 'daily' as const, target_count: 8, timezone: 'Asia/Seoul', date: '2026-11-21', todayCount: 5, progress: 5 }],
      focus: { running: { id: 'f', startedAt: '2026-11-21T08:50:00Z', plannedSeconds: 1500 }, date: '2026-11-21', count: 1, seconds: 1500 },
      calendar: { '2026-11-21': 2, '2026-11-30': 1 },
    };
    for (const snapshot of [full, { ...full, tasks: [], habits: [], focus: null }, { signedIn: false, tasks: [] }]) {
      for (const name of Object.values(WIDGETS)) {
        const widget = drawWidget(name, snapshot, now) as { light: React.JSX.Element; dark: React.JSX.Element };
        buildWidgetTree(widget.light);
        buildWidgetTree(widget.dark);
      }
    }
  } catch (error) {
    failed.push('widget (' + (error instanceof Error ? error.message : String(error)) + ')');
  }
  try {
    const Notifications = await import('expo-notifications');
    const { prepareReminders, reminderContent } = await import('../features/reminders/notify');
    await prepareReminders();
    const due = new Date(Date.now() + 4000).toISOString();
    const task = {
      id: '22222222-2222-4222-8222-222222222222', title: 'Dayframe 알림 점검', due_at: due, all_day: false, timezone: deviceTimeZone(),
      notes: '자세한 알림 확인', recurrence_rule: 'FREQ=DAILY',
    } as Parameters<typeof reminderContent>[0];
    const id = reminderId(task.id, due);
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: reminderContent(task, due, defaultReminderSettings, { projectName: () => '점검', openSubtasks: () => 2 }),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: Date.parse(due), channelId: 'task-reminders' },
    });
    const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).some((item) => item.identifier === id);
    await new Promise((resolve) => setTimeout(resolve, 9000));
    const shown = (await Notifications.getPresentedNotificationsAsync()).some((item) => item.request.identifier === id);
    if (!scheduled || !shown) failed.push(`notification (scheduled=${scheduled} shown=${shown})`);
  } catch (error) {
    failed.push('notification (' + (error instanceof Error ? error.message : String(error)) + ')');
  }
  console.log('DAYFRAME_SELF_CHECK_BACKGROUND ' + (failed.length ? 'fail: ' + failed.join(', ') : 'ok'));
}
