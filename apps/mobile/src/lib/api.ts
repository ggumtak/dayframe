import { accessToken, refreshedToken } from './auth';
import { apiBase, env } from './env';
import type {
  ApiError, AppVersion, CompleteTaskInput, FinishFocusInput, FocusInput, FocusSession, Habit, HabitInput, HabitLog,
  HabitLogInput, HabitPatch, HabitStats, McpConnection, NewMcpConnection, Page, Project, ProjectInput, RescheduleResult, Tag, Task, TaskCompletion,
  TaskInput, TaskPatch, TaskTag, User, UserPatch,
} from './shared';

/** An HTTP failure from the Dayframe API, carrying the stable error `code` from the contract. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: string[];

  constructor(status: number, code: string, message: string, fields?: string[]) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** True when the server answered and a retry cannot change that answer, so a queued write should be dropped. */
export function isPermanentFailure(error: unknown): boolean {
  return error instanceof ApiFailure && error.status >= 400 && error.status < 500 && error.status !== 429;
}

/** True when no answer arrived at all: the write is still valid and should wait for the network. */
export function isUnreachable(error: unknown): boolean {
  return !(error instanceof ApiFailure);
}

const messages: Record<string, string> = {
  INVALID_INPUT: '입력값을 확인해 주세요.',
  INVALID_SCHEDULE: '날짜나 시간을 이해하지 못했습니다.',
  INVALID_REFERENCE: '연결된 항목을 찾을 수 없습니다.',
  NOT_FOUND: '항목을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.',
  CONFLICT: '이미 존재하거나 진행 중인 항목이 있습니다.',
  STALE_RESOURCE: '다른 기기에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
  UNAUTHORIZED: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  SERVER: '서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.',
  NETWORK: '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiFailure) {
    return messages[error.code] ?? (error.status >= 500 ? messages.SERVER : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return messages.NETWORK;
}

type Query = Record<string, string | number | undefined>;
interface Options { method?: string; body?: object; query?: Query; anonymous?: boolean }

async function send(path: string, options: Options, token: string | null): Promise<Response> {
  const search = Object.entries(options.query ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
    .join('&');
  return fetch(apiBase + path + (search ? '?' + search : ''), {
    method: options.method ?? 'GET',
    headers: {
      apikey: env.supabaseKey,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function request<T>(path: string, options: Options = {}): Promise<T> {
  let token = options.anonymous ? null : await accessToken();
  if (!options.anonymous && !token) throw new ApiFailure(401, 'UNAUTHORIZED', 'No session');
  let response = await send(path, options, token);
  if (response.status === 401 && !options.anonymous) {
    // The token can expire between the local check and the server's; refresh once and retry.
    token = await refreshedToken();
    if (token) response = await send(path, options, token);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const detail = (payload as ApiError | undefined)?.error;
    throw new ApiFailure(response.status, detail?.code ?? 'HTTP_' + response.status, detail?.message ?? 'Request failed', detail?.fields);
  }
  return payload as T;
}

/** Follows `nextOffset` until the collection is exhausted. */
async function all<T>(path: string, query: Query = {}): Promise<T[]> {
  const items: T[] = [];
  let offset: number | null = 0;
  while (offset !== null && items.length < 5000) {
    const page: Page<T> = await request<Page<T>>(path, { query: { ...query, limit: 100, offset } });
    items.push(...page.items);
    offset = page.nextOffset;
  }
  return items;
}

const json = <T>(path: string, method: string, body?: object) => request<T>(path, { method, body: body ?? {} });

export const api = {
  me: () => request<User>('/me'),
  updateMe: (patch: UserPatch) => json<User>('/me', 'PATCH', patch),

  projects: () => all<Project>('/projects'),
  createProject: (input: ProjectInput) => json<Project>('/projects', 'POST', input),
  updateProject: (id: string, patch: Partial<ProjectInput>) => json<Project>('/projects/' + id, 'PATCH', patch),
  deleteProject: (id: string) => request<void>('/projects/' + id, { method: 'DELETE' }),
  tags: () => all<Tag>('/tags'),
  createTag: (name: string) => json<Tag>('/tags', 'POST', { name }),

  openTasks: () => all<Task>('/tasks', { state: 'open' }),
  completedTasks: () => all<Task>('/tasks', { state: 'completed' }),
  task: (id: string) => request<Task>('/tasks/' + id),
  createTask: (input: TaskInput) => json<Task>('/tasks', 'POST', input),
  updateTask: (id: string, patch: TaskPatch) => json<Task>('/tasks/' + id, 'PATCH', patch),
  deleteTask: (id: string) => request<void>('/tasks/' + id, { method: 'DELETE' }),
  completeTask: (id: string, input: CompleteTaskInput) => json<TaskCompletion>('/tasks/' + id + '/complete', 'POST', input),
  reopenTask: (id: string) => request<Task>('/tasks/' + id + '/reopen', { method: 'POST' }),
  rescheduleOverdue: () => request<RescheduleResult>('/tasks/reschedule-overdue', { method: 'POST' }),
  taskTags: () => all<TaskTag>('/task-tags'),
  attachTag: (taskId: string, tagId: string) => request<void>('/tasks/' + taskId + '/tags/' + tagId, { method: 'PUT' }),
  detachTag: (taskId: string, tagId: string) => request<void>('/tasks/' + taskId + '/tags/' + tagId, { method: 'DELETE' }),

  habits: () => all<Habit>('/habits'),
  createHabit: (input: HabitInput) => json<Habit>('/habits', 'POST', input),
  updateHabit: (id: string, patch: HabitPatch) => json<Habit>('/habits/' + id, 'PATCH', patch),
  deleteHabit: (id: string) => request<void>('/habits/' + id, { method: 'DELETE' }),
  habitLogs: (id: string) => all<HabitLog>('/habits/' + id + '/logs'),
  setHabitLog: (id: string, date: string, input: HabitLogInput) => json<HabitLog>('/habits/' + id + '/logs/' + date, 'PUT', input),
  deleteHabitLog: (id: string, date: string) => request<void>('/habits/' + id + '/logs/' + date, { method: 'DELETE' }),
  habitStats: (id: string) => request<HabitStats>('/habits/' + id + '/stats'),

  focusSessions: () => request<Page<FocusSession>>('/focus-sessions', { query: { limit: 100 } }).then((page) => page.items),
  startFocus: (input: FocusInput) => json<FocusSession>('/focus-sessions', 'POST', input),
  finishFocus: (id: string, input: FinishFocusInput) => json<FocusSession>('/focus-sessions/' + id + '/finish', 'POST', input),
  deleteFocus: (id: string) => request<void>('/focus-sessions/' + id, { method: 'DELETE' }),

  mcpConnections: () => request<Page<McpConnection>>('/mcp-connections').then((page) => page.items),
  createMcpConnection: (label: string) => json<NewMcpConnection>('/mcp-connections', 'POST', { label }),
  deleteMcpConnection: (id: string) => request<void>('/mcp-connections/' + id, { method: 'DELETE' }),

  appVersion: () => request<AppVersion>('/app/version', { anonymous: true }),
};
