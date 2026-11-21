import type { Task } from '@/lib/shared';

import type { ReminderOverrides } from './overrides';
import type { ReminderSettings } from './plan';

// Scheduled alerts need the device's notification service, which the web build does not have.
export type PermissionState = 'granted' | 'denied' | 'undetermined';
export interface ReminderContext {
  projectName: (task: Task) => string | undefined;
  openSubtasks: (task: Task) => number;
}
export const COMPLETE = 'complete';
export const SNOOZE = 'snooze';
export async function prepareReminders(): Promise<void> {}
export async function reminderPermission(): Promise<PermissionState> { return 'denied'; }
export async function requestReminderPermission(_force?: boolean): Promise<PermissionState> { return 'denied'; }
export interface HabitReminderInfo { id: string; name: string; time: string; timezone: string; doneThrough: string | null; progress: string }
export async function syncReminders(
  _tasks: Task[], _settings: ReminderSettings, _context: ReminderContext, _extra?: { overrides?: ReminderOverrides; habits?: HabitReminderInfo[] },
): Promise<void> {}
export async function clearReminders(): Promise<void> {}
export async function handleReminderAction(_response: unknown): Promise<void> {}
export function listenForReminders(_open: (target: { taskId: string } | { habitId: string }) => void, _changed: () => void): () => void { return () => {}; }
export async function openNotificationSettings(): Promise<void> {}
