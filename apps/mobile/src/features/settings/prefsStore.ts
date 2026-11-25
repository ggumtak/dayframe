import { createLocalStore, registerAccountStoreReset } from '@/lib/localStore';

import { DEFAULT_PERSONAL_PREFS, mergePersonalPrefs, parsePersonalPrefs, type PersonalPrefs } from './prefs';

const KEY = 'dayframe-personal-prefs-v1';

const store = createLocalStore<PersonalPrefs>({
  key: KEY,
  initial: DEFAULT_PERSONAL_PREFS,
  parse: parsePersonalPrefs,
});

// Clear only the account-specific default project reference when switching accounts, preserving device preferences.
registerAccountStoreReset(() => {
  if (store.get().quickAddDefaultProjectId !== null) {
    store.set((prev) => mergePersonalPrefs(prev, { quickAddDefaultProjectId: null }));
  }
});

export function usePersonalPrefs(): PersonalPrefs {
  return store.useValue();
}

export function getPersonalPrefs(): PersonalPrefs {
  return store.get();
}

export function setPersonalPrefs(patch: Partial<PersonalPrefs>): void {
  store.set((prev) => mergePersonalPrefs(prev, patch));
}

export function resetPersonalPrefs(): Promise<void> {
  return store.reset();
}
