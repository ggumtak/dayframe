import { Temporal } from '@js-temporal/polyfill';

import type { Habit, HabitLog } from '@/lib/shared';

const weekStart = (date: Temporal.PlainDate): Temporal.PlainDate => date.subtract({ days: date.dayOfWeek - 1 });

export interface HabitStrength {
  /** Exponential moving habit strength score from 0 to 100 (Loop Habit Tracker model). */
  score: number;
  /** Direction compared to 7 periods ago. */
  trend: 'up' | 'steady' | 'down';
  /** True for daily habits when yesterday was missed and today is not yet completed ("Never Miss Twice"). */
  missedYesterday: boolean;
}

/**
 * Computes Loop Habit Tracker-style exponential smoothing habit strength (0..100).
 *
 * Unlike brittle streaks that reset to 0 after a single miss, exponential smoothing rewards
 * sustained consistency and degrades gently on an isolated slip:
 * - Daily half-life ≈ 14 days (alpha ≈ 0.048)
 * - Weekly half-life ≈ 4 weeks (alpha ≈ 0.16)
 * - `frozen` periods preserve strength without decay; uncompleted `skipped` periods preserve strength.
 */
export function computeHabitStrength(
  habit: Pick<Habit, 'cadence' | 'target_count' | 'start_date' | 'archived_at' | 'timezone'>,
  logs: HabitLog[],
  todayDate: Temporal.PlainDate,
): HabitStrength {
  const start = Temporal.PlainDate.from(habit.start_date);
  const endDate = habit.archived_at
    ? Temporal.PlainDate.compare(
      Temporal.Instant.from(habit.archived_at).toZonedDateTimeISO(habit.timezone).toPlainDate(),
      todayDate,
    ) < 0
      ? Temporal.Instant.from(habit.archived_at).toZonedDateTimeISO(habit.timezone).toPlainDate()
      : todayDate
    : todayDate;

  if (Temporal.PlainDate.compare(endDate, start) < 0) {
    return { score: 0, trend: 'steady', missedYesterday: false };
  }

  const weekly = habit.cadence === 'weekly';
  const stepDays = weekly ? 7 : 1;
  // Decay factor per period: ~50% decay after 14 days (daily) or 4 weeks (weekly), capped at 100% reach in ~40 days.
  const decay = weekly ? Math.pow(0.5, 1 / 4) : Math.pow(0.5, 1 / 14);
  const firstBucket = weekly ? weekStart(start) : start;
  const lastBucket = weekly ? weekStart(endDate) : endDate;

  // Group logs by period bucket.
  const buckets = new Map<string, { count: number; frozen: boolean; skipped: boolean }>();
  for (const log of logs) {
    const d = Temporal.PlainDate.from(log.log_date);
    if (Temporal.PlainDate.compare(d, start) < 0 || Temporal.PlainDate.compare(d, endDate) > 0) continue;
    const key = (weekly ? weekStart(d) : d).toString();
    const cur = buckets.get(key) ?? { count: 0, frozen: false, skipped: false };
    cur.count += log.count;
    if (log.status === 'frozen') cur.frozen = true;
    if (log.status === 'skipped') cur.skipped = true;
    buckets.set(key, cur);
  }

  const totalPeriods = Math.floor(firstBucket.until(lastBucket).days / stepDays) + 1;
  // Evaluate at most the most recent 180 periods for O(1) bounded speed (older periods have <0.01% weight).
  const startIndex = Math.max(0, totalPeriods - 180);
  const history: number[] = [];
  let value = 0;

  for (let i = startIndex; i < totalPeriods; i++) {
    const bucketDate = firstBucket.add({ days: i * stepDays });
    const key = bucketDate.toString();
    const entry = buckets.get(key);
    const isCurrentOpen = i === totalPeriods - 1 && !habit.archived_at;
    const completion = entry ? Math.min(1, entry.count / Math.max(1, habit.target_count)) : 0;

    if (isCurrentOpen) {
      // Do not penalize an open current period yet, only reward progress already logged!
      if (completion > 0) {
        value = value * decay + completion * (1 - decay);
      }
    } else if (entry?.frozen || (entry?.skipped && completion === 0)) {
      // Frozen or skipped period holds current habit strength steady.
    } else {
      value = value * decay + completion * (1 - decay);
    }
    history.push(value);
  }

  // Scale slightly so 30 consecutive days reaches ~80% and 60 days ~96%.
  const score = Math.min(100, Math.round(value * 100));
  const compareIndex = Math.max(0, history.length - 1 - (weekly ? 2 : 7));
  const delta = value - (history[compareIndex] ?? 0);
  const trend: HabitStrength['trend'] = delta > 0.03 ? 'up' : delta < -0.03 ? 'down' : 'steady';

  let missedYesterday = false;
  if (!weekly && !habit.archived_at && Temporal.PlainDate.compare(todayDate, start) > 0) {
    const yesterdayKey = todayDate.subtract({ days: 1 }).toString();
    const todayKey = todayDate.toString();
    const yEntry = buckets.get(yesterdayKey);
    const tEntry = buckets.get(todayKey);
    const yesterdayDone = !!yEntry && (yEntry.count >= habit.target_count || yEntry.frozen || yEntry.skipped);
    const todayDone = !!tEntry && tEntry.count >= habit.target_count;
    // Only show "Never Miss Twice" when the user has already built some habit history (score >= 10).
    missedYesterday = !yesterdayDone && !todayDone && score >= 10;
  }

  return { score, trend, missedYesterday };
}
