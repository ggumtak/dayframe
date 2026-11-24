import { Temporal } from '@js-temporal/polyfill';

import type { Task } from '../../lib/shared';

// Pure derivations for the Today tab (no React Native), so they can be tested with node:test.

/** The group that holds tasks without a project (미분류). */
export const INBOX_GROUP = 'inbox';

export interface TodayGroup {
  /** The project ID, or `INBOX_GROUP` for tasks without one. Also the key the fold state is stored under. */
  key: string;
  projectId: string | null;
  overdue: Task[];
  due: Task[];
}

export interface TodayData {
  overdue: Task[];
  due: Task[];
  groups: TodayGroup[];
}

const weekdayNames = ['월', '화', '수', '목', '금', '토', '일'];

// Parsing an ISO instant into a zoned date is the slow part of the Temporal polyfill, and the same task
// objects come back on every minute tick, so each task's due date is worked out once.
const dueDateCache = new WeakMap<Task, { date: Temporal.PlainDate | null; minutes: number | null }>();

function dueParts(task: Task): { date: Temporal.PlainDate | null; minutes: number | null } {
  let parts = dueDateCache.get(task);
  if (!parts) {
    parts = { date: null, minutes: null };
    if (task.due_at) {
      try {
        const at = Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone);
        parts = { date: at.toPlainDate(), minutes: task.all_day ? null : at.hour * 60 + at.minute };
      } catch {
        // An unreadable date counts as unscheduled, as `dueBucket` does.
      }
    }
    dueDateCache.set(task, parts);
  }
  return parts;
}

/**
 * Open tasks due today and overdue (as of `nowMs`), each list sorted by `compare`. A subtask is left out
 * when its parent is already in either list, since it shows beneath the parent. Every task's bucket is
 * worked out once, and "today" once per time zone.
 */
export function splitToday(tasks: readonly Task[], compare: (a: Task, b: Task) => number, nowMs: number): { overdue: Task[]; due: Task[] } {
  const now = Temporal.Instant.fromEpochMilliseconds(nowMs);
  const todayByZone = new Map<string, Temporal.PlainDate>();
  const buckets = new Map<string, 'overdue' | 'today'>();
  for (const task of tasks) {
    const { date } = dueParts(task);
    if (!date) continue;
    let todayDate = todayByZone.get(task.timezone);
    if (!todayDate) {
      try {
        todayDate = now.toZonedDateTimeISO(task.timezone).toPlainDate();
      } catch {
        continue;
      }
      todayByZone.set(task.timezone, todayDate);
    }
    const order = Temporal.PlainDate.compare(date, todayDate);
    if (order < 0) buckets.set(task.id, 'overdue');
    else if (order === 0) buckets.set(task.id, 'today');
  }
  const overdue: Task[] = [];
  const due: Task[] = [];
  for (const task of tasks) {
    const bucket = buckets.get(task.id);
    if (!bucket) continue;
    if (task.parent_task_id && buckets.has(task.parent_task_id)) continue;
    (bucket === 'overdue' ? overdue : due).push(task);
  }
  overdue.sort(compare);
  due.sort(compare);
  return { overdue, due };
}

/**
 * Splits the sorted lists by project: 미분류 first, then projects in `projectIds` order, only groups that
 * have tasks. Within a group, overdue tasks come first, then today's, each keeping the order it had. A task
 * whose project is not (yet) known goes under 미분류 rather than disappearing.
 */
export function groupByProject(overdue: readonly Task[], due: readonly Task[], projectIds: readonly string[]): TodayGroup[] {
  const known = new Set(projectIds);
  const byKey = new Map<string, TodayGroup>();
  const groupOf = (task: Task) => {
    const projectId = task.project_id && known.has(task.project_id) ? task.project_id : null;
    const key = projectId ?? INBOX_GROUP;
    let group = byKey.get(key);
    if (!group) {
      group = { key, projectId, overdue: [], due: [] };
      byKey.set(key, group);
    }
    return group;
  };
  for (const task of overdue) groupOf(task).overdue.push(task);
  for (const task of due) groupOf(task).due.push(task);
  const ordered: TodayGroup[] = [];
  const inbox = byKey.get(INBOX_GROUP);
  if (inbox) ordered.push(inbox);
  for (const id of projectIds) {
    const group = byKey.get(id);
    if (group) ordered.push(group);
  }
  return ordered;
}

export function deriveToday(
  tasks: readonly Task[], compare: (a: Task, b: Task) => number, projectIds: readonly string[], nowMs: number,
): TodayData {
  const { overdue, due } = splitToday(tasks, compare, nowMs);
  return { overdue, due, groups: groupByProject(overdue, due, projectIds) };
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/**
 * Returns a function that hands back `next`, except that every list (and group) equal item-for-item to
 * the one it returned last time is swapped for that earlier object. A re-derivation that changes nothing
 * (a minute tick, a refetch with the same data) then gives memoised rows the very same props.
 */
export function createTodayReuser(): (next: TodayData) => TodayData {
  let last: TodayData | null = null;
  return (next) => {
    const prev = last;
    if (!prev) {
      last = next;
      return next;
    }
    const overdue = sameItems(prev.overdue, next.overdue) ? prev.overdue : next.overdue;
    const due = sameItems(prev.due, next.due) ? prev.due : next.due;
    const prevGroups = new Map(prev.groups.map((group) => [group.key, group]));
    const groups = next.groups.map((group) => {
      const old = prevGroups.get(group.key);
      if (!old) return group;
      const groupOverdue = sameItems(old.overdue, group.overdue) ? old.overdue : group.overdue;
      const groupDue = sameItems(old.due, group.due) ? old.due : group.due;
      return groupOverdue === old.overdue && groupDue === old.due && old.projectId === group.projectId
        ? old
        : { ...group, overdue: groupOverdue, due: groupDue };
    });
    const result: TodayData = {
      overdue, due, groups: sameItems(prev.groups, groups) ? prev.groups : groups,
    };
    if (result.overdue === prev.overdue && result.due === prev.due && result.groups === prev.groups) return prev;
    last = result;
    return result;
  };
}

function clock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return (hour < 12 ? '오전' : '오후') + ' ' + (hour % 12 === 0 ? 12 : hour % 12) + ':' + String(minute).padStart(2, '0');
}

/**
 * Today's list as plain text for sharing: a date line, the open tasks (overdue first, marked), then what
 * was finished. Null when there is nothing to share.
 */
export function buildShareText({ date, overdue, due, doneTitles, projectName }: {
  date: Temporal.PlainDate;
  overdue: readonly Task[];
  due: readonly Task[];
  doneTitles: readonly string[];
  projectName: (projectId: string) => string | undefined;
}): string | null {
  if (!overdue.length && !due.length && !doneTitles.length) return null;
  const line = (task: Task, late: boolean) => {
    let text = '☐ ' + task.title;
    if (late) text += ' (지연)';
    // An overdue task's time of day belongs to another date, so only today's tasks show their time.
    const minutes = late ? null : dueParts(task).minutes;
    if (minutes !== null) text += ' · ' + clock(minutes);
    const project = task.project_id ? projectName(task.project_id) : undefined;
    if (project) text += ' · ' + project;
    return text;
  };
  const lines = [`${date.month}월 ${date.day}일 (${weekdayNames[date.dayOfWeek - 1]}) 할 일`];
  for (const task of overdue) lines.push(line(task, true));
  for (const task of due) lines.push(line(task, false));
  if (doneTitles.length) {
    lines.push('', `완료 ${doneTitles.length}개`);
    for (const title of doneTitles) lines.push('☑ ' + title);
  }
  return lines.join('\n');
}
