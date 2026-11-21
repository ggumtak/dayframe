import { requestPinWidget, requestWidgetUpdate, type WidgetTaskHandler } from 'react-native-android-widget';

import { cancelOccurrence } from '@/features/reminders/cancel';
import { completeOccurrence } from '@/features/reminders/complete';
import { api } from '@/lib/api';
import { deviceTimeZone } from '@/lib/dates';
import type { Task } from '@/lib/shared';

import { snapshotTasks, type WidgetSnapshot, widgetDate, widgetRows } from './items';
import { readSnapshot, withTask, writeSnapshot } from './store';
import { COMPLETE_ACTION, todayWidget, WIDGET_NAME } from './TodayWidget';

function draw(snapshot: WidgetSnapshot) {
  const now = Date.now();
  return todayWidget({ rows: widgetRows(snapshot.tasks, now), date: widgetDate(now, deviceTimeZone()), signedIn: snapshot.signedIn, notice: snapshot.notice });
}

/** Redraws every placed widget from a snapshot. Does nothing when no widget is on the home screen. */
export async function redrawWidgets(snapshot?: WidgetSnapshot): Promise<void> {
  const current = snapshot ?? await readSnapshot();
  await requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => draw(current) }).catch(() => {});
}

/** Called by the app whenever its task list changes. */
export async function saveWidget(tasks: Task[] | null): Promise<void> {
  const snapshot: WidgetSnapshot = tasks ? { signedIn: true, tasks: snapshotTasks(tasks, Date.now()) } : { signedIn: false, tasks: [] };
  await writeSnapshot(snapshot);
  await redrawWidgets(snapshot);
}

/** Applies a completion made outside the app to the widget. */
export async function widgetTaskChanged(taskId: string, task: Task | null): Promise<void> {
  const snapshot = withTask(await readSnapshot(), taskId, task);
  await writeSnapshot(snapshot);
  await redrawWidgets(snapshot);
}

/** A fresh list from the server, used when the home screen asks for an update while the app is closed. */
async function fetched(snapshot: WidgetSnapshot): Promise<WidgetSnapshot> {
  if (!snapshot.signedIn) return snapshot;
  try {
    const tasks = await Promise.race([
      api.openTasks(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
    const next = { signedIn: true, tasks: snapshotTasks(tasks, Date.now()) };
    await writeSnapshot(next);
    return next;
  } catch {
    return snapshot;
  }
}

export const widgetTaskHandler: WidgetTaskHandler = async ({ widgetAction, clickAction, clickActionData, renderWidget }) => {
  if (widgetAction === 'WIDGET_DELETED') return;
  let snapshot = await readSnapshot();
  if (widgetAction === 'WIDGET_CLICK' && clickAction === COMPLETE_ACTION) {
    const id = String(clickActionData?.id ?? '');
    const occurrence = String(clickActionData?.occurrence ?? '');
    // The row leaves at once; the server is told afterwards.
    renderWidget(draw({ ...snapshot, notice: null, tasks: snapshot.tasks.filter((task) => task.id !== id) }));
    const outcome = await completeOccurrence(id, occurrence);
    if (outcome.status === 'failed') {
      snapshot = { ...snapshot, notice: '연결이 없어 완료하지 못했습니다' };
      await writeSnapshot(snapshot);
    } else {
      await widgetTaskChanged(id, outcome.task);
      await cancelOccurrence(id, occurrence);
      snapshot = await readSnapshot();
    }
    renderWidget(draw(snapshot));
    return;
  }
  if (widgetAction === 'WIDGET_UPDATE' || widgetAction === 'WIDGET_ADDED') {
    renderWidget(draw(snapshot));
    snapshot = await fetched(snapshot);
  }
  renderWidget(draw(snapshot));
};

/** Asks the launcher to place the widget; false when the launcher does not offer that. */
export function pinWidget(): Promise<boolean> {
  return requestPinWidget({ widgetName: WIDGET_NAME }).catch(() => false);
}
