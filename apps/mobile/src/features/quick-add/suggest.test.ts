import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  activeMention, applyMention, applyPriority, applyProject, applyScheduleWord, matchNames, parseChecklistLines, removeTokens, toggleTag,
} from './suggest.ts';

test('activeMention detects bare or partial #project and @tag at the end of input', () => {
  assert.deepEqual(activeMention('#'), { kind: 'project', query: '', start: 0, end: 1 });
  assert.deepEqual(activeMention('운동 #건'), { kind: 'project', query: '건', start: 3, end: 5 });
  assert.deepEqual(activeMention('회의 @외출'), { kind: 'tag', query: '외출', start: 3, end: 6 });
  assert.equal(activeMention('운동 #건강 '), null);
  assert.equal(activeMention('이메일 test@example.com'), null);
});

test('activeMention detects #project and @tag at a mid-sentence cursor position', () => {
  assert.deepEqual(activeMention('운동 #건 내일', 5), { kind: 'project', query: '건', start: 3, end: 5 });
  assert.deepEqual(activeMention('운동 #건강 내일', 5), { kind: 'project', query: '건', start: 3, end: 6 });
  assert.deepEqual(activeMention('회의 @외 내일 3시', 5), { kind: 'tag', query: '외', start: 3, end: 5 });
  assert.deepEqual(activeMention('# 내일', 1), { kind: 'project', query: '', start: 0, end: 1 });
  assert.equal(activeMention('운동 #건강 내일', 9), null);
  assert.equal(activeMention('이메일 test@example.com 내일', 12), null);
  assert.equal(activeMention('운동 #건 내일', 0), null);
});

test('matchNames puts prefix matches before substring matches', () => {
  assert.deepEqual(matchNames(['개인 업무', '업무', '건강', '업데이트'], '업'), ['업무', '업데이트', '개인 업무']);
  assert.deepEqual(matchNames(['회사', '건강'], ''), ['회사', '건강']);
});

test('applyMention quotes names with spaces and preserves trailing text when mid-sentence', () => {
  const m1 = activeMention('장보기 #집')!;
  assert.equal(applyMention('장보기 #집', m1, '집안일'), '장보기 #집안일 ');
  const m2 = activeMention('장보기 #주말')!;
  assert.equal(applyMention('장보기 #주말', m2, '주말 계획'), '장보기 #"주말 계획" ');

  const mid = activeMention('운동 #건 내일 오후 7시', 5)!;
  assert.equal(applyMention('운동 #건 내일 오후 7시', mid, '건강'), '운동 #건강 내일 오후 7시');
  const midFull = activeMention('운동 #건강 내일', 5)!;
  assert.equal(applyMention('운동 #건강 내일', midFull, '건강 관리'), '운동 #"건강 관리" 내일');
  const midTag = activeMention('회의 @외 내일', 5)!;
  assert.equal(applyMention('회의 @외 내일', midTag, '외출'), '회의 @외출 내일');
});

test('applyProject sets, replaces, quotes, or clears #project tokens', () => {
  assert.equal(applyProject('운동', '건강', []), '운동 #건강 ');
  assert.equal(applyProject('운동', '주말 계획', []), '운동 #"주말 계획" ');
  const tokens = [{ kind: 'project' as const, start: 3, end: 6, text: '#건강' }];
  assert.equal(applyProject('운동 #건강 내일', '업무', tokens), '운동 #업무 내일 ');
  assert.equal(applyProject('운동 #건강 내일', null, tokens), '운동 내일 ');
});

test('toggleTag adds missing @tag and removes existing @tag', () => {
  assert.equal(toggleTag('보고서', '집중', []), '보고서 @집중 ');
  assert.equal(toggleTag('보고서', '핵심 업무', []), '보고서 @"핵심 업무" ');
  const tokens = [{ kind: 'tag' as const, start: 4, end: 7, text: '@집중' }];
  assert.equal(toggleTag('보고서 @집중 내일', '집중', tokens), '보고서 내일 ');
});

test('applyPriority replaces existing priority or clears it for P4', () => {
  const tokens = [{ kind: 'priority' as const, start: 4, end: 6, text: 'p1' }];
  assert.equal(applyPriority('보고서 p1', 2, tokens), '보고서 p2 ');
  assert.equal(applyPriority('보고서 p1', 4, tokens), '보고서 ');
  assert.equal(applyPriority('보고서', 1, []), '보고서 p1 ');
});

test('applyScheduleWord swaps an existing date, duration, or recurrence token cleanly and respects cursor boundaries', () => {
  const tokens = [{ kind: 'date' as const, start: 0, end: 2, text: '오늘' }];
  assert.equal(applyScheduleWord('오늘 운동', '내일', 'date', tokens), '내일 운동');
  assert.equal(applyScheduleWord('운동', '내일', 'date', []), '운동 내일 ');
  const durTokens = [{ kind: 'duration' as const, start: 3, end: 7, text: '30분간' }];
  assert.equal(applyScheduleWord('독서 30분간', '1시간 동안', 'duration', durTokens), '독서 1시간 동안 ');
  // Cursor on a clean whitespace boundary inserts mid-sentence
  assert.equal(applyScheduleWord('운동  #건강', '내일', 'date', [], 3), '운동 내일 #건강');
  // Cursor inside a word safely appends to the end without splitting the word
  assert.equal(applyScheduleWord('운동하기', '내일', 'date', [], 2), '운동하기 내일 ');
});

test('removeTokens strips matching parsed tokens cleanly', () => {
  const text = '내일 오후 7시 운동 #건강 @외출 p1';
  const tokens = [
    { kind: 'date' as const, start: 0, end: 2, text: '내일' },
    { kind: 'time' as const, start: 3, end: 8, text: '오후 7시' },
    { kind: 'project' as const, start: 12, end: 15, text: '#건강' },
    { kind: 'tag' as const, start: 16, end: 19, text: '@외출' },
    { kind: 'priority' as const, start: 20, end: 22, text: 'p1' },
  ];
  assert.equal(removeTokens(text, tokens, (t) => t.kind === 'date' || t.kind === 'time'), '운동 #건강 @외출 p1 ');
  assert.equal(removeTokens(text, tokens, (t) => t.kind === 'project'), '내일 오후 7시 운동 @외출 p1 ');
  assert.equal(removeTokens(text, tokens, (t) => t.kind === 'priority'), '내일 오후 7시 운동 #건강 @외출 ');
});

test('parseChecklistLines strips bullets, checkboxes, numbers, and blank lines', () => {
  const pasted = `
    - [ ] 우유 사기
    - [x] 계란 사기
    • 빵
    1. 세제
    2) 휴지

    과일
  `;
  assert.deepEqual(parseChecklistLines(pasted), ['우유 사기', '계란 사기', '빵', '세제', '휴지', '과일']);
});
