import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { IconName } from '@/components/ui';

import { LIST_COLORS } from './listColors';

export interface ProjectMeta {
  color: string;
  icon: IconName;
}

/** The values a list's colour is stored as (see listColors.ts for how they are drawn). */
export const PROJECT_COLORS = LIST_COLORS.map((color) => color.stored);

export const PROJECT_ICONS: IconName[] = [
  'hash', 'briefcase', 'home', 'heart', 'book', 'shopping-bag', 'code', 'compass', 'star', 'zap',
];

const KEY = 'dayframe-project-meta-v1';
let cache: Record<string, ProjectMeta> = {};
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, ProjectMeta>;
      if (parsed && typeof parsed === 'object') {
        cache = { ...parsed, ...cache };
        notify();
      }
    })
    .catch(() => {});
}

function save() {
  AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
}

export function setProjectMeta(projectId: string, meta: ProjectMeta): void {
  cache = { ...cache, [projectId]: meta };
  notify();
  save();
}

export function deleteProjectMeta(projectId: string): void {
  if (!(projectId in cache)) return;
  const next = { ...cache };
  delete next[projectId];
  cache = next;
  notify();
  save();
}

export function useProjectMetaMap(): Record<string, ProjectMeta> {
  ensureLoaded();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    () => cache,
    () => cache,
  );
}
