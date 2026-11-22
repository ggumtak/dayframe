import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Temporal } from '@js-temporal/polyfill';

import { countByDate, datePhrase, occurrenceDates } from './occurrences.ts';

// A stand-in for the backend's recurrence engine (tested in the root suite), kept local so this app test
// needs only the app's own packages: weekly rules step to the next listed weekday, monthly ones by a month.
const nextOccurrence = (rule: string, timezone: string, _anchor: string, after: Temporal.Instant) => {
  const at = after.toZonedDateTimeISO(timezone);
  if (rule.startsWith('FREQ=MONTHLY')) return at.add({ months: 1 }).toInstant().toString();
  const days = /BYDAY=([A-Z,]+)/.exec(rule)?.[1].split(',');
  if (!rule.startsWith('FREQ=WEEKLY') || !days) throw new Error('unsupported rule');
  const names = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  for (let step = 1; step <= 7; step++) {
    const next = at.add({ days: step });
    if (days.includes(names[next.dayOfWeek - 1])) return next.toInstant().toString();
  }
  throw new Error('no weekday');
};

const base = { id: 'a', all_day: false, timezone: 'Asia/Seoul', recurrence_anchor_at: null, recurrence_local_time: null };
const nov = [Temporal.PlainDate.from('2026-11-01'), Temporal.PlainDate.from('2026-11-30')] as const;

test('a repeating task shows on every date it will fall on, a one-off only on its own', () => {
  const gym = { ...base, due_at: '2026-11-23T10:00:00Z', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', recurrence_local_time: '19:00:00' };
  assert.deepEqual(occurrenceDates(gym, ...nov, nextOccurrence).map(String), ['2026-11-23', '2026-11-25', '2026-11-27', '2026-11-30']);
  const rent = { ...base, due_at: '2026-11-25T00:00:00Z', recurrence_rule: 'FREQ=MONTHLY' };
  assert.deepEqual(occurrenceDates(rent, Temporal.PlainDate.from('2026-11-01'), Temporal.PlainDate.from('2027-01-31'), nextOccurrence).map(String),
    ['2026-11-25', '2026-12-25', '2027-01-25']);
  const once = { ...base, due_at: '2026-11-10T01:00:00Z', recurrence_rule: null };
  assert.deepEqual(occurrenceDates(once, ...nov, nextOccurrence).map(String), ['2026-11-10']);
  assert.deepEqual(occurrenceDates({ ...once, due_at: null }, ...nov, nextOccurrence), []);
  assert.deepEqual(occurrenceDates({ ...gym, recurrence_rule: 'FREQ=BROKEN' }, ...nov, nextOccurrence).map(String), ['2026-11-23']);
  assert.deepEqual(countByDate([gym, once, { ...once, id: 'b' }], ...nov, nextOccurrence),
    { '2026-11-10': 2, '2026-11-23': 1, '2026-11-25': 1, '2026-11-27': 1, '2026-11-30': 1 });
});

test('an occurrence moved before its slot does not show that slot again', () => {
  // Monday-and-Wednesday gym moved from Wednesday the 25th to Tuesday the 24th: the next one is Monday the 30th.
  const moved = { ...base, due_at: '2026-11-24T10:00:00Z', occurrence_at: '2026-11-25T10:00:00Z', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,WE' };
  assert.deepEqual(occurrenceDates(moved, ...nov, nextOccurrence).map(String), ['2026-11-24', '2026-11-30']);
  assert.deepEqual(occurrenceDates({ ...moved, occurrence_at: null }, ...nov, nextOccurrence).map(String), ['2026-11-24', '2026-11-25', '2026-11-30']);
});

test('the entry bar is prefilled with words the parser reads back as that date', () => {
  const today = Temporal.PlainDate.from('2026-11-21');
  assert.equal(datePhrase(today, today), '오늘');
  assert.equal(datePhrase(today.add({ days: 1 }), today), '내일');
  assert.equal(datePhrase(Temporal.PlainDate.from('2026-11-28'), today), '11월 28일');
  assert.equal(datePhrase(Temporal.PlainDate.from('2027-01-05'), today), '1월 5일');
  assert.equal(datePhrase(Temporal.PlainDate.from('2026-11-15'), today), '2026-11-15');
});
