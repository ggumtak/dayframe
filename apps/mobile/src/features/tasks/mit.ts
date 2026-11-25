/**
 * Daily Top 3 MITs ("오늘의 핵심", max 3 task IDs) and "오늘 저녁 (This Evening)" task IDs,
 * scoped to a single logical calendar date (`YYYY-MM-DD`).
 * Kept free of React Native and storage imports so it can be unit-tested directly with Node.
 */

export const MAX_MIT_COUNT = 3;

export interface DailyFocusState {
  date: string;
  mitIds: string[];
  eveningIds: string[];
}

export const EMPTY_DAILY_FOCUS: DailyFocusState = {
  date: '',
  mitIds: [],
  eveningIds: [],
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function uniqueIds(value: unknown, limit?: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}

/** Normalizes any untrusted stored value into a valid `DailyFocusState`. */
export function normalizeDailyFocus(value: unknown): DailyFocusState {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const date = typeof source.date === 'string' && DATE_PATTERN.test(source.date) ? source.date : '';
  if (!date) return EMPTY_DAILY_FOCUS;
  return {
    date,
    mitIds: uniqueIds(source.mitIds, MAX_MIT_COUNT),
    eveningIds: uniqueIds(source.eveningIds),
  };
}

/** Reads stored JSON; anything unreadable returns an empty state. */
export function parseDailyFocus(raw: string | null | undefined): DailyFocusState {
  if (!raw) return EMPTY_DAILY_FOCUS;
  try {
    return normalizeDailyFocus(JSON.parse(raw));
  } catch {
    return EMPTY_DAILY_FOCUS;
  }
}

/**
 * Projects `state` onto `date`: if the stored state is from a previous logical day,
 * automatically resets both lists fresh for `date`.
 */
export function forLogicalDate(state: DailyFocusState, date: string): DailyFocusState {
  if (state.date === date) return state;
  return { date, mitIds: [], eveningIds: [] };
}

/**
 * Toggles a task in today's Top 3 MITs.
 * Returns `{ state, full: true }` without adding if 3 MITs are already selected.
 */
export function toggleMit(
  state: DailyFocusState,
  date: string,
  taskId: string,
): { state: DailyFocusState; full?: boolean } {
  const current = forLogicalDate(state, date);
  if (current.mitIds.includes(taskId)) {
    return {
      state: {
        ...current,
        mitIds: current.mitIds.filter((id) => id !== taskId),
      },
    };
  }
  if (current.mitIds.length >= MAX_MIT_COUNT) {
    return { state: current, full: true };
  }
  return {
    state: {
      ...current,
      mitIds: [...current.mitIds, taskId],
    },
  };
}

/** Toggles a task in today's "오늘 저녁 (This Evening)" list. */
export function toggleEvening(
  state: DailyFocusState,
  date: string,
  taskId: string,
): DailyFocusState {
  const current = forLogicalDate(state, date);
  const exists = current.eveningIds.includes(taskId);
  return {
    ...current,
    eveningIds: exists
      ? current.eveningIds.filter((id) => id !== taskId)
      : [...current.eveningIds, taskId],
  };
}

/** Removes task IDs that are no longer valid (e.g. completed or deleted), and auto-resets stale dates. */
export function pruneMitState(
  state: DailyFocusState,
  date: string,
  validIds: ReadonlySet<string> | readonly string[],
): DailyFocusState {
  const current = forLogicalDate(state, date);
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  const mitIds = current.mitIds.filter((id) => valid.has(id));
  const eveningIds = current.eveningIds.filter((id) => valid.has(id));
  if (
    current === state
    && mitIds.length === current.mitIds.length
    && eveningIds.length === current.eveningIds.length
  ) {
    return state;
  }
  return { date, mitIds, eveningIds };
}
