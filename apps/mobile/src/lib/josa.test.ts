import assert from 'node:assert/strict';
import { test } from 'node:test';

import { josa, withJosa } from './josa.ts';

test('Hangul: a final consonant takes 을 이 은 과 으로, a vowel takes 를 가 는 와 로', () => {
  assert.equal(withJosa('운동', '을/를'), '운동을');
  assert.equal(withJosa('장보기', '을/를'), '장보기를');
  assert.equal(withJosa('책상', '이/가'), '책상이');
  assert.equal(withJosa('메모', '이/가'), '메모가');
  assert.equal(withJosa('습관', '은/는'), '습관은');
  assert.equal(withJosa('할 일', '은/는'), '할 일은');
  assert.equal(withJosa('하루', '은/는'), '하루는');
  assert.equal(withJosa('회의', '와/과'), '회의와');
  assert.equal(withJosa('회의록', '와/과'), '회의록과');
  assert.equal(withJosa('건강', '으로/로'), '건강으로');
  assert.equal(withJosa('내일', '으로/로'), '내일로'); // ㄹ takes 로
  assert.equal(withJosa('오늘', '으로/로'), '오늘로');
  assert.equal(withJosa('미분류', '으로/로'), '미분류로');
});

test('digits are read as Korean numbers', () => {
  assert.equal(josa('1', '으로/로'), '로'); // 일
  assert.equal(josa('2', '을/를'), '를'); // 이
  assert.equal(josa('3', '으로/로'), '으로'); // 삼
  assert.equal(josa('6', '이/가'), '이'); // 육
  assert.equal(josa('7', '으로/로'), '로'); // 칠
  assert.equal(josa('8', '으로/로'), '로'); // 팔
  assert.equal(josa('9', '을/를'), '를'); // 구
  assert.equal(josa('0', '이/가'), '이'); // 영
  assert.equal(josa('10', '으로/로'), '으로'); // 십
  assert.equal(josa('20', '을/를'), '을'); // 이십
  assert.equal(josa('100', '은/는'), '은'); // 백
  assert.equal(josa('1000', '이/가'), '이'); // 천
  assert.equal(josa('10000', '이/가'), '이'); // 만
  assert.equal(withJosa('1시간 30분', '으로/로'), '1시간 30분으로');
  assert.equal(withJosa('25분', '으로/로'), '25분으로');
});

test('clock times are read in hours and minutes', () => {
  assert.equal(withJosa('오후 3:00', '으로/로'), '오후 3:00로'); // 세 시로
  assert.equal(withJosa('오전 9:30', '으로/로'), '오전 9:30으로'); // 삼십 분으로
  assert.equal(withJosa('오후 3:05', '으로/로'), '오후 3:05으로'); // 오 분으로
});

test('Latin letters: acronyms by letter name, words by their usual ending', () => {
  assert.equal(withJosa('P1', '으로/로'), 'P1로'); // 피일
  assert.equal(withJosa('P2', '으로/로'), 'P2로'); // 피이
  assert.equal(withJosa('P3', '으로/로'), 'P3으로'); // 피삼
  assert.equal(withJosa('URL', '을/를'), 'URL을'); // 유알엘
  assert.equal(withJosa('URL', '으로/로'), 'URL로');
  assert.equal(withJosa('PM', '이/가'), 'PM이'); // 피엠
  assert.equal(withJosa('AI', '와/과'), 'AI와'); // 에이아이
  assert.equal(withJosa('mail', '으로/로'), 'mail로');
  assert.equal(withJosa('plan', '을/를'), 'plan을');
  assert.equal(withJosa('note', '을/를'), 'note를');
  assert.equal(withJosa('card', '이/가'), 'card가');
});

test('trailing quotes, brackets and punctuation are skipped', () => {
  assert.equal(josa('‘장보기’', '을/를'), '를');
  assert.equal(josa('회의 (오후)', '을/를'), '를');
  assert.equal(josa('운동!', '이/가'), '이');
  assert.equal(josa('#건강', '으로/로'), '으로');
});

test('an unreadable ending falls back to the double form', () => {
  assert.equal(josa('book', '을/를'), '을(를)');
  assert.equal(josa('GitHub', '으로/로'), '(으)로');
  assert.equal(josa('운동 💪', '이/가'), '이(가)');
  assert.equal(josa('', '은/는'), '은(는)');
  assert.equal(josa('…', '와/과'), '와(과)');
});
