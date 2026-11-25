import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export interface LocalStoreOptions<T> {
  key: string;
  initial: T;
  /** Turns stored raw text back into a valid value; thrown errors fall back to `initial`. */
  parse: (raw: string) => T;
  /** Optional custom serializer; defaults to `JSON.stringify`. */
  serialize?: (value: T) => string;
  /** Optional equality check used when hydrating from disk; defaults to serialized comparison. */
  equals?: (a: T, b: T) => boolean;
  /**
   * When true, `resetAccountLocalStores()` (called by `clearLocalData()`) wipes both
   * the in-memory cache and the AsyncStorage key so another account never inherits it.
   */
  accountScoped?: boolean;
}

export interface LocalStore<T> {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
  useValue: () => T;
  reset: () => Promise<void>;
}

const accountResetters = new Set<() => void | Promise<void>>();

/** Registers a reset handler invoked whenever local account data is cleared (sign-out or account switch). */
export function registerAccountStoreReset(fn: () => void | Promise<void>): () => void {
  accountResetters.add(fn);
  return () => {
    accountResetters.delete(fn);
  };
}

/** Clears every account-scoped local store's in-memory cache and persisted AsyncStorage entry. */
export async function resetAccountLocalStores(): Promise<void> {
  await Promise.all([...accountResetters].map((fn) => Promise.resolve().then(fn).catch(() => {})));
}

/**
 * Creates a lightweight AsyncStorage-backed external store safe for `useSyncExternalStore`.
 * Early writes before initial hydration completes are preserved via a `changedBeforeLoad` guard,
 * and `reset()` invalidates any in-flight load so cleared state cannot be clobbered.
 */
export function createLocalStore<T>(options: LocalStoreOptions<T>): LocalStore<T> {
  const { key, initial, parse, accountScoped = false } = options;
  const serialize = options.serialize ?? ((v: T) => JSON.stringify(v));
  const equals = options.equals ?? ((a: T, b: T) => serialize(a) === serialize(b));

  let value: T = initial;
  let loaded = false;
  let changedBeforeLoad = false;
  let loadGeneration = 0;
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const ensureLoaded = () => {
    if (loaded) return;
    loaded = true;
    const generation = loadGeneration;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (generation !== loadGeneration || changedBeforeLoad || raw === null) return;
        let stored: T;
        try {
          stored = parse(raw);
        } catch {
          return;
        }
        if (equals(stored, value)) return;
        value = stored;
        notify();
      })
      .catch(() => {});
  };

  const subscribe = (listener: () => void) => {
    ensureLoaded();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => value;

  const get = (): T => {
    ensureLoaded();
    return value;
  };

  const set = (next: T | ((prev: T) => T)): void => {
    const resolved = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
    if (Object.is(resolved, value)) return;
    changedBeforeLoad = true;
    value = resolved;
    notify();
    AsyncStorage.setItem(key, serialize(resolved)).catch(() => {});
  };

  const useValue = (): T => {
    ensureLoaded();
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  };

  const reset = async (): Promise<void> => {
    loadGeneration += 1;
    loaded = true;
    changedBeforeLoad = false;
    if (!Object.is(value, initial)) {
      value = initial;
      notify();
    }
    await AsyncStorage.removeItem(key).catch(() => {});
  };

  const store: LocalStore<T> = { get, set, subscribe, useValue, reset };
  if (accountScoped) registerAccountStoreReset(() => store.reset());
  return store;
}
