import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Task } from '@/lib/shared';

import { adjustCalendar, snapshotTasks, type WidgetSnapshot } from './items';

const KEY = 'dayframe-widget';
const empty: WidgetSnapshot = { signedIn: false, tasks: [] };

export async function readSnapshot(): Promise<WidgetSnapshot> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    return stored ? { ...empty, ...JSON.parse(stored) as WidgetSnapshot } : empty;
  } catch {
    return empty;
  }
}

export async function writeSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(snapshot)).catch(() => {});
}

/** The snapshot after one task changed: a finished task leaves, a repeating one returns with its next date. */
export function withTask(snapshot: WidgetSnapshot, taskId: string, task: Task | null): WidgetSnapshot {
  const previous = snapshot.tasks.find((item) => item.id === taskId);
  const others = snapshot.tasks.filter((item) => item.id !== taskId);
  const active = task && !task.completed_at ? task : null;
  const next = active ? snapshotTasks([active], Date.now()) : [];
  return {
    ...snapshot, notice: null,
    tasks: [...others, ...next].sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!)),
    calendar: adjustCalendar(snapshot.calendar, previous, active),
  };
}
