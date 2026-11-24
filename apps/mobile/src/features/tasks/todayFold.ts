import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Which list groups on the Today tab are folded, kept across restarts under one key.
const KEY = 'dayframe-today-folded';
let folded: ReadonlySet<string> = new Set();
let loaded = false;
let touched = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (!raw || touched) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        folded = new Set(parsed.filter((item): item is string => typeof item === 'string'));
        notify();
      }
    })
    .catch(() => {});
}

export function toggleTodayGroupFold(key: string): void {
  touched = true;
  const next = new Set(folded);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  folded = next;
  notify();
  AsyncStorage.setItem(KEY, JSON.stringify([...next])).catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const snapshot = () => folded;

export function useTodayFoldedGroups(): ReadonlySet<string> {
  ensureLoaded();
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
