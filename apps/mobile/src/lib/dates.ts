import { Temporal } from '@js-temporal/polyfill';
import { getCalendars } from 'expo-localization';

import { recurrence, type RecurrenceMode, type Task } from './shared';

export { Temporal };
export type PlainDate = Temporal.PlainDate;

const weekdayNames = ['월', '화', '수', '목', '금', '토', '일'];
const byDay: Record<string, string> = { MO: '월', TU: '화', WE: '수', TH: '목', FR: '금', SA: '토', SU: '일' };

export function deviceTimeZone(): string {
  try {
    return getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Compares two nullable ISO instants by moment, ignoring how each one is formatted. */
export function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  try {
    return Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b)) === 0;
  } catch {
    return a === b;
  }
}

export const today = (timeZone: string): PlainDate => Temporal.Now.plainDateISO(timeZone);
export const weekdayName = (date: PlainDate): string => weekdayNames[date.dayOfWeek - 1];
/** Monday of the ISO week that contains `date`. */
export const weekStart = (date: PlainDate): PlainDate => date.subtract({ days: date.dayOfWeek - 1 });

function zoned(task: Pick<Task, 'due_at' | 'timezone'>): Temporal.ZonedDateTime | null {
  if (!task.due_at) return null;
  try {
    return Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone);
  } catch {
    return null;
  }
}

/** The calendar date a task is due, in the task's own time zone (the same rule the server uses). */
export function dueDate(task: Pick<Task, 'due_at' | 'timezone'>): PlainDate | null {
  return zoned(task)?.toPlainDate() ?? null;
}

/** Minutes after local midnight for a timed task, or null for all-day and unscheduled tasks. */
export function dueMinutes(task: Pick<Task, 'due_at' | 'timezone' | 'all_day'>): number | null {
  const at = task.all_day ? null : zoned(task);
  return at ? at.hour * 60 + at.minute : null;
}

export type DueBucket = 'none' | 'overdue' | 'today' | 'upcoming';

export function dueBucket(task: Pick<Task, 'due_at' | 'timezone'>): DueBucket {
  const date = dueDate(task);
  if (!date) return 'none';
  const order = Temporal.PlainDate.compare(date, today(task.timezone));
  return order < 0 ? 'overdue' : order === 0 ? 'today' : 'upcoming';
}

/** True once a timed task's moment has passed, even if it is still dated today. */
export function isPastDue(task: Pick<Task, 'due_at' | 'timezone' | 'all_day'>): boolean {
  if (!task.due_at) return false;
  if (task.all_day) return dueBucket(task) === 'overdue';
  return Temporal.Instant.compare(Temporal.Instant.from(task.due_at), Temporal.Now.instant()) < 0;
}

export function formatTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour < 12 ? '오전' : '오후';
  return period + ' ' + (hour % 12 === 0 ? 12 : hour % 12) + ':' + String(minute).padStart(2, '0');
}

export function formatDate(date: PlainDate, reference: PlainDate): string {
  const delta = reference.until(date, { largestUnit: 'days' }).days;
  if (delta === 0) return '오늘';
  if (delta === 1) return '내일';
  if (delta === 2) return '모레';
  if (delta === -1) return '어제';
  if (delta > 2 && delta < 7) return weekdayName(date) + '요일';
  const base = date.month + '월 ' + date.day + '일';
  return (date.year === reference.year ? base : date.year + '년 ' + base) + ' (' + weekdayName(date) + ')';
}

/** "오늘 오후 7:00", "내일", "11월 25일 (수)" — or null when the task has no schedule. */
export function formatDue(task: Pick<Task, 'due_at' | 'timezone' | 'all_day'>): string | null {
  const date = dueDate(task);
  if (!date) return null;
  const minutes = dueMinutes(task);
  const day = formatDate(date, today(task.timezone));
  return minutes === null ? day : day + ' ' + formatTime(minutes);
}

export function describeRecurrence(rule: string | null, mode: RecurrenceMode = 'schedule'): string | null {
  if (!rule) return null;
  const completion = mode === 'completion';
  const prefix = completion ? '완료 후 ' : '';
  try {
    const { frequency, interval, weekdays, lastDay } = recurrence(rule);
    if (frequency === 'DAILY') return prefix + (!completion && interval === 1 ? '매일' : interval + '일마다');
    if (frequency === 'YEARLY') return prefix + (!completion && interval === 1 ? '매년' : interval + '년마다');
    if (frequency === 'MONTHLY') {
      if (lastDay) return prefix + (interval === 1 ? '매월 말일' : interval + '개월마다 말일');
      return prefix + (!completion && interval === 1 ? '매월' : interval + '개월마다');
    }
    const every = interval === 1 ? '매주' : interval === 2 ? '격주' : interval + '주마다';
    const days = weekdays.join(',');
    if (days === 'MO,TU,WE,TH,FR') return prefix + (interval === 1 ? '평일' : every + ' 평일');
    if (days === 'SA,SU') return prefix + (interval === 1 ? '주말' : every + ' 주말');
    if (weekdays.length) return prefix + every + ' ' + weekdays.map((day) => byDay[day]).join('·');
    return prefix + (completion ? interval + '주마다' : every);
  } catch {
    return prefix + '반복';
  }
}

/** Formats an estimated duration in minutes: "30분", "1시간", "1시간 30분". */
export function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) return minutes + '분';
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours}시간 ${rem}분` : `${hours}시간`;
}

/** ISO instant for the start of `date`, or for `minutes` past its local midnight. */
export function instantFor(date: PlainDate, minutes: number | null, timeZone: string): string {
  const time = minutes === null ? undefined : Temporal.PlainTime.from({ hour: Math.floor(minutes / 60), minute: minutes % 60 });
  return date.toZonedDateTime({ timeZone, plainTime: time }).toInstant().toString();
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return String(Math.floor(safe / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0');
}

export function formatMinutes(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0분';
  if (totalSeconds < 60) return '1분 미만';
  const minutes = Math.round(totalSeconds / 60);
  return minutes < 60 ? minutes + '분' : Math.floor(minutes / 60) + '시간' + (minutes % 60 ? ' ' + (minutes % 60) + '분' : '');
}
