import assert from 'node:assert/strict';
import { test } from 'node:test';

import { snapshotTasks, widgetDate, widgetRows, type WidgetTask } from './items.ts';

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
  ], now);
  assert.deepEqual(kept.map((item) => item.title), ['tomorrow']);
  assert.equal('completed_at' in kept[0], false);
  // After midnight in Seoul, tomorrow's task becomes today's.
  assert.deepEqual(widgetRows(kept, Date.parse('2026-11-21T16:00:00Z')).map((row) => row.title), ['tomorrow']);
  assert.equal(widgetDate(now, 'Asia/Seoul'), '11월 21일 토요일');
});
