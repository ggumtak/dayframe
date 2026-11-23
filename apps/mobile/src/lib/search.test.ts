import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractChosung, isChosungQuery, matchScore, parseSearchQuery, searchTasks } from './search.ts';
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

test('parseSearchQuery separates #project, @tag, priority and text tokens', () => {
  assert.deepEqual(parseSearchQuery('#회사 @외출 p1 ㅂㄱㅅ'), {
    priority: 1,
    projectTerms: ['회사'],
    tagTerms: ['외출'],
    words: ['ㅂㄱㅅ'],
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
