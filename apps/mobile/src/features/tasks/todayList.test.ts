import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Temporal } from '@js-temporal/polyfill';

import type { Task } from '../../lib/shared';
import { buildShareText, createTodayReuser, deriveToday, groupByProject, INBOX_GROUP, splitToday } from './todayList.ts';

const nowMs = Date.parse('2026-11-23T03:00:00Z'); // Monday 2026-11-23 12:00 KST

function makeTask(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    user_id: 'u',
    project_id: null,
    section_id: null,
    parent_task_id: null,
    title: id,
    notes: null,
    priority: 4,
    position: 1024,
    due_at: null,
    all_day: false,
    timezone: 'Asia/Seoul',
    recurrence_rule: null,
    recurrence_mode: 'schedule',
    recurrence_anchor_at: null,
    recurrence_local_time: null,
    occurrence_at: null,
    duration_minutes: null,
    completed_at: null,
    created_at: '2026-11-20T00:00:00Z',
    updated_at: '2026-11-20T00:00:00Z',
    ...extra,
  };
}

const byDue = (a: Task, b: Task) => Date.parse(a.due_at ?? '9999-01-01') - Date.parse(b.due_at ?? '9999-01-01') || (a.id < b.id ? -1 : 1);

test('splitToday buckets by the task time zone, sorts, and drops subtasks whose parent is shown', () => {
  const late = makeTask('late', { due_at: '2026-11-21T15:00:00Z', all_day: true }); // 11-22 KST
  const todayPm = makeTask('today-pm', { due_at: '2026-11-23T06:00:00Z' }); // 15:00 KST
  const todayAm = makeTask('today-am', { due_at: '2026-11-23T00:00:00Z' }); // 09:00 KST
  const tomorrow = makeTask('tomorrow', { due_at: '2026-11-24T01:00:00Z' });
  const none = makeTask('none');
  const childOfShown = makeTask('child', { parent_task_id: 'today-pm', due_at: '2026-11-23T05:00:00Z' });
  const childOfHidden = makeTask('orphan', { parent_task_id: 'tomorrow', due_at: '2026-11-23T05:00:00Z' });
  // 2026-11-22T20:00Z is 11-23 in Seoul but still 11-22 in New York.
  const newYork = makeTask('ny', { due_at: '2026-11-22T20:00:00Z', timezone: 'America/New_York' });

  const { overdue, due } = splitToday([todayPm, late, tomorrow, none, childOfShown, childOfHidden, todayAm, newYork], byDue, nowMs);
  assert.deepEqual(overdue.map((task) => task.id), ['late']);
  assert.deepEqual(due.map((task) => task.id), ['ny', 'today-am', 'orphan', 'today-pm']);
});

test('groupByProject puts 미분류 first, then projects in their order, overdue before today inside each', () => {
  const a = (id: string, project: string | null) => makeTask(id, { project_id: project });
  const overdue = [a('o-work', 'work'), a('o-inbox', null)];
  const due = [a('d-home', 'home'), a('d-work', 'work'), a('d-gone', 'deleted'), a('d-inbox', null)];
  const groups = groupByProject(overdue, due, ['home', 'work', 'empty']);
  assert.deepEqual(groups.map((group) => group.key), [INBOX_GROUP, 'home', 'work']);
  assert.deepEqual(groups[0].overdue.map((task) => task.id), ['o-inbox']);
  assert.deepEqual(groups[0].due.map((task) => task.id), ['d-gone', 'd-inbox']);
  assert.equal(groups[0].projectId, null);
  assert.deepEqual(groups[2].overdue.map((task) => task.id), ['o-work']);
  assert.deepEqual(groups[2].due.map((task) => task.id), ['d-work']);
});

test('createTodayReuser keeps earlier objects when a re-derivation changes nothing', () => {
  const tasks = [
    makeTask('x', { due_at: '2026-11-23T01:00:00Z', project_id: 'p' }),
    makeTask('y', { due_at: '2026-11-23T02:00:00Z' }),
  ];
  const reuse = createTodayReuser();
  const first = reuse(deriveToday(tasks, byDue, ['p'], nowMs));
  const second = reuse(deriveToday(tasks, byDue, ['p'], nowMs + 60_000));
  assert.equal(second, first);

  // Completing `y` changes the inbox group and `due`, but the project group is the same object.
  const third = reuse(deriveToday([tasks[0]], byDue, ['p'], nowMs + 120_000));
  assert.notEqual(third, first);
  assert.notEqual(third.due, first.due);
  assert.equal(third.overdue, first.overdue);
  assert.equal(third.groups.length, 1);
  assert.equal(third.groups[0], first.groups[1]);
});

test('buildShareText lists open tasks with time and list, then what was done', () => {
  const text = buildShareText({
    date: Temporal.PlainDate.from('2026-11-23'),
    overdue: [makeTask('보고서 마무리', { due_at: '2026-11-22T06:00:00Z', project_id: 'w' })],
    due: [
      makeTask('운동', { due_at: '2026-11-23T06:00:00Z' }),
      makeTask('장보기', { due_at: '2026-11-22T15:00:00Z', all_day: true, project_id: 'h' }),
    ],
    doneTitles: ['메일 답장'],
    projectName: (id) => ({ w: '회사', h: '집' } as Record<string, string>)[id],
  });
  assert.equal(text, [
    '11월 23일 월요일 할 일',
    '☐ 보고서 마무리 (지연) · 회사',
    '☐ 운동 · 오후 3:00',
    '☐ 장보기 · 집',
    '',
    '완료 1개',
    '☑ 메일 답장',
  ].join('\n'));
});

test('buildShareText returns null when there is nothing to share, and omits the done block when empty', () => {
  const date = Temporal.PlainDate.from('2026-11-23');
  assert.equal(buildShareText({ date, overdue: [], due: [], doneTitles: [], projectName: () => undefined }), null);
  assert.equal(
    buildShareText({ date, overdue: [], due: [makeTask('a')], doneTitles: [], projectName: () => undefined }),
    '11월 23일 월요일 할 일\n☐ a',
  );
});
