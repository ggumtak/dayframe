/**
 * Saved search filters (smart views) that can be pinned for quick access.
 * Kept free of React Native and storage imports so it can be unit-tested directly with Node.
 */

export interface SavedFilter {
  id: string;
  name: string;
  icon: string;
  query: string;
  quickFilters: string[];
  includeCompleted: boolean;
  pinned: boolean;
}

export type NewSavedFilterInput = Omit<SavedFilter, 'id' | 'pinned'> & {
  id?: string;
  pinned?: boolean;
};

export const DEFAULT_SAVED_FILTERS: SavedFilter[] = [
  {
    id: 'preset-p1',
    name: '가장 중요한 일',
    icon: 'flag',
    query: '',
    quickFilters: ['p1'],
    includeCompleted: false,
    pinned: true,
  },
  {
    id: 'preset-week',
    name: '이번 주 일정',
    icon: 'calendar',
    query: '',
    quickFilters: ['week'],
    includeCompleted: false,
    pinned: false,
  },
  {
    id: 'preset-stale',
    name: '오래 미룬 일',
    icon: 'clock',
    query: '',
    quickFilters: ['stale'],
    includeCompleted: false,
    pinned: false,
  },
];

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Validates an untrusted object as a `SavedFilter`, or returns null if required fields are missing. */
export function normalizeSavedFilter(value: unknown): SavedFilter | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  if (!id || !name) return null;
  const icon = typeof source.icon === 'string' && source.icon.trim() ? source.icon.trim() : 'filter';
  const query = typeof source.query === 'string' ? source.query.trim() : '';
  const quickFilters = uniqueStrings(source.quickFilters);
  const includeCompleted = typeof source.includeCompleted === 'boolean' ? source.includeCompleted : false;
  const pinned = typeof source.pinned === 'boolean' ? source.pinned : false;
  return { id, name, icon, query, quickFilters, includeCompleted, pinned };
}

/**
 * Reads stored JSON; missing or unreadable storage falls back to starter presets.
 * An explicit empty array (`"[]"`) is preserved so users can delete every starter preset.
 */
export function parseSavedFilters(raw: string | null | undefined): SavedFilter[] {
  if (!raw) return DEFAULT_SAVED_FILTERS.map((f) => ({ ...f, quickFilters: [...f.quickFilters] }));
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_SAVED_FILTERS.map((f) => ({ ...f, quickFilters: [...f.quickFilters] }));
    }
    const seen = new Set<string>();
    const filters: SavedFilter[] = [];
    for (const item of parsed) {
      const normalized = normalizeSavedFilter(item);
      if (!normalized || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      filters.push(normalized);
    }
    return filters;
  } catch {
    return DEFAULT_SAVED_FILTERS.map((f) => ({ ...f, quickFilters: [...f.quickFilters] }));
  }
}

export function addSavedFilter(list: SavedFilter[], input: NewSavedFilterInput): SavedFilter[] {
  const name = input.name.trim();
  if (!name) return list;
  const id = input.id?.trim() || `filter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const next: SavedFilter = {
    id,
    name,
    icon: input.icon.trim() || 'filter',
    query: input.query.trim(),
    quickFilters: uniqueStrings(input.quickFilters),
    includeCompleted: Boolean(input.includeCompleted),
    pinned: Boolean(input.pinned),
  };
  const existingIndex = list.findIndex((item) => item.id === id);
  if (existingIndex >= 0) {
    return list.map((item, idx) => (idx === existingIndex ? next : item));
  }
  return [...list, next];
}

export function removeSavedFilter(list: SavedFilter[], id: string): SavedFilter[] {
  const next = list.filter((item) => item.id !== id);
  return next.length === list.length ? list : next;
}

export function togglePinSavedFilter(list: SavedFilter[], id: string): SavedFilter[] {
  let changed = false;
  const next = list.map((item) => {
    if (item.id !== id) return item;
    changed = true;
    return { ...item, pinned: !item.pinned };
  });
  return changed ? next : list;
}

export function renameSavedFilter(list: SavedFilter[], id: string, name: string, icon?: string): SavedFilter[] {
  const trimmed = name.trim();
  if (!trimmed) return list;
  let changed = false;
  const next = list.map((item) => {
    if (item.id !== id) return item;
    const nextIcon = icon !== undefined && icon.trim() ? icon.trim() : item.icon;
    if (item.name === trimmed && item.icon === nextIcon) return item;
    changed = true;
    return { ...item, name: trimmed, icon: nextIcon };
  });
  return changed ? next : list;
}

export function pinnedSavedFilters(list: SavedFilter[]): SavedFilter[] {
  return list.filter((item) => item.pinned);
}
