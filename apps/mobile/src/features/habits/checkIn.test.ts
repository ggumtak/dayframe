import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextCheckIn } from './checkIn.ts';

test('a tap counts a daily habit up to its goal, then clears the day; a weekly habit ticks once a day', () => {
  const water = { cadence: 'daily' as const, target_count: 3 };
  assert.deepEqual(nextCheckIn(water, 0, 0), { status: 'completed', count: 1, reaches: false });
  assert.deepEqual(nextCheckIn(water, 2, 2), { status: 'completed', count: 3, reaches: true });
  assert.deepEqual(nextCheckIn(water, 3, 3), { status: null, count: 0, reaches: false });
  const run = { cadence: 'weekly' as const, target_count: 3 };
  assert.deepEqual(nextCheckIn(run, 0, 2), { status: 'completed', count: 1, reaches: true });
  assert.deepEqual(nextCheckIn(run, 1, 3), { status: null, count: 0, reaches: false });
});
