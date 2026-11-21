import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { recurrence } from "./schedule.ts";

export const uuid = z.uuid().toLowerCase();
export const instant = z.iso.datetime({ offset: true }).refine(
  (value) => {
    try { Temporal.Instant.from(value); return true; } catch { return false; }
  }, "Use a valid ISO 8601 timestamp with an offset",
);
export const timezone = z.string().max(100).regex(/^[A-Za-z][A-Za-z0-9_+/-]*$/).refine(
  (value) => {
    try { Temporal.Now.instant().toZonedDateTimeISO(value); return true; } catch { return false; }
  }, "Use an IANA time zone",
);
export const localDate = z.iso.date();
const name = z.string().trim().min(1).max(120);
const position = z.int32();
const id = uuid.optional();
const link = uuid.nullable().optional();

export const userPatch = z.strictObject({ display_name: z.string().trim().max(120).nullable(), timezone }).partial();
export const project = z.strictObject({ name, position: position.optional() });
export const section = project.extend({ project_id: uuid });
export const tag = z.strictObject({ name });
const taskFields = z.strictObject({
  project_id: link, section_id: link, title: z.string().trim().min(1).max(500),
  notes: z.string().max(10000).nullable().optional(), priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  position: position.optional(), due_at: instant.nullable().optional(), all_day: z.boolean().optional(),
  timezone: timezone.optional(),
  recurrence_local_time: z.iso.time().nullable().optional(),
  recurrence_rule: z.string().max(100).refine((rule) => {
    try { recurrence(rule); return true; } catch { return false; }
  }, "Use a supported daily or weekly RRULE").nullable().optional(),
});
export const task = taskFields.extend({ id, parent_task_id: link });
export const taskPatch = taskFields.partial();
export const complete = z.strictObject({ request_id: uuid, expected_updated_at: instant });
export const parse = z.strictObject({ text: z.string().trim().min(1).max(1000), timezone, now: instant.optional() });

export const habit = z.strictObject({
  id, name, cadence: z.enum(["daily", "weekly"]), target_count: z.int().min(1).max(100).optional(),
  timezone, start_date: localDate.optional(),
});
export const habitPatch = z.strictObject({ name: name.optional(), archive: z.literal(true).optional() });
export const log = z.strictObject({
  status: z.enum(["completed", "skipped", "frozen"]), count: z.int().min(0).max(100).optional(),
}).refine(({ status, count }) => count === undefined || (status === "completed" ? count > 0 : count === 0),
  "Completed logs need a positive count. Skipped or frozen logs need zero.");
export const focus = z.strictObject({
  id, task_id: link, habit_id: link, started_at: instant.optional(),
  planned_seconds: z.int().min(60).max(28800).optional(),
}).refine(({ task_id, habit_id }) => !task_id || !habit_id, "Link one task or one habit");
export const finish = z.strictObject({
  status: z.enum(["completed", "cancelled"]), ended_at: instant.optional(),
});
export const mcpConnection = z.strictObject({ label: z.string().trim().min(1).max(60).optional() });
