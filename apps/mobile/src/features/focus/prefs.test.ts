import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Temporal } from '@js-temporal/polyfill';

import { clampInt, defaultFocusPrefs, nextBreak, normalizeFocusPrefs, weeklyFocusStats } from './model.ts';

test('clampInt keeps custom durations inside valid server bounds', () => {
  assert.equal(clampInt(0, 1, 480, 25), 1);
  assert.equal(clampInt(999, 1, 480, 25), 480);
  assert.equal(clampInt(37.4, 1, 480, 25), 37);
  assert.equal(clampInt(Number.NaN, 1, 480, 25), 25);
});

test('normalizeFocusPrefs sanitizes partial or out-of-range stored preferences', () => {
  const normalized = normalizeFocusPrefs({ mode: 'timer', focusMinutes: 0, shortBreakMinutes: 120, timerMinutes: 90 });
  assert.deepEqual(normalized, {
    ...defaultFocusPrefs,
    mode: 'timer',
    focusMinutes: 1,
    shortBreakMinutes: 60,
    timerMinutes: 90,
  });
});

test('nextBreak gives short breaks, a long break every N rounds, and no break in timer mode', () => {
  const pomo = { ...defaultFocusPrefs, mode: 'pomodoro' as const, shortBreakMinutes: 5, longBreakMinutes: 20, roundsBeforeLongBreak: 4 };
  assert.deepEqual(nextBreak(pomo, 0), { minutes: 5, seconds: 300, long: false });
  assert.deepEqual(nextBreak(pomo, 2), { minutes: 5, seconds: 300, long: false });
  assert.deepEqual(nextBreak(pomo, 3), { minutes: 20, seconds: 1200, long: true });
  // After the 4th round, round 5 starts a fresh cycle.
  assert.deepEqual(nextBreak(pomo, 4), { minutes: 5, seconds: 300, long: false });
  assert.equal(nextBreak({ ...pomo, mode: 'timer' }, 3), null);
  assert.equal(nextBreak({ ...pomo, mode: 'stopwatch' }, 3), null);
  assert.equal(normalizeFocusPrefs({ mode: 'stopwatch' }).mode, 'stopwatch');
});

test('weeklyFocusStats aggregates completed sessions across the last 7 local days', () => {
  const todayDate = Temporal.PlainDate.from('2026-11-23');
  const sessions = [
    { status: 'completed', started_at: '2026-11-23T01:00:00Z', ended_at: '2026-11-23T01:25:00Z' }, // 25m today
    { status: 'completed', started_at: '2026-11-23T02:00:00Z', ended_at: '2026-11-23T02:20:00Z' }, // 20m today
    { status: 'cancelled', started_at: '2026-11-23T03:00:00Z', ended_at: '2026-11-23T03:10:00Z' }, // ignored
    { status: 'completed', started_at: '2026-11-21T01:00:00Z', ended_at: '2026-11-21T01:30:00Z' }, // 30m 2 days ago
    { status: 'completed', started_at: '2026-11-10T01:00:00Z', ended_at: '2026-11-10T02:00:00Z' }, // outside 7-day window
  ];
  const stats = weeklyFocusStats(sessions, todayDate, 'Asia/Seoul');
  assert.equal(stats.days.length, 7);
  assert.equal(stats.totalCount, 3);
  assert.equal(stats.totalSeconds, 75 * 60);
  assert.equal(stats.maxMinutes, 45);
  assert.equal(stats.days[6].isToday, true);
  assert.equal(stats.days[6].minutes, 45);
  assert.equal(stats.days[4].minutes, 30);
});
