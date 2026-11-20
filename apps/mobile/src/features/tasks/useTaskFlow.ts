import { useCallback } from 'react';

import { queryClient } from '@/data/client';
import { keys } from '@/data/keys';
import { hideTasks, unhideTasks, useTaskActions, withDescendants } from '@/data/tasks';
import { dueMinutes, instantFor, type PlainDate, today } from '@/lib/dates';
import type { Task, TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';

/** The schedule fields for moving a task to `date`, keeping its time of day. A null date clears the schedule. */
export function schedulePatch(task: Task, date: PlainDate | null, minutes: number | null | undefined = undefined): TaskPatch {
  if (!date) return { due_at: null, all_day: false, recurrence_rule: null };
  const time = minutes === undefined ? dueMinutes(task) : minutes;
  return { due_at: instantFor(date, time, task.timezone), all_day: time === null };
}

/** Task gestures with their feedback: completion and deletion can both be undone from the toast. */
export function useTaskFlow() {
  const actions = useTaskActions();

  const complete = useCallback((task: Task) => {
    actions.complete(task);
    if (task.recurrence_rule) showToast('완료했습니다. 다음 일정으로 넘어갑니다.');
    else showToast('완료했습니다.', { actionLabel: '실행 취소', onAction: () => actions.reopen(task) });
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

  const reschedule = useCallback((task: Task, date: PlainDate | null) => {
    actions.update(task.id, schedulePatch(task, date));
  }, [actions]);

  const postpone = useCallback((task: Task) => {
    reschedule(task, today(task.timezone).add({ days: 1 }));
    showToast('내일로 옮겼습니다.');
  }, [reschedule]);

  return { ...actions, complete, remove, reschedule, postpone };
}
