import { Temporal } from '@js-temporal/polyfill';

import type { Priority, Task } from '@/lib/shared';

export type WidgetTask = Pick<Task, 'id' | 'title' | 'due_at' | 'all_day' | 'timezone' | 'priority' | 'updated_at' | 'recurrence_rule'>;

export interface WidgetHabit {
  id: string;
  name: string;
  cadence: 'daily' | 'weekly';
  target_count: number;
  timezone: string;
  /** The local day the two counts below belong to. */
  date: string;
  todayCount: number;
  /** Progress toward the goal in the current day or week. */
  progress: number;
}

export interface WidgetFocus {
  running: { id: string; startedAt: string; plannedSeconds: number } | null;
  /** The local day the totals belong to. */
  date: string;
  count: number;
  seconds: number;
}

/** What the app leaves for the widgets: enough to draw them and to act on them without the app. */
export interface WidgetSnapshot {
  signedIn: boolean;
  tasks: WidgetTask[];
  habits?: WidgetHabit[];
  focus?: WidgetFocus | null;
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

const MAX_SNAPSHOT = 80;

/** Keeps overdue tasks and those due within eight days: today's list after midnight and the week ahead. */
export function snapshotTasks(tasks: (WidgetTask & Pick<Task, 'completed_at'>)[], now: number): WidgetTask[] {
  const limit = now + 8 * 86_400_000;
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

export type UpcomingRow = { kind: 'day'; key: string; label: string; count: number } | ({ kind: 'task' } & WidgetRow);

/** The next seven days after today, one heading per day that has something on it. */
export function upcomingRows(tasks: WidgetTask[], now: number, timeZone: string): UpcomingRow[] {
  const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone).toPlainDate();
  const days = new Map<string, { date: Temporal.PlainDate; rows: WidgetRow[] }>();
  for (const task of [...tasks].sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!) || a.priority - b.priority)) {
    if (!task.due_at) continue;
    const due = Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone);
    const ahead = today.until(due.toPlainDate()).days;
    if (ahead < 1 || ahead > 7) continue;
    const key = due.toPlainDate().toString();
    const entry = days.get(key) ?? { date: due.toPlainDate(), rows: [] };
    entry.rows.push({
      id: task.id, title: task.title, when: task.all_day ? '' : clock(due.hour, due.minute), overdue: false,
      priority: task.priority, occurrence: task.due_at,
    });
    days.set(key, entry);
  }
  const rows: UpcomingRow[] = [];
  for (const [key, { date, rows: items }] of [...days].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const ahead = today.until(date).days;
    const name = ahead === 1 ? '내일' : ahead === 2 ? '모레' : '월화수목금토일'[date.dayOfWeek - 1] + '요일';
    rows.push({ kind: 'day', key, label: name + ' · ' + date.month + '월 ' + date.day + '일', count: items.length });
    rows.push(...items.map((item) => ({ kind: 'task' as const, ...item })));
  }
  return rows;
}

/** Today's figures for a habit, carried over correctly when the snapshot is from an earlier day. */
export function habitToday(habit: WidgetHabit, now: number): { date: string; todayCount: number; progress: number } {
  const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(habit.timezone).toPlainDate();
  if (today.toString() === habit.date) return { date: habit.date, todayCount: habit.todayCount, progress: habit.progress };
  const sameWeek = habit.cadence === 'weekly' && weekOf(today) === weekOf(Temporal.PlainDate.from(habit.date));
  return { date: today.toString(), todayCount: 0, progress: sameWeek ? habit.progress : 0 };
}

const weekOf = (date: Temporal.PlainDate) => date.subtract({ days: date.dayOfWeek - 1 }).toString();

/** The focus timer as the widget shows it: a session past its end counts as finished. */
export function focusState(focus: WidgetFocus | null | undefined, now: number, timeZone: string) {
  const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone).toPlainDate().toString();
  const running = focus?.running && Date.parse(focus.running.startedAt) + focus.running.plannedSeconds * 1000 > now ? focus.running : null;
  const endsAt = running ? Temporal.Instant.fromEpochMilliseconds(Date.parse(running.startedAt) + running.plannedSeconds * 1000)
    .toZonedDateTimeISO(timeZone) : null;
  const sameDay = focus?.date === today;
  return {
    running,
    endsAt: endsAt ? clock(endsAt.hour, endsAt.minute) : null,
    count: sameDay ? focus!.count : 0,
    minutes: sameDay ? Math.round(focus!.seconds / 60) : 0,
  };
}
