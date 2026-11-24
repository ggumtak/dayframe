import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BACKDROP_VARIANTS, BACKDROPS, backdropFor, backdropPaints } from './backdrop.ts';
import { ILLUSTRATIONS } from './illustrations.ts';
import { SAMPLE_ACCENTS, sampleTheme } from './samples.ts';
import { artPalette, contrast, mix, nodeCount, resolvePaint, svgNodes, toSvgString } from './scene.ts';

test('backdropFor maps every hour of the day to its sky', () => {
  const expected = [
    'night', 'night', 'night', 'night', 'night', 'morning', 'morning', 'morning', 'morning', 'morning', 'morning',
    'afternoon', 'afternoon', 'afternoon', 'afternoon', 'afternoon', 'afternoon', 'evening', 'evening', 'evening',
    'night', 'night', 'night', 'night',
  ];
  assert.deepEqual(Array.from({ length: 24 }, (_, h) => backdropFor(h)), expected);
});

test('backdropFor wraps and tolerates odd input', () => {
  assert.equal(backdropFor(24), 'night');
  assert.equal(backdropFor(-1), 'night');
  assert.equal(backdropFor(29), 'morning');
  assert.equal(backdropFor(13.75), 'afternoon');
  assert.equal(backdropFor(Number.NaN), 'afternoon');
});

test('header text stays clearly readable on every backdrop colour, every accent, both modes', () => {
  for (const accent of Object.keys(SAMPLE_ACCENTS)) {
    for (const dark of [false, true]) {
      const theme = sampleTheme(accent, dark);
      const p = artPalette(theme);
      for (const v of BACKDROP_VARIANTS) {
        for (const paint of backdropPaints(v)) {
          const ratio = contrast(theme.text, resolvePaint(p, paint));
          assert.ok(ratio >= 7, `${accent}/${dark ? 'dark' : 'light'}/${v}: ${JSON.stringify(paint)} gives ${ratio.toFixed(2)}:1`);
        }
      }
    }
  }
});

test('every piece stays within the node budget and resolves every colour', () => {
  const p = artPalette(sampleTheme('purple', true));
  for (const [name, art] of [...Object.entries(ILLUSTRATIONS), ...Object.entries(BACKDROPS)]) {
    assert.ok(nodeCount(art) <= 60, `${name} has ${nodeCount(art)} nodes`);
    for (const node of svgNodes(art, p)) {
      for (const key of ['fill', 'stroke'] as const) {
        const value = node.attrs[key];
        if (value !== undefined) assert.match(String(value), /^(#[0-9A-F]{6}|none|url\(#[\w-]+\))$/i, `${name} ${key}=${value}`);
      }
    }
  }
});

test('the preview SVG carries the same elements the app draws', () => {
  const p = artPalette(sampleTheme('blue', false));
  const svg = toSvgString(ILLUSTRATIONS.EmptyList, p);
  assert.equal((svg.match(/<(rect|circle|ellipse|path|line) /g) ?? []).length, ILLUSTRATIONS.EmptyList.shapes.length);
  assert.ok(svg.includes(`fill="${p.accent}"`));
  assert.ok(svg.includes('stroke-width="2.5"'));
});

test('mix blends hex colours and leaves unknown formats alone', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(mix('#fff', '#000', 0), '#FFFFFF');
  assert.equal(mix('rgba(0,0,0,0.4)', '#FFFFFF', 0.2), 'rgba(0,0,0,0.4)');
});
