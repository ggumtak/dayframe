import Anthropic from "@anthropic-ai/sdk";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import type { AiClassification, AiPlan, Project, Tag, Task } from "../../../packages/shared/types.ts";
import { ApiProblem, readJson, type Supabase, type SupabaseConfig } from "./http.ts";
import * as schema from "./validation.ts";

// Filing a task has to come back while the person is still looking at it, so it runs on the faster model
// at low effort. Ordering a day weighs many things at once and is asked for once a day.
const CLASSIFY_MODEL = "claude-sonnet-5-5";
const PLAN_MODEL = "claude-opus-5-5";

interface Ask<T> {
  model: string;
  effort: "low" | "medium";
  system: string;
  user: string;
  /** JSON schema the reply must match; `parse` then checks it again and narrows the type. */
  format: Record<string, unknown>;
  parse: z.ZodType<T>;
}

/** One question to Claude that must come back as JSON of a known shape. */
async function ask<T>(config: SupabaseConfig, input: Ask<T>): Promise<T> {
  if (!config.anthropicKey) throw new ApiProblem(503, "AI_UNAVAILABLE", "AI features are not configured");
  const client = new Anthropic({ apiKey: config.anthropicKey, fetch: config.fetch, maxRetries: 1, timeout: 45_000 });
  const request = {
    model: input.model, max_tokens: 4096, system: input.system,
    messages: [{ role: "user" as const, content: input.user }],
    output_config: { effort: input.effort, format: { type: "json_schema" as const, schema: input.format } },
  };
  let message: { stop_reason: string | null; content: Array<{ type: string; text?: string }> };
  try {
    try {
      // If a safety classifier declines the request, the API retries it on a fallback model in the same call.
      message = await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (error) {
      // Should the fallback option ever be refused for this request shape, the plain request still works.
      if (!(error instanceof Anthropic.BadRequestError)) throw error;
      message = await client.messages.create(request);
    }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new ApiProblem(503, "AI_UNAVAILABLE", "The AI key was rejected");
    }
    if (error instanceof Anthropic.RateLimitError) throw new ApiProblem(429, "AI_BUSY", "AI is busy; try again shortly");
    if (error instanceof Anthropic.APIError || error instanceof Anthropic.APIConnectionError) {
      throw new ApiProblem(502, "AI_FAILED", "AI did not answer");
    }
    throw error;
  }
  if (message.stop_reason === "refusal") throw new ApiProblem(422, "AI_DECLINED", "AI declined this request");
  const text = message.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  try {
    return input.parse.parse(JSON.parse(text));
  } catch {
    throw new ApiProblem(502, "AI_FAILED", "AI answered in an unexpected form");
  }
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const classifySystem = `You file new tasks in Dayframe, one person's to-do app. Given a task the person just wrote, suggest where it belongs.

Your suggestion is shown as a one-tap offer next to the task. A wrong offer is worse than none: it teaches the person to ignore them. So leave a field empty unless the task clearly calls for it.

- project: the name of one existing project the task plainly belongs to, copied exactly, or "" when none fits. Never invent a project.
- tags: existing tags that plainly apply, copied exactly. Usually none.
- priority: 1 (urgent) to 3 only when the wording itself signals urgency or importance (a hard deadline, "급함", "꼭", consequences). 0 for an ordinary task, which is most of them.
- duration_minutes: a realistic length for doing it in one sitting, in minutes (5 to 480), when the task is an activity with an obvious length (a workout, a call, a commute errand, a meeting). 0 when it has no meaningful length or you would be guessing.`;

const classifyFormat = {
  type: "object", additionalProperties: false, required: ["project", "tags", "priority", "duration_minutes"],
  properties: {
    project: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    priority: { type: "integer", enum: [0, 1, 2, 3] },
    duration_minutes: { type: "integer" },
  },
};
const classifyReply = z.object({
  project: z.string(), tags: z.array(z.string()), priority: z.number().int(), duration_minutes: z.number().int(),
});

export async function classifyTask(request: Request, db: Supabase, config: SupabaseConfig): Promise<AiClassification> {
  const input = await readJson(request, schema.aiClassify);
  const [projects, tags] = await Promise.all([
    db.rest<Project[]>("projects", { select: "id,name", order: "position.asc", limit: "200" }),
    db.rest<Tag[]>("tags", { select: "id,name", order: "name.asc", limit: "200" }),
  ]);
  const reply = await ask(config, {
    model: CLASSIFY_MODEL, effort: "low", system: classifySystem, format: classifyFormat, parse: classifyReply,
    user: JSON.stringify({
      task: { title: input.title, ...(input.notes ? { notes: input.notes.slice(0, 1000) } : {}) },
      existing_projects: projects.map((project) => project.name),
      existing_tags: tags.map((tag) => tag.name),
    }),
  });
  // Only what already exists is ever returned: a name the model made up is dropped, not created.
  const project = reply.project ? projects.find((item) => sameName(item.name, reply.project)) : undefined;
  const tagIds = reply.tags.flatMap((name) => tags.find((tag) => sameName(tag.name, name))?.id ?? []);
  return {
    project_id: project?.id ?? null,
    tag_ids: [...new Set(tagIds)],
    priority: reply.priority >= 1 && reply.priority <= 3 ? reply.priority as 1 | 2 | 3 : null,
    duration_minutes: reply.duration_minutes >= 5 && reply.duration_minutes <= 480 ? reply.duration_minutes : null,
  };
}

const planSystem = `You order one person's tasks for today in Dayframe, their to-do app. You get the current local time and the tasks still open today, each with a short key.

Return every key exactly once, in the order to do them, each with the reason for its place, and one sentence of advice for the day.

How to order:
- A task with a clock time is fixed: it stays at that time, and other tasks are arranged around it.
- Before a fixed task, put only what fits in the time until it, using the stated durations (assume 30 minutes when none is given).
- Earlier: overdue tasks, higher priority (p1 is highest, p4 is none), tasks other things wait on, and demanding work while the day is young.
- Group errands that share a place or a project so they are done in one trip.
- Small quick tasks can fill gaps or wind the day down.

Write each reason in Korean, 20 characters or fewer, concrete ("회의 전 30분에 가능", "지연 2일째"). Write the advice in Korean, one sentence, polite 합니다체. Do not repeat the task titles in the reasons.`;

const planFormat = {
  type: "object", additionalProperties: false, required: ["order", "note"],
  properties: {
    order: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["key", "reason"],
        properties: { key: { type: "string" }, reason: { type: "string" } },
      },
    },
    note: { type: "string" },
  },
};
const planReply = z.object({ order: z.array(z.object({ key: z.string(), reason: z.string() })), note: z.string() });

export async function planToday(request: Request, db: Supabase, config: SupabaseConfig): Promise<AiPlan> {
  const input = await readJson(request, schema.aiPlan);
  // The tasks are read again as the caller, so nothing but their own rows can reach the prompt.
  const rows = await db.rest<Task[]>("tasks", { id: "in.(" + input.task_ids.join(",") + ")", completed_at: "is.null" });
  const byId = new Map(rows.map((task) => [task.id, task]));
  const tasks = input.task_ids.flatMap((id) => byId.get(id) ?? []);
  if (tasks.length < 2) return { order: tasks.map((task) => ({ task_id: task.id, reason: "" })), note: "" };

  const zone = tasks[0].timezone;
  const now = Temporal.Now.zonedDateTimeISO(zone);
  const projects = await db.rest<Project[]>("projects", { select: "id,name", limit: "200" });
  const projectName = new Map(projects.map((project) => [project.id, project.name]));
  const keyOf = new Map(tasks.map((task, index) => [task.id, "t" + (index + 1)]));
  const described = tasks.map((task) => {
    const due = task.due_at ? Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone) : null;
    const overdueDays = due ? Math.max(0, due.toPlainDate().until(now.toPlainDate()).days) : 0;
    return {
      key: keyOf.get(task.id)!, title: task.title.slice(0, 200),
      ...(due && !task.all_day && overdueDays === 0 ? { at: due.toPlainTime().toString().slice(0, 5) } : {}),
      ...(overdueDays ? { overdue_days: overdueDays } : {}),
      priority: "p" + task.priority,
      ...(task.duration_minutes ? { minutes: task.duration_minutes } : {}),
      ...(task.project_id && projectName.has(task.project_id) ? { project: projectName.get(task.project_id) } : {}),
    };
  });
  const reply = await ask(config, {
    model: PLAN_MODEL, effort: "medium", system: planSystem, format: planFormat, parse: planReply,
    user: JSON.stringify({ now: now.toPlainTime().toString().slice(0, 5), weekday: now.dayOfWeek, tasks: described }),
  });

  // Every task comes back exactly once whatever the model returned: unknown keys are dropped, repeats ignored,
  // and anything it left out keeps its original place at the end.
  const idOf = new Map([...keyOf].map(([id, key]) => [key, id]));
  const seen = new Set<string>();
  const order: AiPlan["order"] = [];
  for (const item of reply.order) {
    const id = idOf.get(item.key);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    order.push({ task_id: id, reason: item.reason.slice(0, 60) });
  }
  for (const task of tasks) if (!seen.has(task.id)) order.push({ task_id: task.id, reason: "" });
  return { order, note: reply.note.slice(0, 200) };
}
