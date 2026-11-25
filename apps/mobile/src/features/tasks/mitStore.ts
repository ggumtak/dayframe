import { useCallback, useMemo } from 'react';

import { createLocalStore } from '@/lib/localStore';

import {
  type DailyFocusState,
  EMPTY_DAILY_FOCUS,
  forLogicalDate,
  parseDailyFocus,
  pruneMitState,
  toggleEvening as toggleEveningState,
  toggleMit as toggleMitState,
} from './mit';

const KEY = 'dayframe-daily-focus-v1';

const store = createLocalStore<DailyFocusState>({
  key: KEY,
  initial: EMPTY_DAILY_FOCUS,
  parse: parseDailyFocus,
  accountScoped: true,
});

export function getDailyFocus(logicalDate: string): DailyFocusState {
  return forLogicalDate(store.get(), logicalDate);
}

export function toggleMitTask(logicalDate: string, taskId: string): { full?: boolean } {
  let result: { state: DailyFocusState; full?: boolean } = { state: store.get() };
  store.set((prev) => {
    result = toggleMitState(prev, logicalDate, taskId);
    return result.state;
  });
  return result.full ? { full: true } : {};
}

export function toggleEveningTask(logicalDate: string, taskId: string): void {
  store.set((prev) => toggleEveningState(prev, logicalDate, taskId));
}

export function pruneDailyFocus(logicalDate: string, validIds: ReadonlySet<string> | readonly string[]): void {
  store.set((prev) => pruneMitState(prev, logicalDate, validIds));
}

export function resetDailyFocus(): Promise<void> {
  return store.reset();
}

export interface DailyFocusHandle {
  mitIds: readonly string[];
  eveningIds: readonly string[];
  isMit: (taskId: string) => boolean;
  isEvening: (taskId: string) => boolean;
  toggleMit: (taskId: string) => { full?: boolean };
  toggleEvening: (taskId: string) => void;
}

export function useDailyFocus(logicalDate: string): DailyFocusHandle {
  const raw = store.useValue();
  const active = useMemo(() => forLogicalDate(raw, logicalDate), [raw, logicalDate]);
  const mitSet = useMemo(() => new Set(active.mitIds), [active.mitIds]);
  const eveningSet = useMemo(() => new Set(active.eveningIds), [active.eveningIds]);

  const isMit = useCallback((taskId: string) => mitSet.has(taskId), [mitSet]);
  const isEvening = useCallback((taskId: string) => eveningSet.has(taskId), [eveningSet]);
  const toggleMit = useCallback((taskId: string) => toggleMitTask(logicalDate, taskId), [logicalDate]);
  const toggleEvening = useCallback((taskId: string) => toggleEveningTask(logicalDate, taskId), [logicalDate]);

  return useMemo(
    () => ({
      mitIds: active.mitIds,
      eveningIds: active.eveningIds,
      isMit,
      isEvening,
      toggleMit,
      toggleEvening,
    }),
    [active.mitIds, active.eveningIds, isMit, isEvening, toggleMit, toggleEvening],
  );
}
