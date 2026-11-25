import { Temporal } from '@js-temporal/polyfill';

import { ApiFailure, api } from '@/lib/api';
import type { Task } from '@/lib/shared';

import { stableUuid } from './plan';

export type Completion =
  | { status: 'done'; task: Task }
  /** Someone already finished, moved or deleted this occurrence; there is nothing left to do. */
  | { status: 'gone'; task: Task | null }
  | { status: 'failed' };

/**
 * Completes one occurrence of a task from outside the app (a notification button or the widget).
 * The task is read first so a stale alert never completes a later occurrence of a repeating task,
 * and the request id is derived from the occurrence so a second tap changes nothing.
 */
export async function completeOccurrence(taskId: string, occurrence: string): Promise<Completion> {
  try {
    const task = await api.task(taskId);
    if (task.completed_at || !task.due_at || Date.parse(task.due_at) !== Date.parse(occurrence)) return { status: 'gone', task };
    const result = await api.completeTask(taskId, {
      // Same tap, same id; a reopen changes `updated_at`, so completing again later is a new request.
      request_id: stableUuid(taskId + '@' + Date.parse(occurrence) + '@' + task.updated_at), expected_updated_at: task.updated_at,
    });
    return { status: 'done', task: result.task };
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) return { status: 'gone', task: null };
    return { status: 'failed' };
  }
}

/**
 * Postpones one occurrence to tomorrow in the task's own time zone, keeping its wall time (or all-day status)
 * and preserving a repeating series's anchor via `preserve_recurrence: true`.
 */
export async function postponeOccurrenceToTomorrow(taskId: string, occurrence: string): Promise<Completion> {
  try {
    const task = await api.task(taskId);
    if (task.completed_at || !task.due_at || Date.parse(task.due_at) !== Date.parse(occurrence)) return { status: 'gone', task };
    const zone = task.timezone;
    const dueZdt = Temporal.Instant.from(task.due_at).toZonedDateTimeISO(zone);
    const todayDate = Temporal.Now.plainDateISO(zone);
    const baseDate = Temporal.PlainDate.compare(dueZdt.toPlainDate(), todayDate) < 0 ? todayDate : dueZdt.toPlainDate();
    const tomorrow = baseDate.add({ days: 1 });
    const nextDueAt = task.all_day
      ? tomorrow.toZonedDateTime(zone).toInstant().toString()
      : tomorrow.toZonedDateTime({ timeZone: zone, plainTime: { hour: dueZdt.hour, minute: dueZdt.minute } }).toInstant().toString();
    const updated = await api.updateTask(
      taskId,
      task.recurrence_rule
        ? { due_at: nextDueAt, expected_due_at: task.due_at, preserve_recurrence: true }
        : { due_at: nextDueAt, all_day: task.all_day },
    );
    return { status: 'done', task: updated };
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) return { status: 'gone', task: null };
    return { status: 'failed' };
  }
}
