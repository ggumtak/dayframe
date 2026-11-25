import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyQuickFilters, extractChosung, isChosungQuery, matchScore, parseSearchQuery, searchTasks } from './search.ts';
import type { Task } from './shared';

function makeTask(id: string, title: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    user_id: 'u',
    project_id: null,
    section_id: null,
    parent_task_id: null,
    title,
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

test('extractChosung and isChosungQuery recognize Hangul initial consonants', () => {
  assert.equal(extractChosung('주간 장보기 목록'), 'ㅈㄱㅈㅂㄱㅁㄹ');
  assert.equal(extractChosung('팀 회의 2차'), 'ㅌㅎㅇ2ㅊ');
  assert.equal(isChosungQuery('ㅈㅂㄱ'), true);
  assert.equal(isChosungQuery('장보기'), false);
  assert.equal(isChosungQuery(''), false);
});

test('matchScore ranks exact > prefix > substring > chosung', () => {
  assert.ok(matchScore('장보기', '장보기') > matchScore('장보기 리스트', '장보기'));
  assert.ok(matchScore('장보기 리스트', '장보기') > matchScore('주말 장보기', '장보기'));
  assert.ok(matchScore('장보기', 'ㅈㅂㄱ') > 0);
  assert.equal(matchScore('운동하기', 'ㅈㅂㄱ'), 0);
});

test('parseSearchQuery separates #project, @tag, priority, due, has:subtasks, negations, and text tokens', () => {
  assert.deepEqual(parseSearchQuery('#회사 @외출 p1 ㅂㄱㅅ'), {
    priority: 1,
    excludePriorities: [],
    projectTerms: ['회사'],
    excludeProjectTerms: [],
    tagTerms: ['외출'],
    excludeTagTerms: [],
    dueFilter: null,
    hasSubtasks: false,
    words: ['ㅂㄱㅅ'],
  });

  assert.deepEqual(parseSearchQuery('due:today has:subtasks -p4 -#개인 -@보류 보고서'), {
    priority: null,
    excludePriorities: [4],
    projectTerms: [],
    excludeProjectTerms: ['개인'],
    tagTerms: [],
    excludeTagTerms: ['보류'],
    dueFilter: 'today',
    hasSubtasks: true,
    words: ['보고서'],
  });
});

test('searchTasks supports chosung, strict #project/@tag/priority filters, and relevance ranking', () => {
  const tasks = [
    makeTask('1', '보고서 초안 작성', { project_id: 'p-work', priority: 2 }),
    makeTask('2', '분기 보고서', { project_id: 'p-work', priority: 1 }),
    makeTask('3', '장보기', { project_id: 'p-home', notes: '회사 간식도 사기', priority: 4 }),
  ];
  const ctx = {
    projectNames: new Map([['p-work', '회사'], ['p-home', '집안일']]),
    tagNames: new Map([['1', ['집중']], ['2', ['급함', '집중']], ['3', ['외출']]]),
  };

  // Chosung search finds "장보기"
  assert.deepEqual(searchTasks(tasks, 'ㅈㅂㄱ', ctx).map((t) => t.id), ['3']);

  // #회사 strictly filters by project (sorted by priority P1 before P2), NOT by notes mentioning "회사"!
  assert.deepEqual(searchTasks(tasks, '#회사', ctx).map((t) => t.id), ['2', '1']);

  // Combined #회사 @급함 p1
  assert.deepEqual(searchTasks(tasks, '#회사 @급함 p1', ctx).map((t) => t.id), ['2']);

  // Relevance: prefix match "보고서 초안 작성" ranks ahead of substring "분기 보고서" for "보고서"
  assert.deepEqual(searchTasks(tasks, '보고서', ctx).map((t) => t.id), ['1', '2']);
});

test('searchTasks supports due:today, due:overdue, due:week, due:none, and dayStartHour', () => {
  // 2026-11-25 12:00 KST
  const nowMs = Date.parse('2026-11-25T12:00:00+09:00');
  const tasks = [
    makeTask('overdue', '어제 마감', { due_at: '2026-11-24T09:00:00+09:00', position: 1 }),
    makeTask('today', '오늘 할 일', { due_at: '2026-11-25T18:00:00+09:00', position: 2 }),
    makeTask('week', '사흘 뒤', { due_at: '2026-11-28T00:00:00+09:00', all_day: true, position: 3 }),
    makeTask('later', '한 달 뒤', { due_at: '2026-12-25T00:00:00+09:00', all_day: true, position: 4 }),
    makeTask('none', '날짜 없음', { due_at: null, position: 5 }),
  ];
  const ctx = { projectNames: new Map<string, string>(), tagNames: new Map<string, string[]>(), nowMs };

  assert.deepEqual(searchTasks(tasks, 'due:overdue', ctx).map((t) => t.id), ['overdue']);
  assert.deepEqual(searchTasks(tasks, 'due:today', ctx).map((t) => t.id), ['today']);
  assert.deepEqual(searchTasks(tasks, 'due:week', ctx).map((t) => t.id), ['today', 'week']);
  assert.deepEqual(searchTasks(tasks, 'due:none', ctx).map((t) => t.id), ['none']);

  // 01:00 KST on Nov 25 with dayStartHour=2 still counts Nov 24 as logical today
  const lateNightMs = Date.parse('2026-11-25T01:00:00+09:00');
  assert.deepEqual(
    searchTasks(tasks, 'due:today', { ...ctx, nowMs: lateNightMs, dayStartHour: 2 }).map((t) => t.id),
    ['overdue'],
  );
});

test('searchTasks supports has:subtasks and negations (-p4, -#project, -@tag)', () => {
  const tasks = [
    makeTask('1', '발표 준비', { project_id: 'p-work', priority: 1 }),
    makeTask('2', '간식 주문', { project_id: 'p-work', priority: 4 }),
    makeTask('3', '장보기', { project_id: 'p-home', priority: 2 }),
    makeTask('4', '슬라이드 초안', { parent_task_id: '1', priority: 3 }),
  ];
  const ctx = {
    projectNames: new Map([['p-work', '회사'], ['p-home', '집안일']]),
    tagNames: new Map([['1', ['집중']], ['2', ['보류']], ['3', ['외출']]]),
    subtaskProgress: new Map([['1', { total: 2 }], ['3', { total: 1 }]]),
  };

  // has:subtasks with subtaskProgress
  assert.deepEqual(searchTasks(tasks, 'has:subtasks', ctx).map((t) => t.id), ['1', '3']);
  // has:subtasks fallback without subtaskProgress
  assert.deepEqual(
    searchTasks(tasks, 'has:subtasks', { projectNames: ctx.projectNames, tagNames: ctx.tagNames }).map((t) => t.id),
    ['1'],
  );

  // Negations
  assert.deepEqual(searchTasks(tasks, '-p4', ctx).map((t) => t.id), ['1', '3', '4']);
  assert.deepEqual(searchTasks(tasks, '-#회사 -p3', ctx).map((t) => t.id), ['3']);
  assert.deepEqual(searchTasks(tasks, '#회사 -@보류', ctx).map((t) => t.id), ['1']);
  assert.deepEqual(searchTasks(tasks, '-#집안일 -p4 has:subtasks', ctx).map((t) => t.id), ['1']);
});

test('applyQuickFilters composes multiple quick filters with AND logic', () => {
  const nowMs = Date.parse('2026-11-25T12:00:00+09:00');
  const tasks = [
    makeTask('1', '긴급 기한지남', { priority: 1, due_at: '2026-11-24T09:00:00+09:00' }),
    makeTask('2', '보통 기한지남', { priority: 3, due_at: '2026-11-24T09:00:00+09:00' }),
    makeTask('3', '미지정 체크리스트', { priority: 2, due_at: null }),
    makeTask('4', '오늘 체크리스트', { priority: 2, due_at: '2026-11-25T15:00:00+09:00' }),
  ];
  const ctx = { nowMs, subtaskProgress: new Map([['3', { total: 3 }], ['4', { total: 1 }]]) };

  assert.deepEqual(applyQuickFilters(tasks, ['p1', 'overdue'], ctx).map((t) => t.id), ['1']);
  assert.deepEqual(applyQuickFilters(tasks, ['unscheduled', 'checklist'], ctx).map((t) => t.id), ['3']);
});
