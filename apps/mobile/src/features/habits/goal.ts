import { Temporal } from '@js-temporal/polyfill';

import type { Habit, HabitLog } from '@/lib/shared';

/**
 * The goal rules every habit screen shares: which period a day counts toward, how far a period has got,
 * and how one day reads on a dot or a calendar cell. Kept free of React Native so it can be tested on its own.
 */

const mondayOf = (date: Temporal.PlainDate): Temporal.PlainDate => date.subtract({ days: date.dayOfWeek - 1 });

/** The start of the day or ISO week that `date` falls in. */
export function periodStart(habit: Pick<Habit, 'cadence'>, date: string): string {
  const day = Temporal.PlainDate.from(date);
  return (habit.cadence === 'weekly' ? mondayOf(day) : day).toString();
}

/** Check-ins counted toward the period (day or week) that holds `date`. */
export function periodProgress(habit: Pick<Habit, 'cadence'>, logs: HabitLog[], date: string): number {
  const start = periodStart(habit, date);
  return logs.reduce((sum, log) => (periodStart(habit, log.log_date) === start ? sum + log.count : sum), 0);
}

/**
 * How one day reads. A weekly habit's day counts as met once it was ticked; a daily habit's day is met only
 * at its daily goal, and is partial below it. Skipped and frozen days keep their own marks.
 */
export type DayState = 'met' | 'partial' | 'skipped' | 'frozen' | 'empty';

export function dayState(habit: Pick<Habit, 'cadence' | 'target_count'>, log: Pick<HabitLog, 'status' | 'count'> | undefined): DayState {
  if (!log) return 'empty';
  if (log.status === 'skipped') return 'skipped';
  if (log.status === 'frozen') return 'frozen';
  if (habit.cadence === 'weekly' || log.count >= habit.target_count) return 'met';
  return 'partial';
}

export const dayMet = (habit: Pick<Habit, 'cadence' | 'target_count'>, log: Pick<HabitLog, 'status' | 'count'> | undefined): boolean =>
  dayState(habit, log) === 'met';

/** Logs keyed by date, built once per log list so a grid never searches the list cell by cell. */
export function logsByDate(logs: HabitLog[]): Map<string, HabitLog> {
  return new Map(logs.map((log) => [log.log_date, log]));
}

/** The seven days of the week that starts on `monday`. */
export function weekDates(monday: Temporal.PlainDate): Temporal.PlainDate[] {
  return Array.from({ length: 7 }, (_, index) => monday.add({ days: index }));
}

/** A Monday-first month grid: blanks before the 1st and after the last day so every row has seven cells. */
export function monthCells(month: Temporal.PlainYearMonth): (Temporal.PlainDate | null)[] {
  const first = month.toPlainDate({ day: 1 });
  const lead = first.dayOfWeek - 1;
  const cells: (Temporal.PlainDate | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= month.daysInMonth; day += 1) cells.push(month.toPlainDate({ day }));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/**
 * The earliest day the overview can show: the oldest start date among the habits (logs are only kept from
 * a habit's start onward), or `fallback` when there are none.
 */
export function earliestStart(habits: Pick<Habit, 'start_date'>[], fallback: Temporal.PlainDate): Temporal.PlainDate {
  let earliest = fallback;
  for (const habit of habits) {
    const start = Temporal.PlainDate.from(habit.start_date);
    if (Temporal.PlainDate.compare(start, earliest) < 0) earliest = start;
  }
  return earliest;
}

/** Whether `date` is outside the habit's life so far: before it started or after today. */
export function outsideHabit(habit: Pick<Habit, 'start_date'>, date: Temporal.PlainDate, today: Temporal.PlainDate): boolean {
  return date.toString() < habit.start_date || Temporal.PlainDate.compare(date, today) > 0;
}
