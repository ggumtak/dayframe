import { Temporal } from '@js-temporal/polyfill';

import type { Priority, Task } from './shared';
import { isStaleTask } from './smart.ts';

const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const CHOSUNG_SET = new Set<string>(CHOSUNG);

/** Extracts Korean initial consonants (초성) while keeping non-Hangul characters lowercased. */
export function extractChosung(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_END) {
      out += CHOSUNG[Math.floor((code - HANGUL_BASE) / 588)];
    } else if (!/\s/.test(ch)) {
      out += ch.toLowerCase();
    }
  }
  return out;
}

/** True when `word` consists purely of Korean initial consonants (e.g. "ㅈㅂㄱ" for "장보기"). */
export function isChosungQuery(word: string): boolean {
  if (!word) return false;
  for (const ch of word) {
    if (!CHOSUNG_SET.has(ch)) return false;
  }
  return true;
}

/** Lower-cased and with spaces removed, so "보고 서" still finds "보고서". */
export const foldText = (text: string): string => text.toLowerCase().replace(/\s+/g, '');

/** Matches `needle` against `target` by folded substring OR Korean chosung sequence. */
export function matchScore(target: string, needle: string): number {
  if (!target || !needle) return 0;
  const foldedTarget = foldText(target);
  const foldedNeedle = foldText(needle);
  if (!foldedNeedle) return 0;
  if (foldedTarget === foldedNeedle) return 100;
  if (foldedTarget.startsWith(foldedNeedle)) return 80;
  if (foldedTarget.includes(foldedNeedle)) return 60;
  if (isChosungQuery(foldedNeedle)) {
    const chosungTarget = extractChosung(target);
    if (chosungTarget === foldedNeedle) return 75;
    if (chosungTarget.startsWith(foldedNeedle)) return 55;
    if (chosungTarget.includes(foldedNeedle)) return 40;
  }
  return 0;
}

export type SearchDueFilter = 'today' | 'overdue' | 'week' | 'none';

export type QuickFilterKey = 'overdue' | 'today' | 'week' | 'p1' | 'repeating' | 'checklist' | 'stale' | 'unscheduled';

export const QUICK_FILTER_KEYS: readonly QuickFilterKey[] = [
  'overdue', 'today', 'week', 'p1', 'repeating', 'checklist', 'stale', 'unscheduled',
];

export const isQuickFilterKey = (value: string): value is QuickFilterKey =>
  (QUICK_FILTER_KEYS as readonly string[]).includes(value);

export interface ParsedSearchQuery {
  priority: Priority | null;
  excludePriorities: Priority[];
  projectTerms: string[];
  excludeProjectTerms: string[];
  tagTerms: string[];
  excludeTagTerms: string[];
  dueFilter: SearchDueFilter | null;
  hasSubtasks: boolean;
  words: string[];
}

/**
 * Splits a search input into structured filters (`#project`, `@tag`, `p1`–`p4`, `due:today|overdue|week|none`,
 * `has:subtasks`, and `-p4` / `-#project` / `-@tag` negations) and free-text terms.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let priority: Priority | null = null;
  const excludePriorities: Priority[] = [];
  const projectTerms: string[] = [];
  const excludeProjectTerms: string[] = [];
  const tagTerms: string[] = [];
  const excludeTagTerms: string[] = [];
  let dueFilter: SearchDueFilter | null = null;
  let hasSubtasks = false;
  const words: string[] = [];

  for (const token of tokens) {
    const pMatch = /^p([1-4])$/i.exec(token);
    if (pMatch && priority === null) {
      priority = Number(pMatch[1]) as Priority;
      continue;
    }
    const negPMatch = /^-p([1-4])$/i.exec(token);
    if (negPMatch) {
      const p = Number(negPMatch[1]) as Priority;
      if (!excludePriorities.includes(p)) excludePriorities.push(p);
      continue;
    }
    if (token.startsWith('-#') && token.length > 2) {
      excludeProjectTerms.push(token.slice(2));
      continue;
    }
    if (token.startsWith('-@') && token.length > 2) {
      excludeTagTerms.push(token.slice(2));
      continue;
    }
    if (token.startsWith('#') && token.length > 1) {
      projectTerms.push(token.slice(1));
      continue;
    }
    if (token.startsWith('@') && token.length > 1) {
      tagTerms.push(token.slice(1));
      continue;
    }
    const dueMatch = /^due:(today|overdue|week|none)$/i.exec(token);
    if (dueMatch && dueFilter === null) {
      dueFilter = dueMatch[1].toLowerCase() as SearchDueFilter;
      continue;
    }
    if (/^has:subtasks?$/i.test(token)) {
      hasSubtasks = true;
      continue;
    }
    words.push(token);
  }
  return {
    priority,
    excludePriorities,
    projectTerms,
    excludeProjectTerms,
    tagTerms,
    excludeTagTerms,
    dueFilter,
    hasSubtasks,
    words,
  };
}

export interface SearchContext {
  projectNames: Map<string, string>;
  tagNames: Map<string, string[]>;
  subtaskProgress?: Map<string, { total: number }>;
  /** Reference epoch ms for `due:*` and time-based quick filters (defaults to `Date.now()`). */
  nowMs?: number;
  /** Optional logical day boundary shift (0..5 hours), matching `PersonalPrefs.dayStartHour`. */
  dayStartHour?: number;
}

function taskDueDayDelta(task: Pick<Task, 'due_at' | 'timezone'>, nowMs: number, dayStartHour: number): number | null {
  if (!task.due_at) return null;
  try {
    const dueDate = Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone).toPlainDate();
    const nowInstant = Temporal.Instant.fromEpochMilliseconds(nowMs);
    const shift = Math.max(0, Math.min(5, Math.round(dayStartHour)));
    const refInstant = shift > 0 ? nowInstant.subtract({ hours: shift }) : nowInstant;
    const taskToday = refInstant.toZonedDateTimeISO(task.timezone).toPlainDate();
    return taskToday.until(dueDate, { largestUnit: 'days' }).days;
  } catch {
    return null;
  }
}

function matchesDueFilter(task: Task, dueFilter: SearchDueFilter, nowMs: number, dayStartHour: number): boolean {
  if (dueFilter === 'none') return !task.due_at;
  const delta = taskDueDayDelta(task, nowMs, dayStartHour);
  if (delta === null) return false;
  if (dueFilter === 'overdue') return delta < 0;
  if (dueFilter === 'today') return delta === 0;
  return delta >= 0 && delta <= 7;
}

export interface QuickFilterContext {
  subtaskProgress?: Map<string, { total: number }>;
  nowMs?: number;
  dayStartHour?: number;
}

/** Evaluates a single quick filter chip against `task`. */
export function matchesQuickFilter(task: Task, filter: QuickFilterKey, context: QuickFilterContext = {}): boolean {
  const nowMs = context.nowMs ?? Date.now();
  const dayStartHour = context.dayStartHour ?? 0;
  if (filter === 'overdue') return matchesDueFilter(task, 'overdue', nowMs, dayStartHour);
  if (filter === 'today') return matchesDueFilter(task, 'today', nowMs, dayStartHour);
  if (filter === 'week') return matchesDueFilter(task, 'week', nowMs, dayStartHour);
  if (filter === 'p1') return task.priority === 1;
  if (filter === 'repeating') return !!task.recurrence_rule;
  if (filter === 'checklist') return (context.subtaskProgress?.get(task.id)?.total ?? 0) > 0;
  if (filter === 'stale') return isStaleTask(task, nowMs, 14);
  return !task.due_at;
}

/** Filters `tasks` by an AND-composed set/list of quick filters. */
export function applyQuickFilters(
  tasks: Task[],
  filters: Iterable<string>,
  context: QuickFilterContext = {},
): Task[] {
  const active: QuickFilterKey[] = [];
  for (const raw of filters) {
    if (isQuickFilterKey(raw)) active.push(raw);
  }
  if (active.length === 0) return tasks;
  return tasks.filter((task) => active.every((f) => matchesQuickFilter(task, f, context)));
}

/**
 * Searches tasks with structured `#project`, `@tag`, `p1`–`p4`, `due:*`, `has:subtasks`, negations (`-p4`, `-#project`, `-@tag`),
 * plus Korean chosung matching, returning matches ranked by relevance (exact title > prefix > title > chosung > project/tag > notes).
 */
export function searchTasks(tasks: Task[], rawQuery: string, context: SearchContext): Task[] {
  const parsed = parseSearchQuery(rawQuery);
  const hasFilters = parsed.priority !== null
    || parsed.excludePriorities.length > 0
    || parsed.projectTerms.length > 0
    || parsed.excludeProjectTerms.length > 0
    || parsed.tagTerms.length > 0
    || parsed.excludeTagTerms.length > 0
    || parsed.dueFilter !== null
    || parsed.hasSubtasks
    || parsed.words.length > 0;
  if (!hasFilters) return [];

  const nowMs = context.nowMs ?? Date.now();
  const dayStartHour = context.dayStartHour ?? 0;
  let fallbackParents: Set<string> | null = null;
  if (parsed.hasSubtasks && !context.subtaskProgress) {
    fallbackParents = new Set<string>();
    for (const task of tasks) {
      if (task.parent_task_id) fallbackParents.add(task.parent_task_id);
    }
  }

  const ranked: { task: Task; score: number }[] = [];
  for (const task of tasks) {
    if (parsed.priority !== null && task.priority !== parsed.priority) continue;
    if (parsed.excludePriorities.length > 0 && parsed.excludePriorities.includes(task.priority)) continue;

    if (parsed.dueFilter !== null && !matchesDueFilter(task, parsed.dueFilter, nowMs, dayStartHour)) continue;

    if (parsed.hasSubtasks) {
      const hasSubs = context.subtaskProgress
        ? (context.subtaskProgress.get(task.id)?.total ?? 0) > 0
        : fallbackParents!.has(task.id);
      if (!hasSubs) continue;
    }

    const projectName = task.project_id ? context.projectNames.get(task.project_id) ?? '' : '';
    const tags = context.tagNames.get(task.id) ?? [];

    if (parsed.projectTerms.length > 0) {
      const ok = parsed.projectTerms.every((term) => matchScore(projectName, term) > 0);
      if (!ok) continue;
    }
    if (parsed.excludeProjectTerms.length > 0) {
      const excluded = parsed.excludeProjectTerms.some((term) => projectName && matchScore(projectName, term) > 0);
      if (excluded) continue;
    }
    if (parsed.tagTerms.length > 0) {
      const ok = parsed.tagTerms.every((term) => tags.some((tag) => matchScore(tag, term) > 0));
      if (!ok) continue;
    }
    if (parsed.excludeTagTerms.length > 0) {
      const excluded = parsed.excludeTagTerms.some((term) => tags.some((tag) => matchScore(tag, term) > 0));
      if (excluded) continue;
    }

    let score = parsed.priority !== null ? 10 : 0;
    let matchedAll = true;
    for (const word of parsed.words) {
      const titleHit = matchScore(task.title, word);
      const projectHit = projectName ? matchScore(projectName, word) * 0.6 : 0;
      const tagHit = tags.reduce((best, tag) => Math.max(best, matchScore(tag, word) * 0.65), 0);
      const notesHit = task.notes ? matchScore(task.notes, word) * 0.45 : 0;
      const best = Math.max(titleHit, projectHit, tagHit, notesHit);
      if (best <= 0) {
        matchedAll = false;
        break;
      }
      score += best;
    }
    if (!matchedAll) continue;
    ranked.push({ task, score });
  }

  return ranked
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDue = a.task.due_at ? Date.parse(a.task.due_at) : Number.POSITIVE_INFINITY;
      const bDue = b.task.due_at ? Date.parse(b.task.due_at) : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return a.task.priority - b.task.priority || a.task.position - b.task.position;
    })
    .map((entry) => entry.task);
}
