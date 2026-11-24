// Sample themes for checking the artwork outside the app (scripts/art/render.mjs and the tests): the app's own
// tokens (src/theme/tokens.ts) for every selectable accent. Not used at runtime.
import { colorsFor } from '../../theme/tokens.ts';
import { ACCENTS, type AccentId } from '../../features/settings/palettes.ts';

import type { ArtColors } from './scene.ts';

export interface SampleTheme extends ArtColors { text: string; textMuted: string }

/** [light accent, dark accent] per selectable accent. */
export const SAMPLE_ACCENTS: Record<string, [string, string]> = Object.fromEntries(
  ACCENTS.map((palette) => [palette.id, [palette.light.accent, palette.dark.accent]]),
);

export function sampleTheme(accentName: string, dark: boolean): SampleTheme {
  const id = (accentName in SAMPLE_ACCENTS ? accentName : 'blue') as AccentId;
  return colorsFor(dark, id);
}
