import type { Priority, TaskToken } from '@/lib/shared';

export interface ActiveMention {
  kind: 'project' | 'tag';
  query: string;
  start: number;
  end: number;
}

/**
 * Detects a `#project` or `@tag` token being typed at `cursor` (defaults to end of `text`),
 * so the quick-add bar can suggest matches even when editing mid-sentence.
 */
export function activeMention(text: string, cursor: number = text.length): ActiveMention | null {
  const pos = Math.max(0, Math.min(text.length, cursor));
  const before = text.slice(0, pos);
  const match = /(?:^|\s)([#@])([^\s"]*)$/.exec(before);
  if (!match) return null;
  const symbol = match[1];
  const query = match[2];
  const tail = /^[^\s"]*/.exec(text.slice(pos))?.[0] ?? '';
  const start = pos - query.length - 1;
  return { kind: symbol === '#' ? 'project' : 'tag', query, start, end: pos + tail.length };
}

/** Filters existing project or tag names for `query`, putting prefix matches first. */
export function matchNames(names: string[], query: string, limit = 8): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return names.slice(0, limit);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.startsWith(needle)) starts.push(name);
    else if (lower.includes(needle)) contains.push(name);
  }
  return [...starts, ...contains].slice(0, limit);
}

function formatMention(prefix: '#' | '@', name: string): string {
  return /\s/.test(name) ? `${prefix}"${name}"` : `${prefix}${name}`;
}

/** Replaces the active `#...` or `@...` fragment with the chosen name, quoting names that contain spaces and preserving trailing text. */
export function applyMention(text: string, mention: ActiveMention, name: string): string {
  const prefix = mention.kind === 'project' ? '#' : '@';
  const formatted = formatMention(prefix, name);
  const before = text.slice(0, mention.start);
  const after = text.slice(mention.end);
  if (!after) return before + formatted + ' ';
  return before + formatted + (/^\s/.test(after) ? after : ' ' + after);
}

/** Sets, replaces, or clears a `#project` token in the quick-add bar without creating duplicates. */
export function applyProject(text: string, name: string | null, tokens: TaskToken[]): string {
  const existing = tokens.find((token) => token.kind === 'project');
  const next = name ? formatMention('#', name) : '';
  if (existing) {
    const before = text.slice(0, existing.start).replace(/\s+$/, '');
    const after = text.slice(existing.end).replace(/^\s+/, '');
    const parts = [before, next, after].filter(Boolean);
    return parts.join(' ') + (parts.length ? ' ' : '');
  }
  if (!next) return text;
  const trimmed = text.replace(/\s+$/, '');
  return (trimmed ? trimmed + ' ' : '') + next + ' ';
}

/** Adds or removes an `@tag` token in the quick-add bar. */
export function toggleTag(text: string, name: string, tokens: TaskToken[]): string {
  const target = name.trim().toLowerCase();
  const hasTag = tokens.some(
    (token) => token.kind === 'tag' && token.text.replace(/^@"?|"?$/g, '').toLowerCase() === target,
  );
  if (hasTag) {
    return removeTokens(
      text,
      tokens,
      (token) => token.kind === 'tag' && token.text.replace(/^@"?|"?$/g, '').toLowerCase() === target,
    );
  }
  const formatted = formatMention('@', name.trim());
  const trimmed = text.replace(/\s+$/, '');
  return (trimmed ? trimmed + ' ' : '') + formatted + ' ';
}

/** Sets or replaces a `p1`–`p4` priority token in the quick-add bar without creating duplicates. */
export function applyPriority(text: string, priority: Priority, tokens: TaskToken[]): string {
  const existing = tokens.find((token) => token.kind === 'priority');
  const next = priority === 4 ? '' : 'p' + priority;
  if (existing) {
    const before = text.slice(0, existing.start).replace(/\s+$/, '');
    const after = text.slice(existing.end).replace(/^\s+/, '');
    const parts = [before, next, after].filter(Boolean);
    return parts.join(' ') + (parts.length ? ' ' : '');
  }
  if (!next) return text;
  const trimmed = text.replace(/\s+$/, '');
  return (trimmed ? trimmed + ' ' : '') + next + ' ';
}

/**
 * Inserts a date, time, duration, or recurrence shortcut, replacing any existing token of the same kind to avoid parse errors.
 * When `cursor` sits on a word boundary inside `text`, inserts at `cursor` rather than forcing the token to the end.
 */
export function applyScheduleWord(
  text: string,
  word: string,
  kind: 'date' | 'time' | 'duration' | 'recurrence',
  tokens: TaskToken[],
  cursor?: number,
): string {
  const existing = tokens.find((token) => token.kind === kind);
  if (existing) {
    const before = text.slice(0, existing.start);
    const after = text.slice(existing.end);
    return before + word + (after.startsWith(' ') || !after ? after || ' ' : ' ' + after);
  }
  if (cursor !== undefined) {
    const pos = Math.max(0, Math.min(text.length, cursor));
    const leftBoundary = pos === 0 || /\s/.test(text[pos - 1]);
    const rightBoundary = pos === text.length || /\s/.test(text[pos]);
    if (pos < text.length && leftBoundary && rightBoundary) {
      const before = text.slice(0, pos).replace(/\s+$/, '');
      const after = text.slice(pos).replace(/^\s+/, '');
      const parts = [before, word, after].filter(Boolean);
      return parts.join(' ') + (after ? '' : ' ');
    }
  }
  const trimmed = text.replace(/\s+$/, '');
  return (trimmed ? trimmed + ' ' : '') + word + ' ';
}

/** Splits pasted/multi-line checklist text into clean lines, stripping common bullet or checkbox prefixes. */
export function parseChecklistLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:[-*•·▪▸]\s*(?:\[[ xX]\]\s*)?|\d+[.)]\s*)/, '').trim())
    .filter(Boolean);
}

/** Removes tokens matching `predicate` from `text`, keeping spacing tidy. */
export function removeTokens(text: string, tokens: TaskToken[], predicate: (token: TaskToken) => boolean): string {
  const targets = tokens.filter(predicate).sort((a, b) => b.start - a.start);
  if (!targets.length) return text;
  let next = text;
  for (const token of targets) {
    const before = next.slice(0, token.start).replace(/\s+$/, '');
    const after = next.slice(token.end).replace(/^\s+/, '');
    next = before && after ? before + ' ' + after : before || after;
  }
  return next ? next + ' ' : '';
}
