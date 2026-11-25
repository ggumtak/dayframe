import { Temporal } from '@js-temporal/polyfill';

import type { Task } from '../../lib/shared.ts';

import { alertTime } from './lead.ts';

export { alertTime };

export interface ReminderSettings {
  enabled: boolean;
  /** Minutes before a timed task's due time. */
  leadMinutes: 0 | 5 | 10 | 15 | 30 | 60;
  /** Local hour that an all-day task is announced on its day, or null for no alert. */
  allDayHour: number | null;
  /** Local hour for the daily Today digest summary, or null when off. */
  briefingHour?: number | null;
}

export const defaultReminderSettings: ReminderSettings = {
  enabled: true, leadMinutes: 0, allDayHour: 9, briefingHour: 8,
};

export type ReminderTask = Pick<Task, 'id' | 'title' | 'due_at' | 'all_day' | 'timezone' | 'completed_at' | 'recurrence_rule'>
  & Partial<Pick<Task, 'recurrence_mode' | 'priority'>>;

export interface PlannedReminder {
  /** Also the notification's identifier, so the same occurrence is never scheduled twice. */
  id: string;
  taskId: string;
  /** The occurrence's due time, as stored on the task. */
  occurrence: string;
  /** When the alert fires, in epoch milliseconds. */
  at: number;
}

export const REMINDER_PREFIX = 'task-';
export const SNOOZE_PREFIX = 'snooze-';
export const HABIT_SNOOZE_PREFIX = 'habit-snooze-';
export const BRIEFING_PREFIX = 'briefing-';

export const reminderId = (taskId: string, occurrence: string) => REMINDER_PREFIX + taskId + '-' + Date.parse(occurrence);

/** Reads back what `reminderId` (or its snoozed copy) encoded. */
export function parseReminderId(id: string): { taskId: string; occurrence: string } | null {
  const match = /^(?:task|snooze)-([0-9a-f-]{36})-(\d+)$/.exec(id);
  return match ? { taskId: match[1], occurrence: new Date(Number(match[2])).toISOString() } : null;
}

/**
 * The alerts the device should hold: each open task's coming occurrences inside the horizon, earliest
 * first. Repeating tasks get their next few occurrences, so they still ring when the app stays closed.
 * `upcoming` returns the occurrence after a given one, or null.
 */
export function planReminders(
  tasks: ReminderTask[], settings: ReminderSettings, now: number,
  upcoming: (task: ReminderTask, after: string) => string | null,
  options: { horizonDays?: number; limit?: number; perTask?: number; leadFor?: (task: ReminderTask) => number | 'off' | undefined } = {},
): PlannedReminder[] {
  if (!settings.enabled) return [];
  const horizon = now + (options.horizonDays ?? 7) * 86_400_000;
  const planned: PlannedReminder[] = [];
  for (const task of tasks) {
    if (task.completed_at || !task.due_at) continue;
    const own = options.leadFor?.(task);
    if (own === 'off') continue;
    let occurrence: string | null = task.due_at;
    // Completion-based repeats don't have deterministic future dates until completed, so only schedule the current occurrence.
    const repeatsAhead = !!task.recurrence_rule && task.recurrence_mode !== 'completion';
    for (let count = 0; occurrence && count < (repeatsAhead ? options.perTask ?? 4 : 1); count++) {
      const at = alertTime(task, occurrence, settings, own);
      if (at !== null && at > horizon) break;
      if (at !== null && at > now) planned.push({ id: reminderId(task.id, occurrence), taskId: task.id, occurrence, at });
      occurrence = repeatsAhead ? safely(() => upcoming(task, occurrence!)) : null;
    }
  }
  return planned.sort((a, b) => a.at - b.at).slice(0, options.limit ?? 60);
}

function safely<T>(run: () => T): T | null {
  try {
    return run();
  } catch {
    return null;
  }
}

/** A UUID that is the same every time for the same text, so a repeated "완료" tap completes once. */
export function stableUuid(text: string): string {
  let hex = '';
  for (let round = 0; hex.length < 32; round++) {
    let hash = 0x811c9dc5 ^ round;
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
    hex += (hash >>> 0).toString(16).padStart(8, '0');
  }
  return [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16), '8' + hex.slice(17, 20), hex.slice(20, 32)].join('-');
}

export const HABIT_PREFIX = 'habit-';
export interface HabitReminderInput {
  id: string; time: string; timezone: string;
  /** The last day already covered by a met goal: today for a daily habit, Sunday for a weekly one. Null if not met. */
  doneThrough: string | null;
}
export interface PlannedHabitReminder { id: string; habitId: string; date: string; at: number }

/** A habit's alert for each of the coming days at its chosen time, skipping the days a met goal already covers. */
export function planHabitReminders(habits: HabitReminderInput[], now: number, days = 7): PlannedHabitReminder[] {
  const planned: PlannedHabitReminder[] = [];
  for (const habit of habits) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(habit.time);
    if (!match) continue;
    const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(habit.timezone).toPlainDate();
    for (let offset = 0; offset < days; offset++) {
      const date = today.add({ days: offset });
      if (habit.doneThrough && Temporal.PlainDate.compare(date, Temporal.PlainDate.from(habit.doneThrough)) <= 0) continue;
      const at = date.toZonedDateTime({ timeZone: habit.timezone, plainTime: { hour: Number(match[1]), minute: Number(match[2]) } }).epochMilliseconds;
      if (at <= now) continue;
      planned.push({ id: HABIT_PREFIX + habit.id + '-' + date.toString(), habitId: habit.id, date: date.toString(), at });
    }
  }
  return planned;
}

export function parseHabitReminderId(id: string): { habitId: string; date: string } | null {
  const match = /^(?:habit|habit-snooze)-([0-9a-f-]{36})-(\d{4}-\d{2}-\d{2})$/.exec(id);
  return match ? { habitId: match[1], date: match[2] } : null;
}

export interface PlannedBriefing {
  id: string;
  date: string;
  at: number;
  todayCount: number;
  overdueCount: number;
  topTitles: string[];
}

/**
 * Daily summary briefing at `settings.briefingHour` (e.g. 08:00), scheduled only for days inside the horizon
 * that actually have open tasks due or overdue — never spamming on clear days.
 */
export function planBriefingReminders(
  tasks: ReminderTask[], settings: ReminderSettings, now: number, timeZone: string,
  upcoming: (task: ReminderTask, after: string) => string | null, days = 7,
): PlannedBriefing[] {
  const hour = settings.briefingHour === undefined ? defaultReminderSettings.briefingHour : settings.briefingHour;
  if (!settings.enabled || hour === null || hour === undefined) return [];
  const baseDate = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone).toPlainDate();
  const planned: PlannedBriefing[] = [];
  let includedOverdue = false;

  for (let offset = 0; offset < days; offset++) {
    const target = baseDate.add({ days: offset });
    const at = target.toZonedDateTime({ timeZone, plainTime: { hour, minute: 0 } }).epochMilliseconds;
    if (at <= now) continue;

    const includeOverdue = !includedOverdue;
    includedOverdue = true;
    let overdueCount = 0;
    const dueCandidates: { title: string; priority: number; sortMs: number }[] = [];

    for (const task of tasks) {
      if (task.completed_at || !task.due_at) continue;
      const firstDate = safely(() => Temporal.Instant.from(task.due_at!).toZonedDateTimeISO(task.timezone).toPlainDate());
      if (!firstDate) continue;
      const cmp = Temporal.PlainDate.compare(firstDate, target);
      if (includeOverdue && Temporal.PlainDate.compare(firstDate, baseDate) < 0) {
        overdueCount += 1;
        dueCandidates.push({ title: task.title, priority: task.priority ?? 4, sortMs: Date.parse(task.due_at) });
      } else if (cmp === 0) {
        dueCandidates.push({ title: task.title, priority: task.priority ?? 4, sortMs: Date.parse(task.due_at) });
      } else if (cmp < 0 && task.recurrence_rule && task.recurrence_mode !== 'completion') {
        let occ: string | null = task.due_at;
        for (let step = 0; occ && step < 64; step++) {
          const d = safely(() => Temporal.Instant.from(occ!).toZonedDateTimeISO(task.timezone).toPlainDate());
          if (!d || Temporal.PlainDate.compare(d, target) > 0) break;
          if (d.equals(target)) {
            dueCandidates.push({ title: task.title, priority: task.priority ?? 4, sortMs: Date.parse(occ) });
            break;
          }
          occ = safely(() => upcoming(task, occ!));
        }
      }
    }

    const todayCount = dueCandidates.length - overdueCount;
    if (todayCount + overdueCount === 0) continue;

    dueCandidates.sort((a, b) => a.priority - b.priority || a.sortMs - b.sortMs);
    planned.push({
      id: BRIEFING_PREFIX + target.toString(),
      date: target.toString(),
      at,
      todayCount,
      overdueCount,
      topTitles: dueCandidates.slice(0, 3).map((item) => item.title),
    });
  }

  return planned;
}

export function parseBriefingReminderId(id: string): { date: string } | null {
  const match = /^briefing-(\d{4}-\d{2}-\d{2})$/.exec(id);
  return match ? { date: match[1] } : null;
}
