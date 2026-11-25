import type { Task } from '@/lib/shared';

import type { WidgetDoneToday, WidgetFocus, WidgetHabit, WidgetSnapshot } from './items';

// Home-screen widgets exist only on Android.
export async function redrawWidgets(_snapshot?: WidgetSnapshot): Promise<void> {}
export async function saveWidget(
  _tasks: Task[] | null,
  _extra?: {
    habits?: WidgetHabit[];
    focus?: WidgetFocus | null;
    calendar?: Record<string, number>;
    doneToday?: WidgetDoneToday;
    projectName?: (task: { id: string; project_id?: string | null }) => string | undefined;
    subtaskLabel?: (taskId: string) => string | undefined;
  },
): Promise<void> {}
export async function widgetTaskChanged(_taskId: string, _task: Task | null, _options?: { completed?: boolean }): Promise<void> {}
export async function widgetHabitChanged(_habitId: string, _date: string, _todayCount: number, _progress: number): Promise<void> {}
