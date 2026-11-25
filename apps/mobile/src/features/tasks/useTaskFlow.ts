import { useCallback } from 'react';

import { queryClient } from '@/data/client';
import { keys } from '@/data/keys';
import { hideTasks, nextDueAfterComplete, nextPosition, unhideTasks, useTaskActions, withDescendants } from '@/data/tasks';
import { getPersonalPrefs } from '@/features/settings/prefsStore';
import { dueMinutes, formatDue, instantFor, type PlainDate, sameInstant, Temporal, today } from '@/lib/dates';
import { josa } from '@/lib/josa';
import { nextOccurrence, occurrenceFloor, type Task, type TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';

/** Formats minutes past midnight as `HH:MM:00` for `recurrence_local_time`. */
export function localTimeString(minutes: number): string {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0') + ':00';
}

/** The schedule fields for moving a task to `date`, keeping or updating its time of day. A null date clears the schedule. */
export function schedulePatch(task: Task, date: PlainDate | null, minutes: number | null | undefined = undefined): TaskPatch {
  if (!date) return { due_at: null, all_day: false, recurrence_rule: null, recurrence_mode: 'schedule', recurrence_local_time: null };
  const time = minutes === undefined ? dueMinutes(task) : minutes;
  const all_day = time === null;
  const patch: TaskPatch = { due_at: instantFor(date, time, task.timezone), all_day };
  if (task.recurrence_rule) patch.recurrence_local_time = all_day ? null : localTimeString(time);
  return patch;
}

/** Formats a task and its subtasks as a Markdown checklist for sharing. */
export function toMarkdownChecklist(task: Task, openSubtasks: Task[], completedSubtasks: Task[] = []): string {
  const lines = [`- [${task.completed_at ? 'x' : ' '}] ${task.title}`];
  if (task.notes?.trim()) {
    for (const line of task.notes.trim().split('\n')) lines.push(`  ${line}`);
  }
  for (const sub of openSubtasks) lines.push(`  - [ ] ${sub.title}`);
  for (const sub of completedSubtasks) lines.push(`  - [x] ${sub.title}`);
  return lines.join('\n');
}

export interface RescheduleOptions {
  durationMinutes?: number | null;
  toastMessage?: string;
}

/** Task gestures with their feedback: completion (including repeats), rescheduling, skipping, and deletion can be undone from the toast. */
export function useTaskFlow() {
  const actions = useTaskActions();

  /**
   * Takes back a completion. A one-off task is reopened; a repeating task has no completed state, so it
   * moves back to the occurrence that was checked off.
   */
  const uncomplete = useCallback((task: Task, occurrenceDueAt: string | null) => {
    if (!task.recurrence_rule) {
      actions.reopen(task);
      return;
    }
    const current = queryClient.getQueryData<Task[]>(keys.tasks)?.find((item) => item.id === task.id);
    if (!occurrenceDueAt || !current?.due_at || sameInstant(current.due_at, occurrenceDueAt)) return;
    actions.update(task.id, { due_at: occurrenceDueAt, expected_due_at: current.due_at, preserve_recurrence: true });
  }, [actions]);

  const complete = useCallback((task: Task) => {
    const completedChildren = (queryClient.getQueryData<Task[]>(keys.completedTasks) ?? [])
      .filter((item) => item.parent_task_id === task.id);
    actions.complete(task);
    if (task.recurrence_rule) {
      // Recurring checklists (e.g. weekly packing/review) automatically reset completed subtasks for the next cycle.
      for (const child of completedChildren) actions.reopen(child);
    }
    const next = nextDueAfterComplete(task);
    const when = next ? formatDue({ due_at: next, timezone: task.timezone, all_day: task.all_day }, getPersonalPrefs().timeFormat) : null;
    const message = !task.recurrence_rule
      ? '완료했습니다.'
      : completedChildren.length > 0
        ? (when ? `다음 일정: ${when} · 하위 작업 ${completedChildren.length}개 초기화` : `완료했습니다. 하위 작업 ${completedChildren.length}개를 초기화했습니다.`)
        : (when ? `다음 일정: ${when}` : '완료했습니다. 다음 일정으로 넘어갑니다.');
    showToast(message, {
      actionLabel: '실행 취소', onAction: () => uncomplete(task, task.due_at),
    });
  }, [actions, uncomplete]);

  const remove = useCallback((task: Task) => {
    // Hide now, delete when the toast leaves, so "undo" never has to recreate anything.
    const ids = [...withDescendants(queryClient.getQueryData<Task[]>(keys.tasks) ?? [], task.id)];
    hideTasks(ids);
    showToast(ids.length > 1 ? `하위 작업 ${ids.length - 1}개와 함께 삭제했습니다.` : '삭제했습니다.', {
      actionLabel: '실행 취소',
      onAction: () => unhideTasks(ids),
      onDismiss: () => actions.remove(task.id),
    });
  }, [actions]);

  const reschedule = useCallback((task: Task, date: PlainDate | null, minutes?: number | null, options?: RescheduleOptions) => {
    const previousSnapshot = {
      due_at: task.due_at,
      all_day: task.all_day,
      recurrence_rule: task.recurrence_rule,
      recurrence_mode: task.recurrence_mode,
      recurrence_local_time: task.recurrence_local_time,
      occurrence_at: task.occurrence_at,
      duration_minutes: task.duration_minutes,
    };
    const durationChanged = options?.durationMinutes !== undefined && options.durationMinutes !== task.duration_minutes;
    const currentMinutes = dueMinutes(task);
    const timeChanged = minutes !== undefined && minutes !== currentMinutes;

    let movedDueAt: string | null = null;
    let movedAllDay = task.all_day;
    let usedPreserve = false;

    if (date && task.recurrence_rule && task.due_at && !timeChanged) {
      usedPreserve = true;
      movedDueAt = task.recurrence_local_time
        ? date.toZonedDateTime({ timeZone: task.timezone, plainTime: task.recurrence_local_time }).toInstant().toString()
        : instantFor(date, currentMinutes, task.timezone);
      movedAllDay = currentMinutes === null;
      actions.update(task.id, { due_at: movedDueAt, expected_due_at: task.due_at, preserve_recurrence: true });
      if (durationChanged) {
        actions.update(task.id, { duration_minutes: options?.durationMinutes ?? null });
      }
    } else {
      const nextPatch = schedulePatch(task, date, minutes);
      if (!('preserve_recurrence' in nextPatch) && durationChanged) {
        nextPatch.duration_minutes = options?.durationMinutes ?? null;
      }
      movedDueAt = 'due_at' in nextPatch ? (nextPatch.due_at ?? null) : null;
      movedAllDay = 'all_day' in nextPatch ? !!nextPatch.all_day : false;
      actions.update(task.id, nextPatch);
    }

    const undo = () => {
      if (usedPreserve && previousSnapshot.due_at) {
        const current = queryClient.getQueryData<Task[]>(keys.tasks)?.find((item) => item.id === task.id);
        actions.update(task.id, {
          due_at: previousSnapshot.due_at,
          expected_due_at: current?.due_at ?? movedDueAt ?? previousSnapshot.due_at,
          preserve_recurrence: true,
        });
        if (durationChanged) {
          actions.update(task.id, { duration_minutes: previousSnapshot.duration_minutes });
        }
        return;
      }
      const revertPatch: TaskPatch = {
        due_at: previousSnapshot.due_at,
        all_day: previousSnapshot.all_day,
        recurrence_rule: previousSnapshot.recurrence_rule,
        recurrence_mode: previousSnapshot.recurrence_mode,
        recurrence_local_time: previousSnapshot.recurrence_local_time,
        ...(durationChanged ? { duration_minutes: previousSnapshot.duration_minutes } : {}),
      };
      actions.update(task.id, revertPatch);
      if (previousSnapshot.occurrence_at) {
        queryClient.setQueryData<Task[]>(keys.tasks, (list) => list?.map((item) => (
          item.id === task.id ? { ...item, occurrence_at: previousSnapshot.occurrence_at } : item
        )));
      }
    };

    if (options?.toastMessage) {
      showToast(options.toastMessage, { actionLabel: '실행 취소', onAction: undo });
      return;
    }

    if (!date) {
      if (previousSnapshot.due_at || durationChanged) {
        showToast(previousSnapshot.due_at ? '일정을 지웠습니다.' : '소요 시간을 바꿨습니다.', {
          actionLabel: '실행 취소',
          onAction: undo,
        });
      }
      return;
    }

    const when = movedDueAt
      ? formatDue({ due_at: movedDueAt, timezone: task.timezone, all_day: movedAllDay }, getPersonalPrefs().timeFormat)
      : null;
    showToast(when ? `일정을 ‘${when}’${josa(when, '으로/로')} 바꿨습니다.` : '일정을 바꿨습니다.', {
      actionLabel: '실행 취소',
      onAction: undo,
    });
  }, [actions]);

  const postpone = useCallback((task: Task) => {
    reschedule(task, today(task.timezone).add({ days: 1 }), undefined, { toastMessage: '내일로 옮겼습니다.' });
  }, [reschedule]);

  const skipOccurrence = useCallback((task: Task) => {
    if (!task.recurrence_rule || !task.due_at) return;
    const anchorAt = task.recurrence_anchor_at ?? task.due_at;
    let nextDueAt: string;
    try {
      const mode = task.recurrence_mode ?? 'schedule';
      const floor = occurrenceFloor(task, Temporal.Now.instant());
      nextDueAt = nextOccurrence(
        task.recurrence_rule,
        task.timezone,
        anchorAt,
        floor,
        task.all_day,
        task.recurrence_local_time,
        mode,
      );
    } catch {
      return;
    }
    const previousDueAt = task.due_at;
    const previousOccurrenceAt = task.occurrence_at;
    actions.update(task.id, {
      due_at: nextDueAt,
      expected_due_at: previousDueAt,
      preserve_recurrence: true,
    });
    const when = formatDue({ due_at: nextDueAt, timezone: task.timezone, all_day: task.all_day }, getPersonalPrefs().timeFormat);
    showToast(when ? `이번 반복을 건너뛰었습니다 · 다음: ${when}` : '이번 반복을 건너뛰었습니다', {
      actionLabel: '실행 취소',
      onAction: () => {
        const current = queryClient.getQueryData<Task[]>(keys.tasks)?.find((item) => item.id === task.id);
        actions.update(task.id, {
          due_at: previousDueAt,
          expected_due_at: current?.due_at ?? nextDueAt,
          preserve_recurrence: true,
        });
        if (previousOccurrenceAt) {
          queryClient.setQueryData<Task[]>(keys.tasks, (list) => list?.map((item) => (
            item.id === task.id ? { ...item, occurrence_at: previousOccurrenceAt } : item
          )));
        }
      },
    });
  }, [actions]);

  const duplicate = useCallback((task: Task, options: { openSubtasks?: Task[]; completedSubtasks?: Task[]; tagNames?: string[] } = {}) => {
    const allOpen = queryClient.getQueryData<Task[]>(keys.tasks) ?? [];
    const siblings = allOpen.filter((item) => (task.parent_task_id
      ? item.parent_task_id === task.parent_task_id
      : !item.parent_task_id && item.project_id === task.project_id));
    const newId = actions.create({
      input: {
        title: task.title,
        notes: task.notes,
        priority: task.priority,
        timezone: task.timezone,
        position: nextPosition(siblings),
        ...(task.parent_task_id ? { parent_task_id: task.parent_task_id } : {
          ...(task.project_id ? { project_id: task.project_id } : {}),
          ...(task.section_id ? { section_id: task.section_id } : {}),
        }),
        ...(task.due_at ? { due_at: task.due_at, all_day: task.all_day } : {}),
        ...(task.recurrence_rule ? { recurrence_rule: task.recurrence_rule, recurrence_mode: task.recurrence_mode } : {}),
        ...(task.recurrence_local_time ? { recurrence_local_time: task.recurrence_local_time } : {}),
        ...(task.duration_minutes ? { duration_minutes: task.duration_minutes } : {}),
      },
      tagNames: options.tagNames,
    });
    const allChildren = [...(options.openSubtasks ?? []), ...(options.completedSubtasks ?? [])];
    allChildren.forEach((child, index) => {
      actions.create({
        input: {
          title: child.title,
          notes: child.notes,
          priority: child.priority,
          timezone: child.timezone,
          position: (index + 1) * 1024,
          parent_task_id: newId,
        },
      });
    });
    showToast(allChildren.length
      ? `‘${task.title}’${josa(task.title, '와/과')} 하위 작업 ${allChildren.length}개를 복제했습니다.`
      : `‘${task.title}’${josa(task.title, '을/를')} 복제했습니다.`);
    return newId;
  }, [actions]);

  const resetChecklist = useCallback((completedSubtasks: Task[]) => {
    if (!completedSubtasks.length) return;
    for (const sub of completedSubtasks) actions.reopen(sub);
    showToast(`완료한 하위 작업 ${completedSubtasks.length}개의 체크를 해제했습니다.`);
  }, [actions]);

  return { ...actions, complete, uncomplete, remove, reschedule, postpone, skipOccurrence, duplicate, resetChecklist };
}
