import { useMemo } from 'react';

import { getPersonalPrefs } from '@/features/settings/prefsStore';
import { deviceTimeZone, logicalToday } from '@/lib/dates';
import { createLocalStore } from '@/lib/localStore';

interface TodayFoldState {
  date: string;
  keys: string[];
}

// Which list groups on the Today tab are folded, scoped to the logical date so sections unfold each morning.
const KEY = 'dayframe-today-folded';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMPTY_STATE: TodayFoldState = { date: '', keys: [] };
const EMPTY_SET: ReadonlySet<string> = new Set();

function parseTodayFold(raw: string): TodayFoldState {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_STATE;
  const source = parsed as Record<string, unknown>;
  const date = typeof source.date === 'string' && DATE_PATTERN.test(source.date) ? source.date : '';
  if (!date || !Array.isArray(source.keys)) return EMPTY_STATE;
  const keys = [...new Set(source.keys.filter((item): item is string => typeof item === 'string' && item.length > 0))];
  return { date, keys };
}

function defaultTodayIso(): string {
  return logicalToday(deviceTimeZone(), getPersonalPrefs().dayStartHour).toString();
}

const store = createLocalStore<TodayFoldState>({
  key: KEY,
  initial: EMPTY_STATE,
  parse: parseTodayFold,
  accountScoped: true,
});

export function toggleTodayGroupFold(key: string, todayIso?: string): void {
  const activeDate = todayIso ?? defaultTodayIso();
  store.set((prev) => {
    const keys = prev.date === activeDate ? prev.keys : [];
    const nextKeys = keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key];
    return { date: activeDate, keys: nextKeys };
  });
}

export function useTodayFoldedGroups(todayIso?: string): ReadonlySet<string> {
  const state = store.useValue();
  const activeDate = todayIso ?? defaultTodayIso();
  return useMemo(
    () => (state.date === activeDate && state.keys.length > 0 ? new Set(state.keys) : EMPTY_SET),
    [state, activeDate],
  );
}
