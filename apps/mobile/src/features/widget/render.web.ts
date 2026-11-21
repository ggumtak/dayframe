import type { Task } from '@/lib/shared';

import type { WidgetFocus, WidgetHabit } from './items';

// Home-screen widgets exist only on Android.
export async function redrawWidgets(): Promise<void> {}
export async function saveWidget(_tasks: Task[] | null, _extra?: { habits?: WidgetHabit[]; focus?: WidgetFocus | null }): Promise<void> {}
export async function widgetTaskChanged(_taskId: string, _task: Task | null): Promise<void> {}
export async function pinWidget(_widgetName?: string): Promise<boolean> { return false; }
