// The JSON shape each feature asks for (sent as `output_config.format`) and the code that checks a reply
// against it before anything else reads it. Structured outputs make a matching reply very likely, not
// certain (a refusal or a cut-off reply may not match), so every field is checked again here, values out
// of range are dropped or clamped, and ids and list names the app did not send are ignored.
// Pure: tested with node:test.
import type { Temporal } from '@js-temporal/polyfill';

import { formatHHMM, parseHHMM, parseIsoDate } from './time.ts';

/** A JSON schema for the request plus the check that turns an untyped reply into `T`, or null when unusable. */
export interface AiSchema<T> {
  json: Record<string, unknown>;
  /** The top-level field the reply must have, named in the "자세히" line when a reply fails the check. */
  rootKey: string;
  parse: (raw: unknown) => T | null;
}

type Json = Record<string, unknown>;
const obj = (properties: Json, required = Object.keys(properties)): Json =>
  ({ type: 'object', additionalProperties: false, properties, required });
const nullable = (schema: Json): Json => ({ anyOf: [schema, { type: 'null' }] });
const str = (description?: string): Json => (description ? { type: 'string', description } : { type: 'string' });
const int = (description?: string): Json => (description ? { type: 'integer', description } : { type: 'integer' });
const arr = (items: Json): Json => ({ type: 'array', items });

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Trimmed, single-spaced, cut to `max` characters; empty becomes null. */
export function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

/** A whole number within [min, max], or null. */
function wholeIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : null;
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();

// ---------------------------------------------------------------------------------------------------------
// 메모 정리

export interface OrganizedTask {
  title: string;
  /** YYYY-MM-DD or null (no date). */
  date: string | null;
  /** Minutes after midnight, or null (all day / no time). */
  minutes: number | null;
  /** One of the owner's list names, exactly as the app has it, or null (미분류). */
  list: string | null;
  priority: 1 | 2 | 3 | 4;
  durationMinutes: number | null;
  subtasks: string[];
}

export const MAX_ORGANIZED = 30;

export function organizeSchema(listNames: string[], today: Temporal.PlainDate): AiSchema<OrganizedTask[]> {
  const names = [...new Set(listNames.filter((name) => name.trim()))];
  const json = obj({
    tasks: arr(obj({
      title: str('Short task title in Korean, as the owner would write it.'),
      date: nullable(str('YYYY-MM-DD, only when the memo implies a day.')),
      time: nullable(str('24-hour HH:MM, only when the memo names a time.')),
      list: names.length ? nullable({ type: 'string', enum: names }) : { type: 'null' },
      priority: { type: 'integer', enum: [1, 2, 3, 4], description: '1 highest, 4 none.' },
      duration_minutes: nullable(int('Estimated minutes, only when it is reasonably clear.')),
      subtasks: arr(str()),
    })),
  });
  return { json, rootKey: 'tasks', parse: (raw) => parseOrganized(raw, names, today) };
}

export function parseOrganized(raw: unknown, listNames: string[], today: Temporal.PlainDate): OrganizedTask[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.tasks)) return null;
  const result: OrganizedTask[] = [];
  for (const item of raw.tasks) {
    if (!isRecord(item)) continue;
    const title = cleanText(item.title);
    if (!title) continue;
    const minutes = parseHHMM(item.time);
    let date = parseIsoDate(item.date)?.toString() ?? null;
    // A time without a day means today; the app cannot store a time on an undated task.
    if (minutes !== null && !date) date = today.toString();
    const listName = typeof item.list === 'string' ? listNames.find((name) => sameText(name, item.list as string)) ?? null : null;
    const priority = wholeIn(item.priority, 1, 4) ?? 4;
    const subtasks = list(item.subtasks).map((sub) => cleanText(sub)).filter((sub): sub is string => !!sub).slice(0, 20);
    result.push({
      title, date, minutes, list: listName, priority: priority as 1 | 2 | 3 | 4,
      durationMinutes: wholeIn(item.duration_minutes, 1, 24 * 60), subtasks,
    });
    if (result.length >= MAX_ORGANIZED) break;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------
// 하루 계획 (validation of the proposal lives in plan.ts, which knows the window and the candidates)

export interface RawPlan {
  blocks: { taskId: string; start: number | null; minutes: number | null }[];
  leftOut: { taskId: string; reason: string | null }[];
  note: string | null;
}

export function planSchema(taskIds: string[]): AiSchema<RawPlan> {
  const id = taskIds.length ? { type: 'string', enum: taskIds } : str();
  const json = obj({
    blocks: arr(obj({ task_id: id, start: str('24-hour HH:MM'), minutes: int() })),
    left_out: arr(obj({ task_id: id, reason: str('Short Korean reason, under 25 characters.') })),
    note: str('One or two Korean sentences about the plan.'),
  });
  return { json, rootKey: 'blocks', parse: parseRawPlan };
}

export function parseRawPlan(raw: unknown): RawPlan | null {
  if (!isRecord(raw) || !Array.isArray(raw.blocks)) return null;
  const blocks = raw.blocks.filter(isRecord).flatMap((block) => (typeof block.task_id === 'string'
    ? [{ taskId: block.task_id, start: parseHHMM(block.start), minutes: wholeIn(block.minutes, 1, 24 * 60) }] : []));
  const leftOut = list(raw.left_out).filter(isRecord).flatMap((item) => (typeof item.task_id === 'string'
    ? [{ taskId: item.task_id, reason: cleanText(item.reason, 60) }] : []));
  return { blocks, leftOut, note: cleanText(raw.note, 300) };
}

// ---------------------------------------------------------------------------------------------------------
// 큰 일 쪼개기

export interface BreakdownStep {
  title: string;
  minutes: number | null;
}

export const MAX_STEPS = 8;

export function breakdownSchema(existingSubtasks: string[]): AiSchema<BreakdownStep[]> {
  const json = obj({
    steps: arr(obj({ title: str('Concrete step in natural Korean.'), minutes: nullable(int('Estimated minutes.')) })),
  });
  return { json, rootKey: 'steps', parse: (raw) => parseBreakdown(raw, existingSubtasks) };
}

export function parseBreakdown(raw: unknown, existingSubtasks: string[]): BreakdownStep[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.steps)) return null;
  const steps: BreakdownStep[] = [];
  for (const item of raw.steps) {
    if (!isRecord(item)) continue;
    const title = cleanText(item.title);
    if (!title) continue;
    if (existingSubtasks.some((existing) => sameText(existing, title)) || steps.some((step) => sameText(step.title, title))) continue;
    steps.push({ title, minutes: wholeIn(item.minutes, 1, 8 * 60) });
    if (steps.length >= MAX_STEPS) break;
  }
  return steps.length ? steps : null;
}

// ---------------------------------------------------------------------------------------------------------
// 주간 돌아보기

export interface WeeklyReview {
  headline: string;
  wins: string[];
  slipped: string[];
  patterns: string[];
  suggestions: { title: string; asTask: boolean }[];
}

export function reviewSchema(): AiSchema<WeeklyReview> {
  const json = obj({
    headline: str('One Korean sentence summing up the week.'),
    wins: arr(str()),
    slipped: arr(str()),
    patterns: arr(str()),
    suggestions: arr(obj({ title: str(), as_task: { type: 'boolean' } })),
  });
  return { json, rootKey: 'headline', parse: parseReview };
}

const sentences = (value: unknown, max: number) =>
  list(value).map((item) => cleanText(item, 240)).filter((item): item is string => !!item).slice(0, max);

export function parseReview(raw: unknown): WeeklyReview | null {
  if (!isRecord(raw)) return null;
  const headline = cleanText(raw.headline, 200);
  if (!headline) return null;
  const suggestions = list(raw.suggestions).filter(isRecord).flatMap((item) => {
    const title = cleanText(item.title, 200);
    return title ? [{ title, asTask: item.as_task === true }] : [];
  }).slice(0, 5);
  return {
    headline, wins: sentences(raw.wins, 6), slipped: sentences(raw.slipped, 6), patterns: sentences(raw.patterns, 5), suggestions,
  };
}

// ---------------------------------------------------------------------------------------------------------
// 자유 부탁

export type CommandActionKind =
  | 'add_task'
  | 'update_task'
  | 'complete_task'
  | 'delete_task'
  | 'add_habit'
  | 'set_habit_reminder';

export interface CommandAction {
  kind: CommandActionKind;
  taskId: string | null;
  habitId: string | null;
  title: string | null;
  /** YYYY-MM-DD, 'clear' (update_task only), or null. */
  date: string | 'clear' | null;
  /** Minutes after midnight, 'clear' (update_task only), or null. */
  minutes: number | 'clear' | null;
  /** 1..1440, 'clear' (update_task only, from 0), or null. */
  durationMinutes: number | 'clear' | null;
  priority: 1 | 2 | 3 | 4 | null;
  /** Matched list name, 'inbox' (미분류), or null. */
  list: string | 'inbox' | null;
  notes: string | null;
  subtasks: string[];
  /** Lead minutes (0..43200), 'off' (from -1), or null. */
  reminderMinutes: number | 'off' | null;
  habitCadence: 'daily' | 'weekly' | null;
  habitTarget: number | null;
  /** Normalized 24-hour HH:MM, 'off', or null. */
  habitReminderTime: string | 'off' | null;
}

export interface CommandReply {
  reply: string;
  actions: CommandAction[];
}

export interface CommandContext {
  listNames: string[];
  taskIds: string[];
  habitIds: string[];
  today: Temporal.PlainDate;
}

export const MAX_COMMAND_ACTIONS = 20;
const MAX_REMINDER_MINUTES = 43_200;

const COMMAND_KINDS: readonly CommandActionKind[] = [
  'add_task', 'update_task', 'complete_task', 'delete_task', 'add_habit', 'set_habit_reminder',
];

function isCommandKind(value: unknown): value is CommandActionKind {
  return typeof value === 'string' && (COMMAND_KINDS as readonly string[]).includes(value);
}

function cleanNotes(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1000) : null;
}

function parseCommandDate(value: unknown, allowClear: boolean): string | 'clear' | null {
  if (allowClear && typeof value === 'string' && value.trim().toLowerCase() === 'clear') return 'clear';
  return parseIsoDate(value)?.toString() ?? null;
}

function parseCommandTime(value: unknown, allowClear: boolean): number | 'clear' | null {
  if (allowClear && typeof value === 'string' && value.trim().toLowerCase() === 'clear') return 'clear';
  return parseHHMM(value);
}

function parseCommandDuration(value: unknown, allowClear: boolean): number | 'clear' | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (allowClear && rounded === 0) return 'clear';
  return rounded >= 1 && rounded <= 24 * 60 ? rounded : null;
}

function parseCommandList(value: unknown, listNames: string[]): string | 'inbox' | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'inbox' || sameText(trimmed, '미분류')) return 'inbox';
  return listNames.find((name) => sameText(name, trimmed)) ?? null;
}

function parseCommandReminder(value: unknown): number | 'off' | null {
  if (typeof value === 'string' && value.trim().toLowerCase() === 'off') return 'off';
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded === -1) return 'off';
  return rounded >= 0 && rounded <= MAX_REMINDER_MINUTES ? rounded : null;
}

function parseHabitReminder(value: unknown, allowOff: boolean): string | 'off' | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (allowOff && trimmed.toLowerCase() === 'off') return 'off';
  const minutes = parseHHMM(trimmed);
  return minutes !== null ? formatHHMM(minutes) : null;
}

export function commandSchema({ listNames, taskIds, habitIds, today }: CommandContext): AiSchema<CommandReply> {
  const names = [...new Set(listNames.filter((name) => name.trim()))];
  const validTaskIds = [...new Set(taskIds.filter((id) => id.trim()))];
  const validHabitIds = [...new Set(habitIds.filter((id) => id.trim()))];
  const listEnum = [...new Set(['inbox', ...names])];

  const json = obj({
    reply: str('Short, natural Korean reply in 합니다체 summarizing what was prepared or answering the question.'),
    actions: arr(obj({
      kind: { type: 'string', enum: [...COMMAND_KINDS] },
      task_id: validTaskIds.length ? nullable({ type: 'string', enum: validTaskIds }) : { type: 'null' },
      habit_id: validHabitIds.length ? nullable({ type: 'string', enum: validHabitIds }) : { type: 'null' },
      title: nullable(str('Task or habit title in Korean. Required for add_task and add_habit; set on update_task only to rename.')),
      date: nullable(str('YYYY-MM-DD, or "clear" to remove the schedule on update_task.')),
      time: nullable(str('24-hour HH:MM, or "clear" to make an existing task all-day on update_task.')),
      duration_minutes: nullable(int('Estimated minutes (1..1440), or 0 to clear on update_task.')),
      priority: nullable({ type: 'integer', enum: [1, 2, 3, 4], description: '1 highest, 4 none.' }),
      list: nullable({ type: 'string', enum: listEnum }),
      notes: nullable(str('Task notes when requested, otherwise null.')),
      subtasks: arr(str()),
      reminder_minutes: nullable(int('Lead minutes before task time (0 = on time, 10 = 10m before, 30 = 30m before, max 43200), or -1 to turn off.')),
      habit_cadence: nullable({ type: 'string', enum: ['daily', 'weekly'] }),
      habit_target: nullable(int('Target count per period: 1..20 for daily, 1..7 for weekly.')),
      habit_reminder_time: nullable(str('24-hour HH:MM for habit alert, or "off" to turn off.')),
    })),
  });

  return {
    json,
    rootKey: 'actions',
    parse: (raw) => parseCommandReply(raw, { listNames: names, taskIds: validTaskIds, habitIds: validHabitIds, today }),
  };
}

export function parseCommandReply(raw: unknown, { listNames, taskIds, habitIds, today }: CommandContext): CommandReply | null {
  if (!isRecord(raw) || !Array.isArray(raw.actions)) return null;
  const validTasks = new Set(taskIds);
  const validHabits = new Set(habitIds);
  const actions: CommandAction[] = [];

  for (const item of raw.actions) {
    if (!isRecord(item) || !isCommandKind(item.kind)) continue;
    const { kind } = item;

    const base: CommandAction = {
      kind,
      taskId: null,
      habitId: null,
      title: null,
      date: null,
      minutes: null,
      durationMinutes: null,
      priority: null,
      list: null,
      notes: null,
      subtasks: [],
      reminderMinutes: null,
      habitCadence: null,
      habitTarget: null,
      habitReminderTime: null,
    };

    if (kind === 'add_task') {
      const title = cleanText(item.title);
      if (!title) continue;
      const minutes = parseCommandTime(item.time, false);
      let date = parseCommandDate(item.date, false);
      if (typeof minutes === 'number' && !date) date = today.toString();
      const subtasks = list(item.subtasks).map((sub) => cleanText(sub)).filter((sub): sub is string => !!sub).slice(0, 20);
      actions.push({
        ...base,
        title,
        date,
        minutes,
        durationMinutes: parseCommandDuration(item.duration_minutes, false),
        priority: wholeIn(item.priority, 1, 4) as 1 | 2 | 3 | 4 | null,
        list: parseCommandList(item.list, listNames),
        notes: cleanNotes(item.notes),
        subtasks,
        reminderMinutes: parseCommandReminder(item.reminder_minutes),
      });
    } else if (kind === 'update_task') {
      const taskId = typeof item.task_id === 'string' && validTasks.has(item.task_id) ? item.task_id : null;
      if (!taskId) continue;
      const title = cleanText(item.title);
      const date = parseCommandDate(item.date, true);
      const minutes = date === 'clear' ? null : parseCommandTime(item.time, true);
      const durationMinutes = parseCommandDuration(item.duration_minutes, true);
      const priority = wholeIn(item.priority, 1, 4) as 1 | 2 | 3 | 4 | null;
      const listName = parseCommandList(item.list, listNames);
      const notes = cleanNotes(item.notes);
      const subtasks = list(item.subtasks).map((sub) => cleanText(sub)).filter((sub): sub is string => !!sub).slice(0, 20);
      const reminderMinutes = parseCommandReminder(item.reminder_minutes);
      const hasChange = title !== null || date !== null || minutes !== null || durationMinutes !== null
        || priority !== null || listName !== null || notes !== null || subtasks.length > 0 || reminderMinutes !== null;
      if (!hasChange) continue;
      actions.push({
        ...base,
        taskId,
        title,
        date,
        minutes,
        durationMinutes,
        priority,
        list: listName,
        notes,
        subtasks,
        reminderMinutes,
      });
    } else if (kind === 'complete_task' || kind === 'delete_task') {
      const taskId = typeof item.task_id === 'string' && validTasks.has(item.task_id) ? item.task_id : null;
      if (!taskId) continue;
      actions.push({ ...base, taskId });
    } else if (kind === 'add_habit') {
      const title = cleanText(item.title, 120);
      if (!title) continue;
      const habitCadence: 'daily' | 'weekly' = item.habit_cadence === 'weekly' ? 'weekly' : 'daily';
      const maxTarget = habitCadence === 'weekly' ? 7 : 20;
      const habitTarget = wholeIn(item.habit_target, 1, maxTarget);
      const habitReminderTime = parseHabitReminder(item.habit_reminder_time, false);
      actions.push({
        ...base,
        title,
        habitCadence,
        habitTarget,
        habitReminderTime,
      });
    } else if (kind === 'set_habit_reminder') {
      const habitId = typeof item.habit_id === 'string' && validHabits.has(item.habit_id) ? item.habit_id : null;
      const habitReminderTime = parseHabitReminder(item.habit_reminder_time, true);
      if (!habitId || !habitReminderTime) continue;
      actions.push({
        ...base,
        habitId,
        habitReminderTime,
      });
    }

    if (actions.length >= MAX_COMMAND_ACTIONS) break;
  }

  const reply = cleanText(raw.reply, 600);
  if (!reply && actions.length === 0) return null;
  return { reply: reply ?? '요청하신 내용을 정리했습니다.', actions };
}
