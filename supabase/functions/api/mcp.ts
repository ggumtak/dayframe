import { Temporal } from "@js-temporal/polyfill";
import type { Habit, HabitLog, HabitStats, Page, Project, Tag, Task, TaskCompletion, TaskTag, User } from "../../../packages/shared/types.ts";
import type { SupabaseConfig } from "./http.ts";
import { parseTask } from "./parser.ts";
import { InvalidSchedule } from "./schedule.ts";

/**
 * Model Context Protocol endpoint, so an AI assistant (Claude, ChatGPT, ...) can read and change one
 * account's tasks and habits. A connection is addressed by an unguessable token in the URL path. Each
 * tool call is replayed through the REST handler with a session for the connection's owner, so the
 * same validation and row-level security apply as for the mobile app.
 */

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = "Dayframe holds the user's tasks, projects, tags and habits. Dates and times are in the user's own time zone. "
  + "Call list_tasks or list_habits to get IDs before changing anything. add_task takes the user's words as they are, "
  + "in Korean or English, for example \"내일 저녁 7시 운동 매주 월수금 #건강 @외출 p1\". Deleting cannot be undone.";

type Json = Record<string, unknown>;
type Api = (request: Request) => Promise<Response>;

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The address an assistant is given. A hosted project's functions also answer on their own host without the
 * "/functions/v1" prefix; the shorter form survives being carried to another device, where a dropped "1" or
 * "/" in that prefix sent the assistant to the gateway's 401 and into a sign-in flow that does not exist.
 */
export function connectionUrl(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const hosted = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(base);
  return hosted ? "https://" + hosted[1] + ".functions.supabase.co/api/mcp/" + token : base + "/functions/v1/api/mcp/" + token;
}

/** A failure the assistant should read and act on, as opposed to a protocol error. */
class ToolFailure extends Error {}

// Per function instance. A cold start signs the owner in again, which costs two requests.
const sessions = new Map<string, { token: string; expires: number }>();
// Auth keeps one sign-in link per user, so two sessions opened at once would cancel each other out.
const opening = new Map<string, Promise<string>>();
const touched = new Map<string, number>();

async function service<T>(config: SupabaseConfig, path: string, init: { method?: string; body?: Json; prefer?: string } = {}): Promise<T> {
  const response = await (config.fetch ?? fetch)(new URL(path, config.url), {
    method: init.method ?? "GET",
    headers: {
      apikey: config.serviceKey!, Authorization: "Bearer " + config.serviceKey!,
      ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body && JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Service request failed: " + response.status);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function findOwner(config: SupabaseConfig, token: string): Promise<string | null> {
  const rows = await service<Array<{ id: string; user_id: string }>>(config,
    "/rest/v1/mcp_connections?select=id,user_id&token_hash=eq." + await hashToken(token));
  if (!rows[0]) return null;
  const { id, user_id } = rows[0];
  if (Date.now() - (touched.get(id) ?? 0) > 600_000) {
    touched.set(id, Date.now());
    await service(config, "/rest/v1/mcp_connections?id=eq." + id,
      { method: "PATCH", body: { last_used_at: new Date().toISOString() }, prefer: "return=minimal" }).catch(() => {});
  }
  return user_id;
}

/** An access token for the connection's owner, minted through the Auth admin API. */
function ownerToken(config: SupabaseConfig, userId: string, fresh = false): Promise<string> {
  const cached = sessions.get(userId);
  if (!fresh && cached && cached.expires - Date.now() > 60_000) return Promise.resolve(cached.token);
  let pending = opening.get(userId);
  if (!pending) {
    pending = openSession(config, userId).finally(() => opening.delete(userId));
    opening.set(userId, pending);
  }
  return pending;
}

async function openSession(config: SupabaseConfig, userId: string): Promise<string> {
  const user = await service<{ email?: string }>(config, "/auth/v1/admin/users/" + userId);
  if (!user.email) throw new Error("Connection owner has no email");
  const link = await service<{ hashed_token?: string; verification_type?: string }>(config, "/auth/v1/admin/generate_link",
    { method: "POST", body: { type: "magiclink", email: user.email } });
  const verified = await (config.fetch ?? fetch)(new URL("/auth/v1/verify", config.url), {
    method: "POST", headers: { apikey: config.key, "Content-Type": "application/json" },
    body: JSON.stringify({ type: link.verification_type ?? "magiclink", token_hash: link.hashed_token }),
    signal: AbortSignal.timeout(15_000),
  });
  const session = await verified.json() as { access_token?: string; expires_in?: number };
  if (!verified.ok || !session.access_token) throw new Error("Could not open a session for the connection owner");
  sessions.set(userId, { token: session.access_token, expires: Date.now() + (session.expires_in ?? 3600) * 1000 });
  return session.access_token;
}

interface Context {
  call<T>(method: string, path: string, body?: Json): Promise<T>;
  all<T>(path: string): Promise<T[]>;
  timezone(): Promise<string>;
}

function context(config: SupabaseConfig, userId: string, api: Api): Context {
  let zone: string | undefined;
  const send = async (method: string, path: string, body: Json | undefined, fresh: boolean) => api(new Request(
    "https://dayframe.internal/api/v1/" + path, {
      method,
      headers: { Authorization: "Bearer " + await ownerToken(config, userId, fresh), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body && JSON.stringify(body),
    }));
  const self: Context = {
    async call<T>(method: string, path: string, body?: Json) {
      // Every path is built from validated IDs; this keeps a missed check from reaching another route.
      if (!/^[a-z-]+(?:\/[A-Za-z0-9-]+)*(?:\?[a-z_]+=[A-Za-z0-9-]+(?:&[a-z_]+=[A-Za-z0-9-]+)*)?$/.test(path)) throw new ToolFailure("Invalid reference");
      let response = await send(method, path, body, false);
      if (response.status === 401) response = await send(method, path, body, true);
      if (response.status === 204) return undefined as T;
      const payload = await response.json() as { error?: { code?: string; message?: string; fields?: string[] } };
      if (!response.ok) {
        const detail = payload.error?.fields?.length ? " (" + payload.error.fields.join("; ") + ")" : "";
        throw new ToolFailure((payload.error?.message ?? "Request failed") + detail);
      }
      return payload as T;
    },
    async all<T>(path: string) {
      const items: T[] = [];
      for (let offset: number | null = 0; offset !== null && items.length < 2000;) {
        const page: Page<T> = await self.call("GET", path + (path.includes("?") ? "&" : "?") + "limit=100&offset=" + offset);
        items.push(...page.items);
        offset = page.nextOffset;
      }
      return items;
    },
    async timezone() {
      zone ??= (await self.call<User>("GET", "me")).timezone;
      return zone;
    },
  };
  return self;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const text = (value: unknown, field: string, max = 1000): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ToolFailure(field + " must be text of 1–" + max + " characters");
  return value.trim();
};
const identifier = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new ToolFailure(field + " must be an ID returned by a list tool");
  return value.toLowerCase();
};

function localDue(task: Pick<Task, "due_at" | "all_day" | "timezone">): string | null {
  if (!task.due_at) return null;
  const at = Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone);
  return task.all_day ? at.toPlainDate().toString() : at.toPlainDate().toString() + " " + at.toPlainTime().toString().slice(0, 5);
}

function dueStatus(task: Pick<Task, "due_at" | "timezone">): "none" | "overdue" | "today" | "upcoming" {
  if (!task.due_at) return "none";
  const date = Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone).toPlainDate();
  const order = Temporal.PlainDate.compare(date, Temporal.Now.plainDateISO(task.timezone));
  return order < 0 ? "overdue" : order === 0 ? "today" : "upcoming";
}

async function names(api: Context) {
  const [projects, tags, links] = await Promise.all([api.all<Project>("projects"), api.all<Tag>("tags"), api.all<TaskTag>("task-tags")]);
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));
  const byTask = new Map<string, string[]>();
  for (const link of links) byTask.set(link.task_id, [...(byTask.get(link.task_id) ?? []), tagNames.get(link.tag_id) ?? ""]);
  return { projects, tags, project: (id: string | null) => projects.find((item) => item.id === id)?.name ?? null, tagsOf: (id: string) => byTask.get(id) ?? [] };
}

function describe(task: Task, project: string | null, tags: string[]) {
  return {
    id: task.id, title: task.title, due: localDue(task), status: dueStatus(task), repeats: task.recurrence_rule, priority: "p" + task.priority,
    project, tags, ...(task.notes ? { notes: task.notes } : {}), ...(task.parent_task_id ? { parent_task_id: task.parent_task_id } : {}),
  };
}

async function ensureProject(api: Context, name: string): Promise<Project> {
  const existing = (await api.all<Project>("projects")).find((item) => sameName(item.name, name));
  return existing ?? api.call<Project>("POST", "projects", { name });
}

/** Parses "내일 오후 3시" style text into schedule fields by lending the parser a placeholder title. */
function schedule(words: string, timezone: string) {
  const placeholder = "⁣";
  const parsed = parseTask({ text: words + " " + placeholder, timezone });
  const leftover = parsed.title.replace(placeholder, "").trim();
  if (leftover) throw new ToolFailure("Could not understand this part of the schedule: " + leftover);
  if (parsed.project || parsed.tags.length || parsed.priority !== 4) {
    throw new ToolFailure("schedule takes only dates, times and repeats; use the priority and project fields for the rest");
  }
  if (!parsed.due_at) throw new ToolFailure("No date or time found in the schedule");
  return {
    due_at: parsed.due_at, all_day: parsed.all_day, recurrence_rule: parsed.recurrence_rule,
    ...(parsed.recurrence_local_time ? { recurrence_local_time: parsed.recurrence_local_time } : {}),
  };
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: false };
  run(api: Context, args: Json): Promise<unknown>;
}

const object = (properties: Json = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const taskId = { type: "string", description: "Task ID from list_tasks" };
const habitId = { type: "string", description: "Habit ID from list_habits" };
const read = { readOnlyHint: true, openWorldHint: false } as const;
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const destroy = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export const tools: Tool[] = [
  {
    name: "list_tasks", title: "List tasks", annotations: read,
    description: "Lists open tasks. view: today (due today plus overdue, the default), overdue, upcoming (after today), inbox (no project), or all.",
    inputSchema: object({
      view: { type: "string", enum: ["today", "overdue", "upcoming", "inbox", "all"] },
      project: { type: "string", description: "Only tasks in the project with this name" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    }),
    async run(api, args) {
      const view = args.view === undefined ? "today" : args.view;
      if (!["today", "overdue", "upcoming", "inbox", "all"].includes(view as string)) {
        throw new ToolFailure("view must be today, overdue, upcoming, inbox or all");
      }
      const [tasks, lookup] = await Promise.all([api.all<Task>("tasks?state=open"), names(api)]);
      const wanted = typeof args.project === "string" ? lookup.projects.find((item) => sameName(item.name, args.project as string))?.id ?? "none" : null;
      const selected = tasks.filter((task) => {
        const status = dueStatus(task);
        if (wanted !== null && task.project_id !== wanted) return false;
        if (view === "today") return status === "today" || status === "overdue";
        if (view === "overdue" || view === "upcoming") return status === view;
        if (view === "inbox") return !task.project_id && !task.parent_task_id;
        return true;
      }).sort((a, b) => (a.due_at ?? "9") < (b.due_at ?? "9") ? -1 : (a.due_at ?? "9") > (b.due_at ?? "9") ? 1 : a.priority - b.priority);
      const limit = typeof args.limit === "number" ? Math.min(200, Math.max(1, Math.floor(args.limit))) : 50;
      const timezone = await api.timezone();
      return {
        today: Temporal.Now.plainDateISO(timezone).toString(), timezone, total: selected.length,
        tasks: selected.slice(0, limit).map((task) => describe(task, lookup.project(task.project_id), lookup.tagsOf(task.id))),
      };
    },
  },
  {
    name: "add_task", title: "Add a task", annotations: write,
    description: "Adds a task from natural language in Korean or English. Dates (내일, 11월 25일, next Tue), times (저녁 7시, 7pm), "
      + "repeats (매일, 매주 월수금, 매달 말일, every weekday, yearly), #project, @tag and p1–p4 are understood; the rest becomes the title. "
      + "Set parent_task_id to add a subtask.",
    inputSchema: object({
      text: { type: "string", description: "The task as the user said it" },
      notes: { type: "string", description: "Optional longer notes" },
      parent_task_id: { ...taskId, description: "Parent task ID, to create a subtask" },
    }, ["text"]),
    async run(api, args) {
      const timezone = await api.timezone();
      const parsed = parseTask({ text: text(args.text, "text"), timezone });
      const parent = args.parent_task_id === undefined ? null : identifier(args.parent_task_id, "parent_task_id");
      const project = parsed.project && !parent ? await ensureProject(api, parsed.project) : null;
      const siblings = (await api.all<Task>("tasks?state=open&parent_task_id=" + (parent ?? "root")))
        .filter((task) => parent || task.project_id === (project?.id ?? null));
      const created = await api.call<Task>("POST", "tasks", {
        title: parsed.title, priority: parsed.priority, timezone,
        position: siblings.reduce((max, task) => Math.max(max, task.position), 0) + 1024,
        ...(parsed.due_at ? { due_at: parsed.due_at, all_day: parsed.all_day } : {}),
        ...(parsed.recurrence_rule ? { recurrence_rule: parsed.recurrence_rule } : {}),
        ...(parsed.recurrence_local_time ? { recurrence_local_time: parsed.recurrence_local_time } : {}),
        ...(typeof args.notes === "string" && args.notes.trim() ? { notes: args.notes.slice(0, 10000) } : {}),
        ...(parent ? { parent_task_id: parent } : project ? { project_id: project.id } : {}),
      });
      const tags = parsed.tags.length ? await api.all<Tag>("tags") : [];
      for (const name of parsed.tags) {
        const tag = tags.find((item) => sameName(item.name, name)) ?? await api.call<Tag>("POST", "tags", { name });
        await api.call("PUT", "tasks/" + created.id + "/tags/" + tag.id);
      }
      return { added: describe(created, project?.name ?? null, parsed.tags) };
    },
  },
  {
    name: "update_task", title: "Change a task", annotations: write,
    description: "Changes a task. schedule takes natural language such as \"내일 오후 3시\" or \"매주 월수금 저녁 7시\" and replaces the date, time and repeat. "
      + "clear_schedule removes them. project takes a project name, or an empty string to move the task to the inbox.",
    inputSchema: object({
      task_id: taskId, title: { type: "string" }, notes: { type: "string", description: "Empty string clears the notes" },
      priority: { type: "integer", minimum: 1, maximum: 4, description: "1 is highest, 4 is the default" },
      schedule: { type: "string" }, clear_schedule: { type: "boolean" }, project: { type: "string" },
    }, ["task_id"]),
    async run(api, args) {
      const id = identifier(args.task_id, "task_id");
      // Looked up first so a wrong ID fails before a project is created for it.
      const current = await api.call<Task>("GET", "tasks/" + id);
      const patch: Json = {};
      if (args.title !== undefined) patch.title = text(args.title, "title", 500);
      if (typeof args.notes === "string") patch.notes = args.notes.trim() ? args.notes.slice(0, 10000) : null;
      if (args.priority !== undefined) {
        if (![1, 2, 3, 4].includes(args.priority as number)) throw new ToolFailure("priority must be 1, 2, 3 or 4");
        patch.priority = args.priority;
      }
      if (args.clear_schedule === true) Object.assign(patch, { due_at: null, all_day: false, recurrence_rule: null });
      else if (args.schedule !== undefined) Object.assign(patch, schedule(text(args.schedule, "schedule", 200), current.timezone));
      if (typeof args.project === "string") {
        Object.assign(patch, { project_id: args.project.trim() ? (await ensureProject(api, args.project)).id : null, section_id: null });
      }
      if (!Object.keys(patch).length) throw new ToolFailure("Nothing to change: pass at least one field besides task_id");
      const task = await api.call<Task>("PATCH", "tasks/" + id, patch);
      const lookup = await names(api);
      return { updated: describe(task, lookup.project(task.project_id), lookup.tagsOf(task.id)) };
    },
  },
  {
    name: "complete_task", title: "Complete a task", annotations: { ...write, idempotentHint: false },
    description: "Marks a task done. A repeating task moves to its next date instead of closing.",
    inputSchema: object({ task_id: taskId }, ["task_id"]),
    async run(api, args) {
      const id = identifier(args.task_id, "task_id");
      const task = await api.call<Task>("GET", "tasks/" + id);
      const done = await api.call<TaskCompletion>("POST", "tasks/" + id + "/complete",
        { request_id: crypto.randomUUID(), expected_updated_at: task.updated_at });
      return done.task.completed_at ? { completed: task.title } : { completed: task.title, next_due: localDue(done.task) };
    },
  },
  {
    name: "reopen_task", title: "Reopen a task", annotations: { ...write, idempotentHint: true },
    description: "Reopens a task that was completed by mistake.",
    inputSchema: object({ task_id: taskId }, ["task_id"]),
    async run(api, args) {
      const task = await api.call<Task>("POST", "tasks/" + identifier(args.task_id, "task_id") + "/reopen");
      return { reopened: task.title };
    },
  },
  {
    name: "delete_task", title: "Delete a task", annotations: destroy,
    description: "Permanently deletes a task and all of its subtasks. This cannot be undone.",
    inputSchema: object({ task_id: taskId }, ["task_id"]),
    async run(api, args) {
      const id = identifier(args.task_id, "task_id");
      const task = await api.call<Task>("GET", "tasks/" + id);
      await api.call("DELETE", "tasks/" + id);
      return { deleted: task.title };
    },
  },
  {
    name: "move_overdue_to_today", title: "Move overdue tasks to today", annotations: { ...write, idempotentHint: true },
    description: "Moves every open task dated before today to today, keeping each task's time of day.",
    inputSchema: object(),
    run: (api) => api.call<{ count: number }>("POST", "tasks/reschedule-overdue").then((result) => ({ moved: result.count })),
  },
  {
    name: "list_projects", title: "List projects and tags", annotations: read,
    description: "Lists the user's project names and tag names.",
    inputSchema: object(),
    async run(api) {
      const [projects, tags] = await Promise.all([api.all<Project>("projects"), api.all<Tag>("tags")]);
      return { projects: projects.map((item) => item.name), tags: tags.map((item) => item.name) };
    },
  },
  {
    name: "list_habits", title: "List habits", annotations: read,
    description: "Lists active habits with today's progress and the current streak.",
    inputSchema: object(),
    async run(api) {
      const habits = (await api.all<Habit>("habits")).filter((habit) => !habit.archived_at);
      return {
        habits: await Promise.all(habits.map(async (habit) => {
          const today = Temporal.Now.plainDateISO(habit.timezone).toString();
          const [logs, stats] = await Promise.all([
            api.call<Page<HabitLog>>("GET", "habits/" + habit.id + "/logs?limit=7"), api.call<HabitStats>("GET", "habits/" + habit.id + "/stats"),
          ]);
          const log = logs.items.find((item) => item.log_date === today);
          return {
            id: habit.id, name: habit.name, cadence: habit.cadence, target: habit.target_count, today,
            today_status: log?.status ?? "not logged", today_count: log?.count ?? 0,
            period_count: stats.current_period_count, streak: stats.current_streak, longest_streak: stats.longest_streak,
          };
        })),
      };
    },
  },
  {
    name: "add_habit", title: "Add a habit", annotations: write,
    description: "Creates a habit. cadence is daily (target_count times a day) or weekly (target_count days a week). These cannot be changed later.",
    inputSchema: object({
      name: { type: "string" }, cadence: { type: "string", enum: ["daily", "weekly"] }, target_count: { type: "integer", minimum: 1, maximum: 100 },
    }, ["name"]),
    async run(api, args) {
      const habit = await api.call<Habit>("POST", "habits", {
        name: text(args.name, "name", 120), cadence: args.cadence === "weekly" ? "weekly" : "daily", timezone: await api.timezone(),
        ...(typeof args.target_count === "number" ? { target_count: Math.floor(args.target_count) } : {}),
      });
      return { added: { id: habit.id, name: habit.name, cadence: habit.cadence, target: habit.target_count } };
    },
  },
  {
    name: "log_habit", title: "Log a habit", annotations: { ...write, idempotentHint: true },
    description: "Sets a habit's entry for one day. status: completed (count is that day's total, default 1), skipped, frozen (keeps the streak), "
      + "or clear to remove the entry. date is YYYY-MM-DD and defaults to today.",
    inputSchema: object({
      habit_id: habitId, status: { type: "string", enum: ["completed", "skipped", "frozen", "clear"] },
      count: { type: "integer", minimum: 1, maximum: 100 }, date: { type: "string", description: "YYYY-MM-DD" },
    }, ["habit_id"]),
    async run(api, args) {
      const id = identifier(args.habit_id, "habit_id");
      if (args.date !== undefined && (typeof args.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(args.date))) {
        throw new ToolFailure("date must be YYYY-MM-DD");
      }
      const habit = await api.call<Habit>("GET", "habits/" + id);
      const date = Temporal.PlainDate.from(args.date ?? Temporal.Now.plainDateISO(habit.timezone), { overflow: "reject" }).toString();
      const status = typeof args.status === "string" ? args.status : "completed";
      if (status === "clear") {
        await api.call("DELETE", "habits/" + id + "/logs/" + date);
        return { habit: habit.name, date, status: "cleared" };
      }
      const log = await api.call<HabitLog>("PUT", "habits/" + id + "/logs/" + date,
        { status, ...(status === "completed" ? { count: typeof args.count === "number" ? Math.floor(args.count) : 1 } : {}) });
      return { habit: habit.name, date: log.log_date, status: log.status, count: log.count };
    },
  },
  {
    name: "remove_habit", title: "Archive or delete a habit", annotations: destroy,
    description: "mode archive hides the habit and keeps its history. mode delete erases the habit and every entry, which cannot be undone.",
    inputSchema: object({ habit_id: habitId, mode: { type: "string", enum: ["archive", "delete"] } }, ["habit_id", "mode"]),
    async run(api, args) {
      const id = identifier(args.habit_id, "habit_id");
      const habit = await api.call<Habit>("GET", "habits/" + id);
      if (args.mode === "delete") await api.call("DELETE", "habits/" + id);
      else if (args.mode === "archive") await api.call("PATCH", "habits/" + id, { archive: true });
      else throw new ToolFailure("mode must be archive or delete");
      return { [args.mode === "delete" ? "deleted" : "archived"]: habit.name };
    },
  },
];

interface Message { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Json }

async function dispatch(message: Message, api: () => Context): Promise<Json> {
  const fail = (code: number, reason: string) => ({ jsonrpc: "2.0", id: message.id ?? null, error: { code, message: reason } });
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return fail(-32600, "Invalid request");
  const done = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize": {
      const requested = message.params?.protocolVersion;
      return done({
        protocolVersion: typeof requested === "string" && VERSIONS.includes(requested) ? requested : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "dayframe", title: "Dayframe", version: "1.0.0" }, instructions: INSTRUCTIONS,
      });
    }
    case "ping": return done({});
    case "tools/list": return done({ tools: tools.map(({ run: _run, ...definition }) => definition) });
    case "tools/call": {
      const tool = tools.find((item) => item.name === message.params?.name);
      if (!tool) return fail(-32602, "Unknown tool");
      try {
        // Some assistants send null for the optional arguments they leave out.
        const given = Object.entries((message.params?.arguments ?? {}) as Json).filter(([, value]) => value !== null);
        const result = await tool.run(api(), Object.fromEntries(given));
        return done({ content: [{ type: "text", text: JSON.stringify(result) }] });
      } catch (error) {
        // Bad input is reported to the assistant so it can correct itself; anything else stays generic.
        const reason = error instanceof ToolFailure || error instanceof InvalidSchedule ? error.message
          : error instanceof RangeError ? "That date or time does not exist" : "Dayframe could not complete this right now";
        return done({ content: [{ type: "text", text: reason }], isError: true });
      }
    }
    default: return fail(-32601, "Method not found");
  }
}

export async function handleMcp(request: Request, config: SupabaseConfig, token: string, api: Api, headers: Headers): Promise<Response> {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (request.method !== "POST") {
    // No server-initiated stream is offered, which the protocol signals with 405.
    return new Response(null, { status: 405, headers: { ...Object.fromEntries(headers), Allow: "POST, OPTIONS" } });
  }
  if (!config.serviceKey) return reply({ error: { code: "SERVICE_UNAVAILABLE", message: "AI connections are not configured" } }, 503);
  const owner = await findOwner(config, token);
  // 404, never 401: a 401 would send the assistant looking for a sign-in flow that does not exist.
  if (!owner) return reply({ error: { code: "NOT_FOUND", message: "Unknown or removed connection" } }, 404);

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 262_144) throw new Error("too large");
    body = JSON.parse(raw);
  } catch {
    return reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  let shared: Context | undefined;
  const messages = (Array.isArray(body) ? body : [body]) as Message[];
  const invalid = (id: unknown = null) => ({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid request" } });
  if (messages.length === 0 || messages.length > 20) return reply(invalid(), 400);
  const replies: Json[] = [];
  for (const message of messages) {
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      replies.push(invalid());
      continue;
    }
    // A reply to a request this server never made needs no answer.
    if (message.method === undefined && ("result" in message || "error" in message)) continue;
    const response = await dispatch(message, () => shared ??= context(config, owner, api));
    // Notifications carry no id and get no reply, unless they are not valid requests at all.
    if (message.id !== undefined || typeof message.method !== "string") replies.push(response);
  }
  if (!replies.length) return new Response(null, { status: 202, headers });
  return reply(Array.isArray(body) ? replies : replies[0]);
}
