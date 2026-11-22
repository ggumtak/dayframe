import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';

import { api, ApiFailure } from '@/lib/api';
import { deviceTimeZone, dueBucket, dueMinutes, instantFor, sameInstant, Temporal, today } from '@/lib/dates';
import { uuid } from '@/lib/ids';
import { movedOccurrenceSlot, nextOccurrence, occurrenceFloor, type Project, type Tag, type Task, type TaskInput, type TaskPatch, type TaskTag, type User } from '@/lib/shared';

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
      recurrence_anchor_at: input.recurrence_rule ? input.due_at ?? null : null,
      recurrence_local_time: input.recurrence_local_time ?? null, occurrence_at: null,
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
    return nextOccurrence(task.recurrence_rule, task.timezone, task.recurrence_anchor_at,
      occurrenceFloor(task, Temporal.Now.instant()), task.all_day, task.recurrence_local_time);
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
    await hold(keys.tasks);
    editTasks((tasks) => tasks.flatMap((task) => {
      if (task.id !== vars.id) return [task];
      if (!task.recurrence_rule || !task.recurrence_anchor_at) return [];
      const due_at = nextDueAfterComplete(task);
      return due_at ? [{ ...task, due_at, occurrence_at: null }] : [task];
    }));
  },
  onSettled: () => settle(keys.tasks, keys.completedTasks),
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
  onSettled: () => settle(keys.tasks, keys.completedTasks),
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

queryClient.setMutationDefaults(writes.rescheduleOverdue, {
  scope,
  mutationFn: () => api.rescheduleOverdue(),
  onMutate: async () => {
    await hold(keys.tasks);
    // Mirrors the server: keep each task's wall time and move only its date.
    editTasks((tasks) => tasks.map((task) => (dueBucket(task) === 'overdue'
      ? { ...task, due_at: instantFor(today(task.timezone), dueMinutes(task), task.timezone) }
      : task)));
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

/** Creates the tag if needed and attaches it. Needs a connection, since a new tag has no ID to queue against. */
export async function attachTagByName(taskId: string, name: string): Promise<void> {
  const tag = await ensureTag(name);
  await api.attachTag(taskId, tag.id);
  await refresh(keys.tags, keys.taskTags);
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
export const useTags = () => useQuery({ queryKey: keys.tags, queryFn: api.tags });
export const useTaskTags = () => useQuery({ queryKey: keys.taskTags, queryFn: api.taskTags });

export const byPosition = (a: Task, b: Task) => a.position - b.position || (a.id < b.id ? -1 : 1);

/** Sorts scheduled work the way a day is read: timed items in order, then by priority. */
export function bySchedule(a: Task, b: Task): number {
  const [left, right] = [a.due_at ?? '', b.due_at ?? ''];
  if (left !== right) {
    if (!left) return 1;
    if (!right) return -1;
    return left < right ? -1 : 1;
  }
  return a.priority - b.priority || byPosition(a, b);
}

/** Sorts highest priority first (P1 → P4), then earliest due date, then manual order. */
export function byPriority(a: Task, b: Task): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return bySchedule(a, b);
}

/** Create, rename, or delete a project; deleting cascades to its tasks on the server. */
export function useProjectActions() {
  const create = useMutation({
    mutationFn: (name: string) => api.createProject({ name }),
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(keys.projects, (list) => [...(list ?? []).filter((item) => item.id !== project.id), project]);
    },
    onSettled: () => settle(keys.projects),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.updateProject(id, { name }),
    onMutate: async ({ id, name }) => {
      await hold(keys.projects);
      queryClient.setQueryData<Project[]>(keys.projects, (list) => list?.map((project) => (project.id === id ? { ...project, name } : project)));
    },
    onSettled: () => settle(keys.projects),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onMutate: async (id) => {
      await hold(keys.projects, keys.tasks);
      queryClient.setQueryData<Project[]>(keys.projects, (list) => list?.filter((project) => project.id !== id));
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
    onSettled: () => settle(keys.projects, keys.tasks, keys.taskTags, keys.completedTasks),
  });
  return {
    create: (name: string, onSuccess?: (project: Project) => void) => create.mutate(name, { onSuccess }),
    rename: (id: string, name: string) => rename.mutate({ id, name }),
    remove: (id: string) => remove.mutate(id),
    creating: create.isPending,
  };
}

/** Rename or delete a tag; deleting removes its links from tasks on the server. */
export function useTagActions() {
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.updateTag(id, name),
    onMutate: async ({ id, name }) => {
      await hold(keys.tags);
      queryClient.setQueryData<Tag[]>(keys.tags, (list) => list?.map((tag) => (tag.id === id ? { ...tag, name } : tag)));
    },
    onSettled: () => settle(keys.tags),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onMutate: async (id) => {
      await hold(keys.tags, keys.taskTags);
      queryClient.setQueryData<Tag[]>(keys.tags, (list) => list?.filter((tag) => tag.id !== id));
      queryClient.setQueryData<TaskTag[]>(keys.taskTags, (links) => links?.filter((link) => link.tag_id !== id));
    },
    onSettled: () => settle(keys.tags, keys.taskTags),
  });
  return {
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
      if (!task.parent_task_id) roots.push(task);
      else children.set(task.parent_task_id, [...(children.get(task.parent_task_id) ?? []), task]);
    }
    children.forEach((list) => list.sort(byPosition));
    return { tasks, byId, children, roots };
  }, [data]);
  return { ...index, isLoading, isError, refetch };
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
