import type { TaskToken } from '@/lib/shared';

/** Dates, times and repeats share one pill so "오늘 7시" reads as a single schedule. */
export type PillKind = 'schedule' | 'project' | 'tag' | 'priority';
export interface Pill { start: number; end: number; kind: PillKind }
/** Where a wrapped line begins: its first character and its position inside the field. */
export interface Line { start: number; top: number; left: number }
/** One stretch of a line. `joinsBefore`/`joinsAfter` mark a pill that has another pill right beside it. */
export interface Run { text: string; kind?: PillKind; joinsBefore?: boolean; joinsAfter?: boolean }

export const firstLine: Line[] = [{ start: 0, top: 0, left: 0 }];

const kindOf = (token: TaskToken): PillKind =>
  (token.kind === 'date' || token.kind === 'time' || token.kind === 'recurrence' ? 'schedule' : token.kind);

/** Turns tokens into pills, joining schedule tokens that have only spaces between them. */
export function pills(text: string, tokens: TaskToken[]): Pill[] {
  const result: Pill[] = [];
  for (const token of tokens) {
    const last = result[result.length - 1];
    if (token.start < (last?.end ?? 0) || token.end > text.length) continue;
    const kind = kindOf(token);
    if (last && kind === 'schedule' && last.kind === 'schedule' && !text.slice(last.end, token.start).trim()) last.end = token.end;
    else result.push({ start: token.start, end: token.end, kind });
  }
  return result;
}

/**
 * Maps the lines a text layout reports onto offsets in `text`. Returns null when the report does not
 * describe this text (it can be one keystroke old), so the caller keeps what it had.
 */
export function lineStarts(text: string, reported: { text: string; x: number; y: number }[]): Line[] | null {
  const lines: Line[] = [];
  let cursor = 0;
  for (const line of reported) {
    const body = line.text.replace(/\s+$/, '');
    const found = body ? text.indexOf(body, cursor) : cursor;
    // Only spaces may sit between one line's end and the next line's first glyph.
    if (found < 0 || text.slice(cursor, found).trim()) return null;
    lines.push({ start: found, top: line.y, left: line.x });
    cursor = found + body.length;
  }
  if (text.slice(cursor).trim()) return null;
  return lines.length ? lines : firstLine;
}

/** Cuts the visual line `[from, to)` into plain runs and pills. Text after the last pill needs no run. */
export function runs(text: string, from: number, to: number, all: Pill[]): Run[] {
  const parts: Run[] = [];
  let cursor = from;
  for (const pill of all) {
    const start = Math.max(pill.start, from);
    const end = Math.min(pill.end, to);
    if (start >= end) continue;
    const last = parts[parts.length - 1];
    const gap = text.slice(cursor, start);
    // Two pills a single space apart would overlap if both reached into it.
    const joined = !!last?.kind && gap.length <= 1;
    if (joined) last.joinsAfter = true;
    if (gap) parts.push({ text: gap });
    parts.push({ text: text.slice(start, end), kind: pill.kind, joinsBefore: joined });
    cursor = end;
  }
  return parts;
}

/** Splits the full text into non-overlapping plain and highlighted spans for a single-pass `<Text>` render. */
export function segments(text: string, all: Pill[]): { text: string; kind?: PillKind }[] {
  if (!all.length) return text ? [{ text }] : [];
  const parts: { text: string; kind?: PillKind }[] = [];
  let cursor = 0;
  for (const pill of all) {
    if (pill.start < cursor || pill.end > text.length) continue;
    if (pill.start > cursor) parts.push({ text: text.slice(cursor, pill.start) });
    parts.push({ text: text.slice(pill.start, pill.end), kind: pill.kind });
    cursor = pill.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
