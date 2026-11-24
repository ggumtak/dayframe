/**
 * List colours: a small mark (the list's icon glyph) in the 목록 tab and in list pickers, never on Today, in task
 * rows or in text. Free of React Native so it can be tested.
 *
 * The eight colours are one tone-in-tone set (PCCS 톤인톤): the same OKLCH lightness and chroma, only the hue changes,
 * so no list shouts louder than another. 슬레이트 keeps the lightness with less chroma (it is a grey-blue by name).
 * The old 빨강 is now 갈색 (terracotta): red means overdue, and only that.
 *
 * What is stored is unchanged (the hex a list was given, kept on this device), so earlier choices keep working:
 * `listColor()` maps a stored value to this set for the current mode.
 */

export type ListColorId = 'blue' | 'green' | 'orange' | 'brown' | 'purple' | 'teal' | 'pink' | 'slate';

export interface ListColor {
  id: ListColorId;
  label: string;
  /** The value a list stores; the hex earlier versions saved for this slot, so stored lists map back. */
  stored: string;
  light: string;
  dark: string;
}

// OKLCH L 0.56 / C 0.075 (light) and L 0.74 / C 0.064 (dark); hue per colour.
export const LIST_COLORS: readonly ListColor[] = [
  { id: 'blue', label: '파랑', stored: '#3574F0', light: '#5976A0', dark: '#92ADD3' },
  { id: 'green', label: '초록', stored: '#1F9D63', light: '#53815D', dark: '#8FB796' },
  { id: 'orange', label: '황토', stored: '#E5870B', light: '#8C703F', dark: '#C0A77D' },
  { id: 'brown', label: '갈색', stored: '#DC4C3E', light: '#9B6553', dark: '#CF9E8D' },
  { id: 'purple', label: '보라', stored: '#7C5CFF', light: '#776C9C', dark: '#ADA3CF' },
  { id: 'teal', label: '청록', stored: '#0EA5A4', light: '#358282', dark: '#7AB8B7' },
  { id: 'pink', label: '분홍', stored: '#D9468F', light: '#96627B', dark: '#CB9BB0' },
  { id: 'slate', label: '슬레이트', stored: '#64748B', light: '#6B7583', dark: '#A2ACB8' },
];

const rgb = (hex: string): [number, number, number] | null => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [value >> 16, (value >> 8) & 0xff, value & 0xff];
};

const slots = LIST_COLORS.map((color) => ({ color, rgb: rgb(color.stored)! }));

/**
 * The palette entry for a stored list colour: an exact earlier hex, an id, or, for any other hex, the nearest of the
 * eight. Nothing stored (or something unreadable) gives null: the list's icon is then drawn neutral.
 */
export function listColorEntry(stored: string | null | undefined): ListColor | null {
  if (!stored) return null;
  const byId = LIST_COLORS.find((color) => color.id === stored);
  if (byId) return byId;
  const value = rgb(stored);
  if (!value) return null;
  let best = slots[0];
  let bestDistance = Infinity;
  for (const slot of slots) {
    const distance = slot.rgb.reduce((sum, channel, i) => sum + (channel - value[i]) ** 2, 0);
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best.color;
}

/** The colour to draw a list's icon in, for the current mode; undefined when the list has none. */
export function listColor(stored: string | null | undefined, isDark: boolean): string | undefined {
  const entry = listColorEntry(stored);
  return entry ? entry[isDark ? 'dark' : 'light'] : undefined;
}
