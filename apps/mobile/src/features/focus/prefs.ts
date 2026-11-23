import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { defaultFocusPrefs, type FocusPrefs, normalizeFocusPrefs } from './model';

export {
  clampInt, defaultFocusPrefs, FOCUS_LIMITS, type FocusDayBar, type FocusMode, type FocusPrefs, nextBreak, normalizeFocusPrefs,
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
