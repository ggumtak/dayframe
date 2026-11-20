import { Temporal } from "@js-temporal/polyfill";

const week = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = typeof week[number];

export class InvalidSchedule extends Error {}

export const recurrencePattern =
  /^FREQ=(DAILY|WEEKLY)(?:;INTERVAL=([1-9]|[1-4][0-9]|5[0-2]))?(?:;BYDAY=((?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU)){0,6}))?$/;

export function recurrence(rule: string) {
  const match = recurrencePattern.exec(rule);
  if (!match || (match[1] === "DAILY" && match[3])) {
    throw new InvalidSchedule("Use a daily or weekly RRULE with an interval from 1 to 52");
  }
  const weekdays = (match[3]?.split(",") ?? []) as Weekday[];
  if (new Set(weekdays).size !== weekdays.length) {
    throw new InvalidSchedule("RRULE weekdays must be unique");
  }
  return { frequency: match[1], interval: Number(match[2] ?? 1), weekdays };
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
): string {
  const { frequency, interval, weekdays } = recurrence(rule);
  const anchor = Temporal.Instant.from(anchorAt).toZonedDateTimeISO(timezone);
  const date = after.toZonedDateTimeISO(timezone).toPlainDate();
  const anchorDate = anchor.toPlainDate();
  const time = allDay ? null : localTime ? Temporal.PlainTime.from(localTime) : anchor.toPlainTime();
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
