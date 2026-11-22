export type FocusMode = 'pomodoro' | 'timer';

/** Backend `focus_sessions.planned_seconds` accepts 60..28800 (1..480 minutes). */
export const FOCUS_LIMITS = {
  focus: { min: 1, max: 480 },
  shortBreak: { min: 1, max: 60 },
  longBreak: { min: 1, max: 90 },
  rounds: { min: 2, max: 8 },
} as const;

export interface FocusPrefs {
  mode: FocusMode;
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  roundsBeforeLongBreak: number;
  timerMinutes: number;
}

export const defaultFocusPrefs: FocusPrefs = {
  mode: 'pomodoro',
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
  timerMinutes: 25,
};

export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function normalizeFocusPrefs(raw: Partial<FocusPrefs> | null | undefined): FocusPrefs {
  const input = raw ?? {};
  return {
    mode: input.mode === 'timer' ? 'timer' : 'pomodoro',
    focusMinutes: clampInt(input.focusMinutes ?? defaultFocusPrefs.focusMinutes, FOCUS_LIMITS.focus.min, FOCUS_LIMITS.focus.max, defaultFocusPrefs.focusMinutes),
    shortBreakMinutes: clampInt(input.shortBreakMinutes ?? defaultFocusPrefs.shortBreakMinutes, FOCUS_LIMITS.shortBreak.min, FOCUS_LIMITS.shortBreak.max, defaultFocusPrefs.shortBreakMinutes),
    longBreakMinutes: clampInt(input.longBreakMinutes ?? defaultFocusPrefs.longBreakMinutes, FOCUS_LIMITS.longBreak.min, FOCUS_LIMITS.longBreak.max, defaultFocusPrefs.longBreakMinutes),
    roundsBeforeLongBreak: clampInt(input.roundsBeforeLongBreak ?? defaultFocusPrefs.roundsBeforeLongBreak, FOCUS_LIMITS.rounds.min, FOCUS_LIMITS.rounds.max, defaultFocusPrefs.roundsBeforeLongBreak),
    timerMinutes: clampInt(input.timerMinutes ?? defaultFocusPrefs.timerMinutes, FOCUS_LIMITS.focus.min, FOCUS_LIMITS.focus.max, defaultFocusPrefs.timerMinutes),
  };
}

/** Returns the earned break after completing a round, or `null` in single-timer mode. */
export function nextBreak(prefs: FocusPrefs, completedTodayBefore: number): { minutes: number; seconds: number; long: boolean } | null {
  if (prefs.mode !== 'pomodoro') return null;
  const long = (completedTodayBefore + 1) % prefs.roundsBeforeLongBreak === 0;
  const minutes = long ? prefs.longBreakMinutes : prefs.shortBreakMinutes;
  return { minutes, seconds: minutes * 60, long };
}
