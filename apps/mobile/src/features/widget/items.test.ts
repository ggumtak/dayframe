import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adjustCalendar, calendarGrid, focusState, habitToday, snapshotTasks, upcomingRows, widgetDate, widgetRows, type WidgetTask } from './items.ts';

const now = Date.parse('2026-11-21T09:00:00Z'); // Saturday 18:00 in Seoul
let next = 0;
const task = (title: string, due_at: string | null, extra: Partial<WidgetTask> = {}) => ({
  id: String(++next), title, due_at, all_day: false, timezone: 'Asia/Seoul', priority: 4 as const,
  updated_at: '2026-11-20T00:00:00Z', recurrence_rule: null, completed_at: null, ...extra,
});

test('the widget lists what is overdue and due today, oldest first', () => {
  const tasks = [
    task('저녁 운동', '2026-11-21T10:00:00Z'),
    task('장보기', '2026-11-20T15:00:00Z', { all_day: true }), // today, all day
    task('보고서', '2026-11-20T09:00:00Z', { priority: 1 }), // yesterday 18:00
    task('세금', '2026-11-18T15:00:00Z', { all_day: true }), // 11월 19일
    task('점심 약속', '2026-11-21T03:00:00Z'), // today 12:00, already past
    task('내일 회의', '2026-11-22T01:00:00Z'),
    task('언젠가', null),
  ];
  const rows = widgetRows(snapshotTasks(tasks, now), now);
  assert.deepEqual(rows.map((row) => [row.title, row.when, row.overdue]), [
    ['세금', '11월 19일', true],
    ['보고서', '어제', true],
    ['장보기', '', false],
    ['점심 약속', '오후 12:00', true],
    ['저녁 운동', '오후 7:00', false],
  ]);
});

test('the snapshot drops finished and far-off tasks but keeps tomorrow for after midnight', () => {
  const kept = snapshotTasks([
    task('done', '2026-11-21T10:00:00Z', { completed_at: '2026-11-21T08:00:00Z' }),
    task('tomorrow', '2026-11-22T01:00:00Z'),
    task('next week', '2026-11-28T01:00:00Z'),
    task('next month', '2026-12-25T01:00:00Z'),
  ], now);
  assert.deepEqual(kept.map((item) => item.title), ['tomorrow', 'next week']);
  assert.equal('completed_at' in kept[0], false);
  // After midnight in Seoul, tomorrow's task becomes today's.
  assert.deepEqual(widgetRows(kept, Date.parse('2026-11-21T16:00:00Z')).map((row) => row.title), ['tomorrow']);
  assert.equal(widgetDate(now, 'Asia/Seoul'), '11월 21일 토요일');
});

test('the upcoming widget groups the next seven days under day headings', () => {
  const tasks = snapshotTasks([
    task('오늘 일', '2026-11-21T10:00:00Z'),
    task('회의', '2026-11-22T01:00:00Z'),
    task('장보기', '2026-11-21T15:00:00Z', { all_day: true }), // 11/22 all day
    task('보고서', '2026-11-24T00:00:00Z', { priority: 1 }), // 11/24 09:00
    task('다음 주 토', '2026-11-28T01:00:00Z'),
  ], now);
  assert.deepEqual(upcomingRows(tasks, now, 'Asia/Seoul').map((row) => (row.kind === 'day' ? '# ' + row.label + ' ' + row.count : row.title + ' ' + row.when)), [
    '# 내일 · 11월 22일 2', '장보기 ', '회의 오전 10:00',
    '# 화요일 · 11월 24일 1', '보고서 오전 9:00',
    '# 토요일 · 11월 28일 1', '다음 주 토 오전 10:00',
  ]);
});

test('habit and focus figures roll over with the day', () => {
  const habit = { id: 'h', name: '물', cadence: 'daily' as const, target_count: 8, timezone: 'Asia/Seoul', date: '2026-11-21', todayCount: 5, progress: 5 };
  assert.deepEqual(habitToday(habit, now), { date: '2026-11-21', todayCount: 5, progress: 5 });
  assert.deepEqual(habitToday(habit, Date.parse('2026-11-21T16:00:00Z')), { date: '2026-11-22', todayCount: 0, progress: 0 });
  const weekly = { ...habit, cadence: 'weekly' as const, target_count: 3, date: '2026-11-18', todayCount: 1, progress: 2 }; // Wed
  assert.deepEqual(habitToday(weekly, now), { date: '2026-11-21', todayCount: 0, progress: 2 });
  assert.equal(habitToday(weekly, Date.parse('2026-11-23T01:00:00Z')).progress, 0); // next Monday

  const focus = { running: { id: 'f', startedAt: '2026-11-21T08:50:00Z', plannedSeconds: 1500 }, date: '2026-11-21', count: 2, seconds: 3000 };
  assert.deepEqual(focusState(focus, now, 'Asia/Seoul'), { running: focus.running, endsAt: '오후 6:15', count: 2, minutes: 50 });
  assert.equal(focusState(focus, Date.parse('2026-11-21T09:20:00Z'), 'Asia/Seoul').running, null);
  assert.equal(focusState(focus, Date.parse('2026-11-21T16:00:00Z'), 'Asia/Seoul').count, 0);
});

test('the calendar widget lays a month out Monday-first and marks today and busy days', () => {
  const grid = calendarGrid(now, 'Asia/Seoul', 0, { '2026-11-21': 2, '2026-11-30': 1 });
  assert.equal(grid.title, '11월');
  assert.equal(grid.weeks.length, 6); // November 2026 starts on a Sunday
  assert.deepEqual(grid.weeks[0].map((cell) => cell?.day ?? null), [null, null, null, null, null, null, 1]);
  const today = grid.weeks.flat().find((cell) => cell?.today);
  assert.deepEqual([today?.date, today?.count, today?.weekend], ['2026-11-21', 2, true]);
  assert.equal(grid.weeks[5][0]?.date, '2026-11-30');
  assert.equal(calendarGrid(now, 'Asia/Seoul', 2, {}).title, '2027년 1월');
});

test('adjustCalendar updates cached day counts when tasks are completed from a widget', () => {
  const prev = task('회의', '2026-11-21T10:00:00Z');
  assert.deepEqual(adjustCalendar({ '2026-11-21': 2, '2026-11-22': 1 }, prev, null), { '2026-11-21': 1, '2026-11-22': 1 });
  assert.deepEqual(adjustCalendar({ '2026-11-21': 1 }, prev, null), {});
  // A repeating task's next day was already counted, so only the completed day decrements.
  const nextRepeat = task('회의', '2026-11-22T10:00:00Z', { recurrence_rule: 'FREQ=DAILY' });
  assert.deepEqual(adjustCalendar({ '2026-11-21': 1, '2026-11-22': 1 }, prev, nextRepeat), { '2026-11-22': 1 });
});
