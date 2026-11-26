import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assignRowTracks,
  BASE_HOUR_HEIGHT,
  computeHourOffsets,
  hourRowHeight,
  sliceIntervalByHour,
  snapMinutesFromDrag,
} from './timelineLayout.ts';

test('12:10 to 12:40 occupies strictly 10..40 minutes of hour 12 (16.67% left, 50% width)', () => {
  const slices = sliceIntervalByHour(12 * 60 + 10, 30);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].hour, 12);
  assert.equal(slices[0].startInHour, 10);
  assert.equal(slices[0].endInHour, 40);
  assert.ok(Math.abs(slices[0].leftPct - (10 / 60) * 100) < 0.001);
  assert.ok(Math.abs(slices[0].widthPct - 50) < 0.001);
  assert.equal(slices[0].isFirst, true);
  assert.equal(slices[0].isLast, true);
});

test('9:30 for 15 minutes occupies strictly 30..45 minutes (50% left, 25% width)', () => {
  const slices = sliceIntervalByHour(9 * 60 + 30, 15);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].hour, 9);
  assert.equal(slices[0].leftPct, 50);
  assert.equal(slices[0].widthPct, 25);
});

test('12:40 for 40 minutes splits across hour 12 (40..60) and hour 13 (0..20)', () => {
  const slices = sliceIntervalByHour(12 * 60 + 40, 40);
  assert.equal(slices.length, 2);
  assert.equal(slices[0].hour, 12);
  assert.equal(slices[0].startInHour, 40);
  assert.equal(slices[0].endInHour, 60);
  assert.equal(slices[0].isFirst, true);
  assert.equal(slices[0].isLast, false);
  assert.equal(slices[1].hour, 13);
  assert.equal(slices[1].startInHour, 0);
  assert.equal(slices[1].endInHour, 20);
  assert.equal(slices[1].isFirst, false);
  assert.equal(slices[1].isLast, true);
});

test('14:00 for 60 minutes fills 0..100% of hour 14 only', () => {
  const slices = sliceIntervalByHour(14 * 60, 60);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].hour, 14);
  assert.equal(slices[0].leftPct, 0);
  assert.equal(slices[0].widthPct, 100);
});

test('clamps intervals past midnight at 24:00', () => {
  const slices = sliceIntervalByHour(23 * 60 + 45, 60);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].hour, 23);
  assert.equal(slices[0].startInHour, 45);
  assert.equal(slices[0].endInHour, 60);
});

test('assignRowTracks stacks overlapping bars vertically and reuses tracks for sequential bars', () => {
  const tracked = assignRowTracks([
    { id: 'a', startInHour: 10, endInHour: 40 },
    { id: 'b', startInHour: 20, endInHour: 50 },
    { id: 'c', startInHour: 40, endInHour: 55 },
  ]);
  const byId = new Map(tracked.map((t) => [t.item.id, t]));
  assert.equal(byId.get('a')?.track, 0);
  assert.equal(byId.get('b')?.track, 1);
  assert.equal(byId.get('c')?.track, 0);
  assert.equal(byId.get('a')?.trackCount, 2);
});

test('computeHourOffsets accumulates variable row heights', () => {
  const heights = new Map<number, number>([
    [12, hourRowHeight(2, false)],
    [13, hourRowHeight(1, true)],
  ]);
  const { offsets, totalHeight } = computeHourOffsets([11, 12, 13], heights);
  assert.equal(offsets.get(11), 0);
  assert.equal(offsets.get(12), BASE_HOUR_HEIGHT);
  assert.equal(offsets.get(13), BASE_HOUR_HEIGHT + hourRowHeight(2, false));
  assert.equal(totalHeight, BASE_HOUR_HEIGHT + hourRowHeight(2, false) + hourRowHeight(1, true));
});

test('snapMinutesFromDrag maps horizontal delta to minutes and vertical delta to hours', () => {
  // Start at 12:10, drag right by half a 300px lane (+30m) and down by 1 row (+60m) -> 13:40
  assert.equal(snapMinutesFromDrag(12 * 60 + 10, 150, 56, 300, 56, 10, 0), 13 * 60 + 40);
  // Clamps to minMinutes
  assert.equal(snapMinutesFromDrag(6 * 60 + 10, -200, -100, 300, 56, 10, 6 * 60), 6 * 60);
});
