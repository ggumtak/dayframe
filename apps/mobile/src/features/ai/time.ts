// Clock and calendar helpers for prompts and model replies. Pure (Temporal only), tested with node:test.
import { Temporal } from '@js-temporal/polyfill';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

/** Minutes after midnight from a strict 24-hour "HH:MM", or null. */
export function parseHHMM(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function formatHHMM(minutes: number): string {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return String(Math.floor(safe / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0');
}

/** A real calendar date in "YYYY-MM-DD", or null. */
export function parseIsoDate(text: unknown): Temporal.PlainDate | null {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) return null;
  try {
    return Temporal.PlainDate.from(text.trim(), { overflow: 'reject' });
  } catch {
    return null;
  }
}

/** "11월 24일 (화)" */
export function formatKoreanDate(date: Temporal.PlainDate): string {
  return `${date.month}월 ${date.day}일 (${WEEKDAYS[date.dayOfWeek - 1]})`;
}

export interface NowContext {
  date: string;
  weekday: string;
  time: string;
  minutes: number;
  timeZone: string;
}

export function nowContext(instant: Temporal.Instant, timeZone: string): NowContext {
  const zoned = instant.toZonedDateTimeISO(timeZone);
  const minutes = zoned.hour * 60 + zoned.minute;
  return {
    date: zoned.toPlainDate().toString(), weekday: WEEKDAYS[zoned.dayOfWeek - 1] + '요일', time: formatHHMM(minutes), minutes, timeZone,
  };
}

/** The line every user message starts with, so "내일", "다음 주 월요일" and "지금부터" mean something. */
export function describeNow(now: NowContext): string {
  return `지금: ${now.date} ${now.weekday} ${now.time} (시간대 ${now.timeZone})`;
}

/** Rounds up to the next multiple of `step` minutes. */
export function roundUp(minutes: number, step = 5): number {
  return Math.ceil(minutes / step) * step;
}
