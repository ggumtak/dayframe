import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { defaultReminderSettings, type ReminderSettings } from './plan';

const KEY = 'dayframe-reminder-settings';
let current: ReminderSettings = defaultReminderSettings;
let loaded: Promise<ReminderSettings> | undefined;
const listeners = new Set<() => void>();

/** The saved settings; background tasks call this because they start without the app's state. */
export function loadReminderSettings(): Promise<ReminderSettings> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((stored) => {
      current = { ...defaultReminderSettings, ...(stored ? JSON.parse(stored) as Partial<ReminderSettings> : {}) };
      listeners.forEach((listener) => listener());
      return current;
    })
    .catch(() => current);
  return loaded;
}

export function setReminderSettings(patch: Partial<ReminderSettings>): void {
  current = { ...current, ...patch };
  loaded = Promise.resolve(current);
  listeners.forEach((listener) => listener());
  AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {});
}

export function useReminderSettings(): ReminderSettings {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    void loadReminderSettings();
    return () => { listeners.delete(listener); };
  }, () => current, () => current);
}
