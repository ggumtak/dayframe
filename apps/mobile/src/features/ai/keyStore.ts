import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { maskKey } from './models';

// The owner's Anthropic key lives only in expo-secure-store (Android Keystore), under this one name. It is
// never put in AsyncStorage, never logged and never shown in full; the only place it is sent is
// api.anthropic.com, by client.ts. The web build (development previews only) keeps it in memory instead,
// so a reload forgets it.
const KEY_NAME = 'dayframe.anthropic-key';

type KeyState = { status: 'loading' } | { status: 'ready'; key: string | null };

let state: KeyState = { status: 'loading' };
let started = false;
let memoryKey: string | null = null;
const listeners = new Set<() => void>();

function set(next: KeyState) {
  state = next;
  listeners.forEach((listener) => listener());
}

// The secure-store module is imported on first use, so nothing here runs while the app starts.
const secureStore = () => import('expo-secure-store');

async function load(): Promise<string | null> {
  if (Platform.OS === 'web') return memoryKey;
  try {
    return await (await secureStore()).getItemAsync(KEY_NAME);
  } catch {
    return null;
  }
}

function ensureLoaded() {
  if (started) return;
  started = true;
  void load().then((key) => set({ status: 'ready', key }));
}

/** The saved key, read fresh from storage; null when there is none. For client.ts only. */
export async function readKey(): Promise<string | null> {
  if (state.status === 'ready') return state.key;
  const key = await load();
  started = true;
  set({ status: 'ready', key });
  return key;
}

export async function saveKey(key: string): Promise<void> {
  if (Platform.OS === 'web') memoryKey = key;
  else await (await secureStore()).setItemAsync(KEY_NAME, key);
  set({ status: 'ready', key });
}

export async function deleteKey(): Promise<void> {
  if (Platform.OS === 'web') memoryKey = null;
  else await (await secureStore()).deleteItemAsync(KEY_NAME);
  set({ status: 'ready', key: null });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export interface AiKeyStatus {
  /** False until the stored key has been read once. */
  ready: boolean;
  hasKey: boolean;
  /** "sk-ant-…abcd", or null. */
  masked: string | null;
}

const statusCache = new WeakMap<KeyState, AiKeyStatus>();
function statusOf(current: KeyState): AiKeyStatus {
  let status = statusCache.get(current);
  if (!status) {
    status = current.status === 'loading'
      ? { ready: false, hasKey: false, masked: null }
      : { ready: true, hasKey: !!current.key, masked: current.key ? maskKey(current.key) : null };
    statusCache.set(current, status);
  }
  return status;
}

/** Whether a key is saved, and its masked form. Reads secure storage the first time a screen asks. */
export function useAiKeyStatus(): AiKeyStatus {
  ensureLoaded();
  return useSyncExternalStore(subscribe, () => statusOf(state), () => statusOf(state));
}
