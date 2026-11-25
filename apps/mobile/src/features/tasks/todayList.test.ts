import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Temporal } from '@js-temporal/polyfill';

import type { Task } from '../../lib/shared';
import {
  buildShareText, createTodayReuser, deriveToday, groupByPriority, groupByProject, groupByTimeOfDay, INBOX_GROUP,
  partitionDailyFocus, planAutoTimeSlots, splitToday,
} from './todayList.ts';

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
    '11월 23일 (월) 할 일',
    '☐ 보고서 마무리 (기한 지남) · 회사',
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
    '11월 23일 (월) 할 일\n☐ a',
  );
});

test('groupByTimeOfDay and groupByPriority bucket Today tasks cleanly', () => {
  const late = makeTask('late', { due_at: '2026-11-21T15:00:00Z', all_day: true, priority: 2 });
  const am = makeTask('am', { due_at: '2026-11-23T00:00:00Z', priority: 1 }); // 09:00 KST
  const pm = makeTask('pm', { due_at: '2026-11-23T06:00:00Z', priority: 3 }); // 15:00 KST
  const eve = makeTask('eve', { due_at: '2026-11-23T11:00:00Z', priority: 4 }); // 20:00 KST
  const allDay = makeTask('all', { due_at: '2026-11-22T15:00:00Z', all_day: true, priority: 1 }); // 11-23 all day

  const byTime = groupByTimeOfDay([late], [am, pm, eve, allDay]);
  assert.deepEqual(byTime.map((g) => [g.title, g.overdue.length + g.due.length]), [
    ['기한 지남', 1], ['오전', 1], ['오후', 1], ['저녁', 1], ['종일', 1],
  ]);

  const byPrio = groupByPriority([late], [am, pm, eve, allDay]);
  assert.deepEqual(byPrio.map((g) => [g.title, g.overdue.map((t) => t.id), g.due.map((t) => t.id)]), [
    ['!!! 가장 높음', [], ['am', 'all']],
    ['!! 높음', ['late'], []],
    ['! 보통', [], ['pm']],
    ['우선순위 없음', [], ['eve']],
  ]);
});

test('splitToday respects dayStartHour for night-owl users past midnight', () => {
  // 2026-11-23T16:30:00Z is 2026-11-24 01:30 KST.
  const lateNightMs = Date.parse('2026-11-23T16:30:00Z');
  const nov23 = makeTask('nov23', { due_at: '2026-11-22T15:00:00Z', all_day: true }); // 11-23 KST
  const nov24 = makeTask('nov24', { due_at: '2026-11-23T15:00:00Z', all_day: true }); // 11-24 KST

  // With dayStartHour=0, 11-23 is overdue and 11-24 is today.
  const normal = splitToday([nov23, nov24], byDue, lateNightMs, 0);
  assert.deepEqual(normal.overdue.map((t) => t.id), ['nov23']);
  assert.deepEqual(normal.due.map((t) => t.id), ['nov24']);

  // With dayStartHour=3, 01:30 KST still counts as 11-23, so nov23 is today and nov24 is upcoming.
  const nightOwl = splitToday([nov23, nov24], byDue, lateNightMs, 3);
  assert.deepEqual(nightOwl.overdue.map((t) => t.id), []);
  assert.deepEqual(nightOwl.due.map((t) => t.id), ['nov23']);
});

test('partitionDailyFocus isolates MIT and Evening tasks without duplicating them in daytime lists', () => {
  const o1 = makeTask('o1');
  const o2 = makeTask('o2');
  const d1 = makeTask('d1');
  const d2 = makeTask('d2');
  const d3 = makeTask('d3');

  const result = partitionDailyFocus([o1, o2], [d1, d2, d3], ['d2', 'o1', 'missing'], ['o1', 'd3']);
  assert.deepEqual(result.mitTasks.map((t) => t.id), ['d2', 'o1']);
  // o1 is already pinned as MIT so it is not duplicated in Evening.
  assert.deepEqual(result.eveningTasks.map((t) => t.id), ['d3']);
  assert.deepEqual(result.restOverdue.map((t) => t.id), ['o2']);
  assert.deepEqual(result.restDue.map((t) => t.id), ['d1']);
});

test('planAutoTimeSlots packs unscheduled tasks by priority around existing timed blocks', () => {
  const low = makeTask('low', { priority: 4, duration_minutes: 30, position: 1024 });
  const high = makeTask('high', { priority: 1, duration_minutes: 60, position: 2048 });
  const mid = makeTask('mid', { priority: 2, duration_minutes: null, position: 3072 });

  // Now is 09:40 (580); next 30-min slot is 10:00 (600). Block exists 10:00–11:00 (600..660).
  const plan = planAutoTimeSlots([low, high, mid], [{ start: 600, duration: 60 }], 580);
  assert.deepEqual(
    plan.map((item) => [item.task.id, item.minutes, item.duration]),
    [
      ['high', 660, 60], // 11:00–12:00
      ['mid', 720, 30], // 12:00–12:30
      ['low', 750, 30], // 12:30–13:00
    ],
  );
});

test('buildShareText supports 24h timeFormat', () => {
  const text = buildShareText({
    date: Temporal.PlainDate.from('2026-11-23'),
    overdue: [],
    due: [makeTask('운동', { due_at: '2026-11-23T06:00:00Z' })], // 15:00 KST
    doneTitles: [],
    projectName: () => undefined,
    timeFormat: '24h',
  });
  assert.equal(text, '11월 23일 (월) 할 일\n☐ 운동 · 15:00');
});
