import { Temporal } from "@js-temporal/polyfill";
import type { ParsedTask, ParseTaskInput, Priority } from "../../../packages/shared/types.ts";
import { instantOn, InvalidSchedule, type Weekday } from "./schedule.ts";

export type TaskTokenKind = "project" | "tag" | "priority" | "recurrence" | "date" | "time";
/** A recognized quick-entry token. Offsets are UTF-16 indexes into `TaskAnalysis.text`. */
export interface TaskToken { kind: TaskTokenKind; start: number; end: number; text: string }
export interface TaskAnalysis { task: ParsedTask; text: string; tokens: TaskToken[] }

const englishDays: Record<string, Weekday> = {
  mon: "MO", tue: "TU", wed: "WE", thu: "TH", fri: "FR", sat: "SA", sun: "SU",
};
const koreanDays: Record<string, Weekday> = { 월: "MO", 화: "TU", 수: "WE", 목: "TH", 금: "FR", 토: "SA", 일: "SU" };
const week = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const workdays: Weekday[] = ["MO", "TU", "WE", "TH", "FR"];
const weekend: Weekday[] = ["SA", "SU"];
const enDay = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const koDay = "[월화수목금토일](?:요일)?";
const koList = "(?:" + koDay + ")(?:(?:\\s*[,/]\\s*|\\s+(?:및\\s+)?|(?=[월화수목금토일]))" + koDay + ")*";
const enList = enDay + "(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s+)" + enDay + ")*";
const koPeriod = "오전|오후|아침|저녁|밤|새벽|낮";
const left = "(?<![\\p{L}\\p{N}_])";
const right = "(?![\\p{L}\\p{N}_])";
const koRight = "(?=$|\\s|[,.!?]|(?:" + koPeriod + ")\\s*\\d|\\d{1,2}(?:[:시]))";

const morningWords = /아침|새벽|기상|출근|모닝|morning|breakfast/iu;
const eveningWords = /저녁|밤|야간|퇴근|회식|야식|evening|night|dinner/iu;

function weekday(word: string): Weekday {
  return koreanDays[word[0]] ?? englishDays[word.toLowerCase().slice(0, 3)];
}

/**
 * Parses quick entry and reports where each recognized token sits in the NFC-normalized text.
 * `draft` accepts an entry that has no title yet, so a field can mark "오늘 7시" before the title is typed.
 */
export function analyzeTask(input: ParseTaskInput, options: { draft?: boolean } = {}): TaskAnalysis {
  const now = input.now ? Temporal.Instant.from(input.now) : Temporal.Now.instant();
  const localNow = now.toZonedDateTimeISO(input.timezone);
  const today = localNow.toPlainDate();
  const text = input.text.normalize("NFC");
  const tokens: TaskToken[] = [];
  // Recognized tokens are blanked in place so later offsets still index the original text.
  let remaining = text;
  function consume(pattern: RegExp, kind: TaskTokenKind, handle: (...groups: Array<string | undefined>) => void, boundary = false) {
    remaining = remaining.replace(pattern, (...args: unknown[]) => {
      const match = args[0] as string;
      const offset = args[args.length - 2] as number;
      const groups = args.slice(1, -2) as Array<string | undefined>;
      const skip = boundary ? (groups[0] ?? "").length : 0;
      handle(...(boundary ? groups.slice(1) : groups));
      tokens.push({ kind, start: offset + skip, end: offset + match.length, text: match.slice(skip) });
      return match.slice(0, skip) + " ".repeat(match.length - skip);
    });
  }

  let project: string | null = null;
  let priority: Priority = 4;
  const tags: string[] = [];
  let taggedPriority = false;
  for (const type of ["#", "@"] as const) {
    consume(new RegExp("(^|\\s)" + type + '(?:"([^"\\r\\n]+)"|([\\p{L}\\p{N}_][\\p{L}\\p{M}\\p{N}_-]*))', "gu"),
      type === "#" ? "project" : "tag", (quoted, bare) => {
        const name = (quoted ?? bare ?? "").trim();
        if (!name || name.length > 120) throw new InvalidSchedule("Project and tag names must have 1–120 characters");
        if (type === "#") {
          if (project !== null) throw new InvalidSchedule("Use one #project per task");
          project = name;
        } else if (!tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) tags.push(name);
      }, true);
  }
  consume(/(^|\s)p([1-4])(?=\s|$)/gi, "priority", (value) => {
    if (taggedPriority) throw new InvalidSchedule("Use one priority per task");
    taggedPriority = true;
    priority = Number(value) as Priority;
  }, true);

  let rule: string | null = null;
  let days: Weekday[] = [];
  function setRecurrence(frequency: "DAILY" | "WEEKLY", count: number, selected: Weekday[] = []) {
    if (rule) throw new InvalidSchedule("Use one recurrence per task");
    if (count < 1 || count > 52) throw new InvalidSchedule("Recurrence interval must be 1–52");
    days = week.filter((day) => selected.includes(day));
    rule = "FREQ=" + frequency + (count === 1 ? "" : ";INTERVAL=" + count)
      + (days.length ? ";BYDAY=" + days.join(",") : "");
  }
  const koDays = (list: string) => (list.match(new RegExp(koDay, "g")) ?? []).map(weekday);

  consume(new RegExp(left + "every\\s+(weekday|weekend)s?" + right, "giu"), "recurrence",
    (kind) => setRecurrence("WEEKLY", 1, kind!.toLowerCase() === "weekday" ? workdays : weekend));
  consume(new RegExp(left + "every\\s+other\\s+(day|week)" + right, "giu"), "recurrence",
    (unit) => setRecurrence(unit!.toLowerCase() === "week" ? "WEEKLY" : "DAILY", 2));
  consume(new RegExp(left + "every\\s+(" + enList + ")" + right, "giu"), "recurrence",
    (list) => setRecurrence("WEEKLY", 1, (list!.match(new RegExp(enDay, "gi")) ?? []).map(weekday)));
  consume(new RegExp(left + "(?:매주\\s*(평일|주말)(?:\\s*마다)?|(평일|주말)\\s*마다)" + koRight, "gu"), "recurrence",
    (weekly, each) => setRecurrence("WEEKLY", 1, (weekly ?? each) === "평일" ? workdays : weekend));
  consume(new RegExp(left + "격주(?:\\s*(" + koList + "))?(?:\\s*마다)?" + koRight, "gu"), "recurrence",
    (list) => setRecurrence("WEEKLY", 2, list ? koDays(list) : []));
  consume(new RegExp(left + "매주\\s*(" + koList + ")(?:\\s*마다)?" + koRight, "gu"), "recurrence",
    (list) => setRecurrence("WEEKLY", 1, koDays(list!)));
  consume(new RegExp(left + "(" + koList + ")\\s*마다" + koRight, "gu"), "recurrence",
    (list) => setRecurrence("WEEKLY", 1, koDays(list!)));
  consume(new RegExp(left + "(\\d{1,2})\\s*(일|주)\\s*마다" + koRight, "gu"), "recurrence",
    (count, unit) => setRecurrence(unit === "주" ? "WEEKLY" : "DAILY", Number(count)));
  consume(new RegExp(left + "every\\s+(?:(\\d+)\\s+)?(days?|weeks?)" + right + "|"
      + left + "(daily|weekly)" + right, "giu"), "recurrence",
    (count, unit, shorthand) =>
      setRecurrence((unit ?? shorthand ?? "").toLowerCase().startsWith("w") ? "WEEKLY" : "DAILY", Number(count ?? 1)));
  consume(new RegExp(left + "(매일|매주)" + koRight, "gu"), "recurrence",
    (word) => setRecurrence(word === "매일" ? "DAILY" : "WEEKLY", 1));

  let explicitDate: Temporal.PlainDate | undefined;
  function setDate(date: Temporal.PlainDate) {
    if (explicitDate) throw new InvalidSchedule("Use one due date per task");
    explicitDate = date;
  }
  const baseMonday = today.subtract({ days: today.dayOfWeek - 1 });
  consume(new RegExp(left + "(?:다음\\s*주\\s*(" + koDay + ")(?:까지)?" + koRight
    + "|next\\s+week\\s+(" + enDay + ")" + right + "|next\\s+(" + enDay + ")" + right + ")", "giu"), "date",
    (kr, enWeek, en) => setDate(baseMonday.add({ days: 7 + week.indexOf(weekday(kr ?? enWeek ?? en!)) })));
  consume(new RegExp(left + "(?:이번\\s*주\\s*(" + koDay + ")(?:까지)?" + koRight
    + "|this\\s+(?:week\\s+)?(" + enDay + ")" + right + ")", "giu"), "date",
    (kr, en) => setDate(baseMonday.add({ days: week.indexOf(weekday(kr ?? en!)) })));
  consume(new RegExp(left + "(오늘|내일|모레)(?:까지)?" + koRight + "|"
    + left + "(day\\s+after\\s+tomorrow|tomorrow|today)" + right, "giu"), "date",
    (kr, en) => {
      const word = (kr ?? en ?? "").toLowerCase();
      const offset = word === "오늘" || word === "today" ? 0 : word === "내일" || word === "tomorrow" ? 1 : 2;
      setDate(today.add({ days: offset }));
    });
  consume(new RegExp(left + "(\\d{1,3})\\s*(일|주)\\s*(?:후|뒤)" + koRight + "|"
    + left + "in\\s+(\\d{1,3})\\s+(days?|weeks?)" + right, "giu"), "date",
    (krCount, krUnit, enCount, enUnit) => {
      const count = Number(krCount ?? enCount);
      setDate(today.add(krUnit === "주" || enUnit?.toLowerCase().startsWith("w") ? { weeks: count } : { days: count }));
    });
  consume(new RegExp(left + "(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일(?!간)(?:에|까지)?" + koRight, "gu"), "date",
    (month, day) => {
      // A month and day without a year means the next time that date comes around.
      const date = Temporal.PlainDate.from({ year: today.year, month: Number(month), day: Number(day) }, { overflow: "reject" });
      setDate(Temporal.PlainDate.compare(date, today) < 0
        ? Temporal.PlainDate.from({ year: today.year + 1, month: Number(month), day: Number(day) }, { overflow: "reject" })
        : date);
    });
  consume(new RegExp(left + "(\\d{4}-\\d{2}-\\d{2})" + right, "gu"), "date",
    (value) => setDate(Temporal.PlainDate.from(value!)));

  // `open` marks an hour written without 오전/오후 or am/pm; it is stored as the morning reading until
  // the rest of the entry is known.
  const clock: { time?: Temporal.PlainTime; nextDay?: boolean; open?: boolean } = {};
  function setTime(hourValue: string, minuteValue: string | undefined, period?: string) {
    if (clock.time) throw new InvalidSchedule("Use one due time per task");
    let hour = Number(hourValue);
    // "07:30" and "19시" are already 24-hour times; "7시" and "7:30" could be either half of the day.
    if (!period && hour >= 1 && hour <= 12 && !hourValue.startsWith("0")) {
      clock.open = true;
      hour %= 12;
    }
    if (period) {
      if (hour < 1 || hour > 12) throw new InvalidSchedule("Use 1–12 with AM/PM or 오전/오후");
      const word = period.toLowerCase();
      if (["am", "오전", "아침", "새벽"].includes(word)) hour %= 12;
      else if (["pm", "오후", "저녁"].includes(word)) hour = hour % 12 + 12;
      else if (word === "낮") hour = hour >= 11 ? hour : hour + 12;
      else {
        // 밤 6시–11시 is the evening, 밤 12시 is the midnight that ends the day, 밤 1시–5시 is after midnight.
        clock.nextDay = hour === 12;
        hour = hour === 12 ? 0 : hour >= 6 ? hour + 12 : hour;
      }
    }
    clock.time = Temporal.PlainTime.from({ hour, minute: Number(minuteValue ?? 0) }, { overflow: "reject" });
  }
  consume(new RegExp(left + "(?:(" + koPeriod + ")\\s*)?(\\d{1,2})\\s*시(?!간|리즈|즌)"
    + "(?:\\s*(\\d{1,2})\\s*분|\\s*(반)(?![가-힣]))?(?:쯤|경)?(?:에|까지)?(?=$|\\s|[,.!?]|[가-힣])", "gu"), "time",
    (period, hour, minute, half) => setTime(hour!, half ? "30" : minute, period));
  consume(new RegExp(left + "(?:at\\s+)?(\\d{1,2})(?::(\\d{1,2}))?\\s*(am|pm)" + right, "giu"), "time",
    (hour, minute, period) => setTime(hour!, minute, period));
  consume(new RegExp(left + "(?:(" + koPeriod + ")\\s*|at\\s+)?(\\d{1,2}):(\\d{1,2})" + right, "giu"), "time",
    (period, hour, minute) => setTime(hour!, minute, period));
  consume(new RegExp(left + "(정오|자정)(?:까지)?" + koRight + "|" + left + "(?:at\\s+)?(noon|midnight)" + right, "giu"), "time",
    (kr, en) => setTime(kr === "정오" || en?.toLowerCase() === "noon" ? "12" : "0", undefined));

  const title = remaining.replace(/\s+/g, " ").trim();
  if ((!title && !options.draft) || title.length > 500) throw new InvalidSchedule("Task title must have 1–500 characters");
  const time = clock.time && clock.open && isAfternoon(clock.time) ? clock.time.add({ hours: 12 }) : clock.time;
  /** Picks the half of the day a person most likely means by an hour written without 오전/오후. */
  function isAfternoon(morning: Temporal.PlainTime): boolean {
    if (morningWords.test(title)) return false;
    if (eveningWords.test(title)) return true;
    // 1시–5시 and 12시 are almost never the small hours.
    if (morning.hour < 6) return true;
    // A repeating task or another day has no "now" to be near, so 6시–11시 reads as the morning.
    if (rule || (explicitDate && !explicitDate.equals(today))) return false;
    const current = localNow.toPlainTime();
    if (Temporal.PlainTime.compare(morning, current) > 0) return false;
    if (Temporal.PlainTime.compare(morning.add({ hours: 12 }), current) > 0) return true;
    // Both have passed: "오늘 9시" stays today, a bare "9시" moves to tomorrow morning.
    return explicitDate !== undefined;
  }
  let due_at: string | null = null;
  if (explicitDate || time || rule) {
    let date = explicitDate ? explicitDate.add({ days: clock.nextDay ? 1 : 0 }) : today;
    for (let offset = 0; offset <= 7; offset++, date = date.add({ days: 1 })) {
      if (days.length && !days.includes(week[date.dayOfWeek - 1])) continue;
      const candidate = instantOn(date, time ?? null, input.timezone).toInstant();
      if (time && !explicitDate && Temporal.Instant.compare(candidate, now) <= 0) continue;
      due_at = candidate.toString();
      break;
    }
  }
  tokens.sort((a, b) => a.start - b.start);
  return {
    task: { title, due_at, all_day: due_at !== null && time === undefined, timezone: input.timezone,
      recurrence_rule: rule, recurrence_local_time: rule && time ? time.toString() : null,
      project, tags, priority },
    text, tokens,
  };
}

export function parseTask(input: ParseTaskInput): ParsedTask {
  return analyzeTask(input).task;
}
