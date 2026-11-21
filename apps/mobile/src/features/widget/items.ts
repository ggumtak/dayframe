import { Temporal } from '@js-temporal/polyfill';

import type { Priority, Task } from '@/lib/shared';

export type WidgetTask = Pick<Task, 'id' | 'title' | 'due_at' | 'all_day' | 'timezone' | 'priority' | 'updated_at' | 'recurrence_rule'>;

/** What the app leaves for the widget: enough to draw today's list and to complete a task without the app. */
export interface WidgetSnapshot {
  signedIn: boolean;
  tasks: WidgetTask[];
  /** A short note for the header, such as a failed completion. */
  notice?: string | null;
}

export interface WidgetRow {
  id: string;
  title: string;
  /** "오후 7:00", "어제", "11월 19일", or empty for an all-day task due today. */
  when: string;
  overdue: boolean;
  priority: Priority;
  occurrence: string;
}

const MAX_SNAPSHOT = 60;

/** Keeps overdue tasks and those due within two days, so the widget is still right after midnight. */
export function snapshotTasks(tasks: (WidgetTask & Pick<Task, 'completed_at'>)[], now: number): WidgetTask[] {
  const limit = now + 2 * 86_400_000;
  return tasks
    .filter((task) => !task.completed_at && task.due_at && Date.parse(task.due_at) <= limit)
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))
    .slice(0, MAX_SNAPSHOT)
    .map(({ id, title, due_at, all_day, timezone, priority, updated_at, recurrence_rule }) =>
      ({ id, title, due_at, all_day, timezone, priority, updated_at, recurrence_rule }));
}

/** Today's list as the widget shows it: earliest due first (so overdue days lead), then by priority. */
export function widgetRows(tasks: WidgetTask[], now: number): WidgetRow[] {
  const rows: (WidgetRow & { sort: number })[] = [];
  for (const task of tasks) {
    if (!task.due_at) continue;
    const due = Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone);
    const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(task.timezone).toPlainDate();
    const order = Temporal.PlainDate.compare(due.toPlainDate(), today);
    if (order > 0) continue;
    const timed = !task.all_day;
    const overdue = order < 0 || (timed && Date.parse(task.due_at) < now);
    const days = due.toPlainDate().until(today).days;
    const when = order < 0
      ? (days === 1 ? '어제' : due.month + '월 ' + due.day + '일')
      : timed ? clock(due.hour, due.minute) : '';
    rows.push({ id: task.id, title: task.title, when, overdue, priority: task.priority, occurrence: task.due_at, sort: Date.parse(task.due_at) });
  }
  // An all-day task is stored at the start of its day, so due order already puts earlier days first.
  return rows.sort((a, b) => a.sort - b.sort || a.priority - b.priority).map(({ sort: _sort, ...row }) => row);
}

function clock(hour: number, minute: number): string {
  return (hour < 12 ? '오전 ' : '오후 ') + (hour % 12 === 0 ? 12 : hour % 12) + ':' + String(minute).padStart(2, '0');
}

/** "11월 21일 토요일" in the device's own zone. */
export function widgetDate(now: number, timeZone: string): string {
  const date = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone);
  return date.month + '월 ' + date.day + '일 ' + '월화수목금토일'[date.dayOfWeek - 1] + '요일';
}
