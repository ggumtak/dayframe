/**
 * Accent palettes the person can choose in 외관. Only the interactive colour family changes; success,
 * warning and danger keep their meaning in every palette. Kept free of React Native so it can be tested.
 *
 * - `accent` fills buttons, the selected tab and checked boxes, with white text on it.
 * - `accentSoft` is the tinted background behind selected chips and icons.
 * - `info` / `infoSoft` colour P3 and the "not urgent" quadrant; `schedule` colours date chips as text.
 *
 * In dark mode `accent` stays deep enough for white text, while `info` and `schedule` (which appear as text
 * on dark surfaces) are lighter so they stay readable.
 */

export type AccentId = 'blue' | 'teal' | 'green' | 'orange' | 'pink' | 'purple' | 'slate';

export interface AccentColors {
  accent: string;
  accentSoft: string;
  info: string;
  infoSoft: string;
  schedule: string;
}

export interface AccentPalette {
  id: AccentId;
  label: string;
  light: AccentColors;
  dark: AccentColors;
}

export const DEFAULT_ACCENT: AccentId = 'blue';

/** Names for the light/dark/system choice, shared by 외관 and the 설정 row that summarises it. */
export const MODE_LABELS = { system: '시스템', light: '라이트', dark: '다크' } as const;

export const ACCENTS: readonly AccentPalette[] = [
  {
    // The original Dayframe blue, unchanged.
    id: 'blue', label: '파랑',
    light: { accent: '#3574F0', accentSoft: '#E8F0FE', info: '#3574F0', infoSoft: '#E8F0FE', schedule: '#3574F0' },
    dark: { accent: '#5B8FF7', accentSoft: '#1C2A47', info: '#5B8FF7', infoSoft: '#1C2A47', schedule: '#4A82F5' },
  },
  {
    id: 'teal', label: '청록',
    light: { accent: '#0B7F88', accentSoft: '#E6FBFC', info: '#0B7F88', infoSoft: '#E6FBFC', schedule: '#0B7F88' },
    dark: { accent: '#07828B', accentSoft: '#112B2C', info: '#0FB1BD', infoSoft: '#112B2C', schedule: '#0FB1BD' },
  },
  {
    id: 'green', label: '초록',
    light: { accent: '#1F834E', accentSoft: '#E8FAF0', info: '#1F834E', infoSoft: '#E8FAF0', schedule: '#1F834E' },
    dark: { accent: '#19864C', accentSoft: '#132A1E', info: '#27A662', infoSoft: '#132A1E', schedule: '#27A662' },
  },
  {
    id: 'orange', label: '주황',
    light: { accent: '#BD530C', accentSoft: '#FCEFE6', info: '#BD530C', infoSoft: '#FCEFE6', schedule: '#BD530C' },
    dark: { accent: '#C55206', accentSoft: '#2C1C11', info: '#EF690F', infoSoft: '#2C1C11', schedule: '#EF690F' },
  },
  {
    id: 'pink', label: '분홍',
    light: { accent: '#CF3379', accentSoft: '#FAE8F0', info: '#CF3379', infoSoft: '#FAE8F0', schedule: '#CF3379' },
    dark: { accent: '#D72F7B', accentSoft: '#2A131D', info: '#DD6C9F', infoSoft: '#2A131D', schedule: '#DD6C9F' },
  },
  {
    id: 'purple', label: '보라',
    light: { accent: '#7E58E4', accentSoft: '#ECE7FB', info: '#7E58E4', infoSoft: '#ECE7FB', schedule: '#7E58E4' },
    dark: { accent: '#815AEB', accentSoft: '#18112C', info: '#9C80EA', infoSoft: '#18112C', schedule: '#9C80EA' },
  },
  {
    id: 'slate', label: '슬레이트',
    light: { accent: '#62748D', accentSoft: '#EEF1F3', info: '#62748D', infoSoft: '#EEF1F3', schedule: '#62748D' },
    dark: { accent: '#5E779A', accentSoft: '#1B1E22', info: '#8393A9', infoSoft: '#1B1E22', schedule: '#8393A9' },
  },
];

/**
 * Palettes kept exactly as they shipped before accent themes existed, so the default look does not change.
 * The original blue gives white text 4.28:1 (light) and 3.13:1 (dark), under the 4.5:1 the new palettes meet.
 */
export const LEGACY_PALETTES: ReadonlySet<AccentId> = new Set<AccentId>(['blue']);

const byId = new Map(ACCENTS.map((palette) => [palette.id, palette]));

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === 'string' && byId.has(value as AccentId);
}

export function accentPalette(id: AccentId): AccentPalette {
  return byId.get(id) ?? byId.get(DEFAULT_ACCENT)!;
}

/** Reads a stored accent, falling back to the default for anything unknown. */
export function parseAccent(stored: string | null | undefined): AccentId {
  return isAccentId(stored) ? stored : DEFAULT_ACCENT;
}
