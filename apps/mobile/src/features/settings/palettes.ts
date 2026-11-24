/**
 * Accent palettes the person can choose in 외관. Only the accent family changes; every neutral and the danger
 * red stay the same in every palette (src/theme/tokens.ts). Kept free of React Native so it can be tested.
 *
 * - `accent` fills the one primary button, the FAB, checked boxes and progress data (habit cells and rings).
 *   Text on it is `onAccent` (src/theme/tokens.ts) at 4.5:1 or more in both modes.
 * - `accentText` is the accent as text and icons on the page: links, the selected tab, a selected chip's label.
 *   In light mode it is the accent itself; in dark mode it is a separate, lighter tone, because the fill has to stay
 *   deep enough for light text on it.
 * - `accentSoft` is the background of a selected chip or row, and nothing else.
 *
 * Dark fills keep the light hue with about 83% of its OKLCH chroma: saturated colours look brighter than they
 * measure on a dark background (Helmholtz–Kohlrausch), so the same chroma would glare.
 */

export type AccentId = 'blue' | 'teal' | 'purple' | 'slate';

export interface AccentColors {
  accent: string;
  accentText: string;
  accentSoft: string;
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
    id: 'blue', label: '파랑',
    light: { accent: '#2B66E0', accentText: '#2B66E0', accentSoft: '#F0F4FD' },
    dark: { accent: '#3B6CD0', accentText: '#82ADFE', accentSoft: '#1D293F' },
  },
  {
    id: 'teal', label: '청록',
    light: { accent: '#027C85', accentText: '#027C85', accentSoft: '#EDF6F6' },
    dark: { accent: '#2D7A82', accentText: '#71BCC4', accentSoft: '#182D2F' },
  },
  {
    id: 'purple', label: '보라',
    light: { accent: '#7B55E1', accentText: '#7B55E1', accentSoft: '#F6F3FD' },
    dark: { accent: '#785CCE', accentText: '#AF9DFE', accentSoft: '#29253D' },
  },
  {
    id: 'slate', label: '슬레이트',
    light: { accent: '#5F718A', accentText: '#5F718A', accentSoft: '#F4F5F7' },
    dark: { accent: '#627186', accentText: '#9FAFC6', accentSoft: '#252930' },
  },
];

/**
 * Accents earlier versions offered. Orange and pink sit next to the overdue red, and green next to red is the most
 * common colour-vision confusion, so they were dropped; a stored choice of one of them reads back as blue.
 */
export const RETIRED_ACCENTS: readonly string[] = ['green', 'orange', 'pink'];

const byId = new Map(ACCENTS.map((palette) => [palette.id, palette]));

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === 'string' && byId.has(value as AccentId);
}

export function accentPalette(id: AccentId): AccentPalette {
  return byId.get(id) ?? byId.get(DEFAULT_ACCENT)!;
}

/** Reads a stored accent, falling back to the default for anything unknown or retired. */
export function parseAccent(stored: string | null | undefined): AccentId {
  return isAccentId(stored) ? stored : DEFAULT_ACCENT;
}
