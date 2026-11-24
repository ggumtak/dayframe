import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { defaultFocusPrefs, type FocusPrefs, normalizeFocusPrefs } from './model';

export {
  clampInt, defaultFocusPrefs, FOCUS_LIMITS, type FocusDayBar, focusDoneTitle, type FocusMode, type FocusPrefs, nextBreak, normalizeFocusPrefs,
  STOPWATCH_MAX_SECONDS, weeklyFocusStats,
} from './model';

const KEY = 'dayframe-focus-prefs';
let current: FocusPrefs = defaultFocusPrefs;
let loaded: Promise<FocusPrefs> | undefined;
const listeners = new Set<() => void>();

export function loadFocusPrefs(): Promise<FocusPrefs> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((stored) => {
      current = normalizeFocusPrefs(stored ? JSON.parse(stored) as Partial<FocusPrefs> : undefined);
      listeners.forEach((listener) => listener());
      return current;
    })
    .catch(() => current);
  return loaded;
}

export function setFocusPrefs(patch: Partial<FocusPrefs>): void {
  current = normalizeFocusPrefs({ ...current, ...patch });
  loaded = Promise.resolve(current);
  listeners.forEach((listener) => listener());
  AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {});
}

export function useFocusPrefs(): FocusPrefs {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    void loadFocusPrefs();
    return () => { listeners.delete(listener); };
  }, () => current, () => current);
}

/** Persisted pause & +5m extension state for the currently running focus session so restarts never lose it. */
export interface FocusSessionMod {
  id: string;
  pausedAt: number | null;
  pausedMs: number;
  extraSeconds: number;
}

export const EMPTY_SESSION_MOD: FocusSessionMod = { id: '', pausedAt: null, pausedMs: 0, extraSeconds: 0 };
const MOD_KEY = 'dayframe-focus-session-mod';
let currentMod: FocusSessionMod = EMPTY_SESSION_MOD;
let modLoaded = false;
const modListeners = new Set<() => void>();

function ensureModLoaded() {
  if (modLoaded) return;
  modLoaded = true;
  AsyncStorage.getItem(MOD_KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<FocusSessionMod>;
      if (typeof parsed.id === 'string') {
        currentMod = {
          id: parsed.id,
          pausedAt: typeof parsed.pausedAt === 'number' ? parsed.pausedAt : null,
          pausedMs: typeof parsed.pausedMs === 'number' ? parsed.pausedMs : 0,
          extraSeconds: typeof parsed.extraSeconds === 'number' ? parsed.extraSeconds : 0,
        };
        modListeners.forEach((listener) => listener());
      }
    })
    .catch(() => {});
}

export function setFocusSessionMod(next: FocusSessionMod): void {
  currentMod = next;
  modListeners.forEach((listener) => listener());
  if (!next.id) AsyncStorage.removeItem(MOD_KEY).catch(() => {});
  else AsyncStorage.setItem(MOD_KEY, JSON.stringify(next)).catch(() => {});
}

export function useFocusSessionMod(): FocusSessionMod {
  ensureModLoaded();
  return useSyncExternalStore(
    (listener) => {
      modListeners.add(listener);
      return () => { modListeners.delete(listener); };
    },
    () => currentMod,
    () => EMPTY_SESSION_MOD,
  );
}
