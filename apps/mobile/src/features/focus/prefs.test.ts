import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clampInt, defaultFocusPrefs, nextBreak, normalizeFocusPrefs } from './model.ts';

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
});
