import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lineStarts, pills, runs } from './pills.ts';

const token = (kind: 'date' | 'time' | 'recurrence' | 'project' | 'tag' | 'priority', text: string, start: number) =>
  ({ kind, text, start, end: start + text.length });

test('schedule tokens separated only by spaces become one pill', () => {
  const text = '오늘 7시 운동 매주 월 #건강 p1';
  const all = pills(text, [token('date', '오늘', 0), token('time', '7시', 3), token('recurrence', '매주 월', 9),
    token('project', '#건강', 14), token('priority', 'p1', 18)]);
  assert.deepEqual(all.map((pill) => [text.slice(pill.start, pill.end), pill.kind]),
    [['오늘 7시', 'schedule'], ['매주 월', 'schedule'], ['#건강', 'project'], ['p1', 'priority']]);
});

test('a line is cut into spacers and pills, and neighbouring pills are marked', () => {
  const text = '오늘 7시 운동 #건강 p1 끝';
  const all = pills(text, [token('date', '오늘', 0), token('time', '7시', 3), token('project', '#건강', 9), token('priority', 'p1', 13)]);
  assert.deepEqual(runs(text, 0, text.length, all), [
    { text: '오늘 7시', kind: 'schedule', joinsBefore: false },
    { text: ' 운동 ' },
    { text: '#건강', kind: 'project', joinsBefore: false, joinsAfter: true },
    { text: ' ' },
    { text: 'p1', kind: 'priority', joinsBefore: true },
  ]);
  // A pill that wraps is drawn as one piece per line.
  assert.deepEqual(runs(text, 3, 9, all).map((run) => run.text), ['7시']);
  assert.deepEqual(runs(text, 16, text.length, all), []);
});

test('reported lines map to offsets, with or without their trailing spaces', () => {
  const text = '매주 월수금 저녁 7시 운동하고 나서 장보기';
  const kept = [{ text: '매주 월수금 저녁 7시 ', x: 0, y: 0 }, { text: '운동하고 나서 장보기', x: 0, y: 28 }];
  const trimmed = [{ text: '매주 월수금 저녁 7시', x: 0, y: 0 }, { text: '운동하고 나서 장보기', x: 0, y: 28 }];
  const expected = [{ start: 0, top: 0, left: 0 }, { start: 13, top: 28, left: 0 }];
  assert.deepEqual(lineStarts(text, kept), expected);
  assert.deepEqual(lineStarts(text, trimmed), expected);
  assert.deepEqual(lineStarts('', []), [{ start: 0, top: 0, left: 0 }]);
  // A layout of older or different text is ignored rather than drawn in the wrong place.
  assert.equal(lineStarts(text + ' 그리고', kept), null);
  assert.equal(lineStarts('전혀 다른 글', kept), null);
});
