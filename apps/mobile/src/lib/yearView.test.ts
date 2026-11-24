import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Temporal } from '@js-temporal/polyfill';

import { busiestMonth, busyLevel, leadingBlanks, summarizeYear, yearCounts, yearSummaryText } from './yearView.ts';

// A stand-in for the backend's recurrence engine: daily rules step a day, monthly ones a month.
const nextOccurrence = (rule: string, timezone: string, _anchor: string, after: Temporal.Instant) => {
  const at = after.toZonedDateTimeISO(timezone);
  if (rule.startsWith('FREQ=DAILY')) return at.add({ days: 1 }).toInstant().toString();
  if (rule.startsWith('FREQ=MONTHLY')) return at.add({ months: 1 }).toInstant().toString();
  throw new Error('unsupported rule');
};

const base = { all_day: false, timezone: 'Asia/Seoul', recurrence_anchor_at: null, recurrence_local_time: null, recurrence_rule: null };

test('busy levels step at 1, 3 and 5 tasks', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(busyLevel), [0, 1, 1, 2, 2, 3, 3]);
});

test('a year counts one-offs and every repeat inside it, and nothing outside it', () => {
  const tasks = [
    { ...base, id: 'a', due_at: '2026-03-10T01:00:00Z' },
    { ...base, id: 'b', due_at: '2026-03-10T02:00:00Z' },
    { ...base, id: 'c', due_at: '2027-01-02T01:00:00Z' },
    { ...base, id: 'd', due_at: null },
    { ...base, id: 'rent', due_at: '2026-10-25T00:00:00Z', recurrence_rule: 'FREQ=MONTHLY' },
  ];
  const counts = yearCounts(tasks, 2026, nextOccurrence);
  assert.deepEqual([...counts.entries()].sort(), [['2026-03-10', 2], ['2026-10-25', 1], ['2026-11-25', 1], ['2026-12-25', 1]]);
  const next = yearCounts(tasks, 2027, nextOccurrence);
  assert.equal(next.get('2027-01-02'), 1);
  assert.equal(next.get('2027-12-25'), 1);
  assert.equal(next.size, 13);
});

test('repeats are expanded with the month view step limit, so both views show the same days', () => {
  // 62 daily steps from 24 November reach 24 January; the month view stops on the same day.
  const daily = { ...base, id: 'walk', due_at: '2026-11-24T00:00:00Z', recurrence_rule: 'FREQ=DAILY' };
  const counts = yearCounts([daily], 2027, nextOccurrence);
  assert.equal(counts.size, 24);
  assert.equal(counts.get('2027-01-24'), 1);
  assert.equal(yearCounts([daily], 2026, nextOccurrence).size, 38);
  assert.equal(yearCounts([daily], 2025, nextOccurrence).size, 0);
});

test('the summary names the total and the busiest month, the earliest on a tie', () => {
  const counts = new Map([['2026-02-01', 2], ['2026-02-28', 5], ['2026-07-04', 7], ['2026-12-31', 1]]);
  const months = summarizeYear(counts, 2026);
  assert.equal(months[1].levels.length, 28);
  assert.equal(months[1].levels[0], '1');
  assert.equal(months[1].levels[27], '3');
  assert.equal(months[1].total, 7);
  assert.equal(busiestMonth(months), 2);
  assert.equal(yearSummaryText(months), '예정된 일 15개 · 가장 바쁜 달 2월');
  const empty = summarizeYear(new Map(), 2026);
  assert.equal(busiestMonth(empty), null);
  assert.equal(yearSummaryText(empty), '이 해에는 예정된 일이 없습니다');
  assert.equal(summarizeYear(new Map(), 2028)[1].levels.length, 29);
});

test('month grids start on Monday', () => {
  assert.equal(leadingBlanks(2026, 6), 0); // 2026-06-01 is a Monday
  assert.equal(leadingBlanks(2026, 11), 6); // 2026-11-01 is a Sunday
});
