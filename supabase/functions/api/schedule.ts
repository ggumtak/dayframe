import { Temporal } from "@js-temporal/polyfill";
import type { RecurrenceMode } from "../../../packages/shared/types.ts";

const week = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = typeof week[number];
export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type { RecurrenceMode };

export class InvalidSchedule extends Error {}

export const recurrencePattern =
  /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;INTERVAL=([1-9]|[1-4][0-9]|5[0-2]))?(?:;BYDAY=((?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU)){0,6})|(;BYMONTHDAY=-1))?$/;

export function recurrence(rule: string) {
  const match = recurrencePattern.exec(rule);
  if (!match || (match[3] && match[1] !== "WEEKLY") || (match[4] && match[1] !== "MONTHLY")) {
    throw new InvalidSchedule("Use a supported RRULE with an interval from 1 to 52");
  }
  const weekdays = (match[3]?.split(",") ?? []) as Weekday[];
  if (new Set(weekdays).size !== weekdays.length) {
    throw new InvalidSchedule("RRULE weekdays must be unique");
  }
  return { frequency: match[1] as Frequency, interval: Number(match[2] ?? 1), weekdays, lastDay: !!match[4] };
}

export function instantOn(date: Temporal.PlainDate, time: Temporal.PlainTime | null, timezone: string) {
  return time ? date.toZonedDateTime({ timeZone: timezone, plainTime: time }) : date.toZonedDateTime(timezone);
}

export function nextOccurrence(
  rule: string,
  timezone: string,
  anchorAt: string,
  after: Temporal.Instant,
  allDay: boolean,
  localTime?: string | null,
  mode: RecurrenceMode = "schedule",
): string {
  const { frequency, interval, weekdays, lastDay } = recurrence(rule);
  const anchor = Temporal.Instant.from(anchorAt).toZonedDateTimeISO(timezone);
  const date = after.toZonedDateTimeISO(timezone).toPlainDate();
  const anchorDate = anchor.toPlainDate();
  const time = allDay ? null : localTime ? Temporal.PlainTime.from(localTime) : anchor.toPlainTime();

  if (mode === "completion") {
    if (frequency === "DAILY") {
      const candidate = date.add({ days: interval });
      return instantOn(candidate, time, timezone).toInstant().toString();
    }
    if (frequency === "WEEKLY") {
      if (!weekdays.length) {
        return instantOn(date.add({ weeks: interval }), time, timezone).toInstant().toString();
      }
      const mondayOffset = date.dayOfWeek - 1;
      for (let offset = 1; offset <= interval * 7 + 7; offset++) {
        const candidate = date.add({ days: offset });
        if (Math.floor((offset + mondayOffset) / 7) % interval !== 0) continue;
        if (!weekdays.includes(week[candidate.dayOfWeek - 1])) continue;
        const at = instantOn(candidate, time, timezone).toInstant();
        if (Temporal.Instant.compare(at, after) > 0) return at.toString();
      }
      throw new InvalidSchedule("No next occurrence could be calculated");
    }
    if (frequency === "MONTHLY") {
      const next = date.add({ months: interval });
      const candidate = lastDay ? next.with({ day: next.daysInMonth }) : next;
      return instantOn(candidate, time, timezone).toInstant().toString();
    }
    // YEARLY
    return instantOn(date.add({ years: interval }), time, timezone).toInstant().toString();
  }

  if (frequency === "MONTHLY" || frequency === "YEARLY") {
    const monthly = frequency === "MONTHLY";
    const elapsedYears = date.year - anchorDate.year;
    const elapsed = monthly ? elapsedYears * 12 + date.month - anchorDate.month : elapsedYears;
    const first = Math.max(0, Math.floor(elapsed / interval));
    const anchorMonth = anchorDate.with({ day: 1 });
    // The Gregorian calendar repeats every 400 years. Always calculate from the original date.
    const cycle = monthly ? 400 * 12 : 400;
    for (let step = first; step <= first + cycle; step++) {
      const month = anchorMonth.add(monthly ? { months: step * interval } : { years: step * interval });
      const day = lastDay ? month.daysInMonth : anchorDate.day;
      if (day > month.daysInMonth) continue;
      const at = instantOn(month.with({ day }), time, timezone).toInstant();
      if (Temporal.Instant.compare(at, after) > 0) return at.toString();
    }
    throw new InvalidSchedule("No next occurrence could be calculated");
  }
  const days = anchorDate.until(date).days;
  const mondayOffset = anchorDate.dayOfWeek - 1;
  const anchorWeekday = week[mondayOffset];
  const eligible = weekdays.length ? weekdays : [anchorWeekday];
  // At most one full interval separates eligible dates.
  for (let offset = Math.max(0, days); offset <= Math.max(0, days) + interval * 7 + 7; offset++) {
    const candidate = anchorDate.add({ days: offset });
    const matches = frequency === "DAILY"
      ? offset % interval === 0
      : Math.floor((offset + mondayOffset) / 7) % interval === 0 && eligible.includes(week[candidate.dayOfWeek - 1]);
    if (!matches) continue;
    const at = instantOn(candidate, time, timezone).toInstant();
    if (Temporal.Instant.compare(at, after) > 0) return at.toString();
  }
  throw new InvalidSchedule("No next occurrence could be calculated");
}

/** The fields that place a repeating task's current occurrence in its series. */
export interface OccurrenceFields {
  due_at: string | null;
  timezone: string;
  all_day: boolean;
  recurrence_rule: string | null;
  recurrence_anchor_at: string | null;
  recurrence_local_time: string | null;
  /** The series slot the current occurrence was moved off, or null while it sits on its own slot. */
  occurrence_at?: string | null;
}

/** Whether `at` is a time the series itself produces, rather than a moved one. */
export function isSeriesSlot(task: OccurrenceFields, at: string): boolean {
  if (!task.recurrence_rule || !task.recurrence_anchor_at) return false;
  try {
    const instant = Temporal.Instant.from(at);
    const next = nextOccurrence(task.recurrence_rule, task.timezone, task.recurrence_anchor_at,
      instant.subtract({ nanoseconds: 1 }), task.all_day, task.recurrence_local_time);
    return Temporal.Instant.from(next).equals(instant);
  } catch {
    return false;
  }
}

/**
 * What `occurrence_at` becomes when the current occurrence moves to `to`. Moving it onto a slot of the series
 * (such as undoing a completion) leaves nothing to remember; moving it elsewhere keeps the slot it came from,
 * so completing it early does not bring that same slot back as the next occurrence.
 */
export function movedOccurrenceSlot(task: OccurrenceFields, to: string): string | null {
  if (!task.due_at || isSeriesSlot(task, to)) return null;
  return task.occurrence_at ?? task.due_at;
}

/** The time after which the next occurrence is searched: the current one, the slot it was moved off, and now. */
export function occurrenceFloor(task: Pick<OccurrenceFields, "due_at" | "occurrence_at">, now: Temporal.Instant): Temporal.Instant {
  let floor = now;
  for (const at of [task.due_at, task.occurrence_at]) {
    if (!at) continue;
    const instant = Temporal.Instant.from(at);
    if (Temporal.Instant.compare(instant, floor) > 0) floor = instant;
  }
  return floor;
}
