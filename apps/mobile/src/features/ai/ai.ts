import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager, useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { queryClient } from '@/data/client';
import { keys } from '@/data/keys';
import { runSetTaskTags, runUpdateTask } from '@/data/tasks';
import { api, errorMessage } from '@/lib/api';
import { deviceTimeZone, formatMinutes, today } from '@/lib/dates';
import { usePersistentState } from '@/lib/persist';
import type { AiPlan, Project, Tag, Task, TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';

/** True once the server reports an AI key. Until then every AI control stays out of sight. */
export function useAiAvailable(): boolean {
  const { data } = useQuery({ queryKey: keys.aiStatus, queryFn: api.aiStatus, staleTime: 10 * 60_000, retry: false });
  return data?.available === true;
}

// ---- Filing a new task

/** What happens with the AI's idea of where a new task belongs: nothing, an offer, or applied with an undo. */
export type FilingMode = 'off' | 'suggest' | 'auto';
const isFilingMode = (value: string): value is FilingMode => value === 'off' || value === 'suggest' || value === 'auto';
export const useFilingMode = () => usePersistentState<FilingMode>('dayframe-ai-filing', 'suggest', isFilingMode);

/** An offer (or a done deed with an undo) about one task, shown where the person is looking. */
export interface FilingNotice { id: number; taskId: string; text: string; actionLabel: string; onAction: () => void }
type NoticeListener = (notice: FilingNotice) => void;
const noticeListeners = new Set<NoticeListener>();
let noticeCount = 0;
/** The open entry sheet shows notices inline, above the keyboard; without it they arrive as a toast. */
export function onFilingNotice(listener: NoticeListener): () => void {
  noticeListeners.add(listener);
  return () => { noticeListeners.delete(listener); };
}
function announce(notice: Omit<FilingNotice, 'id'>) {
  if (noticeListeners.size) noticeListeners.forEach((listener) => listener({ ...notice, id: ++noticeCount }));
  else showToast(notice.text, { actionLabel: notice.actionLabel, onAction: notice.onAction });
}

/**
 * Asks where a task that was just added belongs and fills in only what the person left open. Anything they
 * typed (a #project, a priority, a length) is theirs and is never overridden. Failures are silent: the task
 * is already saved exactly as written.
 */
export async function fileNewTask(mode: FilingMode, task: {
  id: string; title: string; notes?: string | null;
  hasProject: boolean; hasTags: boolean; hasPriority: boolean; hasDuration: boolean;
}): Promise<void> {
  if (mode === 'off' || !onlineManager.isOnline()) return;
  let found;
  try {
    found = await api.aiClassify({ title: task.title, notes: task.notes ?? null });
  } catch {
    return;
  }
  const projects = queryClient.getQueryData<Project[]>(keys.projects) ?? [];
  const tags = queryClient.getQueryData<Tag[]>(keys.tags) ?? [];
  const project = task.hasProject ? undefined : projects.find((item) => item.id === found.project_id);
  const newTags = task.hasTags ? [] : tags.filter((tag) => found.tag_ids.includes(tag.id));
  const priority = task.hasPriority ? null : found.priority;
  const minutes = task.hasDuration ? null : found.duration_minutes;
  const parts = [
    project ? '#' + project.name : null, ...newTags.map((tag) => '@' + tag.name),
    priority ? 'P' + priority : null, minutes ? formatMinutes(minutes * 60) : null,
  ].filter(Boolean);
  if (!parts.length) return;

  const patch: TaskPatch = {
    ...(project ? { project_id: project.id, section_id: null } : {}),
    ...(priority ? { priority } : {}),
    ...(minutes ? { duration_minutes: minutes } : {}),
  };
  const back: TaskPatch = {
    ...(project ? { project_id: null, section_id: null } : {}),
    ...(priority ? { priority: 4 as const } : {}),
    ...(minutes ? { duration_minutes: null } : {}),
  };
  const tagIds = newTags.map((tag) => tag.id);
  const change = (fields: TaskPatch, attach: string[], detach: string[]) => {
    // The task may have been completed or deleted in the meantime; then there is nothing to file.
    if (!queryClient.getQueryData<Task[]>(keys.tasks)?.some((item) => item.id === task.id)) return;
    if (Object.keys(fields).length) runUpdateTask({ id: task.id, patch: fields });
    if (attach.length || detach.length) runSetTaskTags({ taskId: task.id, attach, detach });
  };
  const summary = parts.join(' · ');
  if (mode === 'auto') {
    change(patch, tagIds, []);
    announce({ taskId: task.id, text: `‘${task.title}’ → ${summary}`, actionLabel: '되돌리기', onAction: () => change(back, [], tagIds) });
  } else {
    announce({ taskId: task.id, text: `‘${task.title}’ → ${summary}`, actionLabel: '적용', onAction: () => change(patch, tagIds, []) });
  }
}

// ---- Ordering today

/** The order the AI suggested for one day's tasks. It is advice kept on the device; no task is changed by it. */
export interface TodayPlan extends AiPlan { date: string }
const PLAN_KEY = 'dayframe-ai-today-plan';
let plan: TodayPlan | null = null;
let planLoaded = false;
const planListeners = new Set<() => void>();
const setPlan = (next: TodayPlan | null) => {
  plan = next;
  planListeners.forEach((listener) => listener());
};

function loadPlan() {
  if (planLoaded) return;
  planLoaded = true;
  AsyncStorage.getItem(PLAN_KEY).then((stored) => {
    if (!stored || plan) return;
    const saved = JSON.parse(stored) as TodayPlan;
    if (saved && typeof saved.date === 'string' && Array.isArray(saved.order)) setPlan(saved);
  }).catch(() => {});
}

/** Today's stored plan, or null when there is none or it was made for another day. */
export function useTodayPlan(): TodayPlan | null {
  const current = useSyncExternalStore((listener) => {
    planListeners.add(listener);
    loadPlan();
    return () => { planListeners.delete(listener); };
  }, () => plan, () => plan);
  return current && current.date === today(deviceTimeZone()).toString() ? current : null;
}

/** Asks for an order for these tasks and keeps it for the rest of the day. Throws a message fit to show. */
export async function requestTodayPlan(taskIds: string[]): Promise<TodayPlan> {
  let result: AiPlan;
  try {
    result = await api.aiPlanToday(taskIds);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
  const next = { ...result, date: today(deviceTimeZone()).toString() };
  setPlan(next);
  AsyncStorage.setItem(PLAN_KEY, JSON.stringify(next)).catch(() => {});
  return next;
}

/** Sorts by the plan's order; tasks the plan has not seen (added since) keep their relative order at the end. */
export function byPlan(current: TodayPlan): (a: Task, b: Task) => number {
  const rank = new Map(current.order.map((item, index) => [item.task_id, index]));
  return (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER);
}
