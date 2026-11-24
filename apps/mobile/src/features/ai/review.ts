// 주간 돌아보기: the facts of the last seven days, gathered from what the app already loads. Pure, tested.
import { Temporal } from '@js-temporal/polyfill';

import type { FocusSession, Habit, HabitLog, Priority, Task, TaskCompletion } from '../../lib/shared';

export interface ReviewRange {
  /** First day, YYYY-MM-DD (six days before `to`). */
  from: string;
  /** Last day, YYYY-MM-DD (today). */
  to: string;
}

export interface WeekFacts {
  range: ReviewRange;
  completed: { title: string; date: string; list: string | null }[];
  overdue: { title: string; dueDate: string; priority: Priority; list: string | null }[];
  habits: { name: string; cadence: 'daily' | 'weekly'; target: number; doneDays: number; days: string }[];
  focus: { date: string; minutes: number }[];
}

export function reviewRange(today: Temporal.PlainDate): ReviewRange {
  return { from: today.subtract({ days: 6 }).toString(), to: today.toString() };
}

const inRange = (date: string, range: ReviewRange) => date >= range.from && date <= range.to;

function localDate(instant: string, timeZone: string): string | null {
  try {
    return Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDate().toString();
  } catch {
    return null;
  }
}

/** Seven dates from `from` to `to`. */
function days(range: ReviewRange): string[] {
  const start = Temporal.PlainDate.from(range.from);
  return Array.from({ length: 7 }, (_, i) => start.add({ days: i }).toString());
}

export function gatherWeek(input: {
  range: ReviewRange;
  timeZone: string;
  completions: TaskCompletion[];
  openTasks: Task[];
  habits: Habit[];
  habitLogs: Map<string, HabitLog[]>;
  focusSessions: FocusSession[];
  listNames: Map<string, string>;
}): WeekFacts {
  const { range, timeZone, listNames } = input;
  const listOf = (task: Task) => (task.project_id ? listNames.get(task.project_id) ?? null : null);

  const completed = input.completions
    .flatMap((item) => {
      const date = localDate(item.completed_at, timeZone);
      return date && inRange(date, range) ? [{ title: item.task.title, date, list: listOf(item.task) }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-80);

  const overdue = input.openTasks
    .flatMap((task) => {
      if (task.parent_task_id || task.completed_at || !task.due_at) return [];
      const dueDate = localDate(task.due_at, task.timezone);
      return dueDate && dueDate < range.to ? [{ title: task.title, dueDate, priority: task.priority, list: listOf(task) }] : [];
    })
    .sort((a, b) => a.priority - b.priority || a.dueDate.localeCompare(b.dueDate))
    .slice(0, 30);

  const week = days(range);
  const habits = input.habits.filter((habit) => !habit.archived_at).map((habit) => {
    const logs = new Map((input.habitLogs.get(habit.id) ?? []).filter((log) => inRange(log.log_date, range)).map((log) => [log.log_date, log]));
    // One mark per day: ● done, ◐ partly, – skipped, ❄ rest day, · nothing logged.
    const marks = week.map((date) => {
      const log = logs.get(date);
      if (!log) return '·';
      if (log.status === 'skipped') return '–';
      if (log.status === 'frozen') return '❄';
      return habit.cadence === 'daily' && log.count < habit.target_count ? '◐' : '●';
    });
    const doneDays = marks.filter((mark) => mark === '●').length;
    return { name: habit.name, cadence: habit.cadence, target: habit.target_count, doneDays, days: marks.join('') };
  });

  const minutes = new Map(week.map((date) => [date, 0]));
  for (const session of input.focusSessions) {
    if (!session.ended_at || session.status === 'running') continue;
    const date = localDate(session.started_at, timeZone);
    if (!date || !minutes.has(date)) continue;
    const spent = (Date.parse(session.ended_at) - Date.parse(session.started_at)) / 60_000;
    if (spent > 0) minutes.set(date, minutes.get(date)! + spent);
  }
  const focus = week.map((date) => ({ date, minutes: Math.round(minutes.get(date)!) }));

  return { range, completed, overdue, habits, focus };
}
