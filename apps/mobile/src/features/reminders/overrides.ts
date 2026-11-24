import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { cleanReminder, type TaskReminder } from './lead';

export type { TaskReminder };

/**
 * Per-task alert timing and per-habit alert times. They live on this phone only: alerts are scheduled
 * here, and keeping them out of the shared data means the AI assistant and the server never see them.
 */
export interface ReminderOverrides {
  tasks: Record<string, TaskReminder>;
  /** "HH:MM" in the habit's own time zone. */
  habits: Record<string, string>;
}

const KEY = 'dayframe-reminder-overrides';
let current: ReminderOverrides = { tasks: {}, habits: {} };
let loaded: Promise<ReminderOverrides> | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function loadReminderOverrides(): Promise<ReminderOverrides> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((stored) => {
      const parsed = stored ? JSON.parse(stored) as Partial<ReminderOverrides> : {};
      // Values saved by older versions (0, 5, 10, 30, 60 or 'off') read back unchanged; anything unreadable is dropped.
      const tasks: Record<string, TaskReminder> = {};
      for (const [id, value] of Object.entries(parsed.tasks ?? {})) {
        const clean = cleanReminder(value);
        if (clean !== undefined) tasks[id] = clean;
      }
      current = { tasks, habits: parsed.habits ?? {} };
      notify();
      return current;
    })
    .catch(() => current);
  return loaded;
}

function save(next: ReminderOverrides) {
  current = next;
  loaded = Promise.resolve(next);
  notify();
  AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
}

export function setTaskReminder(taskId: string, value: TaskReminder | null): void {
  const tasks = { ...current.tasks };
  if (value === null) delete tasks[taskId];
  else tasks[taskId] = cleanReminder(value) ?? 'off';
  save({ ...current, tasks });
}

export function setHabitReminder(habitId: string, time: string | null): void {
  const habits = { ...current.habits };
  if (time === null) delete habits[habitId];
  else habits[habitId] = time;
  save({ ...current, habits });
}

export function useReminderOverrides(): ReminderOverrides {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    void loadReminderOverrides();
    return () => { listeners.delete(listener); };
  }, () => current, () => current);
}
