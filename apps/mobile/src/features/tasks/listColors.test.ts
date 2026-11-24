import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contrastRatio, toOklch } from '../../theme/color.ts';
import { BASES } from '../../theme/tokens.ts';

import { LIST_COLORS, listColor, listColorEntry } from './listColors.ts';

test('the eight list colours are one tone-in-tone set: same lightness and chroma, different hue', () => {
  for (const mode of ['light', 'dark'] as const) {
    const tones = LIST_COLORS.filter((color) => color.id !== 'slate').map((color) => toOklch(color[mode]));
    const ls = tones.map((tone) => tone.l);
    const cs = tones.map((tone) => tone.c);
    assert.ok(Math.max(...ls) - Math.min(...ls) < 0.02, `${mode} lightness spread ${ls.map((l) => l.toFixed(3)).join(' ')}`);
    assert.ok(Math.max(...cs) - Math.min(...cs) < 0.012, `${mode} chroma spread ${cs.map((c) => c.toFixed(3)).join(' ')}`);
    // Muted: far below the saturated hues they replace.
    assert.ok(Math.max(...cs) < 0.09);
    // Slate keeps the lightness with less chroma.
    const slate = toOklch(LIST_COLORS.find((color) => color.id === 'slate')![mode]);
    assert.ok(Math.abs(slate.l - ls[0]) < 0.02 && slate.c < 0.04);
  }
});

test('the old red list colour is now a brown, so red keeps one meaning', () => {
  const red = listColorEntry('#DC4C3E')!;
  assert.equal(red.id, 'brown');
  assert.equal(red.label, '갈색');
  const hue = toOklch(red.light).h;
  assert.ok(hue > 30 && hue < 60, `hue ${hue.toFixed(0)}`);
  assert.ok(toOklch(red.light).c < 0.09);
});

test('every list mark reaches 3:1 against the page in both modes', () => {
  for (const color of LIST_COLORS) {
    for (const page of [BASES.light.background, BASES.light.surfaceMuted]) assert.ok(contrastRatio(color.light, page) >= 3, `${color.id} light`);
    for (const page of [BASES.dark.background, BASES.dark.surface, BASES.dark.surfaceMuted]) {
      assert.ok(contrastRatio(color.dark, page) >= 3, `${color.id} dark`);
    }
  }
});

test('stored colours map to the set: earlier hexes, ids, any other hex to the nearest, nothing to none', () => {
  assert.equal(listColorEntry('#3574F0')?.id, 'blue');
  assert.equal(listColorEntry('#3574f0')?.id, 'blue');
  assert.equal(listColorEntry('teal')?.id, 'teal');
  assert.equal(listColorEntry('#FF0000')?.id, 'brown');
  assert.equal(listColorEntry('#00AA00')?.id, 'green');
  assert.equal(listColorEntry(undefined), null);
  assert.equal(listColorEntry('not a colour'), null);
  assert.equal(listColor('#1F9D63', false), '#53815D');
  assert.equal(listColor('#1F9D63', true), '#8FB796');
  assert.equal(listColor(null, true), undefined);
});
