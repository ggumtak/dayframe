// The colour tokens: every colour the app draws comes from here (see DESIGN.md at the repository root).
// Free of React Native so node:test can check every pair for contrast.
//
// Budget: one accent (interactive, selected, progress data) and one red (overdue, destructive). Everything else is a
// neutral of one cool temperature (OKLCH hue ≈ 258°, chroma < 0.03), and hierarchy comes from text, textMuted and
// textFaint plus weight, not from hue. Dark mode has its own values, never lightened copies of the light ones.

import { type AccentColors, accentPalette, type AccentId } from '../features/settings/palettes.ts';

import { mixHex } from './color.ts';

const lightBase = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  /** Elevated sheets, toasts and floating chrome. */
  surfaceElevated: '#FFFFFF',
  /** Inputs, neutral chips and secondary buttons, pressed rows, empty progress cells. */
  surfaceMuted: '#F3F5F8',
  /** Hairlines and dividers (decorative, exempt from 3:1). */
  border: '#E6E9EE',
  /** Unchecked checkbox rings, switches off, input outlines: 3:1 on the page. */
  control: '#868E9C',
  /** Titles, task titles, priority marks. */
  text: '#1D2129',
  /** Meta: time, duration, repeat, subtitles, group headings; icons next to body text. */
  textMuted: '#5C6675',
  /** Counts, tags, placeholders, timestamps, completed items; icons next to meta text. */
  textFaint: '#858E9C',
  /** Text and icons on an `accent` fill. */
  onAccent: '#FFFFFF',
  /** Overdue dates and the overdue count, destructive labels. Small marks only, never a background. */
  danger: '#CC3A2E',
  /** Text and icons on a `danger` fill (the swipe-to-delete action, a confirm dialog's delete). */
  onDanger: '#FFFFFF',
  overlay: 'rgba(16, 20, 28, 0.42)',
  shadow: '#10141C',
};

export type BaseColors = typeof lightBase;

const darkBase: BaseColors = {
  background: '#15171A',
  surface: '#1D2024',
  surfaceElevated: '#23272D',
  surfaceMuted: '#272B31',
  border: '#31353C',
  control: '#7A8290',
  // Off-white, not #FFFFFF: pure white on near-black halates.
  text: '#E8EAED',
  textMuted: '#A0A7B2',
  textFaint: '#767E8B',
  onAccent: '#F5F7FA',
  danger: '#F08074',
  onDanger: '#15171A',
  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',
};

export interface Colors extends BaseColors, AccentColors {
  /**
   * One sequential ramp for progress data (habit cells, the year view): light, medium and full accent over the
   * surface. "Nothing" is `surfaceMuted`. Opaque, so cells keep their order in a greyscale screenshot.
   */
  accentRamp: readonly [string, string, string];
}

export function buildColors(isDark: boolean, accent: AccentColors): Colors {
  const base = isDark ? darkBase : lightBase;
  return {
    ...base,
    ...accent,
    accentRamp: [mixHex(base.surface, accent.accent, 0.22), mixHex(base.surface, accent.accent, 0.5), accent.accent],
  };
}

/** The colours for a mode and accent; the same frozen object for the same pair, so consumers can memo on it. */
const cache = new Map<string, Colors>();
export function colorsFor(isDark: boolean, accent: AccentId): Colors {
  const key = (isDark ? 'dark:' : 'light:') + accent;
  let colors = cache.get(key);
  if (!colors) {
    colors = Object.freeze(buildColors(isDark, accentPalette(accent)[isDark ? 'dark' : 'light']));
    cache.set(key, colors);
  }
  return colors;
}

export const BASES = { light: lightBase, dark: darkBase } as const;
