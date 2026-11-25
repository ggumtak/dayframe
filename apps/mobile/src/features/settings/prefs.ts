/**
 * Personalization preferences for how Dayframe behaves and feels on this device.
 * Kept free of React Native and storage imports so it can be unit-tested directly with Node.
 */

export const DENSITIES = ['compact', 'default', 'comfortable'] as const;
export type Density = (typeof DENSITIES)[number];

export const SWIPE_ACTIONS = ['complete', 'tomorrow', 'schedule', 'focus', 'none'] as const;
export type SwipeAction = (typeof SWIPE_ACTIONS)[number];

export const SWIPE_RIGHT_SECONDARIES = ['delete', 'schedule', 'tomorrow', 'focus', 'none'] as const;
export type SwipeRightSecondary = (typeof SWIPE_RIGHT_SECONDARIES)[number];

export const STARTUP_TABS = ['index', 'inbox', 'upcoming', 'habits', 'focus', 'last'] as const;
export type StartupTab = (typeof STARTUP_TABS)[number];

export const TODAY_BADGE_MODES = ['all', 'overdue', 'off'] as const;
export type TodayBadgeMode = (typeof TODAY_BADGE_MODES)[number];

export const TODAY_HABITS_POSITIONS = ['top', 'bottom', 'hidden'] as const;
export type TodayHabitsPosition = (typeof TODAY_HABITS_POSITIONS)[number];

export const START_OF_WEEK_OPTIONS = ['monday', 'sunday'] as const;
export type StartOfWeek = (typeof START_OF_WEEK_OPTIONS)[number];

export const TIME_FORMATS = ['12h', '24h'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export const DAY_START_HOUR_MIN = 0;
export const DAY_START_HOUR_MAX = 5;
export const FOCUS_DAILY_GOAL_MIN = 0;
export const FOCUS_DAILY_GOAL_MAX = 600;
export const MAX_QUICK_ADD_PRESETS = 12;

export const DEFAULT_QUICK_ADD_PRESETS: readonly string[] = [
  '오늘',
  '내일',
  '저녁 7시',
  '30분간',
  '매일',
];

export interface PersonalPrefs {
  /** Hour (0..5) when a new logical day begins; e.g. 2 means 00:00–01:59 still counts as yesterday. */
  dayStartHour: number;
  startOfWeek: StartOfWeek;
  timeFormat: TimeFormat;
  density: Density;
  showNotePreview: boolean;
  /** Revealed when dragging right (left side of the row). Default `'complete'` matches existing swipe gesture. */
  swipeLeft: SwipeAction;
  /** Primary action revealed when dragging left (right side of the row). */
  swipeRightPrimary: SwipeAction;
  /** Secondary action revealed when dragging left (right side of the row). */
  swipeRightSecondary: SwipeRightSecondary;
  startupTab: StartupTab;
  todayBadgeMode: TodayBadgeMode;
  /** Placement of TodayHabits on the Today screen; default `'bottom'` preserves the baseline layout. */
  todayHabitsPosition: TodayHabitsPosition;
  showTodayFocusStrip: boolean;
  showAllDoneArt: boolean;
  quickAddDefaultProjectId: string | null;
  quickAddKeepOpen: boolean;
  quickAddPresets: string[];
  /** Daily focus target in minutes (0..600; 0 disables the daily goal). */
  focusDailyGoalMinutes: number;
  focusKeepAwake: boolean;
  singleKeyShortcuts: boolean;
}

export const DEFAULT_PERSONAL_PREFS: PersonalPrefs = {
  dayStartHour: 0,
  startOfWeek: 'monday',
  timeFormat: '12h',
  density: 'default',
  showNotePreview: true,
  swipeLeft: 'complete',
  swipeRightPrimary: 'schedule',
  swipeRightSecondary: 'delete',
  startupTab: 'index',
  todayBadgeMode: 'all',
  todayHabitsPosition: 'bottom',
  showTodayFocusStrip: true,
  showAllDoneArt: true,
  quickAddDefaultProjectId: null,
  quickAddKeepOpen: false,
  quickAddPresets: [...DEFAULT_QUICK_ADD_PRESETS],
  focusDailyGoalMinutes: 60,
  focusKeepAwake: true,
  singleKeyShortcuts: true,
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeProjectId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePresets(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_QUICK_ADD_PRESETS];
  if (value.length === 0) return [];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, 40);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
    if (cleaned.length >= MAX_QUICK_ADD_PRESETS) break;
  }
  return cleaned.length > 0 ? cleaned : [...DEFAULT_QUICK_ADD_PRESETS];
}

/** Validates and clamps any untrusted object into a complete `PersonalPrefs`. */
export function normalizePersonalPrefs(value: unknown): PersonalPrefs {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    dayStartHour: clampInt(source.dayStartHour, DAY_START_HOUR_MIN, DAY_START_HOUR_MAX, DEFAULT_PERSONAL_PREFS.dayStartHour),
    startOfWeek: oneOf(source.startOfWeek, START_OF_WEEK_OPTIONS, DEFAULT_PERSONAL_PREFS.startOfWeek),
    timeFormat: oneOf(source.timeFormat, TIME_FORMATS, DEFAULT_PERSONAL_PREFS.timeFormat),
    density: oneOf(source.density, DENSITIES, DEFAULT_PERSONAL_PREFS.density),
    showNotePreview: bool(source.showNotePreview, DEFAULT_PERSONAL_PREFS.showNotePreview),
    swipeLeft: oneOf(source.swipeLeft, SWIPE_ACTIONS, DEFAULT_PERSONAL_PREFS.swipeLeft),
    swipeRightPrimary: oneOf(source.swipeRightPrimary, SWIPE_ACTIONS, DEFAULT_PERSONAL_PREFS.swipeRightPrimary),
    swipeRightSecondary: oneOf(source.swipeRightSecondary, SWIPE_RIGHT_SECONDARIES, DEFAULT_PERSONAL_PREFS.swipeRightSecondary),
    startupTab: oneOf(source.startupTab, STARTUP_TABS, DEFAULT_PERSONAL_PREFS.startupTab),
    todayBadgeMode: oneOf(source.todayBadgeMode, TODAY_BADGE_MODES, DEFAULT_PERSONAL_PREFS.todayBadgeMode),
    todayHabitsPosition: oneOf(source.todayHabitsPosition, TODAY_HABITS_POSITIONS, DEFAULT_PERSONAL_PREFS.todayHabitsPosition),
    showTodayFocusStrip: bool(source.showTodayFocusStrip, DEFAULT_PERSONAL_PREFS.showTodayFocusStrip),
    showAllDoneArt: bool(source.showAllDoneArt, DEFAULT_PERSONAL_PREFS.showAllDoneArt),
    quickAddDefaultProjectId: normalizeProjectId(source.quickAddDefaultProjectId),
    quickAddKeepOpen: bool(source.quickAddKeepOpen, DEFAULT_PERSONAL_PREFS.quickAddKeepOpen),
    quickAddPresets: normalizePresets(source.quickAddPresets),
    focusDailyGoalMinutes: clampInt(
      source.focusDailyGoalMinutes,
      FOCUS_DAILY_GOAL_MIN,
      FOCUS_DAILY_GOAL_MAX,
      DEFAULT_PERSONAL_PREFS.focusDailyGoalMinutes,
    ),
    focusKeepAwake: bool(source.focusKeepAwake, DEFAULT_PERSONAL_PREFS.focusKeepAwake),
    singleKeyShortcuts: bool(source.singleKeyShortcuts, DEFAULT_PERSONAL_PREFS.singleKeyShortcuts),
  };
}

/** Reads stored JSON; anything missing or unreadable yields the default preferences. */
export function parsePersonalPrefs(raw: string | null | undefined): PersonalPrefs {
  if (!raw) return DEFAULT_PERSONAL_PREFS;
  try {
    return normalizePersonalPrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_PERSONAL_PREFS;
  }
}

/** Merges a partial update into existing preferences and clamps/validates every field. */
export function mergePersonalPrefs(current: PersonalPrefs, patch: Partial<PersonalPrefs>): PersonalPrefs {
  return normalizePersonalPrefs({ ...current, ...patch });
}
