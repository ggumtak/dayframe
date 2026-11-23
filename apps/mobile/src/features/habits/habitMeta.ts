import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { IconName } from '@/components/ui';

export type HabitTimeOfDay = 'morning' | 'afternoon' | 'evening' | 'anytime';

export interface HabitMeta {
  timeOfDay: HabitTimeOfDay;
}

export const HABIT_TIME_GROUPS: { key: HabitTimeOfDay; label: string; icon: IconName }[] = [
  { key: 'morning', label: '아침', icon: 'sunrise' },
  { key: 'afternoon', label: '오후', icon: 'sun' },
  { key: 'evening', label: '저녁', icon: 'moon' },
  { key: 'anytime', label: '언제든', icon: 'clock' },
];

const KEY = 'dayframe-habit-meta-v1';
let cache: Record<string, HabitMeta> = {};
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, HabitMeta>;
      if (parsed && typeof parsed === 'object') {
        cache = { ...parsed, ...cache };
        notify();
      }
    })
    .catch(() => {});
}

function save() {
  AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
}

export function setHabitMeta(habitId: string, meta: HabitMeta): void {
  cache = { ...cache, [habitId]: meta };
  notify();
  save();
}

export function deleteHabitMeta(habitId: string): void {
  if (!(habitId in cache)) return;
  const next = { ...cache };
  delete next[habitId];
  cache = next;
  notify();
  save();
}

export function useHabitMetaMap(): Record<string, HabitMeta> {
  ensureLoaded();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    () => cache,
    () => cache,
  );
}
