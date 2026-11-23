import { readFileSync, writeFileSync } from "node:fs";
import { stringify } from "yaml";
import { z } from "zod";
import * as v from "../supabase/functions/api/validation.ts";

const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
const str = { type: "string" };
const int = { type: "integer" };
const bool = { type: "boolean" };
const uuid = { type: "string", format: "uuid" };
const stamp = { type: "string", format: "date-time" };
const date = { type: "string", format: "date" };
const uri = { type: "string", format: "uri" };
const nullable = (value: object) => ({ anyOf: [value, { type: "null" }] });
const enumOf = (...values: Array<string | number>) => ({ enum: values });
const array = (items: object) => ({ type: "array", items });
const obj = (properties: Record<string, object>, required = Object.keys(properties)) =>
  ({ type: "object", properties, required, additionalProperties: false });
const owned = { id: uuid, user_id: uuid, created_at: stamp };
const project = { ...owned, name: str, position: int };
const task = {
  ...owned, project_id: nullable(uuid), section_id: nullable(uuid), parent_task_id: nullable(uuid),
  title: str, notes: nullable(str), priority: enumOf(1, 2, 3, 4), position: int, due_at: nullable(stamp),
  all_day: bool, timezone: str, recurrence_rule: nullable(str), recurrence_mode: enumOf("schedule", "completion"),
  recurrence_anchor_at: nullable(stamp), recurrence_local_time: nullable(str), occurrence_at: nullable(stamp),
  duration_minutes: nullable(int),
  completed_at: nullable(stamp), updated_at: stamp,
};
const schemas: Record<string, object> = {
  User: obj({ id: uuid, display_name: nullable(str), timezone: str, new_task_date: enumOf("today", "none"), created_at: stamp }),
  Project: obj(project),
  Section: obj({ ...project, project_id: uuid }),
  Tag: obj({ ...owned, name: str }),
  Task: obj(task),
  Subtask: obj({ ...task, project_id: { type: "null" }, section_id: { type: "null" }, parent_task_id: uuid }),
  TaskTag: obj({ user_id: uuid, task_id: uuid, tag_id: uuid }),
  TaskCompletion: obj({ task: ref("Task"), completed_at: stamp, occurrence_due_at: nullable(stamp) }),
  ParsedTask: obj({ title: str, due_at: nullable(stamp), all_day: bool, timezone: str,
    recurrence_rule: nullable(str), recurrence_mode: enumOf("schedule", "completion"),
    recurrence_local_time: nullable(str), duration_minutes: nullable(int),
    project: nullable(str), tags: array(str), priority: enumOf(1, 2, 3, 4) }),
  RescheduleResult: obj({ count: { ...int, minimum: 0 } }),
  Habit: obj({ ...owned, name: str, cadence: enumOf("daily", "weekly"), target_count: int, timezone: str,
    start_date: date, archived_at: nullable(stamp) }),
  HabitLog: obj({ user_id: uuid, habit_id: uuid, log_date: date,
    status: enumOf("completed", "frozen", "skipped"), count: int, created_at: stamp }),
  HabitStats: obj({ as_of: date, current_streak: int, longest_streak: int, completed_periods: int,
    evaluated_periods: int, completion_rate: nullable({ type: "number", minimum: 0, maximum: 1 }),
    current_period_count: int }),
  FocusSession: obj({ ...owned, task_id: nullable(uuid), habit_id: nullable(uuid), started_at: stamp,
    ended_at: nullable(stamp), planned_seconds: int, status: enumOf("running", "completed", "cancelled") }),
  AppVersion: obj({ latestVersion: str, versionCode: int, minSupportedVersion: str,
    releaseNotes: str, apkDownloadUrl: uri, iosStoreOrTestFlightUrl: nullable(uri) }),
  McpConnection: obj({ id: uuid, label: str, created_at: stamp, last_used_at: nullable(stamp) }),
  NewMcpConnection: obj({ id: uuid, label: str, created_at: stamp, last_used_at: nullable(stamp), url: uri }),
  ApiError: obj({ error: obj({ code: str, message: str, fields: array(str) }, ["code", "message"]) }),
};
const inputs = {
  UserPatch: v.userPatch, ProjectInput: v.project, ProjectPatch: v.project.partial(), SectionInput: v.section,
  SectionPatch: v.project.partial(), TagInput: v.tag, TaskInput: v.task, TaskPatch: v.taskPatch, ParseTaskInput: v.parse,
  CompleteTaskInput: v.complete, HabitInput: v.habit, HabitPatch: v.habitPatch, HabitLogInput: v.log,
  FocusInput: v.focus, FinishFocusInput: v.finish, McpConnectionInput: v.mcpConnection,
};
for (const [name, input] of Object.entries(inputs)) {
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(input, { io: "input" });
  schemas[name] = jsonSchema;
}

type Parameter = { name: string; in: "path" | "query"; required?: boolean; schema: object; description: string };
const query = (name: string, schema: object, description: string): Parameter => ({ name, in: "query", schema, description });
const path = (name: string, schema: object, description: string): Parameter => ({ name, in: "path", required: true, schema, description });
const id = path("id", uuid, "Resource identifier within the signed-in user's account.");
const page = [query("limit", { ...int, minimum: 1, maximum: 100, default: 50 }, "Page size."),
  query("offset", { ...int, minimum: 0, maximum: 2147483547, default: 0 }, "Offset from the previous page.")];
const projectId = query("project_id", uuid, "Direct project assignment.");
const parent = query("parent_task_id", { anyOf: [uuid, { const: "root" }] }, "Direct parent UUID, or root for top-level tasks.");
const state = query("state", enumOf("open", "completed"), "Filter by completion state.");
const dueWindow = [
  query("due_from", stamp, "Inclusive start of the due-time window. Excludes unscheduled tasks."),
  query("due_before", stamp, "Exclusive end of the due-time window. Excludes unscheduled tasks."),
];
const paths: Record<string, Record<string, object>> = {};
const tags = {
  Account: "Profile and default time zone.",
  Organization: "Projects, sections and reusable tags.",
  Tasks: "Task trees, parsing, completion and rescheduling.",
  Habits: "Habit schedules, progress logs and statistics.",
  Focus: "Pomodoro and focus session history.",
  Assistants: "Connections that let an AI assistant act on the account through the Model Context Protocol.",
  Releases: "Public mobile update metadata.",
};

function content(name: string) {
  return { "application/json": { schema: ref(name) } };
}
function operation(
  route: string, verb: string, operationId: string, summary: string, tag: string,
  options: { result?: string; input?: string; parameters?: Parameter[]; status?: number; anonymous?: boolean; description?: string } = {},
) {
  const success = options.status ?? 200;
  const statusDescriptions: Record<number, string> = {
    400: "Invalid input, reference, or schedule.", 401: "Missing or invalid Supabase access token.",
    403: "Action unavailable to the caller.", 404: "Resource or published release not found.",
    409: "Unique conflict, stale revision, or incompatible retry.", 413: "Body exceeds 64 KiB.",
    415: "Expected application/json.", 503: "Upstream service temporarily unavailable.",
  };
  const failures = options.anonymous ? [404, 503] : [400, 401, 403, 404, 409, 503];
  if (options.input) failures.push(413, 415);
  const responses: Record<number, object> = {
    [success]: { description: success === 201 ? "Created." : success === 204 ? "No response body." : "Successful response.",
      ...(options.result ? { content: content(options.result) } : {}) },
  };
  for (const code of failures.sort((a, b) => a - b)) {
    responses[code] = { description: statusDescriptions[code], content: content("ApiError") };
  }
  (paths[route] ??= {})[verb] = {
    operationId, summary, tags: [tag],
    ...(options.description ? { description: options.description } : {}),
    ...(options.anonymous ? { security: [] } : {}),
    ...(options.parameters?.length ? { parameters: options.parameters } : {}),
    ...(options.input ? { requestBody: { required: true, content: content(options.input) } } : {}),
    responses,
  };
}
function paged(name: string) {
  const key = name + "Page";
  schemas[key] ??= obj({ items: array(ref(name)), nextOffset: nullable(int) });
  return key;
}
function resource(
  url: string, model: string, label: string, group: string,
  options: { input?: string; patch?: string; filters?: Parameter[]; remove?: boolean } = {},
) {
  operation(url, "get", "list" + model + "s", "List " + label + "s", group,
    { result: paged(model), parameters: [...page, ...options.filters ?? []] });
  operation(url + "/{id}", "get", "get" + model, "Get a " + label, group, { result: model, parameters: [id] });
  if (options.input) operation(url, "post", "create" + model, "Create a " + label, group,
    { result: model, input: options.input, status: 201 });
  if (options.patch) operation(url + "/{id}", "patch", "update" + model, "Update a " + label, group,
    { result: model, input: options.patch, parameters: [id] });
  if (options.remove) operation(url + "/{id}", "delete", "delete" + model, "Delete a " + label, group,
    { status: 204, parameters: [id] });
}

operation("/me", "get", "getMe", "Get your profile", "Account", { result: "User" });
operation("/me", "patch", "updateMe", "Update your profile", "Account", { input: "UserPatch", result: "User" });
resource("/projects", "Project", "project", "Organization", { input: "ProjectInput", patch: "ProjectPatch", remove: true });
resource("/sections", "Section", "section", "Organization", { input: "SectionInput", patch: "SectionPatch", remove: true, filters: [projectId] });
resource("/tags", "Tag", "tag", "Organization", { input: "TagInput", patch: "TagInput", remove: true });
resource("/tasks", "Task", "task", "Tasks", { input: "TaskInput", patch: "TaskPatch", remove: true,
  filters: [projectId, parent, state, ...dueWindow] });
resource("/subtasks", "Subtask", "subtask", "Tasks", { filters: [parent, state, ...dueWindow] });
operation("/tasks/parse", "post", "parseTask", "Preview a task from Korean or English text", "Tasks",
  { input: "ParseTaskInput", result: "ParsedTask",
    description: "Previews daily, weekly, monthly and yearly schedules, including monthly on the last day. Use #project and @tag, and quote names that contain spaces." });
operation("/tasks/reschedule-overdue", "post", "rescheduleOverdueTasks", "Move past-date open tasks to today", "Tasks",
  { result: "RescheduleResult", description: "Uses each task's time zone and preserves its local time and recurrence anchor. Returns the number changed." });
operation("/tasks/{id}/complete", "post", "completeTask", "Complete the current task occurrence", "Tasks",
  { result: "TaskCompletion", input: "CompleteTaskInput", parameters: [id],
    description: "Reuse request_id and expected_updated_at on network retries. Repeating tasks advance to the next future occurrence." });
operation("/tasks/{id}/reopen", "post", "reopenTask", "Reopen a completed task", "Tasks", { result: "Task", parameters: [id] });
operation("/tasks/{id}/tags", "get", "listTaskTags", "List assigned tags", "Tasks",
  { result: paged("TaskTag"), parameters: [id, ...page] });
const tagId = path("tagId", uuid, "Tag identifier in the signed-in user's account.");
operation("/tasks/{id}/tags/{tagId}", "put", "attachTaskTag", "Attach a tag", "Tasks", { status: 204, parameters: [id, tagId] });
operation("/tasks/{id}/tags/{tagId}", "delete", "detachTaskTag", "Detach a tag", "Tasks", { status: 204, parameters: [id, tagId] });
operation("/task-tags", "get", "listAllTaskTags", "List tag links across every task", "Tasks",
  { result: paged("TaskTag"), parameters: [...page, query("tag_id", uuid, "Only links to this tag.")],
    description: "Lets a client label task lists or filter by tag without one request per task." });
operation("/task-completions", "get", "listTaskCompletions", "List completions, newest first", "Tasks",
  { result: paged("TaskCompletion"), parameters: [...page, query("from", stamp, "Only completions at or after this instant.")],
    description: "Includes each completed occurrence of a repeating task, so a client can show what was finished today." });
resource("/habits", "Habit", "habit", "Habits", { input: "HabitInput", patch: "HabitPatch", remove: true });
operation("/habits/{id}/stats", "get", "getHabitStats", "Get habit streak and completion statistics", "Habits",
  { result: "HabitStats", parameters: [id, query("through", date, "Inclusive habit-local cutoff date. Defaults to today.")] });
operation("/habits/{id}/logs", "get", "listHabitLogs", "List habit logs", "Habits", { result: paged("HabitLog"), parameters: [id, ...page] });
const logDate = path("date", date, "Habit-local log date.");
operation("/habits/{id}/logs/{date}", "put", "upsertHabitLog", "Set a habit log for a date", "Habits",
  { input: "HabitLogInput", result: "HabitLog", parameters: [id, logDate], description: "Replaces the daily total, including when retried." });
operation("/habits/{id}/logs/{date}", "delete", "deleteHabitLog", "Delete a habit log", "Habits", { status: 204, parameters: [id, logDate] });
resource("/focus-sessions", "FocusSession", "focus session", "Focus", { input: "FocusInput", remove: true });
operation("/focus-sessions/{id}/finish", "post", "finishFocusSession", "Complete or cancel a focus session", "Focus",
  { input: "FinishFocusInput", result: "FocusSession", parameters: [id] });
operation("/mcp-connections", "get", "listMcpConnections", "List AI assistant connections", "Assistants", { result: paged("McpConnection") });
operation("/mcp-connections", "post", "createMcpConnection", "Create an AI assistant connection", "Assistants",
  { input: "McpConnectionInput", result: "NewMcpConnection", status: 201,
    description: "Returns the connection URL once. Anyone holding that URL can read and change the account, so treat it as a password. At most five per account." });
operation("/mcp-connections/{id}", "delete", "deleteMcpConnection", "Remove an AI assistant connection", "Assistants",
  { status: 204, parameters: [id], description: "The connection's URL stops working immediately." });
operation("/app/version", "get", "getAppVersion", "Read published Android update metadata", "Releases",
  { result: "AppVersion", anonymous: true, description: "Selects the highest published Android build number. Returns 404 until a release is published." });

const spec = stringify({
  openapi: "3.1.0",
  info: { title: "Dayframe API", version: "1.0.0", description: "REST API for tasks, schedules, habits, focus and in-app updates." },
  servers: [{ url: "https://{projectRef}.supabase.co/functions/v1/api/v1", variables: { projectRef: { default: "exampleprojectref" } } },
    { url: "http://127.0.0.1:54321/functions/v1/api/v1" }],
  tags: Object.entries(tags).map(([name, description]) => ({ name, description })),
  security: [{ SupabaseJwt: [] }],
  paths,
  components: { securitySchemes: { SupabaseJwt: { type: "http", scheme: "bearer", bearerFormat: "JWT" } }, schemas },
}, { lineWidth: 115 });
const file = new URL("../openapi.yaml", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== spec) throw new Error("Run npm run openapi to regenerate openapi.yaml");
} else writeFileSync(file, spec);
