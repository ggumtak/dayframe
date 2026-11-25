import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';

import { api, ApiFailure } from '@/lib/api';
import { deviceTimeZone, dueBucket, dueDate, dueMinutes, instantFor, sameInstant, Temporal, today } from '@/lib/dates';
import { uuid } from '@/lib/ids';
import {
  movedOccurrenceSlot, nextOccurrence, occurrenceFloor, type Project, type Section, type SectionInput, type SectionPatch,
  type Tag, type Task, type TaskCompletion, type TaskInput, type TaskPatch, type TaskTag, type User,
} from '@/lib/shared';
import type { SubtaskProgress } from '@/lib/smart';

import { hold, queryClient, settle } from './client';
import { keys, writes } from './keys';

// One shared scope makes every write run in the order the user made it, online or after a reconnect.
const scope = { id: 'dayframe-writes' };
const refresh = (...queryKeys: readonly (readonly unknown[])[]) =>
  Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
const editTasks = (edit: (tasks: Task[]) => Task[]) =>
  queryClient.setQueryData<Task[]>(keys.tasks, (tasks) => (tasks ? edit(tasks) : tasks));
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function ensureProject(name: string): Promise<Project> {
  const find = (list: Project[] | undefined) => list?.find((project) => sameName(project.name, name));
  const cached = find(queryClient.getQueryData<Project[]>(keys.projects));
  if (cached) return cached;
  try {
    const created = await api.createProject({ name });
    queryClient.setQueryData<Project[]>(keys.projects, (list) => [...(list ?? []), created]);
    return created;
  } catch (error) {
    // Another device (or an earlier retry) created it first.
    const existing = error instanceof ApiFailure && error.status === 409 ? find(await api.projects()) : undefined;
    if (!existing) throw error;
    return existing;
  }
}

async function ensureTag(name: string): Promise<Tag> {
  const find = (list: Tag[] | undefined) => list?.find((tag) => sameName(tag.name, name));
  const cached = find(queryClient.getQueryData<Tag[]>(keys.tags));
  if (cached) return cached;
  try {
    const created = await api.createTag(name);
    queryClient.setQueryData<Tag[]>(keys.tags, (list) => [...(list ?? []), created]);
    return created;
  } catch (error) {
    const existing = error instanceof ApiFailure && error.status === 409 ? find(await api.tags()) : undefined;
    if (!existing) throw error;
    return existing;
  }
}

export interface CreateTaskVars {
  id: string;
  input: Omit<TaskInput, 'id'>;
  /** Names from quick entry; missing projects and tags are created on save. */
  projectName?: string | null;
  tagNames?: string[];
}

queryClient.setMutationDefaults(writes.createTask, {
  scope,
  mutationFn: async (vars: CreateTaskVars) => {
    const project = vars.projectName && !vars.input.parent_task_id ? await ensureProject(vars.projectName) : null;
    let task: Task;
    try {
      task = await api.createTask({ ...vars.input, id: vars.id, ...(project ? { project_id: project.id } : {}) });
    } catch (error) {
      // The ID already exists when an earlier attempt reached the server but its reply was lost.
      if (!(error instanceof ApiFailure && error.status === 409)) throw error;
      task = await api.task(vars.id);
    }
    for (const name of vars.tagNames ?? []) await api.attachTag(task.id, (await ensureTag(name)).id);
    return task;
  },
  onMutate: async (vars: CreateTaskVars) => {
    await hold(keys.tasks);
    const now = new Date().toISOString();
    const { input } = vars;
    const project = vars.projectName
      ? queryClient.getQueryData<Project[]>(keys.projects)?.find((item) => sameName(item.name, vars.projectName!))
      : undefined;
    const draft: Task = {
      id: vars.id, user_id: '', created_at: now, updated_at: now, completed_at: null,
      project_id: input.project_id ?? project?.id ?? null, section_id: input.section_id ?? null,
      parent_task_id: input.parent_task_id ?? null, title: input.title, notes: input.notes ?? null,
      priority: input.priority ?? 4, position: input.position ?? 0, due_at: input.due_at ?? null,
      all_day: input.all_day ?? false,
      timezone: input.timezone ?? queryClient.getQueryData<User>(keys.me)?.timezone ?? deviceTimeZone(),
      recurrence_rule: input.recurrence_rule ?? null,
      recurrence_mode: input.recurrence_rule ? (input.recurrence_mode ?? 'schedule') : 'schedule',
      recurrence_anchor_at: input.recurrence_rule ? input.due_at ?? null : null,
      recurrence_local_time: input.recurrence_local_time ?? null,
      occurrence_at: null,
      duration_minutes: input.duration_minutes ?? null,
    };
    editTasks((tasks) => [...tasks.filter((task) => task.id !== vars.id), draft]);
  },
  onSuccess: (task: Task) => editTasks((tasks) => tasks.map((item) => (item.id === task.id ? task : item))),
  onSettled: () => settle(keys.tasks, keys.taskTags, keys.projects, keys.tags),
});

export interface UpdateTaskVars { id: string; patch: TaskPatch }

queryClient.setMutationDefaults(writes.updateTask, {
  scope,
  mutationFn: (vars: UpdateTaskVars) => api.updateTask(vars.id, vars.patch),
  onMutate: async (vars: UpdateTaskVars) => {
    await hold(keys.tasks);
    const { patch } = vars;
    // Mirrors the server: a one-time move remembers the slot it left; any other schedule edit starts afresh.
    editTasks((tasks) => tasks.map((task) => {
      if (task.id !== vars.id) return task;
      if (patch.preserve_recurrence) return { ...task, due_at: patch.due_at, occurrence_at: movedOccurrenceSlot(task, patch.due_at) };
      const reanchors = 'due_at' in patch || 'recurrence_rule' in patch || 'timezone' in patch;
      return { ...task, ...patch, ...(reanchors ? { occurrence_at: null } : {}) };
    }));
  },
  onSuccess: (task: Task) => editTasks((tasks) => tasks.map((item) => (item.id === task.id ? task : item))),
  onSettled: () => settle(keys.tasks),
});

export interface CompleteTaskVars {
  id: string;
  request_id: string;
  expected_updated_at: string;
  /** The occurrence the user checked off, so a stale retry never completes a later one. */
  occurrence_due_at: string | null;
}

/** Where a repeating task moves when its current occurrence is completed; the server applies the same rule. */
export function nextDueAfterComplete(task: Task): string | null {
  if (!task.recurrence_rule || !task.recurrence_anchor_at) return null;
  try {
    const mode = task.recurrence_mode ?? 'schedule';
    const now = Temporal.Now.instant();
    const floor = mode === 'completion' ? now : occurrenceFloor(task, now);
    return nextOccurrence(
      task.recurrence_rule, task.timezone, task.recurrence_anchor_at,
      floor, task.all_day, task.recurrence_local_time, mode,
    );
  } catch {
    return null;
  }
}

queryClient.setMutationDefaults(writes.completeTask, {
  scope,
  mutationFn: async (vars: CompleteTaskVars) => {
    const input = { request_id: vars.request_id, expected_updated_at: vars.expected_updated_at };
    try {
      return await api.completeTask(vars.id, input);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 404) return null;
      if (error.code !== 'STALE_RESOURCE' && error.code !== 'INVALID_INPUT') throw error;
      // The task changed since it was cached (often our own queued edit). Complete the same occurrence only.
      const fresh = await api.task(vars.id);
      if (fresh.completed_at || !sameInstant(fresh.due_at, vars.occurrence_due_at)) return null;
      return api.completeTask(vars.id, { ...input, expected_updated_at: fresh.updated_at });
    }
  },
  onMutate: async (vars: CompleteTaskVars) => {
    await hold(keys.tasks, keys.completedTasks, keys.done);
    const completedAt = new Date().toISOString();
    const existing = queryClient.getQueryData<Task[]>(keys.tasks)?.find((item) => item.id === vars.id);
    // Shown under 오늘's 완료됨 at once; the server's list replaces it when the write lands.
    if (existing) {
      queryClient.setQueryData<TaskCompletion[]>(doneTodayKey(), (list) => list && [
        { task: { ...existing, completed_at: existing.recurrence_rule ? null : completedAt }, completed_at: completedAt, occurrence_due_at: existing.due_at },
        ...list,
      ]);
    }
    const completedOneOff: Task | null = existing && (!existing.recurrence_rule || !existing.recurrence_anchor_at)
      ? { ...existing, completed_at: completedAt } : null;
    editTasks((tasks) => tasks.flatMap((task) => {
      if (task.id !== vars.id) return [task];
      if (!task.recurrence_rule || !task.recurrence_anchor_at) return [];
      const due_at = nextDueAfterComplete(task);
      if (!due_at) return [task];
      const mode = task.recurrence_mode ?? 'schedule';
      return [{ ...task, due_at, occurrence_at: null, ...(mode === 'completion' ? { recurrence_anchor_at: due_at } : {}) }];
    }));
    if (completedOneOff) {
      queryClient.setQueryData<Task[]>(keys.completedTasks, (list) => (list
        ? [completedOneOff, ...list.filter((item) => item.id !== completedOneOff.id)]
        : list));
    }
  },
  onSettled: () => settle(keys.tasks, keys.completedTasks, keys.done),
});

queryClient.setMutationDefaults(writes.reopenTask, {
  scope,
  mutationFn: (task: Task) => api.reopenTask(task.id),
  // Put the task back at once; the completion it undoes may still be waiting in the queue.
  onMutate: async (task: Task) => {
    await hold(keys.tasks, keys.completedTasks);
    editTasks((tasks) => [...tasks.filter((item) => item.id !== task.id), { ...task, completed_at: null }]);
    queryClient.setQueryData<Task[]>(keys.completedTasks, (tasks) => tasks?.filter((item) => item.id !== task.id));
  },
  onSuccess: (task: Task) => editTasks((tasks) => [...tasks.filter((item) => item.id !== task.id), task]),
  onSettled: () => settle(keys.tasks, keys.completedTasks, keys.done),
});

// Tasks the user has just deleted are hidden while the "undo" toast is up, and only then deleted.
const hiddenIds = new Set<string>();
const hiddenListeners = new Set<() => void>();
let hiddenVersion = 0;
function setHidden(ids: Iterable<string>, hidden: boolean) {
  for (const id of ids) {
    if (hidden) hiddenIds.add(id);
    else hiddenIds.delete(id);
  }
  hiddenVersion += 1;
  hiddenListeners.forEach((listener) => listener());
}
export const hideTasks = (ids: Iterable<string>) => setHidden(ids, true);
export const unhideTasks = (ids: Iterable<string>) => setHidden(ids, false);
const subscribeHidden = (listener: () => void) => {
  hiddenListeners.add(listener);
  return () => { hiddenListeners.delete(listener); };
};

/** A task together with every task nested beneath it. */
export function withDescendants(tasks: Task[], id: string): Set<string> {
  const ids = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const task of tasks) {
      if (task.parent_task_id && ids.has(task.parent_task_id) && !ids.has(task.id)) {
        ids.add(task.id);
        grew = true;
      }
    }
  }
  return ids;
}

queryClient.setMutationDefaults(writes.deleteTask, {
  scope,
  mutationFn: (id: string) => api.deleteTask(id),
  onMutate: async (id: string) => {
    await hold(keys.tasks);
    const removed = withDescendants(queryClient.getQueryData<Task[]>(keys.tasks) ?? [], id);
    editTasks((tasks) => tasks.filter((task) => !removed.has(task.id)));
    // From here the cache itself no longer holds them; if the delete fails they come back visibly.
    unhideTasks(removed);
  },
  onSettled: () => settle(keys.tasks, keys.taskTags),
});

export type ReorderVars = { id: string; position: number }[];

queryClient.setMutationDefaults(writes.reorderTasks, {
  scope,
  mutationFn: async (vars: ReorderVars) => {
    for (const { id, position } of vars) await api.updateTask(id, { position });
  },
  onMutate: async (vars: ReorderVars) => {
    await hold(keys.tasks);
    const positions = new Map(vars.map((item) => [item.id, item.position]));
    editTasks((tasks) => tasks.map((task) => (positions.has(task.id) ? { ...task, position: positions.get(task.id)! } : task)));
  },
  onSettled: () => settle(keys.tasks),
});

/** Rescheduled `{ due_at, all_day }` for an overdue task; drops a wall-clock time that has already passed today. */
export function rescheduledOverdueFields(
  task: Pick<Task, 'due_at' | 'timezone' | 'all_day'>,
  nowMs: number = Date.now(),
): { due_at: string; all_day: boolean } {
  const targetDay = today(task.timezone);
  const candidate = instantFor(targetDay, dueMinutes(task), task.timezone);
  if (!task.all_day && Date.parse(candidate) < nowMs) {
    return { due_at: instantFor(targetDay, null, task.timezone), all_day: true };
  }
  return { due_at: candidate, all_day: task.all_day };
}

queryClient.setMutationDefaults(writes.rescheduleOverdue, {
  scope,
  mutationFn: async () => {
    const now = Date.now();
    const pastWallClock = (await api.openTasks()).filter((task) => (
      dueBucket(task) === 'overdue' && !task.all_day && rescheduledOverdueFields(task, now).all_day
    ));
    let converted = 0;
    for (const task of pastWallClock) {
      const next = rescheduledOverdueFields(task, now);
      try {
        await api.updateTask(task.id, next);
        converted += 1;
      } catch (error) {
        if (!(error instanceof ApiFailure && error.status === 404)) throw error;
      }
    }
    const result = await api.rescheduleOverdue();
    return { count: result.count + converted };
  },
  onMutate: async () => {
    await hold(keys.tasks);
    const now = Date.now();
    editTasks((tasks) => tasks.map((task) => {
      if (dueBucket(task) !== 'overdue') return task;
      const next = rescheduledOverdueFields(task, now);
      return {
        ...task,
        ...next,
        ...(next.all_day && !task.all_day ? { occurrence_at: null } : {}),
        ...(next.all_day && task.recurrence_rule ? { recurrence_local_time: null } : {}),
      };
    }));
  },
  onSettled: () => settle(keys.tasks),
});

export interface SetTaskTagsVars { taskId: string; attach: string[]; detach: string[] }

queryClient.setMutationDefaults(writes.setTaskTags, {
  scope,
  mutationFn: async (vars: SetTaskTagsVars) => {
    for (const tagId of vars.detach) await api.detachTag(vars.taskId, tagId);
    for (const tagId of vars.attach) await api.attachTag(vars.taskId, tagId);
  },
  onMutate: async (vars: SetTaskTagsVars) => {
    await hold(keys.taskTags);
    queryClient.setQueryData<TaskTag[]>(keys.taskTags, (links) => links && [
      ...links.filter((link) => link.task_id !== vars.taskId || !vars.detach.includes(link.tag_id)),
      ...vars.attach.map((tag_id) => ({ user_id: '', task_id: vars.taskId, tag_id })),
    ]);
  },
  onSettled: () => settle(keys.taskTags),
});

export interface UpdateSectionVars { id: string; patch: SectionPatch }
export interface RenameVars { id: string; name: string }

queryClient.setMutationDefaults(writes.createSection, {
  scope,
  mutationFn: (input: SectionInput) => api.createSection(input),
  onSuccess: (section: Section) => {
    queryClient.setQueryData<Section[]>(keys.sections, (list) => [...(list ?? []).filter((item) => item.id !== section.id), section]);
  },
  onSettled: () => settle(keys.sections),
});

queryClient.setMutationDefaults(writes.updateSection, {
  scope,
  mutationFn: ({ id, patch }: UpdateSectionVars) => api.updateSection(id, patch),
  onMutate: async ({ id, patch }: UpdateSectionVars) => {
    await hold(keys.sections);
    queryClient.setQueryData<Section[]>(keys.sections, (list) => list?.map((section) => (section.id === id ? { ...section, ...patch } : section)));
  },
  onSettled: () => settle(keys.sections),
});

queryClient.setMutationDefaults(writes.deleteSection, {
  scope,
  mutationFn: (id: string) => api.deleteSection(id),
  onMutate: async (id: string) => {
    await hold(keys.sections, keys.tasks);
    queryClient.setQueryData<Section[]>(keys.sections, (list) => list?.filter((section) => section.id !== id));
    editTasks((tasks) => tasks.map((task) => (task.section_id === id ? { ...task, section_id: null } : task)));
  },
  onSettled: () => settle(keys.sections, keys.tasks),
});

queryClient.setMutationDefaults(writes.createProject, {
  scope,
  mutationFn: (name: string) => api.createProject({ name }),
  onSuccess: (project: Project) => {
    queryClient.setQueryData<Project[]>(keys.projects, (list) => [...(list ?? []).filter((item) => item.id !== project.id), project]);
  },
  onSettled: () => settle(keys.projects),
});

queryClient.setMutationDefaults(writes.updateProject, {
  scope,
  mutationFn: ({ id, name }: RenameVars) => api.updateProject(id, { name }),
  onMutate: async ({ id, name }: RenameVars) => {
    await hold(keys.projects);
    queryClient.setQueryData<Project[]>(keys.projects, (list) => list?.map((project) => (project.id === id ? { ...project, name } : project)));
  },
  onSettled: () => settle(keys.projects),
});

queryClient.setMutationDefaults(writes.deleteProject, {
  scope,
  mutationFn: (id: string) => api.deleteProject(id),
  onMutate: async (id: string) => {
    await hold(keys.projects, keys.sections, keys.tasks);
    queryClient.setQueryData<Project[]>(keys.projects, (list) => list?.filter((project) => project.id !== id));
    queryClient.setQueryData<Section[]>(keys.sections, (list) => list?.filter((section) => section.project_id !== id));
    editTasks((tasks) => {
      const dropped = new Set<string>();
      for (const task of tasks) {
        if (task.project_id === id) {
          for (const item of withDescendants(tasks, task.id)) dropped.add(item);
        }
      }
      return tasks.filter((task) => !dropped.has(task.id));
    });
  },
  onSettled: () => settle(keys.projects, keys.sections, keys.tasks, keys.taskTags, keys.completedTasks),
});

queryClient.setMutationDefaults(writes.createTag, {
  scope,
  mutationFn: (name: string) => api.createTag(name),
  onSuccess: (tag: Tag) => {
    queryClient.setQueryData<Tag[]>(keys.tags, (list) => [...(list ?? []).filter((item) => item.id !== tag.id), tag]);
  },
  onSettled: () => settle(keys.tags),
});

queryClient.setMutationDefaults(writes.updateTag, {
  scope,
  mutationFn: ({ id, name }: RenameVars) => api.updateTag(id, name),
  onMutate: async ({ id, name }: RenameVars) => {
    await hold(keys.tags);
    queryClient.setQueryData<Tag[]>(keys.tags, (list) => list?.map((tag) => (tag.id === id ? { ...tag, name } : tag)));
  },
  onSettled: () => settle(keys.tags),
});

queryClient.setMutationDefaults(writes.deleteTag, {
  scope,
  mutationFn: (id: string) => api.deleteTag(id),
  onMutate: async (id: string) => {
    await hold(keys.tags, keys.taskTags);
    queryClient.setQueryData<Tag[]>(keys.tags, (list) => list?.filter((tag) => tag.id !== id));
    queryClient.setQueryData<TaskTag[]>(keys.taskTags, (links) => links?.filter((link) => link.tag_id !== id));
  },
  onSettled: () => settle(keys.tags, keys.taskTags),
});

/** Creates the tag if needed and attaches it. Needs a connection, since a new tag has no ID to queue against. */
export async function attachTagByName(taskId: string, name: string): Promise<void> {
  const tag = await ensureTag(name);
  await api.attachTag(taskId, tag.id);
  await refresh(keys.tags, keys.taskTags);
}

const doneTodayKey = () => keys.doneOn(today(deviceTimeZone()).toString());

export interface DoneToday {
  completion: TaskCompletion;
  /** False for an earlier occurrence of a repeating task that was completed again since; only the latest can be undone. */
  undoable: boolean;
}

/**
 * What was checked off today, newest first. A task reopened since, and a repeating occurrence whose
 * completion was undone, are left out even though the server keeps their completion records.
 */
export function useDoneToday(): DoneToday[] {
  const zone = deviceTimeZone();
  const date = today(zone);
  const { data: open } = useTasks();
  const { data } = useQuery({
    queryKey: keys.doneOn(date.toString()),
    queryFn: () => api.completionsSince(date.toZonedDateTime(zone).toInstant().toString()),
    meta: { persist: false },
  });
  return useMemo(() => {
    const current = new Map((open ?? []).map((task) => [task.id, task]));
    const seen = new Set<string>();
    const list: DoneToday[] = [];
    for (const completion of data ?? []) {
      const now = current.get(completion.task.id);
      const repeats = !!completion.task.recurrence_rule;
      // An open one-off task was reopened; a repeating task back on this occurrence had its completion undone.
      if (repeats ? !now || sameInstant(now.due_at, completion.occurrence_due_at) : !!now) continue;
      if (!repeats && seen.has(completion.task.id)) continue;
      list.push({ completion, undoable: !seen.has(completion.task.id) });
      seen.add(completion.task.id);
    }
    return list;
  }, [data, open]);
}

/** Open tasks, minus any that are hidden behind a pending "undo delete". */
export function useTasks() {
  const version = useSyncExternalStore(subscribeHidden, () => hiddenVersion, () => hiddenVersion);
  const query = useQuery({ queryKey: keys.tasks, queryFn: api.openTasks });
  const all = query.data;
  // `version` changes whenever the hidden set does.
  const data = useMemo(() => (version >= 0 ? all?.filter((task) => !hiddenIds.has(task.id)) : all), [all, version]);
  return { ...query, data };
}
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects });
export const useSections = () => useQuery({ queryKey: keys.sections, queryFn: api.sections });
export const useTags = () => useQuery({ queryKey: keys.tags, queryFn: api.tags });
export const useTaskTags = () => useQuery({ queryKey: keys.taskTags, queryFn: api.taskTags });
export const useCompletedTasks = () => useQuery({
  queryKey: keys.completedTasks, queryFn: api.completedTasks, staleTime: 60_000, meta: { persist: false },
});

export const byPosition = (a: Task, b: Task) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Sorts scheduled work the way a day is read: by calendar day, timed items chronologically before all-day items, undated last. */
export function bySchedule(a: Task, b: Task): number {
  const aDate = dueDate(a);
  const bDate = dueDate(b);
  if (!aDate && !bDate) return a.priority - b.priority || byPosition(a, b);
  if (!aDate) return 1;
  if (!bDate) return -1;
  const dayOrder = Temporal.PlainDate.compare(aDate, bDate);
  if (dayOrder !== 0) return dayOrder;
  if (a.all_day !== b.all_day) return a.all_day ? 1 : -1;
  if (!a.all_day) {
    const aMs = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
    const bMs = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
    if (aMs !== bMs) return aMs - bMs;
  }
  return a.priority - b.priority || byPosition(a, b);
}

/** Sorts highest priority first (P1 → P4), then earliest due date, then manual order. */
export function byPriority(a: Task, b: Task): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return bySchedule(a, b);
}

/** Sorts alphabetically using Korean-aware collation. */
export function byTitle(a: Task, b: Task): number {
  return a.title.localeCompare(b.title, 'ko') || byPosition(a, b);
}

/** Create, rename, or delete a section inside a project; deleting clears task section links on the server. */
export function useSectionActions() {
  const create = useMutation<Section, Error, SectionInput>({ mutationKey: writes.createSection, scope });
  const rename = useMutation<Section, Error, UpdateSectionVars>({ mutationKey: writes.updateSection, scope });
  const remove = useMutation<void, Error, string>({ mutationKey: writes.deleteSection, scope });
  return {
    create: (projectId: string, name: string, position?: number, onSuccess?: (section: Section) => void) =>
      create.mutate({ project_id: projectId, name, ...(position !== undefined ? { position } : {}) }, { onSuccess }),
    rename: (id: string, name: string) => rename.mutate({ id, patch: { name } }),
    remove: (id: string) => remove.mutate(id),
    creating: create.isPending,
  };
}

/** Create, rename, or delete a project; deleting cascades to its tasks on the server. */
export function useProjectActions() {
  const create = useMutation<Project, Error, string>({ mutationKey: writes.createProject, scope });
  const rename = useMutation<Project, Error, RenameVars>({ mutationKey: writes.updateProject, scope });
  const remove = useMutation<void, Error, string>({ mutationKey: writes.deleteProject, scope });
  return {
    create: (name: string, onSuccess?: (project: Project) => void) => create.mutate(name, { onSuccess }),
    rename: (id: string, name: string) => rename.mutate({ id, name }),
    remove: (id: string) => remove.mutate(id),
    creating: create.isPending,
  };
}

/** Create, rename, or delete a tag; deleting removes its links from tasks on the server. */
export function useTagActions() {
  const create = useMutation<Tag, Error, string>({ mutationKey: writes.createTag, scope });
  const rename = useMutation<Tag, Error, RenameVars>({ mutationKey: writes.updateTag, scope });
  const remove = useMutation<void, Error, string>({ mutationKey: writes.deleteTag, scope });
  return {
    create: (name: string, onSuccess?: (tag: Tag) => void) => create.mutate(name, { onSuccess }),
    rename: (id: string, name: string) => rename.mutate({ id, name }),
    remove: (id: string) => remove.mutate(id),
  };
}

export interface TaskIndex {
  tasks: Task[];
  byId: Map<string, Task>;
  children: Map<string, Task[]>;
  /** Top-level tasks; subtasks are shown beneath their parent. */
  roots: Task[];
}

export function useTaskIndex(): TaskIndex & { isLoading: boolean; isError: boolean; refetch: () => Promise<unknown> } {
  const { data, isLoading, isError, refetch } = useTasks();
  const index = useMemo<TaskIndex>(() => {
    const tasks = data ?? [];
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const children = new Map<string, Task[]>();
    const roots: Task[] = [];
    for (const task of tasks) {
      // Promote subtasks whose parent is no longer open (e.g. parent completed) so they never vanish silently.
      if (!task.parent_task_id || !byId.has(task.parent_task_id)) roots.push(task);
      else children.set(task.parent_task_id, [...(children.get(task.parent_task_id) ?? []), task]);
    }
    children.forEach((list) => list.sort(byPosition));
    return { tasks, byId, children, roots };
  }, [data]);
  return { ...index, isLoading, isError, refetch };
}

/** Direct completed subtasks grouped by parent task ID, plus per-parent open/completed progress counters. */
export function useSubtaskProgress() {
  const { children } = useTaskIndex();
  const { data: completed } = useCompletedTasks();
  return useMemo(() => {
    const completedChildren = new Map<string, Task[]>();
    for (const task of completed ?? []) {
      if (!task.parent_task_id) continue;
      completedChildren.set(task.parent_task_id, [...(completedChildren.get(task.parent_task_id) ?? []), task]);
    }
    completedChildren.forEach((list) => list.sort(byPosition));

    const progress = new Map<string, SubtaskProgress>();
    const parentIds = new Set<string>([...children.keys(), ...completedChildren.keys()]);
    for (const parentId of parentIds) {
      const openCount = children.get(parentId)?.length ?? 0;
      const doneCount = completedChildren.get(parentId)?.length ?? 0;
      const total = openCount + doneCount;
      if (total > 0) progress.set(parentId, { open: openCount, completed: doneCount, total });
    }
    return { completedChildren, progress };
  }, [children, completed]);
}

/** Tag names per task, for list rows. */
export function useTagNames(): Map<string, string[]> {
  const { data: tags } = useTags();
  const { data: links } = useTaskTags();
  return useMemo(() => {
    const names = new Map((tags ?? []).map((tag) => [tag.id, tag.name]));
    const result = new Map<string, string[]>();
    for (const link of links ?? []) {
      const name = names.get(link.tag_id);
      if (name) result.set(link.task_id, [...(result.get(link.task_id) ?? []), name]);
    }
    return result;
  }, [tags, links]);
}

/** The position that places a new task after its siblings. */
export function nextPosition(siblings: Task[]): number {
  return siblings.reduce((max, task) => Math.max(max, task.position), 0) + 1024;
}

export function useTaskActions() {
  // `mutate` keeps its identity across renders, so the returned actions do too and memoized rows stay put.
  const { mutate: create } = useMutation<Task, Error, CreateTaskVars>({ mutationKey: writes.createTask });
  const { mutate: update } = useMutation<Task, Error, UpdateTaskVars>({ mutationKey: writes.updateTask });
  const { mutate: complete } = useMutation<unknown, Error, CompleteTaskVars>({ mutationKey: writes.completeTask });
  const { mutate: reopen } = useMutation<Task, Error, Task>({ mutationKey: writes.reopenTask });
  const { mutate: remove } = useMutation<void, Error, string>({ mutationKey: writes.deleteTask });
  const { mutate: reorder } = useMutation<void, Error, ReorderVars>({ mutationKey: writes.reorderTasks });
  const { mutate: rescheduleOverdue } = useMutation<unknown, Error, void>({ mutationKey: writes.rescheduleOverdue });
  const { mutate: setTags } = useMutation<void, Error, SetTaskTagsVars>({ mutationKey: writes.setTaskTags });
  return useMemo(() => ({
    create: (vars: Omit<CreateTaskVars, 'id'>) => {
      const id = uuid();
      create({ ...vars, id });
      return id;
    },
    update: (id: string, patch: TaskPatch) => update({ id, patch }),
    complete: (task: Task) => complete({
      id: task.id, request_id: uuid(), expected_updated_at: task.updated_at, occurrence_due_at: task.due_at,
    }),
    reopen: (task: Task) => reopen(task),
    remove: (id: string) => remove(id),
    reorder: (vars: ReorderVars) => reorder(vars),
    rescheduleOverdue: () => rescheduleOverdue(),
    setTags: (vars: SetTaskTagsVars) => setTags(vars),
  }), [create, update, complete, reopen, remove, reorder, rescheduleOverdue, setTags]);
}
