import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

const KEY = 'dayframe-haptics-enabled';
let enabled = true;
let loaded = false;
const listeners = new Set<() => void>();

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (raw === '0') {
        enabled = false;
        listeners.forEach((listener) => listener());
      }
    })
    .catch(() => {});
}

export function setHapticsEnabled(next: boolean): void {
  enabled = next;
  listeners.forEach((listener) => listener());
  AsyncStorage.setItem(KEY, next ? '1' : '0').catch(() => {});
}

export function useHapticsEnabled(): boolean {
  ensureLoaded();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    () => enabled,
    () => true,
  );
}

const safely = (run: () => Promise<void>) => {
  if (!enabled || Platform.OS === 'web') return;
  run().catch(() => {});
};

/** Small tactile cues; silently skipped when disabled or where the platform has none. */
export const haptic = {
  tap: () => safely(() => Haptics.selectionAsync()),
  light: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
