import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import type {
  AppVersion, FocusSession, Habit, HabitLog, HabitStats, McpConnection, NewMcpConnection, Page, Project, RescheduleResult,
  Section, Tag, Task, TaskCompletion, TaskTag, User,
} from "../../../packages/shared/types.ts";
import { ApiProblem, onlyResult, queryInteger, readJson, requireChanges, Supabase, validate } from "./http.ts";
import { connectionUrl, hashToken, newToken } from "./mcp.ts";
import { parseTask } from "./parser.ts";
import { nextOccurrence } from "./schedule.ts";
import * as schema from "./validation.ts";

type Resource = "projects" | "sections" | "tags" | "tasks" | "subtasks" | "habits" | "focus_sessions";
type Row = Project | Section | Tag | Task | Habit | FocusSession;
const uuidFilter = (id: string) => "eq." + id;

async function list<T>(db: Supabase, table: string, params: URLSearchParams, query: Record<string, string>): Promise<Page<T>> {
  const limit = queryInteger(params, "limit", 50, 1, 100);
  const offset = queryInteger(params, "offset", 0, 0, 2_147_483_547);
  const rows = await db.rest<T[]>(table, { ...query, limit: String(limit + 1), offset: String(offset) });
  return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
}

async function insert<T>(db: Supabase, table: string, data: object): Promise<T> {
  return onlyResult(await db.rest<T[]>(table, {}, "POST", data, "missing=default,return=representation"));
}

async function update<T>(db: Supabase, table: string, filter: Record<string, string>, data: object): Promise<T> {
  return onlyResult(await db.rest<T[]>(table, filter, "PATCH", data, "return=representation"));
}

async function remove(db: Supabase, table: string, filter: Record<string, string>) {
  await db.rest(table, filter, "DELETE", undefined, "return=minimal");
  return { status: 204 };
}

const orders: Record<Resource, string> = {
  projects: "position.asc,id.asc", sections: "position.asc,id.asc", tags: "name.asc,id.asc",
  tasks: "position.asc,id.asc", subtasks: "position.asc,id.asc", habits: "created_at.desc,id.asc",
  focus_sessions: "started_at.desc,id.asc",
};
const resourceNames: Record<string, Resource> = {
  projects: "projects", sections: "sections", tags: "tags", tasks: "tasks",
  subtasks: "subtasks", habits: "habits", "focus-sessions": "focus_sessions",
};
const createSchemas = { projects: schema.project, sections: schema.section, tags: schema.tag, tasks: schema.task,
  habits: schema.habit, focus_sessions: schema.focus };

function filters(table: Resource, params: URLSearchParams): Record<string, string> {
  const query: Record<string, string> = { order: orders[table] };
  const project = params.get("project_id");
  const parent = params.get("parent_task_id");
  if (table === "sections" || table === "tasks") {
    if (project !== null) query.project_id = uuidFilter(validate(schema.uuid, project));
  }
  if (table === "tasks" || table === "subtasks") {
    if (parent !== null) query.parent_task_id = parent === "root" ? "is.null" : uuidFilter(validate(schema.uuid, parent));
    const state = params.get("state");
    if (state !== null) {
      query.completed_at = validate(z.enum(["open", "completed"]), state) === "open" ? "is.null" : "not.is.null";
    }
    const from = params.get("due_from");
    const before = params.get("due_before");
    if (from !== null || before !== null) {
      const lower = from === null ? null : Temporal.Instant.from(validate(schema.instant, from));
      const upper = before === null ? null : Temporal.Instant.from(validate(schema.instant, before));
      if (lower && upper && Temporal.Instant.compare(lower, upper) >= 0) {
        throw new ApiProblem(400, "INVALID_INPUT", "due_from must be earlier than due_before");
      }
      const bounds = [lower && "due_at.gte." + lower.toString(), upper && "due_at.lt." + upper.toString()];
      query.and = "(" + bounds.filter(Boolean).join(",") + ")";
      query.order = "due_at.asc,priority.asc,position.asc,id.asc";
    }
  }
  return query;
}

async function createResource(request: Request, db: Supabase, table: Exclude<Resource, "subtasks">, userId: string) {
  if (table === "habits") {
    const input = await readJson(request, schema.habit);
    const start_date = input.start_date ?? Temporal.Now.zonedDateTimeISO(input.timezone).toPlainDate().toString();
    return { status: 201, data: await insert<Habit>(db, table, { ...input, start_date }) };
  }
  if (table === "tasks") {
    const input = await readJson(request, schema.task);
    const tz = input.timezone ?? onlyResult(await db.rest<User[]>("users", { id: uuidFilter(userId), select: "timezone" })).timezone;
    return { status: 201, data: await insert<Task>(db, table, { ...input, timezone: tz }) };
  }
  const input = await readJson(request, createSchemas[table] as z.ZodType<object>);
  return { status: 201, data: await insert<Row>(db, table, input) };
}

async function editResource(request: Request, db: Supabase, table: Resource, filter: Record<string, string>) {
  switch (table) {
    case "projects": return update<Project>(db, table, filter, requireChanges(await readJson(request, schema.project.partial())));
    case "sections": return update<Section>(db, table, filter, requireChanges(await readJson(request, schema.project.partial())));
    case "tags": return update<Tag>(db, table, filter, await readJson(request, schema.tag));
    case "tasks": {
      const patch = requireChanges(await readJson(request, schema.taskPatch));
      if ("preserve_recurrence" in patch) {
        const moved = await db.rest<Task[]>(table, {
          ...filter, due_at: "eq." + patch.expected_due_at, completed_at: "is.null", recurrence_rule: "not.is.null",
        }, "PATCH", { due_at: patch.due_at }, "return=representation");
        if (moved.length) return moved[0];
        const current = onlyResult(await db.rest<Task[]>(table, filter));
        if (current.recurrence_rule && !current.completed_at && current.due_at &&
          Temporal.Instant.from(current.due_at).equals(patch.due_at)) {
          return current;
        }
        throw new ApiProblem(409, "STALE_RESOURCE", "This occurrence changed before it could be moved");
      }
      const anchor = Object.hasOwn(patch, "due_at") ? { recurrence_anchor_at: patch.due_at } : {};
      return update<Task>(db, table, filter, { ...patch, ...anchor });
    }
    case "habits": {
      const { archive, ...patch } = requireChanges(await readJson(request, schema.habitPatch));
      if (!archive) return update<Habit>(db, table, filter, patch);
      const changed = await db.rest<Habit[]>(table, { ...filter, archived_at: "is.null" }, "PATCH",
        { ...patch, archived_at: new Date().toISOString() }, "return=representation");
      if (changed.length) return changed[0];
      return Object.keys(patch).length ? update<Habit>(db, table, filter, patch) :
        onlyResult(await db.rest<Habit[]>(table, filter));
    }
    default: throw new ApiProblem(405, "METHOD_NOT_ALLOWED", "Use the resource's supported methods");
  }
}

async function completeTask(request: Request, db: Supabase, id: string) {
  const input = await readJson(request, schema.complete);
  const args = { p_task: id, p_request: input.request_id, p_revision: input.expected_updated_at };
  const previous = await db.rest<Array<{ task_id: string; result: TaskCompletion }>>("task_completions",
    { request_id: uuidFilter(input.request_id), select: "task_id,result" });
  if (previous[0]) {
    if (previous[0].task_id !== id) throw new ApiProblem(409, "CONFLICT", "Request ID already used");
    return previous[0].result;
  }
  const item = onlyResult(await db.rest<Task[]>("tasks", { id: uuidFilter(id) }));
  // Let the transaction detect completed requests that raced with this read.
  const now = Temporal.Now.instant();
  const due = item.due_at ? Temporal.Instant.from(item.due_at) : now;
  const next = item.recurrence_rule && item.recurrence_anchor_at
    ? nextOccurrence(item.recurrence_rule, item.timezone, item.recurrence_anchor_at,
      Temporal.Instant.compare(due, now) > 0 ? due : now, item.all_day, item.recurrence_local_time) : null;
  return db.rest<TaskCompletion>("rpc/complete_task", {}, "POST", { ...args, p_next_due: next });
}

async function finishFocus(request: Request, db: Supabase, filter: Record<string, string>) {
  const input = await readJson(request, schema.finish);
  const changed = await db.rest<FocusSession[]>("focus_sessions", { ...filter, status: "eq.running" }, "PATCH",
    { status: input.status, ended_at: input.ended_at ?? new Date().toISOString() }, "return=representation");
  if (changed.length) return changed[0];
  const existing = onlyResult(await db.rest<FocusSession[]>("focus_sessions", filter));
  if (existing.status !== input.status || (input.ended_at &&
    Temporal.Instant.compare(Temporal.Instant.from(existing.ended_at!), Temporal.Instant.from(input.ended_at)) !== 0)) {
    throw new ApiProblem(409, "CONFLICT", "Focus session has already ended");
  }
  return existing;
}

type RouteResult = { status?: number; data?: unknown; cache?: boolean };

export async function version(db: Supabase): Promise<RouteResult> {
  const item = onlyResult(await db.rest<Array<{
    latest_version: string; version_code: number; min_supported_version: string; release_notes: string;
    apk_download_url: string; ios_store_or_test_flight_url: string | null;
  }>>("app_releases", { order: "version_code.desc", limit: "1" }));
  const data: AppVersion = {
    latestVersion: item.latest_version, versionCode: item.version_code, minSupportedVersion: item.min_supported_version,
    releaseNotes: item.release_notes, apkDownloadUrl: item.apk_download_url, iosStoreOrTestFlightUrl: item.ios_store_or_test_flight_url,
  };
  return { data, cache: true };
}

const connectionColumns = "id,label,created_at,last_used_at";

async function mcpConnections(request: Request, db: Supabase, userId: string, parts: string[], baseUrl: string): Promise<RouteResult> {
  const method = request.method;
  if (parts.length === 1 && method === "GET") {
    const items = await db.rest<McpConnection[]>("mcp_connections", { select: connectionColumns, order: "created_at.desc,id.asc" });
    return { data: { items, nextOffset: null } };
  }
  if (parts.length === 1 && method === "POST") {
    const input = await readJson(request, schema.mcpConnection);
    const existing = await db.rest<Array<{ id: string }>>("mcp_connections", { select: "id" });
    if (existing.length >= 5) throw new ApiProblem(409, "CONFLICT", "Remove a connection before adding another");
    const token = newToken();
    const row = { user_id: userId, token_hash: await hashToken(token), ...(input.label ? { label: input.label } : {}) };
    const created = onlyResult(await db.rest<McpConnection[]>("mcp_connections", { select: connectionColumns }, "POST", row,
      "missing=default,return=representation"));
    const data: NewMcpConnection = { ...created, url: connectionUrl(baseUrl, token) };
    return { status: 201, data };
  }
  if (parts.length === 2 && method === "DELETE") {
    return remove(db, "mcp_connections", { id: uuidFilter(validate(schema.uuid, parts[1])) });
  }
  throw new ApiProblem(405, "METHOD_NOT_ALLOWED", "Method is unavailable for this route");
}

export async function authenticatedRoute(
  request: Request, db: Supabase, userId: string, parts: string[], params: URLSearchParams, baseUrl = "",
): Promise<RouteResult> {
  const [resource, key, suffix, extra] = parts;
  const method = request.method;
  const notFound = () => new ApiProblem(404, "NOT_FOUND", "Route not found");
  const unsupported = () => new ApiProblem(405, "METHOD_NOT_ALLOWED", "Method is unavailable for this route");

  if (resource === "me" && parts.length === 1) {
    const filter = { id: uuidFilter(userId) };
    if (method === "GET") return { data: onlyResult(await db.rest<User[]>("users", filter)) };
    if (method === "PATCH") return { data: await update<User>(db, "users", filter, requireChanges(await readJson(request, schema.userPatch))) };
    throw unsupported();
  }
  if (resource === "tasks" && key === "parse" && parts.length === 2) {
    if (method !== "POST") throw unsupported();
    try {
      return { data: parseTask(await readJson(request, schema.parse)) };
    } catch (error) {
      if (error instanceof RangeError) throw new ApiProblem(400, "INVALID_SCHEDULE", "Use a valid calendar date or time");
      throw error;
    }
  }
  if (resource === "tasks" && key === "reschedule-overdue" && parts.length === 2) {
    if (method !== "POST") throw unsupported();
    return { data: await db.rest<RescheduleResult>("rpc/reschedule_overdue", {}, "POST", {}) };
  }

  if (resource === "mcp-connections" && parts.length <= 2) return mcpConnections(request, db, userId, parts, baseUrl);

  if (resource === "task-tags" && parts.length === 1) {
    if (method !== "GET") throw unsupported();
    const tag = params.get("tag_id");
    return { data: await list<TaskTag>(db, "task_tags", params, {
      order: "task_id.asc,tag_id.asc", ...(tag === null ? {} : { tag_id: uuidFilter(validate(schema.uuid, tag)) }),
    }) };
  }

  if (!Object.hasOwn(resourceNames, resource) || parts.length > 4) throw notFound();
  const table = resourceNames[resource];
  if (parts.length === 1) {
    if (method === "GET") return { data: await list<Row>(db, table, params, filters(table, params)) };
    if (method === "POST" && table !== "subtasks") return createResource(request, db, table, userId);
    throw unsupported();
  }
  const id = validate(schema.uuid, key);
  const filter = { id: uuidFilter(id) };
  if (parts.length === 2) {
    if (method === "GET") return { data: onlyResult(await db.rest<Row[]>(table, filter)) };
    if (method === "PATCH" && table !== "subtasks" && table !== "focus_sessions") {
      return { data: await editResource(request, db, table, filter) };
    }
    if (method === "DELETE" && table !== "subtasks") return remove(db, table, filter);
    throw unsupported();
  }
  if (table === "tasks" && suffix === "complete" && parts.length === 3) {
    if (method !== "POST") throw unsupported();
    return { data: await completeTask(request, db, id) };
  }
  if (table === "tasks" && suffix === "reopen" && parts.length === 3) {
    if (method !== "POST") throw unsupported();
    const changed = await db.rest<Task[]>(table, { ...filter, completed_at: "not.is.null" }, "PATCH",
      { completed_at: null }, "return=representation");
    return { data: changed[0] ?? onlyResult(await db.rest<Task[]>(table, filter)) };
  }
  if (table === "focus_sessions" && suffix === "finish" && parts.length === 3) {
    if (method !== "POST") throw unsupported();
    return { data: await finishFocus(request, db, filter) };
  }
  if (table === "habits" && suffix === "stats" && parts.length === 3) {
    if (method !== "GET") throw unsupported();
    const through = params.get("through");
    return { data: onlyResult(await db.rest<HabitStats[]>("rpc/habit_stats", {}, "POST",
      { p_habit: id, p_through: through === null ? null : validate(schema.localDate, through) })) };
  }
  if (table === "habits" && suffix === "logs") {
    const habitFilter = { habit_id: uuidFilter(id) };
    if (parts.length === 3 && method === "GET") {
      return { data: await list<HabitLog>(db, "habit_logs", params, { ...habitFilter, order: "log_date.desc" }) };
    }
    if (parts.length === 4) {
      const date = validate(schema.localDate, extra);
      if (method === "DELETE") return remove(db, "habit_logs", { ...habitFilter, log_date: "eq." + date });
      if (method === "PUT") {
        const input = await readJson(request, schema.log);
        const row = { user_id: userId, habit_id: id, log_date: date, status: input.status,
          count: input.count ?? (input.status === "completed" ? 1 : 0) };
        return { data: onlyResult(await db.rest<HabitLog[]>("habit_logs", { on_conflict: "user_id,habit_id,log_date" },
          "POST", row, "resolution=merge-duplicates,return=representation")) };
      }
    }
    throw unsupported();
  }
  if (table === "tasks" && suffix === "tags") {
    const taskFilter = { task_id: uuidFilter(id) };
    if (parts.length === 3 && method === "GET") {
      return { data: await list<TaskTag>(db, "task_tags", params, { ...taskFilter, order: "tag_id.asc" }) };
    }
    if (parts.length === 4) {
      const tagId = validate(schema.uuid, extra);
      if (method === "DELETE") return remove(db, "task_tags", { ...taskFilter, tag_id: uuidFilter(tagId) });
      if (method === "PUT") {
        await db.rest("task_tags", { on_conflict: "user_id,task_id,tag_id" }, "POST", { user_id: userId, task_id: id, tag_id: tagId },
          "resolution=ignore-duplicates,return=minimal");
        return { status: 204 };
      }
    }
    throw unsupported();
  }
  throw notFound();
}
