import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A screen choice (a tab's view, a list's sort) that survives an app restart. It starts at `initial`,
 * switches to the stored value once read, and keeps any change the person made before that read finished.
 */
export function usePersistentState<T extends string>(
  key: string, initial: T, accept: (stored: string) => stored is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const touched = useRef(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key).then((stored) => {
      if (active && !touched.current && stored !== null && accept(stored)) setValue(stored);
    }).catch(() => {});
    return () => { active = false; };
    // `accept` is a type guard defined at module level by callers; reading once per key is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback((next: T) => {
    touched.current = true;
    setValue(next);
    AsyncStorage.setItem(key, next).catch(() => {});
  }, [key]);

  return [value, set];
}
