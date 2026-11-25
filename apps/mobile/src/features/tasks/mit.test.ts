import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EMPTY_DAILY_FOCUS,
  forLogicalDate,
  MAX_MIT_COUNT,
  parseDailyFocus,
  pruneMitState,
  toggleEvening,
  toggleMit,
} from './mit.ts';

test('parseDailyFocus handles missing, invalid, and valid JSON', () => {
  for (const raw of [null, undefined, '', 'bad', '{}', '{"date":"today"}']) {
    assert.deepEqual(parseDailyFocus(raw), EMPTY_DAILY_FOCUS, String(raw));
  }
  const stored = {
    date: '2026-11-25',
    mitIds: ['a', 'b', 'a', 'c', 'd', 123],
    eveningIds: ['x', 'x', 'y', ''],
  };
  assert.deepEqual(parseDailyFocus(JSON.stringify(stored)), {
    date: '2026-11-25',
    mitIds: ['a', 'b', 'c'],
    eveningIds: ['x', 'y'],
  });
});

test('toggleMit enforces max 3 tasks and allows toggling off', () => {
  const date = '2026-11-25';
  let state = EMPTY_DAILY_FOCUS;

  for (const id of ['t1', 't2', 't3']) {
    const res = toggleMit(state, date, id);
    assert.equal(res.full, undefined);
    state = res.state;
  }
  assert.equal(state.mitIds.length, MAX_MIT_COUNT);
  assert.deepEqual(state.mitIds, ['t1', 't2', 't3']);

  // Adding a 4th returns full: true and preserves the existing 3.
  const overflow = toggleMit(state, date, 't4');
  assert.equal(overflow.full, true);
  assert.deepEqual(overflow.state.mitIds, ['t1', 't2', 't3']);

  // Removing one makes room again.
  const removed = toggleMit(state, date, 't2');
  assert.equal(removed.full, undefined);
  assert.deepEqual(removed.state.mitIds, ['t1', 't3']);
  const added = toggleMit(removed.state, date, 't4');
  assert.equal(added.full, undefined);
  assert.deepEqual(added.state.mitIds, ['t1', 't3', 't4']);
});

test('MIT and evening lists auto-reset when logical date rolls over', () => {
  let state = toggleMit(EMPTY_DAILY_FOCUS, '2026-11-25', 't1').state;
  state = toggleEvening(state, '2026-11-25', 'e1');

  assert.deepEqual(forLogicalDate(state, '2026-11-25'), {
    date: '2026-11-25',
    mitIds: ['t1'],
    eveningIds: ['e1'],
  });
  assert.deepEqual(forLogicalDate(state, '2026-11-26'), {
    date: '2026-11-26',
    mitIds: [],
    eveningIds: [],
  });

  // Toggling on a new day discards yesterday's items cleanly.
  const nextDay = toggleMit(state, '2026-11-26', 't9');
  assert.deepEqual(nextDay.state, {
    date: '2026-11-26',
    mitIds: ['t9'],
    eveningIds: [],
  });
});

test('toggleEvening adds and removes task IDs independently of MITs', () => {
  const date = '2026-11-25';
  let state = toggleMit(EMPTY_DAILY_FOCUS, date, 't1').state;
  state = toggleEvening(state, date, 't1');
  state = toggleEvening(state, date, 't2');
  assert.deepEqual(state, { date, mitIds: ['t1'], eveningIds: ['t1', 't2'] });

  state = toggleEvening(state, date, 't1');
  assert.deepEqual(state, { date, mitIds: ['t1'], eveningIds: ['t2'] });
});

test('pruneMitState drops removed or completed IDs and preserves reference when unchanged', () => {
  const date = '2026-11-25';
  let state = toggleMit(EMPTY_DAILY_FOCUS, date, 't1').state;
  state = toggleMit(state, date, 't2').state;
  state = toggleEvening(state, date, 't2');
  state = toggleEvening(state, date, 't3');

  // Unchanged returns the same reference.
  assert.equal(pruneMitState(state, date, new Set(['t1', 't2', 't3', 't4'])), state);

  // Missing IDs are pruned.
  assert.deepEqual(pruneMitState(state, date, ['t1', 't3']), {
    date,
    mitIds: ['t1'],
    eveningIds: ['t3'],
  });

  // Stale date is reset even if IDs are still valid.
  assert.deepEqual(pruneMitState(state, '2026-11-26', new Set(['t1', 't2', 't3'])), {
    date: '2026-11-26',
    mitIds: [],
    eveningIds: [],
  });
});
