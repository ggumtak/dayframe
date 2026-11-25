import type { IconName } from '@/components/ui';
import { createLocalStore } from '@/lib/localStore';

import { LIST_COLORS } from './listColors';

export interface ProjectMeta {
  color: string;
  icon: IconName;
  checklistMode?: boolean;
  pinned?: boolean;
  showProgress?: boolean;
}

/** The values a list's colour is stored as (see listColors.ts for how they are drawn). */
export const PROJECT_COLORS = LIST_COLORS.map((color) => color.stored);

export const PROJECT_ICONS: IconName[] = [
  'hash', 'briefcase', 'home', 'heart', 'book', 'shopping-bag', 'code', 'compass', 'star', 'zap',
];

const KEY = 'dayframe-project-meta-v1';

function parseProjectMetaMap(raw: string): Record<string, ProjectMeta> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, ProjectMeta>;
}

const store = createLocalStore<Record<string, ProjectMeta>>({
  key: KEY,
  initial: {},
  parse: parseProjectMetaMap,
  accountScoped: true,
});

export function setProjectMeta(projectId: string, meta: ProjectMeta): void {
  store.set((prev) => ({ ...prev, [projectId]: meta }));
}

export function patchProjectMeta(projectId: string, patch: Partial<ProjectMeta>): void {
  store.set((prev) => {
    const existing = prev[projectId];
    const base: ProjectMeta = existing ?? { color: PROJECT_COLORS[0], icon: 'hash' };
    return { ...prev, [projectId]: { ...base, ...patch } };
  });
}

export function deleteProjectMeta(projectId: string): void {
  store.set((prev) => {
    if (!(projectId in prev)) return prev;
    const next = { ...prev };
    delete next[projectId];
    return next;
  });
}

export function useProjectMetaMap(): Record<string, ProjectMeta> {
  return store.useValue();
}
