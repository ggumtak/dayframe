// The JSON shape each feature asks for (sent as `output_config.format`) and the code that checks a reply
// against it before anything else reads it. Structured outputs make a matching reply very likely, not
// certain (a refusal or a cut-off reply may not match), so every field is checked again here, values out
// of range are dropped or clamped, and ids and list names the app did not send are ignored.
// Pure: tested with node:test.
import type { Temporal } from '@js-temporal/polyfill';

import { parseHHMM, parseIsoDate } from './time.ts';

/** A JSON schema for the request plus the check that turns an untyped reply into `T`, or null when unusable. */
export interface AiSchema<T> {
  json: Record<string, unknown>;
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
  return { json, parse: (raw) => parseOrganized(raw, names, today) };
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
  return { json, parse: parseRawPlan };
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
  return { json, parse: (raw) => parseBreakdown(raw, existingSubtasks) };
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
  return { json, parse: parseReview };
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
