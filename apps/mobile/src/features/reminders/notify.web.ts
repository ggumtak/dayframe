import type { Task } from '@/lib/shared';

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
export async function syncReminders(_tasks: Task[], _settings: ReminderSettings, _context: ReminderContext): Promise<void> {}
export async function clearReminders(): Promise<void> {}
export async function handleReminderAction(_response: unknown): Promise<void> {}
export function listenForReminders(_open: (taskId: string) => void, _changed: () => void): () => void { return () => {}; }
