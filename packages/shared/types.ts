/** Wire types for /functions/v1/api/v1. */
export type UUID = string;
export type Instant = string;
export type LocalDate = string;
export type Priority = 1 | 2 | 3 | 4;
export type RecurrenceMode = "schedule" | "completion";
export type HabitCadence = "daily" | "weekly";
export type HabitLogStatus = "completed" | "skipped" | "frozen";
export type FocusStatus = "running" | "completed" | "cancelled";

export interface OwnedRow {
  id: UUID;
  user_id: UUID;
  created_at: Instant;
}
export interface User {
  id: UUID;
  display_name: string | null;
  timezone: string;
  /** Where a task written without a date lands: today, or undated in the list. */
  new_task_date: NewTaskDate;
  created_at: Instant;
}
export type NewTaskDate = "today" | "none";
export type UserPatch = Partial<Pick<User, "display_name" | "timezone" | "new_task_date">>;

export interface Project extends OwnedRow { name: string; position: number }
export interface Section extends Project { project_id: UUID }
export interface Tag extends OwnedRow { name: string }
export type ProjectPatch = Partial<Pick<Project, "name" | "position">>;
export type SectionPatch = ProjectPatch;
export type ProjectInput = Pick<Project, "name"> & Partial<Pick<Project, "position">>;
export type SectionInput = ProjectInput & Pick<Section, "project_id">;
export type TagInput = Pick<Tag, "name">;

export interface Task extends OwnedRow {
  project_id: UUID | null;
  section_id: UUID | null;
  parent_task_id: UUID | null;
  title: string;
  notes: string | null;
  priority: Priority;
  position: number;
  due_at: Instant | null;
  all_day: boolean;
  timezone: string;
  recurrence_rule: string | null;
  recurrence_mode: RecurrenceMode;
  recurrence_anchor_at: Instant | null;
  recurrence_local_time: string | null;
  /** For a repeating task whose current occurrence was moved off its slot: that slot. Otherwise null. */
  occurrence_at: Instant | null;
  duration_minutes: number | null;
  completed_at: Instant | null;
  updated_at: Instant;
}
export type Subtask = Task & { parent_task_id: UUID; project_id: null; section_id: null };
type TaskFields = Partial<Pick<Task, "project_id" | "section_id" | "title" | "notes" |
  "priority" | "position" | "due_at" | "all_day" | "timezone" | "recurrence_rule" | "recurrence_mode" |
  "recurrence_local_time" | "duration_minutes">>;
export type TaskPatch = (TaskFields & { preserve_recurrence?: never; expected_due_at?: never })
  | { due_at: Instant; expected_due_at: Instant; preserve_recurrence: true };
export type TaskInput = TaskFields & Pick<Task, "title"> & Partial<Pick<Task, "id" | "parent_task_id">>;
export interface TaskTag { user_id: UUID; task_id: UUID; tag_id: UUID }
export interface CompleteTaskInput { request_id: UUID; expected_updated_at: Instant }
export interface TaskCompletion {
  task: Task;
  completed_at: Instant;
  occurrence_due_at: Instant | null;
}
export interface RescheduleResult { count: number }

/** Whether the server can reach the AI model; the app hides its AI features when it cannot. */
export interface AiStatus { available: boolean }
/** Where a new task seems to belong. Each field is null (or empty) unless the task clearly calls for it. */
export interface AiClassification {
  project_id: UUID | null;
  tag_ids: UUID[];
  priority: 1 | 2 | 3 | null;
  duration_minutes: number | null;
}
/** Today's open tasks in a suggested order, each with the reason for its place. */
export interface AiPlan {
  order: { task_id: UUID; reason: string }[];
  note: string;
}

export interface ParseTaskInput { text: string; timezone: string; now?: Instant }
export interface ParsedTask {
  title: string;
  due_at: Instant | null;
  all_day: boolean;
  timezone: string;
  recurrence_rule: string | null;
  recurrence_mode: RecurrenceMode;
  recurrence_local_time: string | null;
  duration_minutes: number | null;
  project: string | null;
  tags: string[];
  priority: Priority;
}

export interface Habit extends OwnedRow {
  name: string;
  cadence: HabitCadence;
  target_count: number;
  timezone: string;
  start_date: LocalDate;
  archived_at: Instant | null;
}
export type HabitInput = Pick<Habit, "name" | "cadence" | "timezone"> &
  Partial<Pick<Habit, "id" | "target_count" | "start_date">>;
export interface HabitPatch { name?: string; archive?: boolean }
export interface HabitLogInput { status: HabitLogStatus; count?: number }
export interface HabitLog {
  user_id: UUID;
  habit_id: UUID;
  log_date: LocalDate;
  status: HabitLogStatus;
  count: number;
  created_at: Instant;
}
export interface HabitStats {
  as_of: LocalDate;
  current_streak: number;
  longest_streak: number;
  completed_periods: number;
  evaluated_periods: number;
  completion_rate: number | null;
  current_period_count: number;
}

export interface FocusSession extends OwnedRow {
  task_id: UUID | null;
  habit_id: UUID | null;
  started_at: Instant;
  ended_at: Instant | null;
  planned_seconds: number;
  status: FocusStatus;
}
export type FocusInput = Partial<Pick<FocusSession, "id" | "task_id" | "habit_id" | "started_at" | "planned_seconds">>;
export interface FinishFocusInput {
  status: Exclude<FocusStatus, "running">;
  ended_at?: Instant;
}

export interface AppVersion {
  latestVersion: string;
  versionCode: number;
  minSupportedVersion: string;
  releaseNotes: string;
  apkDownloadUrl: string;
  iosStoreOrTestFlightUrl: string | null;
}
/** An AI assistant's access to the account. `url` is returned once, when the connection is created. */
export interface McpConnection {
  id: UUID;
  label: string;
  created_at: Instant;
  last_used_at: Instant | null;
}
export interface McpConnectionInput { label?: string }
export type NewMcpConnection = McpConnection & { url: string };
export interface Page<T> { items: T[]; nextOffset: number | null }
export interface ApiError { error: { code: string; message: string; fields?: string[] } }
