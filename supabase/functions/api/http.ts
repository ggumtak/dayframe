import { z } from "zod";

export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: string[];

  constructor(status: number, code: string, message: string, fields?: string[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiProblem(400, "INVALID_INPUT", "Check the supplied fields",
      parsed.error.issues.map((issue) => [issue.path.join("."), issue.message].filter(Boolean).join(" — ")));
  }
  return parsed.data;
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiProblem(415, "UNSUPPORTED_MEDIA_TYPE", "Send application/json");
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "";
  let size = 0;
  let payload: unknown;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65_536) {
        await reader.cancel();
        throw new ApiProblem(413, "BODY_TOO_LARGE", "Body exceeds 64 KiB");
      }
      raw += decoder.decode(value, { stream: true });
    }
    payload = JSON.parse(raw + decoder.decode());
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    throw new ApiProblem(400, "INVALID_JSON", "Send a valid JSON object");
  } finally {
    reader?.releaseLock();
  }
  return validate(schema, payload);
}

export function queryInteger(params: URLSearchParams, key: string, fallback: number, min: number, max: number) {
  const value = params.get(key);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new ApiProblem(400, "INVALID_QUERY", key + " must be an integer");
  const result = Number(value);
  if (result < min || result > max) throw new ApiProblem(400, "INVALID_QUERY", key + " is out of range");
  return result;
}

export function onlyResult<T>(rows: T[]): T {
  if (!rows.length) throw new ApiProblem(404, "NOT_FOUND", "Resource not found");
  return rows[0];
}

export function requireChanges<T extends object>(patch: T): T {
  if (Object.keys(patch).length === 0) throw new ApiProblem(400, "INVALID_INPUT", "Supply at least one field to update");
  return patch;
}

export interface SupabaseConfig {
  url: string;
  key: string;
  /** Service-role key. The AI-connection endpoint uses it to resolve a connection token to its owner, and the
   *  update manifest endpoint to read app_updates, which no other role can read. */
  serviceKey?: string;
  fetch?: typeof fetch;
}

export class Supabase {
  private readonly fetcher: typeof fetch;
  private readonly headers: Record<string, string>;

  private readonly config: SupabaseConfig;

  constructor(config: SupabaseConfig, token?: string) {
    this.config = config;
    this.fetcher = config.fetch ?? fetch;
    this.headers = { apikey: config.key, ...(token ? { Authorization: "Bearer " + token } : {}) };
  }

  async user(): Promise<{ id: string }> {
    const response = await this.fetcher(new URL("/auth/v1/user", this.config.url), {
      headers: this.headers, signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new ApiProblem(401, "UNAUTHORIZED", "Sign in with a valid Supabase session");
    }
    if (!response.ok) throw new ApiProblem(503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable");
    const value = await response.json() as { id?: string };
    if (!value.id) throw new ApiProblem(401, "UNAUTHORIZED", "Sign in with a valid Supabase session");
    return { id: value.id };
  }

  async rest<T>(
    path: string, query: Record<string, string> = {}, method = "GET",
    body?: object, prefer?: string,
  ): Promise<T> {
    const url = new URL("/rest/v1/" + path, this.config.url);
    url.search = new URLSearchParams(query).toString();
    const response = await this.fetcher(url, {
      method,
      headers: {
        ...this.headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      if (response.status === 204 || prefer?.includes("return=minimal")) return undefined as T;
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    const detail = await response.json().catch(() => ({})) as { code?: string };
    const code = detail.code ?? "";
    if (code === "PT404") throw new ApiProblem(404, "NOT_FOUND", "Resource not found");
    if (code === "PT409") throw new ApiProblem(409, "STALE_RESOURCE", "Refresh this resource before retrying");
    if (code === "23505") throw new ApiProblem(409, "CONFLICT", "A unique value or running session already exists");
    if (code === "23503") throw new ApiProblem(400, "INVALID_REFERENCE", "Related resource is unavailable or outside its parent scope");
    if (code.startsWith("22") || ["23502", "23514"].includes(code)) {
      throw new ApiProblem(400, "INVALID_INPUT", "Values do not satisfy the resource constraints");
    }
    if (response.status === 401) throw new ApiProblem(401, "UNAUTHORIZED", "Session expired");
    if (response.status === 403) throw new ApiProblem(403, "FORBIDDEN", "This action is unavailable");
    throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "Data service is temporarily unavailable");
  }
}
