import { requestWidgetUpdate, type WidgetTaskHandler } from 'react-native-android-widget';

import { nextCheckIn } from '@/features/habits/checkIn';
import { cancelHabitAlert, cancelOccurrence } from '@/features/reminders/cancel';
import { completeOccurrence } from '@/features/reminders/complete';
import { cancelAlert, scheduleAlert } from '@/lib/alerts';
import { ApiFailure, api } from '@/lib/api';
import { deviceTimeZone, today as localToday } from '@/lib/dates';
import { uuid } from '@/lib/ids';
import { countByDate } from '@/lib/occurrences';
import { nextOccurrence, type Task } from '@/lib/shared';

import {
  CALENDAR_RANGE, calendarGrid, focusState, habitToday, snapshotTasks, upcomingRows, type WidgetFocus, type WidgetHabit, type WidgetSnapshot, widgetDate, widgetRows,
} from './items';
import { externalChange } from './events';
import { readSnapshot, withTask, writeSnapshot } from './store';
import { ACTIONS, type WidgetName, WIDGETS } from './names';
import { calendarWidget, focusWidget, habitsWidget, quickAddWidget, todayWidget, upcomingWidget } from './widgets';

/** The picture of one widget, drawn from the snapshot at this moment. */
export function drawWidget(name: string, snapshot: WidgetSnapshot, now = Date.now()) {
  const zone = deviceTimeZone();
  const { signedIn, notice } = snapshot;
  switch (name) {
    case WIDGETS.upcoming:
      return upcomingWidget({ rows: upcomingRows(snapshot.tasks, now, zone), signedIn });
    case WIDGETS.habits:
      return habitsWidget({
        signedIn, notice,
        rows: (snapshot.habits ?? []).map((habit) => {
          const today = habitToday(habit, now);
          const weekly = habit.cadence === 'weekly';
          const label = (weekly ? '이번 주 ' : '') + today.progress + '/' + habit.target_count;
          return { id: habit.id, name: habit.name, label, ratio: today.progress / habit.target_count, date: today.date };
        }),
      });
    case WIDGETS.focus: {
      const state = focusState(snapshot.focus, now, zone);
      return focusWidget({
        signedIn, notice, running: state.running, endsAt: state.endsAt, count: state.count, minutes: state.minutes,
        plannedMinutes: state.running ? Math.round(state.running.plannedSeconds / 60) : null,
      });
    }
    case WIDGETS.quickAdd:
      return quickAddWidget();
    case WIDGETS.calendar: {
      const offset = snapshot.calendarOffset ?? 0;
      const grid = calendarGrid(now, zone, offset, snapshot.calendar ?? {});
      return calendarWidget({ signedIn, ...grid, stamp: now, canBack: offset > -CALENDAR_RANGE.back, canAhead: offset < CALENDAR_RANGE.ahead });
    }
    default:
      return todayWidget({ rows: widgetRows(snapshot.tasks, now), date: widgetDate(now, zone), signedIn, notice });
  }
}

/** Redraws every placed widget from a snapshot. Widgets not on the home screen cost nothing. */
export async function redrawWidgets(snapshot?: WidgetSnapshot): Promise<void> {
  const current = snapshot ?? await readSnapshot();
  await Promise.all(Object.values(WIDGETS).map((widgetName) =>
    requestWidgetUpdate({ widgetName, renderWidget: () => drawWidget(widgetName, current) }).catch(() => {})));
}

// Each change reads the newest snapshot only after the one before it is written, so the app's saves and
// the widget's own taps never overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

function update(change: (snapshot: WidgetSnapshot) => WidgetSnapshot): Promise<WidgetSnapshot> {
  const run = queue.then(async () => {
    const next = change(await readSnapshot());
    await writeSnapshot(next);
    await redrawWidgets(next);
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

/** Called by the app whenever its data changes. `null` tasks means signed out. */
export async function saveWidget(
  tasks: Task[] | null, extra: { habits?: WidgetHabit[]; focus?: WidgetFocus | null; calendar?: Record<string, number> } = {},
): Promise<void> {
  await update((previous) => (tasks ? {
    signedIn: true, tasks: snapshotTasks(tasks, Date.now()),
    habits: extra.habits ?? previous.habits, focus: extra.focus !== undefined ? extra.focus : previous.focus,
    calendar: extra.calendar ?? previous.calendar, calendarOffset: previous.calendarOffset,
  } : { signedIn: false, tasks: [] }));
}

/** Applies a completion made outside the app to the widgets. */
export async function widgetTaskChanged(taskId: string, task: Task | null): Promise<void> {
  await update((snapshot) => withTask(snapshot, taskId, task));
  externalChange();
}

/** Applies a habit check-in made outside the app (the alert's 기록하기) to the habit widget. */
export async function widgetHabitChanged(habitId: string, date: string, todayCount: number, progress: number): Promise<void> {
  await update((snapshot) => ({
    ...snapshot,
    habits: snapshot.habits?.map((habit) => (habit.id === habitId ? { ...habit, date, todayCount, progress } : habit)),
  }));
  externalChange();
}

/** Fresh tasks from the server, used when the home screen asks for an update while the app is closed. */
async function fetched(snapshot: WidgetSnapshot): Promise<WidgetSnapshot> {
  if (!snapshot.signedIn) return snapshot;
  try {
    const tasks = await Promise.race([
      api.openTasks(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
    const month = localToday(deviceTimeZone()).toPlainYearMonth();
    const end = month.add({ months: CALENDAR_RANGE.ahead });
    const calendar = countByDate(tasks, month.subtract({ months: CALENDAR_RANGE.back }).toPlainDate({ day: 1 }),
      end.toPlainDate({ day: end.daysInMonth }), nextOccurrence);
    // Merged into the newest snapshot: a tap made during the fetch is kept.
    return await update((current) => ({ ...current, notice: null, tasks: snapshotTasks(tasks, Date.now()), calendar }));
  } catch {
    return snapshot;
  }
}

async function checkInHabit(id: string): Promise<void> {
  const snapshot = await readSnapshot();
  const habit = snapshot.habits?.find((item) => item.id === id);
  if (!habit) return;
  const today = habitToday(habit, Date.now());
  const next = nextCheckIn(habit, today.todayCount, today.progress);
  const delta = next.count - today.todayCount;
  const changed = (item: WidgetHabit): WidgetHabit => (item.id !== id ? item
    : { ...item, date: today.date, todayCount: next.count, progress: Math.max(0, today.progress + delta) });
  await update((current) => ({ ...current, notice: null, habits: current.habits?.map(changed) }));
  try {
    if (next.status === null) await api.deleteHabitLog(id, today.date);
    else await api.setHabitLog(id, today.date, { status: next.status, count: next.count });
    // A goal met here needs no reminder later today.
    if (next.reaches) await cancelHabitAlert(id, today.date);
    externalChange();
  } catch {
    // Put the figures back so the widget never shows a check the server does not have.
    await update((current) => ({ ...current, notice: '연결이 없어 기록하지 못했습니다', habits: current.habits?.map((item) => (item.id === id ? habit : item)) }));
  }
}

/**
 * Records a session whose time ran out as completed. Only the Focus tab does this on its own, so a session
 * started here would otherwise stay "running" on the server and block the next one.
 */
async function closeStale(running: { id: string; startedAt: string; plannedSeconds: number } | null | undefined): Promise<void> {
  if (!running) return;
  const end = Date.parse(running.startedAt) + running.plannedSeconds * 1000;
  if (end > Date.now()) return;
  await api.finishFocus(running.id, { status: 'completed', ended_at: new Date(end).toISOString() }).catch(() => {});
}

async function startFocus(minutes: number): Promise<void> {
  const startedAt = new Date().toISOString();
  const id = uuid();
  const start = () => api.startFocus({ id, started_at: startedAt, planned_seconds: minutes * 60 });
  try {
    await closeStale((await readSnapshot()).focus?.running);
    try {
      await start();
    } catch (error) {
      if (!(error instanceof ApiFailure && error.status === 409)) throw error;
      // Another session is still open on the server: finish it if its time is up, then try once more.
      const open = (await api.focusSessions()).find((session) => session.status === 'running');
      if (!open) throw error;
      const end = Date.parse(open.started_at) + open.planned_seconds * 1000;
      if (end > Date.now()) {
        await update((current) => ({
          ...current, notice: null,
          focus: { ...(current.focus ?? { date: '', count: 0, seconds: 0 }), running: { id: open.id, startedAt: open.started_at, plannedSeconds: open.planned_seconds } },
        }));
        return;
      }
      await closeStale({ id: open.id, startedAt: open.started_at, plannedSeconds: open.planned_seconds });
      await start();
    }
  } catch (error) {
    await update((current) => ({ ...current, notice: error instanceof ApiFailure ? '시작하지 못했습니다. 앱에서 확인해 주세요' : '연결이 없어 시작하지 못했습니다' }));
    return;
  }
  await update((current) => ({
    ...current, notice: null,
    focus: { ...(current.focus ?? { date: '', count: 0, seconds: 0 }), running: { id, startedAt, plannedSeconds: minutes * 60 } },
  }));
  await scheduleAlert('focus', Date.parse(startedAt) + minutes * 60_000, `집중 ${minutes}분 완료`, `${minutes === 50 ? 10 : 5}분 쉬어 가세요.`);
  externalChange();
}

async function stopFocus(id: string): Promise<void> {
  const running = (await readSnapshot()).focus?.running;
  const end = running && running.id === id ? Date.parse(running.startedAt) + running.plannedSeconds * 1000 : Infinity;
  try {
    // A round whose time already ran out counts as done, not as given up.
    await api.finishFocus(id, end <= Date.now()
      ? { status: 'completed', ended_at: new Date(end).toISOString() }
      : { status: 'cancelled', ended_at: new Date().toISOString() });
  } catch {
    await update((current) => ({ ...current, notice: '연결이 없어 멈추지 못했습니다' }));
    return;
  }
  await cancelAlert('focus');
  await update((current) => ({ ...current, notice: null, focus: current.focus ? { ...current.focus, running: null } : null }));
  externalChange();
}

export const widgetTaskHandler: WidgetTaskHandler = async ({ widgetInfo, widgetAction, clickAction, clickActionData, renderWidget }) => {
  if (widgetAction === 'WIDGET_DELETED') return;
  const name = widgetInfo.widgetName as WidgetName;
  const data = clickActionData ?? {};
  if (widgetAction === 'WIDGET_CLICK') {
    if (clickAction === ACTIONS.complete) {
      const id = String(data.id ?? '');
      const occurrence = String(data.occurrence ?? '');
      // The row leaves at once; the server is told afterwards.
      const before = await readSnapshot();
      renderWidget(drawWidget(name, { ...before, notice: null, tasks: before.tasks.filter((task) => task.id !== id) }));
      const outcome = await completeOccurrence(id, occurrence);
      if (outcome.status === 'failed') await update((current) => ({ ...current, notice: '연결이 없어 완료하지 못했습니다' }));
      else {
        await widgetTaskChanged(id, outcome.task);
        await cancelOccurrence(id, occurrence);
      }
    } else if (clickAction === ACTIONS.habit) await checkInHabit(String(data.id ?? ''));
    else if (clickAction === ACTIONS.startFocus) await startFocus(Number(data.minutes) === 50 ? 50 : 25);
    else if (clickAction === ACTIONS.stopFocus) await stopFocus(String(data.id ?? ''));
    else if (clickAction === ACTIONS.calendarMove) {
      const by = Number(data.by) || 0;
      await update((current) => ({
        ...current,
        calendarOffset: by === 0 ? 0 : Math.max(-CALENDAR_RANGE.back, Math.min(CALENDAR_RANGE.ahead, (current.calendarOffset ?? 0) + by)),
      }));
    }
    renderWidget(drawWidget(name, await readSnapshot()));
    return;
  }
  let snapshot = await readSnapshot();
  renderWidget(drawWidget(name, snapshot));
  if ((widgetAction === 'WIDGET_UPDATE' || widgetAction === 'WIDGET_ADDED')
    && (name === WIDGETS.today || name === WIDGETS.upcoming || name === WIDGETS.calendar)) {
    snapshot = await fetched(snapshot);
    renderWidget(drawWidget(name, snapshot));
  }
};
