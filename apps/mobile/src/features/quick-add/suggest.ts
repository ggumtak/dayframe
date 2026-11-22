import type { Priority, TaskToken } from '@/lib/shared';

export interface ActiveMention {
  kind: 'project' | 'tag';
  query: string;
  start: number;
  end: number;
}

/** Detects a trailing `#project` or `@tag` token being typed, so the quick-add bar can suggest matches. */
export function activeMention(text: string): ActiveMention | null {
  const match = /(?:^|\s)([#@])([^\s"]*)$/.exec(text);
  if (!match) return null;
  const symbol = match[1];
  const query = match[2];
  const start = text.length - query.length - 1;
  return { kind: symbol === '#' ? 'project' : 'tag', query, start, end: text.length };
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

/** Replaces the active `#...` or `@...` fragment with the chosen name, quoting names that contain spaces. */
export function applyMention(text: string, mention: ActiveMention, name: string): string {
  const prefix = mention.kind === 'project' ? '#' : '@';
  const formatted = /\s/.test(name) ? `${prefix}"${name}"` : `${prefix}${name}`;
  return text.slice(0, mention.start) + formatted + ' ';
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

/** Inserts a date or recurrence shortcut, replacing any existing token of the same kind to avoid parse errors. */
export function applyScheduleWord(text: string, word: string, kind: 'date' | 'recurrence', tokens: TaskToken[]): string {
  const existing = tokens.find((token) => token.kind === kind);
  if (existing) {
    const before = text.slice(0, existing.start);
    const after = text.slice(existing.end);
    return before + word + (after.startsWith(' ') || !after ? after || ' ' : ' ' + after);
  }
  const trimmed = text.replace(/\s+$/, '');
  return (trimmed ? trimmed + ' ' : '') + word + ' ';
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
