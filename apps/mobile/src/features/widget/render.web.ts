import type { Task } from '@/lib/shared';

// Home-screen widgets exist only on Android.
export async function redrawWidgets(): Promise<void> {}
export async function saveWidget(_tasks: Task[] | null): Promise<void> {}
export async function widgetTaskChanged(_taskId: string, _task: Task | null): Promise<void> {}
export async function pinWidget(): Promise<boolean> { return false; }
