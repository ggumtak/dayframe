import { Temporal } from '@js-temporal/polyfill';

import type { Task } from './shared';

export type OccurrenceTask = Pick<Task, 'id' | 'due_at' | 'all_day' | 'timezone' | 'recurrence_rule' | 'recurrence_anchor_at' | 'recurrence_local_time'>
  & Partial<Pick<Task, 'occurrence_at' | 'recurrence_mode'>>;
export type NextOccurrence = (
  rule: string, timezone: string, anchorAt: string, after: Temporal.Instant,
  allDay: boolean, localTime?: string | null, mode?: 'schedule' | 'completion',
) => string;

const SIMPLE_FAST_FORWARD = /^FREQ=(DAILY|WEEKLY)(?:;INTERVAL=([1-9]\d*))?(?:;BYDAY=[A-Z,]+)?$/;

/**
 * Advances `after` by whole rule cycles (`interval` days for DAILY, `interval * 7` days for WEEKLY)
 * to just before `from`, preserving series phase and wall-clock time while skipping distant empty spans.
 */
function fastForwardAfter(rule: string, timezone: string, after: Temporal.Instant, from: Temporal.PlainDate): Temporal.Instant {
  const match = SIMPLE_FAST_FORWARD.exec(rule);
  if (!match) return after;
  const afterZoned = after.toZonedDateTimeISO(timezone);
  const gapDays = afterZoned.toPlainDate().until(from).days;
  if (gapDays <= 1) return after;
  const interval = Number(match[2] ?? 1);
  const cycleDays = match[1] === 'DAILY' ? interval : interval * 7;
  const cycles = Math.floor((gapDays - 1) / cycleDays);
  if (cycles <= 0) return after;
  return afterZoned.add({ days: cycles * cycleDays }).toInstant();
}

/**
 * Every date in [from, to] a task falls on: its current due date, and for a repeating task the dates its
 * later occurrences will fall on. Only the first is a real, completable occurrence; the rest are previews.
 */
export function occurrenceDates(
  task: OccurrenceTask,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  next: NextOccurrence,
  limit?: number,
): Temporal.PlainDate[] {
  if (!task.due_at) return [];
  const spanDays = Math.max(0, from.until(to).days);
  const maxSteps = limit ?? Math.max(120, Math.min(400, spanDays + 16));
  const dates: Temporal.PlainDate[] = [];
  let at: string | null = task.due_at;
  for (let count = 0; at && count < maxSteps; count++) {
    const date = Temporal.Instant.from(at).toZonedDateTimeISO(task.timezone).toPlainDate();
    if (Temporal.PlainDate.compare(date, to) > 0) break;
    if (Temporal.PlainDate.compare(date, from) >= 0) dates.push(date);
    if (!task.recurrence_rule) break;
    try {
      // The first step also passes the slot a moved occurrence came from, so that slot is not shown twice.
      let after = Temporal.Instant.from(at);
      if (count === 0 && task.occurrence_at && Temporal.Instant.compare(Temporal.Instant.from(task.occurrence_at), after) > 0) {
        after = Temporal.Instant.from(task.occurrence_at);
      }
      if (Temporal.PlainDate.compare(date, from) < 0) {
        after = fastForwardAfter(task.recurrence_rule, task.timezone, after, from);
      }
      at = next(task.recurrence_rule, task.timezone, task.recurrence_anchor_at ?? task.due_at, after,
        task.all_day, task.recurrence_local_time, task.recurrence_mode);
    } catch {
      at = null;
    }
  }
  return dates;
}

/** How many tasks fall on each date in [from, to], keyed "YYYY-MM-DD". */
export function countByDate(tasks: OccurrenceTask[], from: Temporal.PlainDate, to: Temporal.PlainDate, next: NextOccurrence): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    for (const date of occurrenceDates(task, from, to, next)) counts[date.toString()] = (counts[date.toString()] ?? 0) + 1;
  }
  return counts;
}

/** Words for the entry bar that put a new task on `date`; the parser reads them like typed text. */
export function datePhrase(date: Temporal.PlainDate, today: Temporal.PlainDate): string {
  const days = today.until(date).days;
  if (days === 0) return '오늘';
  if (days === 1) return '내일';
  if (days === 2) return '모레';
  // "11월 24일" means its next coming date, so a past or distant day is written out in full.
  return days > 0 && days < 300 ? date.month + '월 ' + date.day + '일' : date.toString();
}
