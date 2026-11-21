import { requestPinWidget, requestWidgetUpdate, type WidgetTaskHandler } from 'react-native-android-widget';

import { nextCheckIn } from '@/features/habits/checkIn';
import { cancelOccurrence } from '@/features/reminders/cancel';
import { completeOccurrence } from '@/features/reminders/complete';
import { cancelAlert, scheduleAlert } from '@/lib/alerts';
import { api } from '@/lib/api';
import { deviceTimeZone } from '@/lib/dates';
import { uuid } from '@/lib/ids';
import type { Task } from '@/lib/shared';

import {
  focusState, habitToday, snapshotTasks, upcomingRows, type WidgetFocus, type WidgetHabit, type WidgetSnapshot, widgetDate, widgetRows,
} from './items';
import { readSnapshot, withTask, writeSnapshot } from './store';
import { ACTIONS, type WidgetName, WIDGETS } from './names';
import { focusWidget, habitsWidget, quickAddWidget, todayWidget, upcomingWidget } from './widgets';

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

async function update(change: (snapshot: WidgetSnapshot) => WidgetSnapshot): Promise<WidgetSnapshot> {
  const next = change(await readSnapshot());
  await writeSnapshot(next);
  await redrawWidgets(next);
  return next;
}

/** Called by the app whenever its data changes. `null` tasks means signed out. */
export async function saveWidget(tasks: Task[] | null, extra: { habits?: WidgetHabit[]; focus?: WidgetFocus | null } = {}): Promise<void> {
  await update((previous) => (tasks ? {
    signedIn: true, tasks: snapshotTasks(tasks, Date.now()),
    habits: extra.habits ?? previous.habits, focus: extra.focus !== undefined ? extra.focus : previous.focus,
  } : { signedIn: false, tasks: [] }));
}

/** Applies a completion made outside the app to the widgets. */
export async function widgetTaskChanged(taskId: string, task: Task | null): Promise<void> {
  await update((snapshot) => withTask(snapshot, taskId, task));
}

/** Fresh tasks from the server, used when the home screen asks for an update while the app is closed. */
async function fetched(snapshot: WidgetSnapshot): Promise<WidgetSnapshot> {
  if (!snapshot.signedIn) return snapshot;
  try {
    const tasks = await Promise.race([
      api.openTasks(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
    const next = { ...snapshot, notice: null, tasks: snapshotTasks(tasks, Date.now()) };
    await writeSnapshot(next);
    return next;
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
  } catch {
    // Put the figures back so the widget never shows a check the server does not have.
    await update((current) => ({ ...current, notice: '연결이 없어 기록하지 못했습니다', habits: current.habits?.map((item) => (item.id === id ? habit : item)) }));
  }
}

async function startFocus(minutes: number): Promise<void> {
  const startedAt = new Date().toISOString();
  const id = uuid();
  try {
    await api.startFocus({ id, started_at: startedAt, planned_seconds: minutes * 60 });
  } catch {
    await update((current) => ({ ...current, notice: '연결이 없어 시작하지 못했습니다' }));
    return;
  }
  await update((current) => ({
    ...current, notice: null,
    focus: { ...(current.focus ?? { date: '', count: 0, seconds: 0 }), running: { id, startedAt, plannedSeconds: minutes * 60 } },
  }));
  await scheduleAlert('focus', Date.parse(startedAt) + minutes * 60_000, `집중 ${minutes}분 완료`, `${minutes === 50 ? 10 : 5}분 쉬어 가세요.`);
}

async function stopFocus(id: string): Promise<void> {
  try {
    await api.finishFocus(id, { status: 'cancelled', ended_at: new Date().toISOString() });
  } catch {
    await update((current) => ({ ...current, notice: '연결이 없어 멈추지 못했습니다' }));
    return;
  }
  await cancelAlert('focus');
  await update((current) => ({ ...current, notice: null, focus: current.focus ? { ...current.focus, running: null } : null }));
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
    renderWidget(drawWidget(name, await readSnapshot()));
    return;
  }
  let snapshot = await readSnapshot();
  renderWidget(drawWidget(name, snapshot));
  if ((widgetAction === 'WIDGET_UPDATE' || widgetAction === 'WIDGET_ADDED') && (name === WIDGETS.today || name === WIDGETS.upcoming)) {
    snapshot = await fetched(snapshot);
    renderWidget(drawWidget(name, snapshot));
  }
};

/** Asks the launcher to place a widget; false when the launcher does not offer that. */
export function pinWidget(widgetName: WidgetName = WIDGETS.today): Promise<boolean> {
  return requestPinWidget({ widgetName }).catch(() => false);
}
