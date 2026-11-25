import { Temporal } from '@js-temporal/polyfill';

import type { Priority, Task } from '../../lib/shared.ts';

// Pure derivations for the Today tab (no React Native), so they can be tested with node:test.

/** The group that holds tasks without a project (미분류). */
export const INBOX_GROUP = 'inbox';

export type TodayGrouping = 'project' | 'time' | 'priority' | 'none';

export interface TodayGroup {
  /** Stable key used for fold state persistence. */
  key: string;
  projectId: string | null;
  /** Custom label and icon when grouping by time-of-day or priority instead of project. */
  title?: string;
  icon?: 'alert-circle' | 'sunrise' | 'sun' | 'moon' | 'calendar' | 'flag';
  /** Danger tone for an explicit overdue group header. */
  danger?: boolean;
  /** Optional prefill text when tapping + on this group header. */
  quickAddText?: string;
  /** Hide project name on rows inside this group (true for project grouping). */
  hideProject?: boolean;
  overdue: Task[];
  due: Task[];
}

export interface TodayData {
  overdue: Task[];
  due: Task[];
  groups: TodayGroup[];
}

const weekdayNames = ['월', '화', '수', '목', '금', '토', '일'];

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

export function groupByProject(overdue: readonly Task[], due: readonly Task[], projectIds: readonly string[]): TodayGroup[] {
  const known = new Set(projectIds);
  const byKey = new Map<string, TodayGroup>();
  const groupOf = (task: Task) => {
    const projectId = task.project_id && known.has(task.project_id) ? task.project_id : null;
    const key = projectId ?? INBOX_GROUP;
    let group = byKey.get(key);
    if (!group) {
      group = { key, projectId, hideProject: true, overdue: [], due: [] };
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

/** Splits Today's tasks into 기한 지남, 오전 (00–11), 오후 (12–17), 저녁 (18–23), and 종일. */
export function groupByTimeOfDay(overdue: readonly Task[], due: readonly Task[]): TodayGroup[] {
  const morning: Task[] = [];
  const afternoon: Task[] = [];
  const evening: Task[] = [];
  const allDay: Task[] = [];
  for (const task of due) {
    const { minutes } = dueParts(task);
    if (minutes === null) allDay.push(task);
    else if (minutes < 12 * 60) morning.push(task);
    else if (minutes < 18 * 60) afternoon.push(task);
    else evening.push(task);
  }
  const groups: TodayGroup[] = [];
  if (overdue.length > 0) {
    groups.push({ key: 'time-overdue', projectId: null, title: '기한 지남', icon: 'alert-circle', danger: true, overdue: [...overdue], due: [] });
  }
  if (morning.length > 0) {
    groups.push({ key: 'time-morning', projectId: null, title: '오전', icon: 'sunrise', quickAddText: '오늘 오전 9시 ', overdue: [], due: morning });
  }
  if (afternoon.length > 0) {
    groups.push({ key: 'time-afternoon', projectId: null, title: '오후', icon: 'sun', quickAddText: '오늘 오후 2시 ', overdue: [], due: afternoon });
  }
  if (evening.length > 0) {
    groups.push({ key: 'time-evening', projectId: null, title: '저녁', icon: 'moon', quickAddText: '오늘 저녁 7시 ', overdue: [], due: evening });
  }
  if (allDay.length > 0) {
    groups.push({ key: 'time-allday', projectId: null, title: '종일', icon: 'calendar', overdue: [], due: allDay });
  }
  return groups;
}

const prioritySpecs: { priority: Priority; key: string; title: string; quickAddText?: string }[] = [
  { priority: 1, key: 'prio-1', title: '!!! 가장 높음', quickAddText: '!!! ' },
  { priority: 2, key: 'prio-2', title: '!! 높음', quickAddText: '!! ' },
  { priority: 3, key: 'prio-3', title: '! 보통', quickAddText: '! ' },
  { priority: 4, key: 'prio-4', title: '우선순위 없음' },
];

/** Splits Today's tasks into P1 → P4 priority tiers, overdue before today inside each tier. */
export function groupByPriority(overdue: readonly Task[], due: readonly Task[]): TodayGroup[] {
  const buckets = new Map<Priority, { overdue: Task[]; due: Task[] }>();
  for (const spec of prioritySpecs) buckets.set(spec.priority, { overdue: [], due: [] });
  for (const task of overdue) buckets.get(task.priority)!.overdue.push(task);
  for (const task of due) buckets.get(task.priority)!.due.push(task);
  const groups: TodayGroup[] = [];
  for (const spec of prioritySpecs) {
    const bucket = buckets.get(spec.priority)!;
    if (bucket.overdue.length + bucket.due.length === 0) continue;
    groups.push({
      key: spec.key,
      projectId: null,
      title: spec.title,
      icon: 'flag',
      quickAddText: spec.quickAddText,
      overdue: bucket.overdue,
      due: bucket.due,
    });
  }
  return groups;
}

export function deriveToday(
  tasks: readonly Task[], compare: (a: Task, b: Task) => number, projectIds: readonly string[], nowMs: number,
  grouping: TodayGrouping = 'project',
): TodayData {
  const { overdue, due } = splitToday(tasks, compare, nowMs);
  const groups = grouping === 'time'
    ? groupByTimeOfDay(overdue, due)
    : grouping === 'priority'
      ? groupByPriority(overdue, due)
      : grouping === 'none'
        ? []
        : groupByProject(overdue, due, projectIds);
  return { overdue, due, groups };
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

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
      return groupOverdue === old.overdue
        && groupDue === old.due
        && old.projectId === group.projectId
        && old.title === group.title
        && old.icon === group.icon
        && old.danger === group.danger
        && old.hideProject === group.hideProject
        && old.quickAddText === group.quickAddText
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
    if (late) text += ' (기한 지남)';
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
