import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activeMention, applyMention, applyPriority, applyScheduleWord, matchNames } from './suggest.ts';

test('activeMention detects bare or partial #project and @tag at the end of input', () => {
  assert.deepEqual(activeMention('#'), { kind: 'project', query: '', start: 0, end: 1 });
  assert.deepEqual(activeMention('운동 #건'), { kind: 'project', query: '건', start: 3, end: 5 });
  assert.deepEqual(activeMention('회의 @외출'), { kind: 'tag', query: '외출', start: 3, end: 6 });
  assert.equal(activeMention('운동 #건강 '), null);
  assert.equal(activeMention('이메일 test@example.com'), null);
});

test('matchNames puts prefix matches before substring matches', () => {
  assert.deepEqual(matchNames(['개인 업무', '업무', '건강', '업데이트'], '업'), ['업무', '업데이트', '개인 업무']);
  assert.deepEqual(matchNames(['회사', '건강'], ''), ['회사', '건강']);
});

test('applyMention quotes names with spaces and appends a trailing space', () => {
  const m1 = activeMention('장보기 #집')!;
  assert.equal(applyMention('장보기 #집', m1, '집안일'), '장보기 #집안일 ');
  const m2 = activeMention('장보기 #주말')!;
  assert.equal(applyMention('장보기 #주말', m2, '주말 계획'), '장보기 #"주말 계획" ');
});

test('applyPriority replaces existing priority or clears it for P4', () => {
  const tokens = [{ kind: 'priority' as const, start: 4, end: 6, text: 'p1' }];
  assert.equal(applyPriority('보고서 p1', 2, tokens), '보고서 p2 ');
  assert.equal(applyPriority('보고서 p1', 4, tokens), '보고서 ');
  assert.equal(applyPriority('보고서', 1, []), '보고서 p1 ');
});

test('applyScheduleWord swaps an existing date or recurrence token cleanly', () => {
  const tokens = [{ kind: 'date' as const, start: 0, end: 2, text: '오늘' }];
  assert.equal(applyScheduleWord('오늘 운동', '내일', 'date', tokens), '내일 운동');
  assert.equal(applyScheduleWord('운동', '내일', 'date', []), '운동 내일 ');
});
