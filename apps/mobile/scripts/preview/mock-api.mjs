// In-memory stand-in for the Dayframe REST API (supabase/functions/api/routes.ts) and the bits of
// Supabase Auth the app calls. `handle(method, url, body)` returns { status, json } or null when the
// route is unknown; run.mjs turns that into a 404 and logs it.
import { randomUUID } from 'node:crypto';

import { Temporal } from '@js-temporal/polyfill';

import { createFixtures, fakeSession, TIME_ZONE, USER_ID } from './fixtures.mjs';

const API_PREFIX = '/functions/v1/api/v1';
const AUTH_PREFIX = '/auth/v1';

export const isApiPath = (pathname) => pathname.includes(API_PREFIX + '/') || pathname.endsWith(API_PREFIX);
export const isAuthPath = (pathname) => pathname.includes(AUTH_PREFIX + '/');

const ok = (json, status = 200) => ({ status, json });
const noContent = () => ({ status: 204, json: undefined });
const problem = (status, code, message) => ({ status, json: { error: { code, message } } });
const notFoundItem = () => problem(404, 'NOT_FOUND', 'Not found');

function page(items, params) {
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(params.get('offset') ?? 0) || 0, 0);
  const slice = items.slice(offset, offset + limit);
  return { items: slice, nextOffset: offset + limit < items.length ? offset + limit : null };
}

const byPosition = (a, b) => a.position - b.position || (a.id < b.id ? -1 : 1);
const nowIso = () => new Date().toISOString();

/** Rough next occurrence for a repeating task: enough for a tap to look right, not a reimplementation of schedule.ts. */
function advance(task) {
  if (!task.due_at) return null;
  const due = Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone || TIME_ZONE);
  const rule = task.recurrence_rule ?? '';
  const interval = Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? 1);
  let next;
  if (rule.includes('FREQ=DAILY')) next = due.add({ days: interval });
  else if (rule.includes('FREQ=MONTHLY')) next = rule.includes('BYMONTHDAY=-1')
    ? due.add({ months: interval }).with({ day: 31 }, { overflow: 'constrain' }) : due.add({ months: interval });
  else if (rule.includes('FREQ=YEARLY')) next = due.add({ years: interval });
  else {
    const days = /BYDAY=([A-Z,]+)/.exec(rule)?.[1]?.split(',') ?? [];
    const names = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    next = due.add({ days: 1 });
    if (days.length) while (!days.includes(names[next.dayOfWeek - 1])) next = next.add({ days: 1 });
    else next = due.add({ weeks: interval });
  }
  return next.toInstant().toString();
}

function habitStats(habit, logs, today) {
  const done = new Map();
  const neutral = new Set();
  const periodOf = (date) => (habit.cadence === 'weekly' ? date.subtract({ days: date.dayOfWeek - 1 }).toString() : date.toString());
  for (const log of logs) {
    const key = periodOf(Temporal.PlainDate.from(log.log_date));
    if (log.status === 'completed') done.set(key, (done.get(key) ?? 0) + (habit.cadence === 'weekly' ? 1 : log.count));
    else neutral.add(key);
  }
  const step = habit.cadence === 'weekly' ? { weeks: 1 } : { days: 1 };
  const start = Temporal.PlainDate.from(habit.start_date);
  const periods = [];
  for (let d = Temporal.PlainDate.from(periodOf(today)); Temporal.PlainDate.compare(d, Temporal.PlainDate.from(periodOf(start))) >= 0; d = d.subtract(step)) {
    periods.push(d.toString());
  }
  const met = (key) => (done.get(key) ?? 0) >= habit.target_count;
  // The current period does not break a streak until it is over.
  let current = 0;
  for (const [i, key] of periods.entries()) {
    if (met(key)) current += 1;
    else if (neutral.has(key) || i === 0) continue;
    else break;
  }
  let longest = 0;
  let run = 0;
  for (const key of [...periods].reverse()) {
    if (met(key)) longest = Math.max(longest, (run += 1));
    else if (!neutral.has(key)) run = 0;
  }
  const evaluated = periods.slice(1).filter((key) => !neutral.has(key)).length + (met(periods[0]) ? 1 : 0);
  const completed = periods.filter(met).length;
  return {
    as_of: today.toString(), current_streak: current, longest_streak: longest, completed_periods: completed,
    evaluated_periods: evaluated, completion_rate: evaluated ? completed / evaluated : null,
    current_period_count: done.get(periods[0]) ?? 0,
  };
}

export function createMockApi() {
  let db = createFixtures();
  const reset = () => { db = createFixtures(); };
  const today = () => Temporal.Now.plainDateISO(TIME_ZONE);
  const owned = (extra) => ({ id: randomUUID(), user_id: USER_ID, created_at: nowIso(), ...extra });

  const collections = {
    projects: () => db.projects, sections: () => db.sections, tags: () => db.tags, habits: () => db.habits,
  };

  function handleAuth(method, path) {
    const session = fakeSession();
    if (path.startsWith('/token')) return ok(session);
    if (path.startsWith('/user')) return ok(session.user);
    if (path.startsWith('/logout')) return noContent();
    if (path.startsWith('/settings')) return ok({ external: { email: true }, disable_signup: false, mailer_autoconfirm: true });
    return ok({});
  }

  function handleApi(method, parts, params, body) {
    const [resource, key, suffix, extra] = parts;

    if (resource === 'me' && parts.length === 1) {
      if (method === 'GET') return ok(db.me);
      if (method === 'PATCH') return ok(Object.assign(db.me, body));
    }
    if (resource === 'app' && key === 'version') return ok(db.appVersion);
    if (resource === 'mcp-connections') {
      if (parts.length === 1 && method === 'GET') return ok({ items: db.mcpConnections, nextOffset: null });
      if (parts.length === 1 && method === 'POST') {
        const row = { id: randomUUID(), label: body?.label ?? 'AI 연결', created_at: nowIso(), last_used_at: null };
        db.mcpConnections.unshift(row);
        return ok({ ...row, url: 'https://preview.invalid/mcp/' + row.id }, 201);
      }
      if (parts.length === 2 && method === 'DELETE') {
        db.mcpConnections = db.mcpConnections.filter((c) => c.id !== key);
        return noContent();
      }
    }
    if (resource === 'task-tags' && parts.length === 1) {
      const tag = params.get('tag_id');
      return ok(page(db.taskTags.filter((t) => !tag || t.tag_id === tag), params));
    }
    if (resource === 'task-completions' && parts.length === 1) {
      const from = params.get('from');
      const items = db.completions
        .filter((c) => !from || Temporal.Instant.compare(Temporal.Instant.from(c.completed_at), Temporal.Instant.from(from)) >= 0)
        .sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));
      return ok(page(items, params));
    }

    if (resource === 'tasks') return handleTasks(method, parts, params, body);
    if (resource === 'habits') {
      if (suffix === 'logs') {
        if (parts.length === 3 && method === 'GET') {
          return ok(page(db.habitLogs.filter((l) => l.habit_id === key).sort((a, b) => (a.log_date < b.log_date ? 1 : -1)), params));
        }
        if (parts.length === 4 && method === 'PUT') {
          db.habitLogs = db.habitLogs.filter((l) => !(l.habit_id === key && l.log_date === extra));
          const log = { user_id: USER_ID, habit_id: key, log_date: extra, status: body?.status ?? 'completed',
            count: body?.count ?? (body?.status === 'completed' ? 1 : 0), created_at: nowIso() };
          db.habitLogs.push(log);
          return ok(log);
        }
        if (parts.length === 4 && method === 'DELETE') {
          db.habitLogs = db.habitLogs.filter((l) => !(l.habit_id === key && l.log_date === extra));
          return noContent();
        }
      }
      if (suffix === 'stats' && parts.length === 3) {
        const habit = db.habits.find((h) => h.id === key);
        if (!habit) return notFoundItem();
        return ok(habitStats(habit, db.habitLogs.filter((l) => l.habit_id === key), today()));
      }
      if (parts.length === 1 && method === 'POST') {
        const habit = owned({ name: body?.name ?? '새 습관', cadence: body?.cadence ?? 'daily', target_count: body?.target_count ?? 1,
          timezone: body?.timezone ?? TIME_ZONE, start_date: body?.start_date ?? today().toString(), archived_at: null,
          ...(body?.id ? { id: body.id } : {}) });
        db.habits.unshift(habit);
        return ok(habit, 201);
      }
      if (parts.length === 2 && method === 'PATCH') {
        const habit = db.habits.find((h) => h.id === key);
        if (!habit) return notFoundItem();
        if (body?.name) habit.name = body.name;
        if (body?.archive !== undefined) habit.archived_at = body.archive ? nowIso() : null;
        return ok(habit);
      }
    }
    if (resource === 'focus-sessions') {
      if (parts.length === 1 && method === 'GET') return ok(page(db.focusSessions, params));
      if (parts.length === 1 && method === 'POST') {
        const session = owned({ task_id: body?.task_id ?? null, habit_id: body?.habit_id ?? null, started_at: body?.started_at ?? nowIso(),
          ended_at: null, planned_seconds: body?.planned_seconds ?? 1500, status: 'running', ...(body?.id ? { id: body.id } : {}) });
        db.focusSessions.unshift(session);
        return ok(session, 201);
      }
      if (suffix === 'finish' && method === 'POST') {
        const session = db.focusSessions.find((s) => s.id === key);
        if (!session) return notFoundItem();
        Object.assign(session, { status: body?.status ?? 'completed', ended_at: body?.ended_at ?? nowIso() });
        return ok(session);
      }
      if (parts.length === 2 && method === 'GET') {
        const session = db.focusSessions.find((s) => s.id === key);
        return session ? ok(session) : notFoundItem();
      }
      if (parts.length === 2 && method === 'DELETE') {
        db.focusSessions = db.focusSessions.filter((s) => s.id !== key);
        return noContent();
      }
    }
    if (collections[resource]) {
      const list = collections[resource]();
      if (parts.length === 1 && method === 'GET') {
        const project = params.get('project_id');
        const items = list.filter((row) => !project || row.project_id === project);
        return ok(page(resource === 'tags' ? [...items].sort((a, b) => a.name.localeCompare(b.name)) : resource === 'habits' ? items : [...items].sort(byPosition), params));
      }
      if (parts.length === 1 && method === 'POST') {
        if (list.some((row) => row.name?.trim().toLowerCase() === String(body?.name ?? '').trim().toLowerCase() && resource !== 'sections')) {
          return problem(409, 'CONFLICT', 'Already exists');
        }
        const row = owned({ position: list.length, ...body });
        list.push(row);
        return ok(row, 201);
      }
      const row = list.find((r) => r.id === key);
      if (parts.length === 2 && method === 'GET') return row ? ok(row) : notFoundItem();
      if (parts.length === 2 && method === 'PATCH') return row ? ok(Object.assign(row, body)) : notFoundItem();
      if (parts.length === 2 && method === 'DELETE') {
        const index = list.indexOf(row);
        if (index >= 0) list.splice(index, 1);
        return noContent();
      }
    }
    return null;
  }

  function handleTasks(method, parts, params, body) {
    const [, key, suffix, extra] = parts;
    if (key === 'reschedule-overdue' && method === 'POST') {
      const start = today().toZonedDateTime({ timeZone: TIME_ZONE }).toInstant();
      let count = 0;
      for (const task of db.tasks) {
        if (task.completed_at || !task.due_at || Temporal.Instant.compare(Temporal.Instant.from(task.due_at), start) >= 0) continue;
        const local = Temporal.Instant.from(task.due_at).toZonedDateTimeISO(TIME_ZONE);
        const day = today();
        task.due_at = local.with({ year: day.year, month: day.month, day: day.day }).toInstant().toString();
        task.updated_at = nowIso();
        count += 1;
      }
      return ok({ count });
    }
    if (key === 'parse' && method === 'POST') {
      return ok({ title: body?.text ?? '', due_at: null, all_day: false, timezone: body?.timezone ?? TIME_ZONE, recurrence_rule: null,
        recurrence_mode: 'schedule', recurrence_local_time: null, duration_minutes: null, project: null, tags: [], priority: 4 });
    }
    if (parts.length === 1 && method === 'GET') {
      const state = params.get('state');
      const project = params.get('project_id');
      const parent = params.get('parent_task_id');
      const items = db.tasks.filter((t) => (state === 'open' ? !t.completed_at : state === 'completed' ? !!t.completed_at : true))
        .filter((t) => !project || t.project_id === project)
        .filter((t) => parent === null || (parent === 'root' ? !t.parent_task_id : t.parent_task_id === parent))
        .sort(byPosition);
      return ok(page(items, params));
    }
    if (parts.length === 1 && method === 'POST') {
      if (body?.id && db.tasks.some((t) => t.id === body.id)) return problem(409, 'CONFLICT', 'Task exists');
      const now = nowIso();
      const task = {
        id: body?.id ?? randomUUID(), user_id: USER_ID, created_at: now, updated_at: now, project_id: null, section_id: null,
        parent_task_id: null, notes: null, priority: 4, position: db.tasks.length + 1, due_at: null, all_day: false,
        timezone: TIME_ZONE, recurrence_rule: null, recurrence_mode: 'schedule', recurrence_local_time: null, occurrence_at: null,
        duration_minutes: null, completed_at: null, ...body,
      };
      task.recurrence_anchor_at = task.recurrence_rule ? task.due_at : null;
      db.tasks.push(task);
      return ok(task, 201);
    }
    const task = db.tasks.find((t) => t.id === key);
    if (!task) return notFoundItem();
    if (parts.length === 2) {
      if (method === 'GET') return ok(task);
      if (method === 'PATCH') {
        const { preserve_recurrence: preserve, expected_due_at: _expected, ...patch } = body ?? {};
        if (preserve) Object.assign(task, { due_at: patch.due_at, occurrence_at: task.occurrence_at ?? task.due_at });
        else Object.assign(task, patch, 'due_at' in patch ? { recurrence_anchor_at: patch.due_at, occurrence_at: null } : {});
        task.updated_at = nowIso();
        return ok(task);
      }
      if (method === 'DELETE') {
        db.tasks = db.tasks.filter((t) => t.id !== key && t.parent_task_id !== key);
        return noContent();
      }
    }
    if (suffix === 'complete' && method === 'POST') {
      const completedAt = nowIso();
      const occurrence = task.due_at;
      const snapshot = { ...task };
      if (task.recurrence_rule) {
        task.due_at = advance(task);
        task.recurrence_anchor_at = task.due_at;
        task.occurrence_at = null;
      } else {
        task.completed_at = completedAt;
      }
      task.updated_at = completedAt;
      const completion = { task: task.recurrence_rule ? { ...task } : { ...snapshot, completed_at: completedAt }, completed_at: completedAt,
        occurrence_due_at: occurrence };
      db.completions.push(completion);
      return ok(completion);
    }
    if (suffix === 'reopen' && method === 'POST') {
      task.completed_at = null;
      task.updated_at = nowIso();
      db.completions = db.completions.filter((c) => c.task.id !== task.id || c.task.recurrence_rule);
      return ok(task);
    }
    if (suffix === 'tags') {
      if (parts.length === 3 && method === 'GET') return ok(page(db.taskTags.filter((t) => t.task_id === key), params));
      if (parts.length === 4 && method === 'PUT') {
        if (!db.taskTags.some((t) => t.task_id === key && t.tag_id === extra)) db.taskTags.push({ user_id: USER_ID, task_id: key, tag_id: extra });
        return noContent();
      }
      if (parts.length === 4 && method === 'DELETE') {
        db.taskTags = db.taskTags.filter((t) => !(t.task_id === key && t.tag_id === extra));
        return noContent();
      }
    }
    return null;
  }

  /** Returns { status, json } for a known route, or null for an unknown one. */
  function handle(method, rawUrl, body) {
    const url = new URL(rawUrl);
    if (isAuthPath(url.pathname)) return handleAuth(method, url.pathname.slice(url.pathname.indexOf(AUTH_PREFIX) + AUTH_PREFIX.length));
    const rest = url.pathname.slice(url.pathname.indexOf(API_PREFIX) + API_PREFIX.length);
    const parts = rest.split('/').filter(Boolean).map(decodeURIComponent);
    return handleApi(method, parts, url.searchParams, body);
  }

  return { handle, reset, get db() { return db; } };
}
