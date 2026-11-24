// Sample themes for checking the artwork outside the app (scripts/art/render.mjs and the tests).
// The base palettes copy the light/dark values in src/theme/index.tsx; the accents approximate the
// user-selectable accents (blue is the app's current one). Not used at runtime.
import { type ArtColors, mix } from './scene.ts';

export interface SampleTheme extends ArtColors { text: string; textMuted: string }

const LIGHT = {
  background: '#FFFFFF', surface: '#FFFFFF', surfaceMuted: '#F3F5F8', border: '#E6E9EE', text: '#1D2129',
  textMuted: '#667085', textFaint: '#A4ACB9', warning: '#E5870B', warningSoft: '#FDF0DC',
};
const DARK = {
  background: '#15171A', surface: '#1D2024', surfaceMuted: '#272B31', border: '#31353C', text: '#ECEEF1',
  textMuted: '#9BA3AF', textFaint: '#687080', warning: '#F0A03C', warningSoft: '#3A2A12',
};

/** [light accent, dark accent] per selectable accent. */
export const SAMPLE_ACCENTS: Record<string, [string, string]> = {
  blue: ['#3574F0', '#5B8FF7'],
  teal: ['#0F9A9A', '#2CC1BF'],
  green: ['#2E9E5B', '#4CC38A'],
  orange: ['#E0702A', '#F28C4B'],
  pink: ['#E0457B', '#F06D9B'],
  purple: ['#7C5CE0', '#9B82F5'],
  slate: ['#556274', '#8A97AA'],
};

export function sampleTheme(accentName: string, dark: boolean): SampleTheme {
  const [light, darkAccent] = SAMPLE_ACCENTS[accentName] ?? SAMPLE_ACCENTS.blue;
  const base = dark ? DARK : LIGHT;
  const accent = dark ? darkAccent : light;
  const accentSoft = accentName === 'blue' ? (dark ? '#1C2A47' : '#E8F0FE') : mix(base.background, accent, dark ? 0.22 : 0.11);
  return { ...base, accent, accentSoft, onAccent: '#FFFFFF' };
}
