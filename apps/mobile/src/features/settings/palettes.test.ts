import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contrastRatio, relativeLuminance } from './contrast.ts';
import { ACCENTS, DEFAULT_ACCENT, LEGACY_PALETTES, accentPalette, isAccentId, parseAccent } from './palettes.ts';

// Surfaces from src/theme/index.tsx; the accent palettes are drawn on these.
const LIGHT_SURFACE = '#FFFFFF';
const DARK_BACKGROUND = '#15171A';
const DARK_SURFACE = '#1D2024';
const WHITE = '#FFFFFF';

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

test('the seven accents are offered, blue first and by default', () => {
  assert.deepEqual(ACCENTS.map((palette) => palette.label), ['파랑', '청록', '초록', '주황', '분홍', '보라', '슬레이트']);
  assert.equal(ACCENTS[0].id, DEFAULT_ACCENT);
  assert.equal(new Set(ACCENTS.map((palette) => palette.id)).size, ACCENTS.length);
});

test('the default blue is exactly the colours the app shipped with', () => {
  assert.deepEqual(accentPalette('blue'), {
    id: 'blue', label: '파랑',
    light: { accent: '#3574F0', accentSoft: '#E8F0FE', info: '#3574F0', infoSoft: '#E8F0FE', schedule: '#3574F0' },
    dark: { accent: '#5B8FF7', accentSoft: '#1C2A47', info: '#5B8FF7', infoSoft: '#1C2A47', schedule: '#4A82F5' },
  });
  assert.deepEqual([...LEGACY_PALETTES], ['blue']);
});

for (const palette of ACCENTS) {
  if (LEGACY_PALETTES.has(palette.id)) continue;
  test(`${palette.label}: white text on the accent reaches 4.5:1 in light and dark`, () => {
    assert.ok(contrastRatio(WHITE, palette.light.accent) >= 4.5, `light ${palette.light.accent}`);
    assert.ok(contrastRatio(WHITE, palette.dark.accent) >= 4.5, `dark ${palette.dark.accent}`);
  });

  test(`${palette.label}: accent-coloured text and icons stay legible`, () => {
    // Light: the accent is also link/label text on white.
    assert.ok(contrastRatio(palette.light.accent, LIGHT_SURFACE) >= 4.5);
    assert.ok(contrastRatio(palette.light.info, LIGHT_SURFACE) >= 4.5);
    assert.ok(contrastRatio(palette.light.schedule, LIGHT_SURFACE) >= 4.5);
    assert.ok(contrastRatio(palette.light.accent, palette.light.accentSoft) >= 3);
    // Dark: info and schedule are text on dark surfaces; the accent is at least a visible UI colour there.
    assert.ok(contrastRatio(palette.dark.info, DARK_SURFACE) >= 4.5);
    assert.ok(contrastRatio(palette.dark.schedule, DARK_SURFACE) >= 4.5);
    assert.ok(contrastRatio(palette.dark.info, palette.dark.infoSoft) >= 4.5);
    assert.ok(contrastRatio(palette.dark.accent, DARK_SURFACE) >= 3);
    assert.ok(contrastRatio(palette.dark.accent, DARK_BACKGROUND) >= 3);
    assert.ok(contrastRatio(palette.dark.accent, palette.dark.accentSoft) >= 3);
  });
}

test('stored accents are validated on read', () => {
  assert.equal(parseAccent('purple'), 'purple');
  assert.equal(parseAccent('magenta'), DEFAULT_ACCENT);
  assert.equal(parseAccent(null), DEFAULT_ACCENT);
  assert.equal(parseAccent(undefined), DEFAULT_ACCENT);
  assert.equal(isAccentId('teal'), true);
  assert.equal(isAccentId('toString'), false);
});
