import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toOklch } from '../../theme/color.ts';

import { contrastRatio, relativeLuminance } from './contrast.ts';
import { ACCENTS, DEFAULT_ACCENT, accentPalette, isAccentId, parseAccent, RETIRED_ACCENTS } from './palettes.ts';

test('contrast ratio matches the WCAG reference points', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#FFFFFF'), 1);
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  // A well-known pair: #767676 on white is the lightest grey that passes 4.5:1.
  assert.ok(contrastRatio('#767676', '#FFFFFF') >= 4.5);
  assert.ok(contrastRatio('#777777', '#FFFFFF') < 4.5);
  assert.equal(contrastRatio('#123456', '#ABCDEF'), contrastRatio('#ABCDEF', '#123456'));
  assert.throws(() => relativeLuminance('blue'));
});

test('four accents are offered, blue first and by default', () => {
  assert.deepEqual(ACCENTS.map((palette) => palette.label), ['파랑', '청록', '보라', '슬레이트']);
  assert.equal(ACCENTS[0].id, DEFAULT_ACCENT);
  assert.equal(new Set(ACCENTS.map((palette) => palette.id)).size, ACCENTS.length);
});

test('a stored 주황, 분홍 or 초록 reads back as 파랑', () => {
  for (const retired of RETIRED_ACCENTS) {
    assert.equal(isAccentId(retired), false);
    assert.equal(parseAccent(retired), 'blue');
  }
  assert.deepEqual([...RETIRED_ACCENTS].sort(), ['green', 'orange', 'pink']);
});

for (const palette of ACCENTS) {
  test(`${palette.label}: the dark accent keeps the hue with about 80–85% of the light chroma`, () => {
    const light = toOklch(palette.light.accent);
    const dark = toOklch(palette.dark.accent);
    const ratio = dark.c / light.c;
    assert.ok(ratio >= 0.78 && ratio <= 0.87, `chroma ratio ${ratio.toFixed(2)}`);
    assert.ok(Math.abs(dark.h - light.h) < 6, `hue ${light.h.toFixed(1)} → ${dark.h.toFixed(1)}`);
  });

  test(`${palette.label}: dark text accent is a separate, lighter tone than the dark fill`, () => {
    assert.notEqual(palette.dark.accentText, palette.dark.accent);
    assert.ok(toOklch(palette.dark.accentText).l > toOklch(palette.dark.accent).l + 0.12);
    assert.ok(toOklch(palette.dark.accentText).c <= toOklch(palette.light.accent).c * 0.87);
    // In light mode the accent is already dark enough to be text.
    assert.equal(palette.light.accentText, palette.light.accent);
  });
}

test('stored accents are validated on read', () => {
  assert.equal(parseAccent('purple'), 'purple');
  assert.equal(parseAccent('magenta'), DEFAULT_ACCENT);
  assert.equal(parseAccent(null), DEFAULT_ACCENT);
  assert.equal(parseAccent(undefined), DEFAULT_ACCENT);
  assert.equal(isAccentId('teal'), true);
  assert.equal(isAccentId('toString'), false);
  assert.equal(accentPalette('slate').label, '슬레이트');
});
