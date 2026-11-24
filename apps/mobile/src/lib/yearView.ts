import { Temporal } from '@js-temporal/polyfill';

import { type NextOccurrence, type OccurrenceTask, occurrenceDates } from './occurrences.ts';

/** How busy a day reads in the year view: 0 = nothing, 1 = 1–2 tasks, 2 = 3–4, 3 = 5 or more. */
export type BusyLevel = 0 | 1 | 2 | 3;

export function busyLevel(count: number): BusyLevel {
  return count >= 5 ? 3 : count >= 3 ? 2 : count >= 1 ? 1 : 0;
}

/**
 * Open tasks per date of `year`, keyed "YYYY-MM-DD": each task's due date plus the dates its repeat will fall on.
 * Repeats are expanded with `occurrenceDates` and its default step limit, exactly as the month view does, so a day
 * shows the same workload in both views and a year costs at most that many steps per repeating task.
 */
export function yearCounts(tasks: OccurrenceTask[], year: number, next: NextOccurrence): Map<string, number> {
  const from = Temporal.PlainDate.from({ year, month: 1, day: 1 });
  const to = Temporal.PlainDate.from({ year, month: 12, day: 31 });
  const counts = new Map<string, number>();
  for (const task of tasks) {
    for (const date of occurrenceDates(task, from, to, next)) {
      const key = date.toString();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

export interface YearMonthSummary {
  month: number;
  /** Task count across the month's days. */
  total: number;
  /** One digit (0–3) per day of the month, the day's busy level; a string so a memoized month block can compare it cheaply. */
  levels: string;
}

/** Per-month totals and busy levels for `year`, from the counts `yearCounts` built. */
export function summarizeYear(counts: Map<string, number>, year: number): YearMonthSummary[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const days = Temporal.PlainYearMonth.from({ year, month }).daysInMonth;
    const prefix = year + '-' + String(month).padStart(2, '0') + '-';
    let total = 0;
    let levels = '';
    for (let day = 1; day <= days; day++) {
      const count = counts.get(prefix + String(day).padStart(2, '0')) ?? 0;
      total += count;
      levels += busyLevel(count);
    }
    return { month, total, levels };
  });
}

/** The month with the most tasks (the earliest on a tie), or null when the year is empty. */
export function busiestMonth(months: YearMonthSummary[]): number | null {
  let best: YearMonthSummary | null = null;
  for (const month of months) if (month.total > 0 && (!best || month.total > best.total)) best = month;
  return best?.month ?? null;
}

/** "예정된 일 12개 · 가장 바쁜 달 3월", or a short empty line when the year has nothing. */
export function yearSummaryText(months: YearMonthSummary[]): string {
  const total = months.reduce((sum, month) => sum + month.total, 0);
  if (total === 0) return '이 해에는 예정된 일이 없습니다';
  const busiest = busiestMonth(months);
  return '예정된 일 ' + total + '개' + (busiest ? ' · 가장 바쁜 달 ' + busiest + '월' : '');
}

/** Blank cells before day 1 in a Monday-first grid (the month view's week start). */
export function leadingBlanks(year: number, month: number): number {
  return Temporal.PlainDate.from({ year, month, day: 1 }).dayOfWeek - 1;
}
