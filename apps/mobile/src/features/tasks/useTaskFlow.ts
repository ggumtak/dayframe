import { useCallback } from 'react';

import { queryClient } from '@/data/client';
import { keys } from '@/data/keys';
import { hideTasks, nextDueAfterComplete, unhideTasks, useTaskActions, withDescendants } from '@/data/tasks';
import { dueMinutes, formatDue, instantFor, type PlainDate, sameInstant, today } from '@/lib/dates';
import type { Task, TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';

/** Formats minutes past midnight as `HH:MM:00` for `recurrence_local_time`. */
export function localTimeString(minutes: number): string {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0') + ':00';
}

/** The schedule fields for moving a task to `date`, keeping or updating its time of day. A null date clears the schedule. */
export function schedulePatch(task: Task, date: PlainDate | null, minutes: number | null | undefined = undefined): TaskPatch {
  if (!date) return { due_at: null, all_day: false, recurrence_rule: null, recurrence_local_time: null };
  const time = minutes === undefined ? dueMinutes(task) : minutes;
  const all_day = time === null;
  const patch: TaskPatch = { due_at: instantFor(date, time, task.timezone), all_day };
  if (task.recurrence_rule) patch.recurrence_local_time = all_day ? null : localTimeString(time);
  return patch;
}

/** Task gestures with their feedback: completion and deletion can both be undone from the toast. */
export function useTaskFlow() {
  const actions = useTaskActions();

  const complete = useCallback((task: Task) => {
    actions.complete(task);
    if (!task.recurrence_rule) {
      showToast('완료했습니다.', { actionLabel: '실행 취소', onAction: () => actions.reopen(task) });
      return;
    }
    const next = nextDueAfterComplete(task);
    const when = next ? formatDue({ due_at: next, timezone: task.timezone, all_day: task.all_day }) : null;
    showToast(when ? `다음 일정: ${when}` : '완료했습니다. 다음 일정으로 넘어갑니다.', {
      actionLabel: '실행 취소',
      // A repeating task has no completed state to reopen; undo moves it back to the occurrence it was on.
      onAction: () => {
        const current = queryClient.getQueryData<Task[]>(keys.tasks)?.find((item) => item.id === task.id);
        if (!task.due_at || !current?.due_at || sameInstant(current.due_at, task.due_at)) return;
        actions.update(task.id, { due_at: task.due_at, expected_due_at: current.due_at, preserve_recurrence: true });
      },
    });
  }, [actions]);

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

  const reschedule = useCallback((task: Task, date: PlainDate | null, minutes?: number | null) => {
    const currentMinutes = dueMinutes(task);
    const timeChanged = minutes !== undefined && minutes !== currentMinutes;
    if (date && task.recurrence_rule && task.due_at && !timeChanged) {
      const due_at = task.recurrence_local_time
        ? date.toZonedDateTime({ timeZone: task.timezone, plainTime: task.recurrence_local_time }).toInstant().toString()
        : instantFor(date, currentMinutes, task.timezone);
      actions.update(task.id, { due_at, expected_due_at: task.due_at, preserve_recurrence: true });
    } else actions.update(task.id, schedulePatch(task, date, minutes));
  }, [actions]);

  const postpone = useCallback((task: Task) => {
    reschedule(task, today(task.timezone).add({ days: 1 }));
    showToast('내일로 옮겼습니다.');
  }, [reschedule]);

  return { ...actions, complete, remove, reschedule, postpone };
}
