import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTimeInput, timeInputText } from './timeInput.ts';

test('typed times read on a 24-hour clock, with or without a colon', () => {
  assert.equal(parseTimeInput('17:30'), 17 * 60 + 30);
  assert.equal(parseTimeInput(' 1730 '), 17 * 60 + 30);
  assert.equal(parseTimeInput('930'), 9 * 60 + 30);
  assert.equal(parseTimeInput('0905'), 9 * 60 + 5);
  assert.equal(parseTimeInput('9'), 9 * 60);
  assert.equal(parseTimeInput('0'), 0);
  assert.equal(parseTimeInput('23:59'), 23 * 60 + 59);
  assert.equal(parseTimeInput('9:5'), 9 * 60 + 5);
  assert.equal(parseTimeInput('17:'), 17 * 60);
});

test('오전/오후 switch to a 12-hour clock', () => {
  assert.equal(parseTimeInput('오후 5:30'), 17 * 60 + 30);
  assert.equal(parseTimeInput('오후5시 30분'), 17 * 60 + 30);
  assert.equal(parseTimeInput('오전 12시'), 0);
  assert.equal(parseTimeInput('오후 12:15'), 12 * 60 + 15);
  assert.equal(parseTimeInput('pm 730'), 19 * 60 + 30);
  assert.equal(parseTimeInput('오후 13시'), null);
});

test('anything that is not a clock time is refused', () => {
  for (const text of ['', '24:00', '12:60', '2400', '12345', 'soon', '9:300', '-1']) assert.equal(parseTimeInput(text), null, text);
  assert.equal(timeInputText(9 * 60 + 5), '09:05');
  assert.equal(parseTimeInput(timeInputText(21 * 60 + 45)), 21 * 60 + 45);
});
