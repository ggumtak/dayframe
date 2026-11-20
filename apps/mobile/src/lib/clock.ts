import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

const listeners = new Set<() => void>();
let minute = Math.floor(Date.now() / 60_000);
let timer: ReturnType<typeof setInterval> | null = null;
let appState: { remove: () => void } | null = null;

function check() {
  const next = Math.floor(Date.now() / 60_000);
  if (next === minute) return;
  minute = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(check, 15_000);
    // Timers do not run while the app is in the background, so catch up the moment it returns.
    appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      appState?.remove();
      timer = null;
      appState = null;
    }
  };
}

/**
 * A number that changes once a minute and when the app returns to the foreground. Screens that sort
 * by "today" or show relative dates depend on it, so an app left open overnight rolls over on its own.
 */
export function useMinute(): number {
  return useSyncExternalStore(subscribe, () => minute, () => minute);
}
