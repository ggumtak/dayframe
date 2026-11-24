import assert from 'node:assert/strict';
import { test } from 'node:test';

import { habitLook, presetLook, startDateLabel } from './display.ts';
import { routineGroups } from './routines.ts';

test('presetLook finds a gallery preset by name, ignoring spaces and case', () => {
  const water = routineGroups.flatMap((group) => group.items).find((item) => item.name === '물 2리터 마시기')!;
  assert.deepEqual(presetLook('물 2리터 마시기'), { emoji: water.emoji, color: water.color });
  assert.deepEqual(presetLook('물2리터마시기'), { emoji: water.emoji, color: water.color });
  assert.ok(presetLook('SNS 30분 이하'));
  assert.equal(presetLook('sns 30분이하'), presetLook('SNS 30분 이하'));
  assert.equal(presetLook('나만의 습관'), null);
  // Cached answers are the same objects, so repeated renders do no new work.
  assert.equal(presetLook('물 2리터 마시기'), presetLook('물 2리터 마시기'));
});

test('habitLook keeps what was chosen and falls back to the preset only when nothing was', () => {
  const preset = presetLook('명상 10분')!;
  assert.equal(habitLook('명상 10분'), preset);
  assert.equal(habitLook('명상 10분', {}), preset);
  assert.deepEqual(habitLook('명상 10분', { emoji: '🔥' }), { emoji: '🔥' });
  assert.deepEqual(habitLook('명상 10분', { color: '#123456' }), { color: '#123456' });
  assert.deepEqual(habitLook('직접 만든 습관'), {});
  // The same stored object comes back, so it can be handed to memoised rows as it is.
  const stored = { emoji: '🌱', color: '#1F9D63', quote: '…' };
  assert.equal(habitLook('명상 10분', stored), stored);
});

test('startDateLabel formats like the rest of the app and drops this year', () => {
  assert.equal(startDateLabel('2026-11-01', 2026), '11월 1일 시작');
  assert.equal(startDateLabel('2025-03-09', 2026), '2025년 3월 9일 시작');
  assert.equal(startDateLabel('soon', 2026), 'soon 시작');
});
