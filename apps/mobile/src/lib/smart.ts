import { Temporal } from '@js-temporal/polyfill';

import { occurrenceDates, type NextOccurrence } from './occurrences.ts';
import type { Priority, Task } from './shared';

function zoned(task: Pick<Task, 'due_at' | 'timezone'>): Temporal.ZonedDateTime | null {
  if (!task.due_at) return null;
  try {
    return Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone);
  } catch {
    return null;
  }
}

const dueDate = (task: Pick<Task, 'due_at' | 'timezone'>): Temporal.PlainDate | null => zoned(task)?.toPlainDate() ?? null;
const dueMinutes = (task: Pick<Task, 'due_at' | 'timezone' | 'all_day'>): number | null => {
  const at = task.all_day ? null : zoned(task);
  return at ? at.hour * 60 + at.minute : null;
};
const localToday = (timeZone: string, nowMs: number): Temporal.PlainDate =>
  Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO(timeZone).toPlainDate();
const dueBucketAt = (task: Pick<Task, 'due_at' | 'timezone'>, nowMs: number): 'none' | 'overdue' | 'today' | 'upcoming' => {
  const date = dueDate(task);
  if (!date) return 'none';
  const order = Temporal.PlainDate.compare(date, localToday(task.timezone, nowMs));
  return order < 0 ? 'overdue' : order === 0 ? 'today' : 'upcoming';
};

export interface SubtaskProgress {
  open: number;
  completed: number;
  total: number;
}

export type EisenhowerQuadrant = 'q1' | 'q2' | 'q3' | 'q4';

export interface SmartScoreContext {
  nowMs?: number;
  subtaskProgress?: Map<string, SubtaskProgress>;
}

const PRIORITY_WEIGHT: Record<Priority, number> = { 1: 100, 2: 60, 3: 28, 4: 0 };

/**
 * Computes an actionable urgency + importance score (inspired by Todoist Smart Priority & Sunsama).
 *
 * - Priority sets the primary tier (P1=100, P2=60, P3=28, P4=0).
 * - Due proximity boosts tasks due soon or today.
 * - Overdue urgency uses a capped logarithmic curve so a 30-day stale P4 task does not bury today's P1.
 * - Partially completed checklists (Zeigarnik effect) get a small momentum bonus to encourage finishing.
 */
export function computeUrgencyScore(task: Task, context: SmartScoreContext = {}): number {
  const nowMs = context.nowMs ?? Date.now();
  let score = PRIORITY_WEIGHT[task.priority] ?? 0;

  if (task.due_at) {
    const dueMs = Date.parse(task.due_at);
    const taskToday = Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO(task.timezone).toPlainDate();
    const date = dueDate(task);
    if (date) {
      const dayDelta = taskToday.until(date).days;
      if (dayDelta < 0) {
        // Capped logarithmic overdue boost: 1 day late = +52, 7 days = +66, 30 days = +75 (never overwhelms P1 today).
        const lateDays = Math.abs(dayDelta);
        score += Math.round(45 + Math.min(30, Math.log2(lateDays + 1) * 8));
      } else if (dayDelta === 0) {
        if (!task.all_day && Number.isFinite(dueMs)) {
          const hoursUntil = (dueMs - nowMs) / 3_600_000;
          if (hoursUntil <= 0) score += 62;
          else if (hoursUntil <= 2) score += 55;
          else if (hoursUntil <= 6) score += 44;
          else score += 36;
        } else {
          score += 32;
        }
      } else if (dayDelta === 1) {
        score += 16;
      } else if (dayDelta <= 3) {
        score += 9;
      } else if (dayDelta <= 7) {
        score += 4;
      }
    }
  }

  const progress = context.subtaskProgress?.get(task.id);
  if (progress && progress.completed > 0 && progress.open > 0) {
    // Zeigarnik bonus: tasks already underway are disproportionately high-leverage to finish.
    const ratio = progress.completed / progress.total;
    score += Math.round(10 + ratio * 10);
  }

  return score;
}

/** Comparator sorting open tasks by Smart Urgency Score descending, then earliest due date, then manual order. */
export function bySmartRank(a: Task, b: Task, context: SmartScoreContext = {}): number {
  const diff = computeUrgencyScore(b, context) - computeUrgencyScore(a, context);
  if (diff !== 0) return diff;
  const aMs = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
  const bMs = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
  if (aMs !== bMs) return aMs - bMs;
  return a.priority - b.priority || a.position - b.position || (a.id < b.id ? -1 : 1);
}

/**
 * Detects aging tasks that have sat untouched for `staleDays` (default 14 days),
 * either unscheduled in the backlog or overdue, so the user can consciously act or drop them.
 */
export function isStaleTask(task: Task, nowMs = Date.now(), staleDays = 14): boolean {
  if (task.completed_at) return false;
  const thresholdMs = staleDays * 86_400_000;
  if (task.due_at) {
    const bucket = dueBucketAt(task, nowMs);
    if (bucket !== 'overdue') return false;
    return nowMs - Date.parse(task.due_at) >= thresholdMs;
  }
  const refMs = Date.parse(task.updated_at || task.created_at);
  return Number.isFinite(refMs) && nowMs - refMs >= thresholdMs;
}

/**
 * Classifies a task into TickTick-style Eisenhower Matrix quadrants:
 * - Q1 (Urgent & Important): P1/P2 and due today or overdue
 * - Q2 (Important, Not Urgent): P1/P2 and upcoming or unscheduled
 * - Q3 (Urgent, Less Important): P3/P4 and due today or overdue
 * - Q4 (Neither): P3/P4 and upcoming or unscheduled
 */
export function classifyEisenhower(task: Pick<Task, 'priority' | 'due_at' | 'timezone'>, referenceNowMs = Date.now()): EisenhowerQuadrant {
  const important = task.priority <= 2;
  const date = dueDate(task);
  let urgent = false;
  if (date) {
    const localToday = Temporal.Instant.fromEpochMilliseconds(referenceNowMs).toZonedDateTimeISO(task.timezone).toPlainDate();
    urgent = Temporal.PlainDate.compare(date, localToday) <= 0;
  }
  if (important && urgent) return 'q1';
  if (important) return 'q2';
  if (urgent) return 'q3';
  return 'q4';
}

export interface BalancedProposal {
  task: Task;
  targetDate: Temporal.PlainDate;
  reason: string;
}

/**
 * Load-balanced overdue rescheduler (inspired by Todoist Smart Schedule).
 *
 * Spreads overdue tasks across Today + the next `horizonDays - 1` days based on:
 * 1. Existing scheduled load per day (including future recurring occurrences),
 * 2. Task priority (P1/P2 stay earliest on Today/Tomorrow; P3/P4 balance across lighter days),
 * 3. Daily comfort capacity (`dailyCap`), preventing another burnout pile-up tomorrow.
 */
export function planBalancedReschedule(
  overdueTasks: Task[],
  allOpenTasks: Task[],
  referenceToday: Temporal.PlainDate,
  nextOcc: NextOccurrence,
  options: { horizonDays?: number; dailyCap?: number } = {},
): BalancedProposal[] {
  if (!overdueTasks.length) return [];
  const horizonDays = Math.max(3, options.horizonDays ?? 7);
  const dailyCap = Math.max(2, options.dailyCap ?? 5);
  const end = referenceToday.add({ days: horizonDays - 1 });
  const overdueIds = new Set(overdueTasks.map((task) => task.id));

  // Count existing non-overdue load across each day in the window (including repeating previews).
  const loads = new Map<string, number>();
  const days = Array.from({ length: horizonDays }, (_, offset) => referenceToday.add({ days: offset }));
  for (const d of days) loads.set(d.toString(), 0);

  for (const task of allOpenTasks) {
    if (overdueIds.has(task.id) || !task.due_at || task.parent_task_id) continue;
    for (const d of occurrenceDates(task, referenceToday, end, nextOcc)) {
      const key = d.toString();
      if (loads.has(key)) loads.set(key, (loads.get(key) ?? 0) + 1);
    }
  }

  // Prioritize urgent tasks first, then recurring/timed, then oldest overdue.
  const ordered = [...overdueTasks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (!!a.recurrence_rule !== !!b.recurrence_rule) return a.recurrence_rule ? -1 : 1;
    return Date.parse(a.due_at ?? '') - Date.parse(b.due_at ?? '');
  });

  const proposals: BalancedProposal[] = [];
  for (const task of ordered) {
    // P1 stays on Today or Tomorrow; P2 within 3 days; P3/P4 across the full horizon.
    const maxOffset = task.priority === 1 ? Math.min(1, horizonDays - 1)
      : task.priority === 2 ? Math.min(2, horizonDays - 1)
        : horizonDays - 1;

    let bestDay = days[0];
    let bestCost = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset <= maxOffset; offset++) {
      const day = days[offset];
      const key = day.toString();
      const load = loads.get(key) ?? 0;
      const overflowPenalty = load >= dailyCap ? (load - dailyCap + 1) * 4 : 0;
      // Slight preference for earlier days, strong preference for lighter days, avoid weekends for P3/P4 if weekdays are free.
      const weekendBias = task.priority >= 3 && day.dayOfWeek >= 6 ? 0.6 : 0;
      const cost = load * 2 + overflowPenalty + offset * (task.priority <= 2 ? 1.4 : 0.45) + weekendBias;
      if (cost < bestCost) {
        bestCost = cost;
        bestDay = day;
      }
    }

    const chosenKey = bestDay.toString();
    loads.set(chosenKey, (loads.get(chosenKey) ?? 0) + 1);
    const offset = referenceToday.until(bestDay).days;
    const reason = task.priority === 1
      ? '우선순위 가장 높음'
      : offset === 0
        ? '오늘 일정에 여유 있음'
        : offset === 1
          ? '내일 일정에 여유 있음'
          : `일정이 적은 날 (${bestDay.month}월 ${bestDay.day}일)`;
    proposals.push({ task, targetDate: bestDay, reason });
  }

  return proposals;
}

export interface TodaySuggestion {
  task: Task;
  reason: string;
}

/**
 * Recommends up to `limit` root tasks to pull into Today: ones with no date, and ones due tomorrow
 * (inspired by Microsoft To Do "My Day" suggestions). Tasks already on today, overdue, or deliberately
 * scheduled further ahead are left alone.
 */
export function suggestForToday(
  openRoots: Task[],
  subtaskProgress: Map<string, SubtaskProgress>,
  nowMs = Date.now(),
  limit = 6,
): TodaySuggestion[] {
  const candidates: { task: Task; score: number; reason: string }[] = [];
  for (const task of openRoots) {
    const bucket = dueBucketAt(task, nowMs);
    if (bucket === 'today' || bucket === 'overdue') continue;
    const progress = subtaskProgress.get(task.id);
    const inProgress = !!progress && progress.completed > 0 && progress.open > 0;
    const taskToday = localToday(task.timezone, nowMs);
    const date = dueDate(task);
    const tomorrow = date ? taskToday.until(date).days === 1 : false;
    // A task set for a later day was put there on purpose (an appointment next month must not be offered
    // for today just because part of its checklist is ticked). Only tomorrow's work is worth pulling forward.
    if (date && !tomorrow) continue;
    const stale = !task.due_at && isStaleTask(task, nowMs, 10);

    let score = 0;
    let reason = '';
    if (inProgress) {
      score += 90 + (progress!.completed / progress!.total) * 20;
      reason = `진행 중 (${progress!.completed}/${progress!.total})`;
    } else if (task.priority === 1) {
      score += 85;
      reason = '우선순위 가장 높음';
    } else if (task.priority === 2) {
      score += 65;
      reason = '우선순위 높음';
    } else if (tomorrow) {
      score += 50;
      reason = '내일 할 일 · 미리 끝내기';
    } else if (stale) {
      score += 40;
      reason = '오래 미뤄 둔 할 일';
    } else if (!task.due_at && task.priority === 3) {
      score += 32;
      reason = '우선순위 보통 · 날짜 없음';
    } else if (!task.due_at) {
      score += 18;
      reason = '날짜 없음';
    }

    if (score > 0) {
      if (dueMinutes(task) !== null) score += 2;
      candidates.push({ task, score, reason });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.task.position - b.task.position)
    .slice(0, limit)
    .map(({ task, reason }) => ({ task, reason }));
}
