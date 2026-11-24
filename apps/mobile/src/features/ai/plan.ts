// 하루 계획: which tasks are offered to the model, and how its proposal is checked before it is shown.
// Pure (Temporal + type imports only), tested with node:test.
import { Temporal } from '@js-temporal/polyfill';

import type { Priority, Task } from '../../lib/shared';
import type { RawPlan } from './schemas.ts';
import { roundUp } from './time.ts';

export interface PlanCandidate {
  id: string;
  title: string;
  priority: Priority;
  /** The task's own estimate, if it has one. */
  durationMinutes: number | null;
  /** A time already set for later today: the plan keeps it. */
  fixedMinutes: number | null;
  overdue: boolean;
  /** YYYY-MM-DD the task was due. */
  dueDate: string;
  notes: string | null;
  task: Task;
}

export interface PlanWindow {
  /** Minutes after midnight, already moved past "now". */
  start: number;
  end: number;
}

/** 하루 시작 / 하루 끝 as set on the screen, narrowed to what is still ahead of `nowMinutes`. */
export function planWindow(dayStart: number, dayEnd: number, nowMinutes: number): PlanWindow | null {
  const start = Math.max(dayStart, roundUp(nowMinutes, 5));
  return dayEnd - start >= 15 ? { start, end: dayEnd } : null;
}

function zoned(task: Task): Temporal.ZonedDateTime | null {
  if (!task.due_at) return null;
  try {
    return Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone);
  } catch {
    return null;
  }
}

/**
 * Today's open work: top-level tasks due today or earlier. Repeating all-day tasks are left out, since giving
 * one a time would change every future occurrence, not just today's.
 */
export function collectCandidates(tasks: Task[], now: Temporal.Instant, max = 40): PlanCandidate[] {
  const result: PlanCandidate[] = [];
  for (const task of tasks) {
    if (task.completed_at || task.parent_task_id) continue;
    const at = zoned(task);
    if (!at) continue;
    const today = now.toZonedDateTimeISO(task.timezone).toPlainDate();
    const date = at.toPlainDate();
    const order = Temporal.PlainDate.compare(date, today);
    if (order > 0) continue;
    if (task.recurrence_rule && task.all_day) continue;
    const minutes = task.all_day ? null : at.hour * 60 + at.minute;
    const nowMinutes = now.toZonedDateTimeISO(task.timezone);
    const fixed = order === 0 && minutes !== null && minutes >= nowMinutes.hour * 60 + nowMinutes.minute ? minutes : null;
    result.push({
      id: task.id, title: task.title, priority: task.priority, durationMinutes: task.duration_minutes, fixedMinutes: fixed,
      overdue: order < 0 || (minutes !== null && fixed === null), dueDate: date.toString(), notes: task.notes?.trim() || null, task,
    });
  }
  result.sort((a, b) => a.priority - b.priority || (a.fixedMinutes ?? 9999) - (b.fixedMinutes ?? 9999) || a.dueDate.localeCompare(b.dueDate));
  return result.slice(0, max);
}

export interface PlanBlock {
  candidate: PlanCandidate;
  start: number;
  minutes: number;
  /** The task already had this time; applying leaves its time alone. */
  fixed: boolean;
}

export interface CheckedPlan {
  blocks: PlanBlock[];
  leftOut: { candidate: PlanCandidate; reason: string | null }[];
  note: string | null;
}

const DEFAULT_MINUTES = 30;
const MIN_BLOCK = 10;

/**
 * Turns the model's proposal into a plan the app can apply: unknown and repeated ids are dropped, tasks that
 * already had a time keep it, blocks are pulled into the window (or left out when they cannot fit), and a
 * block that overlaps an earlier one is left out rather than moved.
 */
export function checkPlan(raw: RawPlan, candidates: PlanCandidate[], window: PlanWindow): CheckedPlan {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const used = new Set<string>();
  const leftOut = new Map<string, string | null>();
  const proposed: PlanBlock[] = [];

  // Tasks with a time later today stay put whatever the model said.
  for (const candidate of candidates) {
    if (candidate.fixedMinutes === null) continue;
    const said = raw.blocks.find((block) => block.taskId === candidate.id);
    proposed.push({
      candidate, start: candidate.fixedMinutes, minutes: candidate.durationMinutes ?? said?.minutes ?? DEFAULT_MINUTES, fixed: true,
    });
    used.add(candidate.id);
  }

  for (const block of raw.blocks) {
    const candidate = byId.get(block.taskId);
    if (!candidate || used.has(candidate.id)) continue;
    used.add(candidate.id);
    let start = block.start ?? window.start;
    let minutes = block.minutes ?? candidate.durationMinutes ?? DEFAULT_MINUTES;
    if (start < window.start) start = window.start;
    if (start + minutes > window.end) minutes = window.end - start;
    if (minutes < MIN_BLOCK) {
      leftOut.set(candidate.id, '오늘 남은 시간이 부족합니다');
      continue;
    }
    proposed.push({ candidate, start, minutes, fixed: false });
  }

  // Fixed blocks first so they win any overlap, then the rest in time order.
  proposed.sort((a, b) => Number(b.fixed) - Number(a.fixed) || a.start - b.start);
  const accepted: PlanBlock[] = [];
  for (const block of proposed) {
    const clash = accepted.some((other) => block.start < other.start + other.minutes && other.start < block.start + block.minutes);
    if (clash && !block.fixed) {
      leftOut.set(block.candidate.id, '다른 일과 시간이 겹칩니다');
      continue;
    }
    accepted.push(block);
  }
  accepted.sort((a, b) => a.start - b.start);

  for (const item of raw.leftOut) {
    if (byId.has(item.taskId) && !accepted.some((block) => block.candidate.id === item.taskId) && !leftOut.has(item.taskId)) {
      leftOut.set(item.taskId, item.reason);
    }
  }
  for (const candidate of candidates) {
    if (!accepted.some((block) => block.candidate.id === candidate.id) && !leftOut.has(candidate.id)) leftOut.set(candidate.id, null);
  }

  return {
    blocks: accepted,
    leftOut: [...leftOut].map(([id, reason]) => ({ candidate: byId.get(id)!, reason })),
    note: raw.note,
  };
}

/** Whether applying a block changes anything: a new time, or a duration where the task had none. */
export function blockChanges(block: PlanBlock): { time: boolean; duration: boolean } {
  return { time: !block.fixed, duration: block.candidate.durationMinutes === null };
}
