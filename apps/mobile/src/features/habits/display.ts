/**
 * How a habit is shown, worked out from what is stored. Pure and free of React Native so it can be tested.
 */
import { routineGroups, routineKey } from './routines.ts';

export interface HabitLook {
  emoji?: string;
  color?: string;
}

/** Gallery presets by normalised name, built once when the module loads (the first group wins on a clash). */
const presetsByKey: ReadonlyMap<string, HabitLook> = (() => {
  const index = new Map<string, HabitLook>();
  for (const group of routineGroups) {
    for (const item of group.items) {
      const key = routineKey(item.name);
      if (!index.has(key)) index.set(key, { emoji: item.emoji, color: item.color });
    }
  }
  return index;
})();

/** Answers per name, so a row that re-renders does not normalise the same name again. Bounded by the habit count. */
const lookCache = new Map<string, HabitLook | null>();

/** The gallery preset's emoji and colour for a habit name ("물 2리터 마시기" matches "물2리터마시기"), or null. */
export function presetLook(name: string): HabitLook | null {
  let look = lookCache.get(name);
  if (look === undefined) {
    look = presetsByKey.get(routineKey(name)) ?? null;
    lookCache.set(name, look);
  }
  return look;
}

const NO_LOOK: HabitLook = {};

/**
 * The emoji and colour to draw for a habit. What the person chose always wins; a habit with neither falls back
 * to the matching gallery preset, for display only (nothing is written back to storage).
 */
export function habitLook(name: string, stored?: HabitLook): HabitLook {
  if (stored?.emoji || stored?.color) return stored;
  return presetLook(name) ?? NO_LOOK;
}

/** "11월 1일 시작" in the given year, "2025년 11월 1일 시작" otherwise; the raw text when it is not a YYYY-MM-DD date. */
export function startDateLabel(isoDate: string, currentYear: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate + ' 시작';
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return (year === currentYear ? '' : year + '년 ') + month + '월 ' + day + '일 시작';
}
