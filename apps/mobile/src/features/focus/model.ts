import { Temporal } from '@js-temporal/polyfill';

export type FocusMode = 'pomodoro' | 'timer' | 'stopwatch';

/** Backend `focus_sessions.planned_seconds` accepts 60..28800 (1..480 minutes). */
export const FOCUS_LIMITS = {
  focus: { min: 1, max: 480 },
  shortBreak: { min: 1, max: 60 },
  longBreak: { min: 1, max: 90 },
  rounds: { min: 2, max: 8 },
} as const;

/** Maximum session length sent to the backend for open-ended stopwatch sessions (8 hours). */
export const STOPWATCH_MAX_SECONDS = 28_800;

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
  const mode: FocusMode = input.mode === 'timer' || input.mode === 'stopwatch' ? input.mode : 'pomodoro';
  return {
    mode,
    focusMinutes: clampInt(input.focusMinutes ?? defaultFocusPrefs.focusMinutes, FOCUS_LIMITS.focus.min, FOCUS_LIMITS.focus.max, defaultFocusPrefs.focusMinutes),
    shortBreakMinutes: clampInt(input.shortBreakMinutes ?? defaultFocusPrefs.shortBreakMinutes, FOCUS_LIMITS.shortBreak.min, FOCUS_LIMITS.shortBreak.max, defaultFocusPrefs.shortBreakMinutes),
    longBreakMinutes: clampInt(input.longBreakMinutes ?? defaultFocusPrefs.longBreakMinutes, FOCUS_LIMITS.longBreak.min, FOCUS_LIMITS.longBreak.max, defaultFocusPrefs.longBreakMinutes),
    roundsBeforeLongBreak: clampInt(input.roundsBeforeLongBreak ?? defaultFocusPrefs.roundsBeforeLongBreak, FOCUS_LIMITS.rounds.min, FOCUS_LIMITS.rounds.max, defaultFocusPrefs.roundsBeforeLongBreak),
    timerMinutes: clampInt(input.timerMinutes ?? defaultFocusPrefs.timerMinutes, FOCUS_LIMITS.focus.min, FOCUS_LIMITS.focus.max, defaultFocusPrefs.timerMinutes),
  };
}

/** Returns the earned break after completing a round, or `null` in single-timer or stopwatch mode. */
export function nextBreak(prefs: FocusPrefs, completedTodayBefore: number): { minutes: number; seconds: number; long: boolean } | null {
  if (prefs.mode !== 'pomodoro') return null;
  const long = (completedTodayBefore + 1) % prefs.roundsBeforeLongBreak === 0;
  const minutes = long ? prefs.longBreakMinutes : prefs.shortBreakMinutes;
  return { minutes, seconds: minutes * 60, long };
}

export interface FocusDayBar {
  date: string;
  weekday: string;
  minutes: number;
  count: number;
  isToday: boolean;
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

/** Aggregates completed focus sessions across the last 7 local calendar days for the Focus analytics chart. */
export function weeklyFocusStats(
  sessions: { status: string; started_at: string; ended_at: string | null }[],
  todayDate: Temporal.PlainDate,
  timeZone: string,
): { days: FocusDayBar[]; totalSeconds: number; totalCount: number; maxMinutes: number } {
  const buckets = new Map<string, { seconds: number; count: number }>();
  const dates = Array.from({ length: 7 }, (_, index) => todayDate.subtract({ days: 6 - index }));
  for (const d of dates) buckets.set(d.toString(), { seconds: 0, count: 0 });

  let totalSeconds = 0;
  let totalCount = 0;
  for (const session of sessions) {
    if (session.status !== 'completed' || !session.ended_at) continue;
    const dayKey = Temporal.Instant.from(session.started_at).toZonedDateTimeISO(timeZone).toPlainDate().toString();
    const bucket = buckets.get(dayKey);
    if (!bucket) continue;
    const secs = Math.max(0, (Date.parse(session.ended_at) - Date.parse(session.started_at)) / 1000);
    bucket.seconds += secs;
    bucket.count += 1;
    totalSeconds += secs;
    totalCount += 1;
  }

  const days: FocusDayBar[] = dates.map((d) => {
    const entry = buckets.get(d.toString())!;
    return {
      date: d.toString(),
      weekday: WEEKDAYS[d.dayOfWeek - 1],
      minutes: Math.round(entry.seconds / 60),
      count: entry.count,
      isToday: d.equals(todayDate),
    };
  });
  const maxMinutes = Math.max(1, ...days.map((d) => d.minutes));
  return { days, totalSeconds, totalCount, maxMinutes };
}
