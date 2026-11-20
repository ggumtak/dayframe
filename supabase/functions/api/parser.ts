import { Temporal } from "@js-temporal/polyfill";
import type { ParsedTask, ParseTaskInput, Priority } from "../../../packages/shared/types.ts";
import { instantOn, InvalidSchedule, type Weekday } from "./schedule.ts";

const englishDays: Record<string, Weekday> = {
  mon: "MO", tue: "TU", wed: "WE", thu: "TH", fri: "FR", sat: "SA", sun: "SU",
};
const koreanDays: Record<string, Weekday> = { 월: "MO", 화: "TU", 수: "WE", 목: "TH", 금: "FR", 토: "SA", 일: "SU" };
const week = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const enDay = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const koDay = "[월화수목금토일](?:요일)?";
const koList = "(?:" + koDay + ")(?:(?:\\s*[,/]\\s*|\\s+(?:및\\s+)?|(?=[월화수목금토일]))" + koDay + ")*";
const enList = enDay + "(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s+)" + enDay + ")*";
const left = "(?<![\\p{L}\\p{N}_])";
const right = "(?![\\p{L}\\p{N}_])";
const koRight = "(?=$|\\s|[,.!?]|(?:오전|오후)\\s*\\d|\\d{1,2}(?:[:시]))";

function weekday(word: string): Weekday {
  return koreanDays[word[0]] ?? englishDays[word.toLowerCase().slice(0, 3)];
}

export function parseTask(input: ParseTaskInput): ParsedTask {
  const now = input.now ? Temporal.Instant.from(input.now) : Temporal.Now.instant();
  const localNow = now.toZonedDateTimeISO(input.timezone);
  const today = localNow.toPlainDate();
  let remaining = input.text.normalize("NFC");
  let project: string | null = null;
  let priority: Priority = 4;
  const tags: string[] = [];
  let taggedPriority = false;

  remaining = remaining.replace(/(^|\s)([#@])(?:"([^"\r\n]+)"|([\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*))/gu,
    (_, boundary: string, type: string, quoted: string | undefined, bare: string) => {
      const name = (quoted ?? bare).trim();
      if (!name || name.length > 120) throw new InvalidSchedule("Project and tag names must have 1–120 characters");
      if (type === "#") {
        if (project !== null) throw new InvalidSchedule("Use one #project per task");
        project = name;
      } else if (!tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) tags.push(name);
      return boundary;
    });
  remaining = remaining.replace(/(^|\s)p([1-4])(?=\s|$)/gi, (_, boundary: string, value: string) => {
    if (taggedPriority) throw new InvalidSchedule("Use one priority per task");
    taggedPriority = true;
    priority = Number(value) as Priority;
    return boundary;
  });

  let rule: string | null = null;
  let days: Weekday[] = [];
  function setRecurrence(frequency: "DAILY" | "WEEKLY", count: number, selected: Weekday[] = []) {
    if (rule) throw new InvalidSchedule("Use one recurrence per task");
    if (count < 1 || count > 52) throw new InvalidSchedule("Recurrence interval must be 1–52");
    days = week.filter((day) => selected.includes(day));
    rule = "FREQ=" + frequency + (count === 1 ? "" : ";INTERVAL=" + count)
      + (days.length ? ";BYDAY=" + days.join(",") : "");
    return " ";
  }

  remaining = remaining.replace(new RegExp(left + "every\\s+(" + enList + ")" + right, "giu"),
    (_, list: string) => setRecurrence("WEEKLY", 1, (list.match(new RegExp(enDay, "gi")) ?? []).map(weekday)));
  remaining = remaining.replace(new RegExp(left + "매주\\s*(" + koList + ")" + koRight, "gu"),
    (_, list: string) => setRecurrence("WEEKLY", 1, (list.match(new RegExp(koDay, "g")) ?? []).map(weekday)));
  remaining = remaining.replace(new RegExp(left + "every\\s+(?:(\\d+)\\s+)?(days?|weeks?)" + right + "|"
      + left + "(daily|weekly)" + right, "giu"),
    (_, count: string | undefined, unit: string | undefined, shorthand: string | undefined) =>
      setRecurrence((unit ?? shorthand ?? "").toLowerCase().startsWith("w") ? "WEEKLY" : "DAILY", Number(count ?? 1)));
  remaining = remaining.replace(new RegExp(left + "(매일|매주)" + koRight, "gu"),
    (_, word: string) => setRecurrence(word === "매일" ? "DAILY" : "WEEKLY", 1));

  let explicitDate: Temporal.PlainDate | undefined;
  function setDate(date: Temporal.PlainDate) {
    if (explicitDate) throw new InvalidSchedule("Use one due date per task");
    explicitDate = date;
    return " ";
  }
  const baseMonday = today.subtract({ days: today.dayOfWeek - 1 });
  remaining = remaining.replace(new RegExp(left + "(?:다음\\s*주\\s*(" + koDay + ")" + koRight
    + "|next\\s+week\\s+(" + enDay + ")" + right + "|next\\s+(" + enDay + ")" + right + ")", "giu"),
    (_, kr: string | undefined, enWeek: string | undefined, en: string | undefined) =>
      setDate(baseMonday.add({ days: 7 + week.indexOf(weekday(kr ?? enWeek ?? en!)) })));
  remaining = remaining.replace(new RegExp(left + "(오늘|내일|모레)" + koRight + "|"
    + left + "(day\\s+after\\s+tomorrow|tomorrow|today)" + right, "giu"),
    (_, kr: string | undefined, en: string | undefined) => {
      const word = (kr ?? en ?? "").toLowerCase();
      const offset = word === "오늘" || word === "today" ? 0 : word === "내일" || word === "tomorrow" ? 1 : 2;
      return setDate(today.add({ days: offset }));
    });
  remaining = remaining.replace(new RegExp(left + "(\\d{4}-\\d{2}-\\d{2})" + right, "gu"),
    (_, value: string) => setDate(Temporal.PlainDate.from(value)));

  const clock: { time?: Temporal.PlainTime } = {};
  function setTime(hourValue: string, minuteValue: string | undefined, period?: string) {
    if (clock.time) throw new InvalidSchedule("Use one due time per task");
    let hour = Number(hourValue);
    if (period) {
      if (hour < 1 || hour > 12) throw new InvalidSchedule("Use 1–12 with AM/PM or 오전/오후");
      hour = hour % 12 + (["pm", "오후"].includes(period.toLowerCase()) ? 12 : 0);
    }
    clock.time = Temporal.PlainTime.from({ hour, minute: Number(minuteValue ?? 0) }, { overflow: "reject" });
    return " ";
  }
  remaining = remaining.replace(new RegExp(left + "(?:(오전|오후)\\s*)?(\\d{1,2})\\s*시(?!간)(?:\\s*(\\d{1,2})\\s*분)?"
    + "(?=$|\\s|[,.!?]|[가-힣])", "gu"), (_, period: string | undefined, hour: string, minute: string | undefined) =>
    setTime(hour, minute, period));
  remaining = remaining.replace(new RegExp(left + "(?:at\\s+)?(\\d{1,2})(?::(\\d{1,2}))?\\s*(am|pm)" + right, "giu"),
    (_, hour: string, minute: string | undefined, period: string) => setTime(hour, minute, period));
  remaining = remaining.replace(new RegExp(left + "(?:(오전|오후)\\s*|at\\s+)?(\\d{1,2}):(\\d{1,2})" + right, "giu"),
    (_, period: string | undefined, hour: string, minute: string) => setTime(hour, minute, period));

  const { time } = clock;
  const title = remaining.replace(/\s+/g, " ").trim();
  if (!title || title.length > 500) throw new InvalidSchedule("Task title must have 1–500 characters");
  let due_at: string | null = null;
  if (explicitDate || time || rule) {
    let date = explicitDate ?? today;
    for (let offset = 0; offset <= 7; offset++, date = date.add({ days: 1 })) {
      if (days.length && !days.includes(week[date.dayOfWeek - 1])) continue;
      const candidate = instantOn(date, time ?? null, input.timezone).toInstant();
      if (time && !explicitDate && Temporal.Instant.compare(candidate, now) <= 0) continue;
      due_at = candidate.toString();
      break;
    }
  }
  return { title, due_at, all_day: due_at !== null && time === undefined, timezone: input.timezone,
    recurrence_rule: rule, recurrence_local_time: rule && time ? time.toString() : null,
    project, tags, priority };
}
