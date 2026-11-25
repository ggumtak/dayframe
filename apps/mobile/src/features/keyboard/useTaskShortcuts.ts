import { router } from 'expo-router';
import { useCallback } from 'react';

import { priorityLabel } from '@/features/tasks/priority';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Priority, Task } from '@/lib/shared';
import { showToast } from '@/lib/toast';

import { useKeyHandler } from './manager';
import { matchesCombo } from './normalize';
import { type HardwareKeyEvent, KEY_PRIORITY } from './types';
import type { ListCursor } from './useListCursor';

export interface TaskShortcutOptions {
  enabled: boolean;
  priority?: number;
  selecting?: boolean;
  onToggleSelect?: (task: Task) => void;
  onStartSelect?: (task: Task) => void;
  onSchedule?: (task: Task) => void;
  onOpenMenu?: (task: Task) => void;
  onToggleSubtasks?: (task: Task) => void;
  onAddSubtask?: (task: Task) => void;
  onReorder?: (task: Task, delta: -1 | 1) => void;
  /** Optional screen-specific handler evaluated BEFORE default task shortcuts. Return `true` to consume. */
  onBefore?: (event: HardwareKeyEvent, focused: Task | null) => boolean | void;
  /** Optional screen-specific fallback evaluated AFTER default task shortcuts. Return `true` to consume. */
  onAfter?: (event: HardwareKeyEvent, focused: Task | null) => boolean | void;
}

/**
 * Shared touch-free task list keyboard shortcuts (J/K/↑↓ navigation + Enter/Space/X/S/T/W/Shift+1..4/M/E/F/V/Del).
 * Keeps Today, Inbox, Upcoming, Matrix and Search behaving identically on a Bluetooth keyboard.
 */
export function useTaskShortcuts(cursor: ListCursor<Task>, options: TaskShortcutOptions): void {
  const flow = useTaskFlow();
  const {
    enabled, priority = KEY_PRIORITY.screen, selecting = false,
    onToggleSelect, onStartSelect, onSchedule, onOpenMenu, onToggleSubtasks, onAddSubtask, onReorder,
    onBefore, onAfter,
  } = options;

  const handle = useCallback((event: HardwareKeyEvent): boolean => {
    const task = cursor.focusedItem;
    if (onBefore?.(event, task) === true) return true;
    if (event.editing) return false;

    if (matchesCombo(event, 'j') || matchesCombo(event, 'arrowdown')) {
      cursor.move(1);
      return true;
    }
    if (matchesCombo(event, 'k') || matchesCombo(event, 'arrowup')) {
      cursor.move(-1);
      return true;
    }
    if (matchesCombo(event, 'home')) {
      cursor.moveFirst();
      return true;
    }
    if (matchesCombo(event, 'shift+g') || matchesCombo(event, 'end')) {
      cursor.moveLast();
      return true;
    }

    if (task) {
      if (selecting) {
        if (matchesCombo(event, 'space') || matchesCombo(event, 'v')) {
          haptic.tap();
          onToggleSelect?.(task);
          return true;
        }
        return onAfter?.(event, task) === true;
      }

      if (onReorder) {
        if (matchesCombo(event, 'alt+arrowup')) {
          onReorder(task, -1);
          return true;
        }
        if (matchesCombo(event, 'alt+arrowdown')) {
          onReorder(task, 1);
          return true;
        }
      }

      if (matchesCombo(event, 'enter') || matchesCombo(event, 'o')) {
        router.push({ pathname: '/task/[id]', params: { id: task.id } });
        return true;
      }
      if (matchesCombo(event, 'space') || matchesCombo(event, 'x') || matchesCombo(event, 'c')) {
        haptic.success();
        flow.complete(task);
        return true;
      }
      if (matchesCombo(event, 's') || matchesCombo(event, 'd')) {
        if (onSchedule) {
          haptic.tap();
          onSchedule(task);
          return true;
        }
      }
      if (matchesCombo(event, 't')) {
        haptic.tap();
        flow.reschedule(task, today(task.timezone));
        showToast('오늘로 일정을 바꿨습니다.');
        return true;
      }
      if (matchesCombo(event, 'w')) {
        haptic.tap();
        flow.reschedule(task, today(task.timezone).add({ days: 1 }));
        showToast('내일로 일정을 바꿨습니다.');
        return true;
      }
      if (event.shift && !event.ctrl && !event.alt && !event.meta && ['1', '2', '3', '4'].includes(event.key)) {
        const nextPriority = Number(event.key) as Priority;
        haptic.tap();
        flow.update(task.id, { priority: nextPriority });
        showToast(`우선순위를 ‘${priorityLabel(nextPriority)}’으로 바꿨습니다.`);
        return true;
      }
      if (matchesCombo(event, 'm') && onOpenMenu) {
        haptic.tap();
        onOpenMenu(task);
        return true;
      }
      if ((matchesCombo(event, 'e') || matchesCombo(event, 'arrowright') || matchesCombo(event, 'arrowleft')) && onToggleSubtasks) {
        haptic.tap();
        onToggleSubtasks(task);
        return true;
      }
      if (matchesCombo(event, 'shift+s') && onAddSubtask && !task.parent_task_id) {
        haptic.tap();
        onAddSubtask(task);
        return true;
      }
      if (matchesCombo(event, 'f')) {
        haptic.tap();
        router.navigate({
          pathname: '/focus',
          params: {
            taskId: task.id,
            at: String(Date.now()),
            ...(task.duration_minutes ? { duration: String(task.duration_minutes) } : {}),
          },
        });
        return true;
      }
      if (matchesCombo(event, 'v') && onStartSelect && !task.parent_task_id) {
        haptic.tap();
        onStartSelect(task);
        return true;
      }
      if (matchesCombo(event, 'delete') || matchesCombo(event, 'backspace')) {
        haptic.warning();
        flow.remove(task);
        return true;
      }
      if (matchesCombo(event, 'escape')) {
        cursor.clear();
        return true;
      }
    }

    return onAfter?.(event, task) === true;
  }, [
    cursor, flow, onAfter, onBefore, onOpenMenu, onReorder, onSchedule,
    onStartSelect, onToggleSelect, onToggleSubtasks, onAddSubtask, selecting,
  ]);

  useKeyHandler(handle, { priority, enabled });
}
