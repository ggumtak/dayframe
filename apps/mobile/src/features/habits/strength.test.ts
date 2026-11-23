import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Temporal } from '@js-temporal/polyfill';

import type { HabitLog } from '@/lib/shared';
import { computeHabitStrength } from './strength.ts';

const todayDate = Temporal.PlainDate.from('2026-11-23');

function log(date: string, status: HabitLog['status'] = 'completed', count = 1): HabitLog {
  return { user_id: 'u', habit_id: 'h', log_date: date, status, count, created_at: '2026-11-23T00:00:00Z' };
}

test('computeHabitStrength grows smoothly with consistency and decays gently on a single miss', () => {
  const habit = { cadence: 'daily' as const, target_count: 1, start_date: '2026-10-24', archived_at: null, timezone: 'Asia/Seoul' };
  // 30 consecutive days completed
  const all30 = Array.from({ length: 30 }, (_, i) => log(todayDate.subtract({ days: 30 - i }).toString()));
  const full = computeHabitStrength(habit, all30, todayDate);
  assert.ok(full.score >= 70 && full.score <= 90, `expected ~77, got ${full.score}`);
  assert.equal(full.missedYesterday, false);

  // Missing only yesterday drops strength slightly instead of resetting to 0, and triggers "Never Miss Twice"
  const missedYesterdayLogs = all30.slice(0, -1);
  const afterOneMiss = computeHabitStrength(habit, missedYesterdayLogs, todayDate);
  assert.ok(afterOneMiss.score >= 65 && afterOneMiss.score < full.score);
  assert.equal(afterOneMiss.missedYesterday, true);
});

test('frozen periods preserve habit strength without decaying or triggering missedYesterday', () => {
  const habit = { cadence: 'daily' as const, target_count: 1, start_date: '2026-11-01', archived_at: null, timezone: 'Asia/Seoul' };
  const logs = Array.from({ length: 21 }, (_, i) => log(todayDate.subtract({ days: 22 - i }).toString()));
  const withFreeze = [...logs, log('2026-11-22', 'frozen', 0)];
  const withMiss = [...logs];

  const frozen = computeHabitStrength(habit, withFreeze, todayDate);
  const missed = computeHabitStrength(habit, withMiss, todayDate);
  assert.ok(frozen.score > missed.score);
  assert.equal(frozen.missedYesterday, false);
});

test('weekly habit strength evaluates by ISO week buckets', () => {
  const habit = { cadence: 'weekly' as const, target_count: 3, start_date: '2026-10-12', archived_at: null, timezone: 'Asia/Seoul' };
  const logs = [
    // 4 consecutive completed weeks (3 sessions each)
    log('2026-10-12'), log('2026-10-14'), log('2026-10-16'),
    log('2026-10-19'), log('2026-10-21'), log('2026-10-23'),
    log('2026-10-26'), log('2026-10-28'), log('2026-10-30'),
    log('2026-11-02'), log('2026-11-04'), log('2026-11-06'),
    log('2026-11-09'), log('2026-11-11'), log('2026-11-13'),
    log('2026-11-16'), log('2026-11-18'), log('2026-11-20'),
  ];
  const res = computeHabitStrength(habit, logs, todayDate);
  assert.ok(res.score >= 55);
  assert.equal(res.missedYesterday, false);
});
