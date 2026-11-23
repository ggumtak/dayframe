import type { Priority, Task } from './shared';

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

export interface ParsedSearchQuery {
  priority: Priority | null;
  projectTerms: string[];
  tagTerms: string[];
  words: string[];
}

/** Splits a search input into structured filters (`#project`, `@tag`, `p1`–`p4`) and free-text terms. */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let priority: Priority | null = null;
  const projectTerms: string[] = [];
  const tagTerms: string[] = [];
  const words: string[] = [];

  for (const token of tokens) {
    const pMatch = /^p([1-4])$/i.exec(token);
    if (pMatch && priority === null) {
      priority = Number(pMatch[1]) as Priority;
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
    words.push(token);
  }
  return { priority, projectTerms, tagTerms, words };
}

export interface SearchContext {
  projectNames: Map<string, string>;
  tagNames: Map<string, string[]>;
}

/**
 * Searches tasks with structured `#project`, `@tag`, `p1`–`p4` filtering plus Korean chosung matching,
 * returning matches ranked by relevance (exact title > prefix > title > chosung > project/tag > notes).
 */
export function searchTasks(tasks: Task[], rawQuery: string, context: SearchContext): Task[] {
  const parsed = parseSearchQuery(rawQuery);
  const hasFilters = parsed.priority !== null || parsed.projectTerms.length > 0
    || parsed.tagTerms.length > 0 || parsed.words.length > 0;
  if (!hasFilters) return [];

  const ranked: { task: Task; score: number }[] = [];
  for (const task of tasks) {
    if (parsed.priority !== null && task.priority !== parsed.priority) continue;

    const projectName = task.project_id ? context.projectNames.get(task.project_id) ?? '' : '';
    const tags = context.tagNames.get(task.id) ?? [];

    if (parsed.projectTerms.length > 0) {
      const ok = parsed.projectTerms.every((term) => matchScore(projectName, term) > 0);
      if (!ok) continue;
    }
    if (parsed.tagTerms.length > 0) {
      const ok = parsed.tagTerms.every((term) => tags.some((tag) => matchScore(tag, term) > 0));
      if (!ok) continue;
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
