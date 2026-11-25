import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACCENTS } from '../features/settings/palettes.ts';

import { contrastRatio, mixHex, relativeLuminance, toOklch } from './color.ts';
import { BASES, colorsFor } from './tokens.ts';

const ratio = (a: string, b: string) => contrastRatio(a, b);

for (const palette of ACCENTS) {
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light';
    const c = colorsFor(dark, palette.id);
    const pages = [c.background, c.surface, c.surfaceElevated, c.surfaceMuted];

    test(`${palette.label} ${mode}: text on a filled accent reaches 4.5:1`, () => {
      assert.ok(ratio(c.onAccent, c.accent) >= 4.5, `${c.onAccent} on ${c.accent}: ${ratio(c.onAccent, c.accent).toFixed(2)}`);
    });

    test(`${palette.label} ${mode}: accent text and links reach 4.5:1 on every page tone and on accentSoft`, () => {
      for (const page of [...pages, c.accentSoft]) {
        assert.ok(ratio(c.accentText, page) >= 4.5, `${c.accentText} on ${page}: ${ratio(c.accentText, page).toFixed(2)}`);
      }
    });

    test(`${palette.label} ${mode}: accent graphics (rings, cells, checked boxes) reach 3:1 on the surface`, () => {
      assert.ok(ratio(c.accent, c.surface) >= 3, `${ratio(c.accent, c.surface).toFixed(2)}`);
      assert.ok(ratio(c.accent, c.surfaceElevated) >= 3, `${ratio(c.accent, c.surfaceElevated).toFixed(2)}`);
      assert.ok(ratio(c.accent, c.background) >= 3);
    });

    test(`${palette.label} ${mode}: the progress ramp keeps its order in greyscale`, () => {
      // none (surfaceMuted) → light → medium → full: each step differs in luminance, in the right direction.
      const steps = [c.surfaceMuted, ...c.accentRamp].map(relativeLuminance);
      const darker = !dark;
      for (let i = 1; i < steps.length; i++) {
        assert.ok(darker ? steps[i] < steps[i - 1] : steps[i] > steps[i - 1], `step ${i}: ${steps.map((s) => s.toFixed(3)).join(' ')}`);
      }
      assert.ok(ratio(c.accentRamp[1], c.accent) >= 1.4, 'partial and met are told apart');
      assert.equal(c.accentRamp[2], c.accent);
    });
  }
}

for (const dark of [false, true]) {
  const mode = dark ? 'dark' : 'light';
  const c = colorsFor(dark, 'blue');
  const pages = [c.background, c.surface, c.surfaceElevated, c.surfaceMuted];

  test(`${mode}: text levels — text and textMuted reach 4.5:1, textFaint and controls 3:1, on every page tone`, () => {
    for (const page of pages) {
      assert.ok(ratio(c.text, page) >= 11, `text on ${page}`);
      assert.ok(ratio(c.textMuted, page) >= 4.5, `textMuted on ${page}: ${ratio(c.textMuted, page).toFixed(2)}`);
      assert.ok(ratio(c.control, page) >= 3, `control on ${page}: ${ratio(c.control, page).toFixed(2)}`);
    }
    assert.ok(ratio(c.textFaint, c.background) >= 3.3 || ratio(c.textFaint, c.surface) >= 3.3);
    // Three distinct levels.
    assert.ok(ratio(c.text, c.background) > ratio(c.textMuted, c.background) + 5);
    assert.ok(ratio(c.textMuted, c.background) > ratio(c.textFaint, c.background) + 1.5);
  });

  test(`${mode}: overdue red reaches 4.5:1 on every page tone, and text on a red fill does too`, () => {
    for (const page of pages) assert.ok(ratio(c.danger, page) >= 4.5, `danger on ${page}: ${ratio(c.danger, page).toFixed(2)}`);
    assert.ok(ratio(c.onDanger, c.danger) >= 4.5);
  });
}

test('dark mode is tuned on its own: desaturated red, off-white text, no pure black or white text', () => {
  const light = colorsFor(false, 'blue');
  const dark = colorsFor(true, 'blue');
  assert.ok(toOklch(dark.danger).c < toOklch(light.danger).c * 0.85);
  for (const key of ['text', 'textMuted', 'textFaint', 'onAccent', 'surfaceElevated'] as const) {
    assert.notEqual(dark[key].toUpperCase(), '#FFFFFF');
    assert.notEqual(dark[key].toUpperCase(), '#000000');
  }
  assert.notEqual(dark.background.toUpperCase(), '#000000');
  assert.ok(relativeLuminance(dark.surfaceElevated) > relativeLuminance(dark.surface), 'surfaceElevated lifts above dark surface');
});

test('one neutral temperature: every grey is a faint cool tint of the same hue family', () => {
  for (const base of [BASES.light, BASES.dark]) {
    const greys = [base.surfaceMuted, base.border, base.control, base.text, base.textMuted, base.textFaint];
    if (base.background !== '#FFFFFF') greys.push(base.background, base.surface);
    if (base.surfaceElevated !== '#FFFFFF') greys.push(base.surfaceElevated);
    for (const grey of greys) {
      const { c, h } = toOklch(grey);
      assert.ok(c < 0.03, `${grey} chroma ${c.toFixed(3)}`);
      assert.ok(h > 240 && h < 275, `${grey} hue ${h.toFixed(0)} (cool blue-grey)`);
    }
  }
});

test('mixHex blends and is opaque', () => {
  assert.equal(mixHex('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(mixHex('#FFFFFF', '#2B66E0', 0), '#FFFFFF');
  assert.equal(mixHex('#FFFFFF', '#2B66E0', 1), '#2B66E0');
});

test('the same mode and accent give the same frozen colours object', () => {
  assert.equal(colorsFor(true, 'teal'), colorsFor(true, 'teal'));
  assert.ok(Object.isFrozen(colorsFor(false, 'blue')));
});
