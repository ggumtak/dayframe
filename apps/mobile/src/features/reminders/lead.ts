import { Temporal } from '@js-temporal/polyfill';

import type { ReminderSettings } from './plan.ts';

/** Minutes before a task's time, or off. Absent means the default from settings. Any whole number of minutes is allowed. */
export type TaskReminder = number | 'off';

export const DAY_MINUTES = 1440;
/** The longest lead the custom picker offers: 30 days. */
export const MAX_LEAD_MINUTES = 30 * DAY_MINUTES;

/** One-tap choices for a timed task. */
export const timedLeads: readonly number[] = [0, 5, 15, 30, 60, DAY_MINUTES];
/** One-tap choices for an all-day task: on its day, or the day before, at the settings hour. */
export const allDayLeads: readonly number[] = [0, DAY_MINUTES];

/** Reads a stored value back. Older versions stored 0, 5, 10, 30 or 60; anything unreadable counts as "not set". */
export function cleanReminder(value: unknown): TaskReminder | undefined {
  if (value === 'off') return 'off';
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return clampLead(value);
}

export const clampLead = (minutes: number) => Math.min(MAX_LEAD_MINUTES, Math.max(0, Math.round(minutes)));

export interface LeadParts { days: number; hours: number; minutes: number }

export function splitLead(lead: number): LeadParts {
  const safe = clampLead(lead);
  return { days: Math.floor(safe / DAY_MINUTES), hours: Math.floor((safe % DAY_MINUTES) / 60), minutes: safe % 60 };
}

export const joinLead = ({ days, hours, minutes }: LeadParts) => clampLead(days * DAY_MINUTES + hours * 60 + minutes);

function amount(lead: number): string {
  const { days, hours, minutes } = splitLead(lead);
  return [days ? days + '일' : '', hours ? hours + '시간' : '', minutes ? minutes + '분' : ''].filter(Boolean).join(' ');
}

/** "정시", "5분 전", "1시간 30분 전", "1일 전". */
export const leadLabel = (lead: number) => (clampLead(lead) === 0 ? '정시' : amount(lead) + ' 전');

/** For the alert itself: "30분 후", "1시간 후". */
export const leadAhead = (lead: number) => amount(lead) + ' 후';

/** An all-day task's alert moves only by whole days, so a lead left over from when it had a time keeps ringing on its day. */
export const allDayLeadDays = (lead: number) => Math.floor(clampLead(lead) / DAY_MINUTES);

export const hourLabel = (hour: number) => (hour < 12 ? '오전 ' : '오후 ') + (hour % 12 || 12) + '시';

export function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  return (hour < 12 ? '오전 ' : '오후 ') + (hour % 12 || 12) + ':' + String(minutes % 60).padStart(2, '0');
}

/** "오전 9시", "하루 전 오전 9시", "3일 전 오전 9시". */
export function allDayLeadLabel(lead: number, hour: number): string {
  const days = allDayLeadDays(lead);
  return (days === 0 ? '' : days === 1 ? '하루 전 ' : days + '일 전 ') + hourLabel(hour);
}

/** What a task's alert is set to, in a few words, and whether it rings at all. */
export function reminderSummary(own: TaskReminder | undefined, settings: ReminderSettings, allDay: boolean): { label: string; off: boolean } {
  if (!settings.enabled) return { label: '알림 꺼짐', off: true };
  if (own === 'off') return { label: '알림 끔', off: true };
  if (allDay) {
    if (settings.allDayHour === null) return { label: '알림 없음', off: true };
    return { label: allDayLeadLabel(typeof own === 'number' ? own : 0, settings.allDayHour), off: false };
  }
  const lead = typeof own === 'number' ? own : settings.leadMinutes;
  return { label: lead === 0 ? '정시 알림' : leadLabel(lead), off: false };
}

/** "11월 24일 오후 5:45에 알림" for an alert at `at`, noting when that moment has already gone (alerts never fire late). */
export function alertPreview(at: number | null, timeZone: string, now: number, repeats = false): string | null {
  if (at === null) return null;
  const local = Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(timeZone);
  const thisYear = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone).year;
  const day = (local.year === thisYear ? '' : local.year + '년 ') + local.month + '월 ' + local.day + '일';
  const text = day + ' ' + clockLabel(local.hour * 60 + local.minute) + '에 알림';
  if (at > now) return text;
  return text + (repeats ? ' · 이번에는 지나서 다음 반복부터 울립니다' : ' · 이미 지난 시각이라 울리지 않습니다');
}
