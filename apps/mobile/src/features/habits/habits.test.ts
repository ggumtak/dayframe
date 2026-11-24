import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Temporal } from '@js-temporal/polyfill';

import type { HabitLog } from '@/lib/shared';
import {
  dayMet, dayState, earliestStart, logsByDate, monthCells, outsideHabit, periodProgress, periodStart, weekDates,
} from './goal.ts';
import { HABIT_COLORS, HABIT_EMOJIS, HABIT_QUOTES, initialOf, nextQuote, softTint } from './palette.ts';
import { featuredRoutines, galleryCategories, routineGroups, routineLabel, sameRoutine } from './routines.ts';

function log(date: string, count = 1, status: HabitLog['status'] = 'completed'): HabitLog {
  return { user_id: 'u', habit_id: 'h', log_date: date, status, count, created_at: '2026-11-23T00:00:00Z' };
}

const daily = { cadence: 'daily' as const, target_count: 3 };
const weekly = { cadence: 'weekly' as const, target_count: 3 };

test('periods: a daily habit counts the day, a weekly one the ISO week from Monday', () => {
  assert.equal(periodStart(daily, '2026-11-26'), '2026-11-26');
  assert.equal(periodStart(weekly, '2026-11-26'), '2026-11-23');
  assert.equal(periodStart(weekly, '2026-11-23'), '2026-11-23');
  const logs = [log('2026-11-22', 2), log('2026-11-23', 1), log('2026-11-25', 2)];
  assert.equal(periodProgress(daily, logs, '2026-11-25'), 2);
  assert.equal(periodProgress(weekly, logs, '2026-11-25'), 3);
  assert.equal(periodProgress(weekly, logs, '2026-11-22'), 2);
});

test('a day is met at the daily goal, partial below it, and a weekly tick always meets the day', () => {
  assert.equal(dayState(daily, undefined), 'empty');
  assert.equal(dayState(daily, log('2026-11-23', 1)), 'partial');
  assert.equal(dayState(daily, log('2026-11-23', 3)), 'met');
  assert.equal(dayState(weekly, log('2026-11-23', 1)), 'met');
  assert.equal(dayState(daily, log('2026-11-23', 0, 'skipped')), 'skipped');
  assert.equal(dayState(weekly, log('2026-11-23', 0, 'frozen')), 'frozen');
  assert.equal(dayMet(daily, log('2026-11-23', 4)), true);
  assert.equal(dayMet(daily, log('2026-11-23', 0, 'frozen')), false);
  assert.equal(logsByDate([log('2026-11-23', 2)]).get('2026-11-23')?.count, 2);
});

test('week and month grids are Monday-first and padded to whole weeks', () => {
  const week = weekDates(Temporal.PlainDate.from('2026-11-23'));
  assert.deepEqual(week.map(String), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  // November 2026 starts on a Sunday: six blanks, then 30 days, padded to 42 cells.
  const cells = monthCells(Temporal.PlainYearMonth.from('2026-11'));
  assert.equal(cells.length % 7, 0);
  assert.equal(cells.slice(0, 6).every((cell) => cell === null), true);
  assert.equal(cells[6]?.toString(), '2026-11-01');
  assert.equal(cells.filter(Boolean).length, 30);
  // February 2027 starts on a Monday and fills exactly four weeks.
  assert.equal(monthCells(Temporal.PlainYearMonth.from('2027-02')).length, 28);
});

test('the overview reaches back to the oldest habit start and dims days outside a habit', () => {
  const today = Temporal.PlainDate.from('2026-11-24');
  assert.equal(earliestStart([], today).toString(), '2026-11-24');
  assert.equal(earliestStart([{ start_date: '2026-10-02' }, { start_date: '2026-06-15' }], today).toString(), '2026-06-15');
  const habit = { start_date: '2026-11-10' };
  assert.equal(outsideHabit(habit, Temporal.PlainDate.from('2026-11-09'), today), true);
  assert.equal(outsideHabit(habit, Temporal.PlainDate.from('2026-11-10'), today), false);
  assert.equal(outsideHabit(habit, Temporal.PlainDate.from('2026-11-25'), today), true);
});

test('palette helpers: tints, initials and cycling suggestions', () => {
  assert.equal(softTint('#3574F0', false), '#3574F01F');
  assert.equal(softTint('#3574F0', true), '#3574F033');
  assert.equal(softTint('blue', false), 'blue');
  assert.equal(initialOf('  물 2리터'), '물');
  assert.equal(initialOf('yoga'), 'Y');
  assert.equal(initialOf('   '), '·');
  assert.equal(nextQuote(''), HABIT_QUOTES[0]);
  assert.equal(nextQuote(HABIT_QUOTES[0]), HABIT_QUOTES[1]);
  assert.equal(nextQuote(HABIT_QUOTES[HABIT_QUOTES.length - 1]), HABIT_QUOTES[0]);
  assert.ok(HABIT_EMOJIS.length >= 28 && new Set(HABIT_EMOJIS).size === HABIT_EMOJIS.length);
});

test('every gallery preset has an emoji, a palette colour and a short line', () => {
  const colors = new Set<string>(HABIT_COLORS);
  for (const group of routineGroups) {
    for (const item of group.items) {
      assert.ok(item.emoji.length > 0, item.name);
      assert.ok(colors.has(item.color), item.name);
      assert.ok(Array.from(item.quote).length <= 18, `${item.name}: "${item.quote}" is too long`);
    }
  }
  assert.equal(galleryCategories[0].title, '추천');
  assert.ok(featuredRoutines.length >= 8);
  assert.equal(new Set(featuredRoutines.map((item) => item.name)).size, featuredRoutines.length);
  assert.equal(routineLabel({ cadence: 'weekly', target: 3 }), '주 3회');
  assert.equal(routineLabel({ target: 8 }), '하루 8번');
  assert.equal(routineLabel({}), '매일');
  assert.ok(sameRoutine('물 2리터 마시기', '물2리터마시기'));
});
