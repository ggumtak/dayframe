/**
 * Which tabs sit in the bottom bar and in what order. 오늘 (`index`) is always first and always shown;
 * the other four can be reordered or hidden. Hidden tabs keep their screens and are opened from 설정.
 * Kept free of React Native so it can be tested.
 */

import type { IconName } from '@/components/ui';

export const FIXED_TAB = 'index';
export const MOVABLE_TABS = ['inbox', 'upcoming', 'habits', 'focus'] as const;

export type MovableTab = (typeof MOVABLE_TABS)[number];
export type TabName = typeof FIXED_TAB | MovableTab;

export interface TabBarConfig {
  /** Every movable tab exactly once, in bar order. */
  order: MovableTab[];
  /** The movable tabs left out of the bar, in no particular order. */
  hidden: MovableTab[];
}

export const TAB_LABELS: Record<TabName, string> = { index: '오늘', inbox: '목록', upcoming: '예정', habits: '습관', focus: '집중' };

export const TAB_ICONS: Record<TabName, IconName> = { index: 'sun', inbox: 'list', upcoming: 'calendar', habits: 'repeat', focus: 'clock' };

export const DEFAULT_TAB_BAR: TabBarConfig = { order: [...MOVABLE_TABS], hidden: [] };

export function isMovableTab(value: unknown): value is MovableTab {
  return typeof value === 'string' && (MOVABLE_TABS as readonly string[]).includes(value);
}

/** Known tab names from an untrusted list, each once, in the order given. */
function knownTabs(value: unknown): MovableTab[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<MovableTab>();
  for (const item of value) if (isMovableTab(item)) seen.add(item);
  return [...seen];
}

/**
 * Makes any stored or half-built value a complete config: unknown names and duplicates are dropped,
 * and tabs missing from the order (say, a tab added in a later version) are appended in default order.
 */
export function normalizeTabBar(value: unknown): TabBarConfig {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const order = knownTabs(source.order);
  for (const tab of MOVABLE_TABS) if (!order.includes(tab)) order.push(tab);
  const hiddenSet = new Set(knownTabs(source.hidden));
  return { order, hidden: order.filter((tab) => hiddenSet.has(tab)) };
}

/** Reads the stored JSON; anything unreadable gives the default bar. */
export function parseTabBar(raw: string | null | undefined): TabBarConfig {
  if (!raw) return DEFAULT_TAB_BAR;
  try {
    return normalizeTabBar(JSON.parse(raw));
  } catch {
    return DEFAULT_TAB_BAR;
  }
}

/** The tabs shown in the bar, left to right: 오늘 first, then the visible movable tabs. */
export function visibleTabs(config: TabBarConfig): TabName[] {
  return [FIXED_TAB, ...config.order.filter((tab) => !config.hidden.includes(tab))];
}

/** The hidden tabs in their configured order. */
export function hiddenTabs(config: TabBarConfig): MovableTab[] {
  return config.order.filter((tab) => config.hidden.includes(tab));
}

/** Moves a tab one place earlier (-1) or later (+1); a move past either end leaves the config as it is. */
export function moveTab(config: TabBarConfig, tab: MovableTab, delta: -1 | 1): TabBarConfig {
  const from = config.order.indexOf(tab);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= config.order.length) return config;
  const order = [...config.order];
  order.splice(from, 1);
  order.splice(to, 0, tab);
  return normalizeTabBar({ order, hidden: config.hidden });
}

export function setTabHidden(config: TabBarConfig, tab: MovableTab, hidden: boolean): TabBarConfig {
  if (config.hidden.includes(tab) === hidden) return config;
  return normalizeTabBar({ order: config.order, hidden: hidden ? [...config.hidden, tab] : config.hidden.filter((t) => t !== tab) });
}

export function isDefaultTabBar(config: TabBarConfig): boolean {
  return config.hidden.length === 0 && config.order.every((tab, index) => tab === MOVABLE_TABS[index]);
}
