import * as Notifications from 'expo-notifications';

import { reminderId, SNOOZE_PREFIX } from './plan';

/** Withdraws everything about one occurrence: its pending alert, a snoozed copy and anything on screen. */
export async function cancelOccurrence(taskId: string, occurrence: string): Promise<void> {
  const ids = [reminderId(taskId, occurrence), SNOOZE_PREFIX + reminderId(taskId, occurrence).slice('task-'.length)];
  await Promise.all(ids.flatMap((id) => [
    Notifications.cancelScheduledNotificationAsync(id).catch(() => {}),
    Notifications.dismissNotificationAsync(id).catch(() => {}),
  ]));
}
