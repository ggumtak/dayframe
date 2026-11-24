import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { DEFAULT_TAB_BAR, parseTabBar, type TabBarConfig } from './tabBar';

const KEY = 'dayframe-tab-bar-v1';
let config: TabBarConfig = DEFAULT_TAB_BAR;
let loaded = false;
let changedBeforeLoad = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (changedBeforeLoad || raw === null) return;
      const stored = parseTabBar(raw);
      if (JSON.stringify(stored) === JSON.stringify(config)) return;
      config = stored;
      notify();
    })
    .catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Saves a new bar; every subscriber (the tab bar, 설정, 탭 바) updates at once. */
export function setTabBarConfig(next: TabBarConfig): void {
  if (next === config) return;
  changedBeforeLoad = true;
  config = next;
  notify();
  AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
}

export function useTabBarConfig(): TabBarConfig {
  ensureLoaded();
  return useSyncExternalStore(subscribe, () => config, () => config);
}
