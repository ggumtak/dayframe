import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Temporal } from '@js-temporal/polyfill';

import {
  adjustCalendar, buildWidgetMeta, calendarDateLabel, calendarDateRows, calendarGrid, focusState, habitToday,
  snapshotTasks, todayOverview, todayWidgetItems, upcomingRows, widgetDate, widgetRows, type WidgetTask,
} from './items.ts';

// Local stand-in for the backend recurrence engine so this mobile unit test only depends on apps/mobile packages.
const nextOccurrence = (rule: string, timezone: string, _anchor: string, after: Temporal.Instant) => {
  const at = after.toZonedDateTimeISO(timezone);
  if (rule.startsWith('FREQ=DAILY')) return at.add({ days: 1 }).toInstant().toString();
  throw new Error('unsupported rule: ' + rule);
};

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

test('todayOverview and todayWidgetItems separate overdue days and track today progress', () => {
  const tasks = [
    task('보고서', '2026-11-20T09:00:00Z', { projectName: '업무', subtaskLabel: '1/3' }),
    task('장보기', '2026-11-20T15:00:00Z', { all_day: true }),
    task('운동', '2026-11-21T10:00:00Z', { recurrence_rule: 'FREQ=DAILY' }),
  ];
  const rows = widgetRows(snapshotTasks(tasks, now), now);
  assert.equal(rows[0].meta, '#업무 · 1/3');
  assert.equal(rows[2].meta, '반복');
  const overview = todayOverview(rows, { date: '2026-11-21', count: 2 }, now, 'Asia/Seoul');
  assert.equal(overview.subtitle, '11월 21일 (토) · 기한 지남 1 · 오늘 2');
  assert.equal(overview.ratio, 0.5);
  assert.deepEqual(todayWidgetItems(rows).map((item) => (item.kind === 'section' ? '# ' + item.label : item.title)), [
    '# 기한 지남 · 1', '보고서', '# 오늘 · 2', '장보기', '운동',
  ]);
  const cleanOverview = todayOverview(rows.slice(1), { date: '2026-11-21', count: 2 }, now, 'Asia/Seoul');
  assert.equal(cleanOverview.subtitle, '11월 21일 (토) · 오늘 2/4 완료');
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
  assert.equal(widgetDate(now, 'Asia/Seoul'), '11월 21일 (토)');
});

test('the upcoming widget groups the next seven days, marks real tasks completable, and expands repeats', () => {
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
  const repeating = snapshotTasks([
    task('영양제', '2026-11-21T10:00:00Z', { recurrence_rule: 'FREQ=DAILY', recurrence_anchor_at: '2026-11-21T10:00:00Z', recurrence_local_time: '19:00:00' }),
  ], now);
  const expanded = upcomingRows(repeating, now, 'Asia/Seoul', nextOccurrence);
  const previewTasks = expanded.filter((row): row is Extract<typeof row, { kind: 'task' }> => row.kind === 'task');
  assert.equal(previewTasks.length, 7);
  assert.equal(previewTasks[0].completable, false);
  assert.equal(previewTasks[0].meta, '반복 예정');
  assert.equal(buildWidgetMeta({ projectName: '건강', subtaskLabel: '2/3', recurrence_rule: 'FREQ=DAILY' }), '#건강 · 2/3 · 반복');
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
  const prev = task('회의', '2026-11-21T10:00:00Z', { projectName: '업무' });
  assert.deepEqual(adjustCalendar({ '2026-11-21': 2, '2026-11-22': 1 }, prev, null), { '2026-11-21': 1, '2026-11-22': 1 });
  assert.deepEqual(adjustCalendar({ '2026-11-21': 1 }, prev, null), {});
  const nextRepeat = task('회의', '2026-11-22T10:00:00Z', { recurrence_rule: 'FREQ=DAILY' });
  assert.deepEqual(adjustCalendar({ '2026-11-21': 1, '2026-11-22': 1 }, prev, nextRepeat), { '2026-11-22': 1 });
});

test('calendarDateRows lists real tasks and repeat previews for a selected calendar day', () => {
  const tasks = snapshotTasks([
    task('저녁 운동', '2026-11-21T10:00:00Z', { priority: 2 }), // 11/21 19:00 Seoul
    task('장보기', '2026-11-20T15:00:00Z', { all_day: true }), // 11/21 all-day
    task('점심 약속', '2026-11-21T03:00:00Z', { priority: 1 }), // 11/21 12:00 Seoul (past)
    task('영양제', '2026-11-21T00:00:00Z', {
      recurrence_rule: 'FREQ=DAILY', recurrence_anchor_at: '2026-11-21T00:00:00Z', recurrence_local_time: '09:00:00',
    }), // 11/21 09:00 Seoul, repeats daily
    task('내일 회의', '2026-11-22T01:00:00Z', { projectName: '업무' }), // 11/22 10:00 Seoul
  ], now);

  // Selected today: all-day first, then chronological; overdue flag reflects `now`.
  const todayRows = calendarDateRows(tasks, '2026-11-21', now, nextOccurrence);
  assert.deepEqual(todayRows.map((row) => [row.title, row.when, row.overdue, row.completable]), [
    ['장보기', '', false, true],
    ['영양제', '오전 9:00', true, true],
    ['점심 약속', '오후 12:00', true, true],
    ['저녁 운동', '오후 7:00', false, true],
  ]);

  // Selected tomorrow: real task + daily repeat preview, respecting 24h time format.
  const tomorrowRows = calendarDateRows(tasks, '2026-11-22', now, nextOccurrence, '24h');
  assert.deepEqual(tomorrowRows.map((row) => [row.title, row.when, row.completable, row.meta]), [
    ['영양제', '09:00', false, '반복 예정'],
    ['내일 회의', '10:00', true, '#업무'],
  ]);

  // Invalid date returns empty safely; label formats cleanly.
  assert.deepEqual(calendarDateRows(tasks, 'not-a-date', now, nextOccurrence), []);
  assert.equal(calendarDateLabel('2026-11-26'), '11월 26일 (목)');
});

