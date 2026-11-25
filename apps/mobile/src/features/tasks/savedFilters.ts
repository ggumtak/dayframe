import { createLocalStore } from '@/lib/localStore';

import {
  addSavedFilter,
  DEFAULT_SAVED_FILTERS,
  type NewSavedFilterInput,
  parseSavedFilters,
  pinnedSavedFilters,
  removeSavedFilter,
  renameSavedFilter,
  type SavedFilter,
  togglePinSavedFilter,
} from './savedFiltersLogic';

export {
  addSavedFilter,
  DEFAULT_SAVED_FILTERS,
  normalizeSavedFilter,
  parseSavedFilters,
  pinnedSavedFilters,
  removeSavedFilter,
  renameSavedFilter,
  togglePinSavedFilter,
} from './savedFiltersLogic';
export type { NewSavedFilterInput, SavedFilter } from './savedFiltersLogic';

const KEY = 'dayframe-saved-filters-v1';

const store = createLocalStore<SavedFilter[]>({
  key: KEY,
  initial: DEFAULT_SAVED_FILTERS,
  parse: parseSavedFilters,
  accountScoped: true,
});

export function useSavedFilters(): SavedFilter[] {
  return store.useValue();
}

export function getSavedFilters(): SavedFilter[] {
  return store.get();
}

export function saveFilter(input: NewSavedFilterInput): void {
  store.set((prev) => addSavedFilter(prev, input));
}

export function deleteSavedFilter(id: string): void {
  store.set((prev) => removeSavedFilter(prev, id));
}

export function toggleSavedFilterPin(id: string): void {
  store.set((prev) => togglePinSavedFilter(prev, id));
}

export function renameFilter(id: string, name: string, icon?: string): void {
  store.set((prev) => renameSavedFilter(prev, id, name, icon));
}

export function resetSavedFilters(): Promise<void> {
  return store.reset();
}

export function getPinnedSavedFilters(): SavedFilter[] {
  return pinnedSavedFilters(store.get());
}
