import type { ApiError } from "../../../packages/shared/types.ts";
import { ApiProblem, Supabase, type SupabaseConfig } from "./http.ts";
import { handleMcp } from "./mcp.ts";
import { authenticatedRoute, version } from "./routes.ts";
import { InvalidSchedule } from "./schedule.ts";

export function createHandler(config: SupabaseConfig) {
  const handle = async (request: Request): Promise<Response> => {
    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, accept, mcp-protocol-version, mcp-session-id",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Cache-Control": "no-store",
    });
    const empty = (status: number) => new Response(null, { status, headers });
    const json = (data: unknown, status: number) => Response.json(data, { status, headers });
    try {
      if (request.method === "OPTIONS") return empty(204);
      const url = new URL(request.url);
      // AI assistants connect here. The path segment is the connection token, so no other credential is sent.
      const assistant = /^(?:\/functions\/v1)?\/api\/mcp\/([A-Za-z0-9_-]{32,128})\/?$/.exec(url.pathname);
      if (assistant) return await handleMcp(request, config, assistant[1], handle, headers);
      const route = /^(?:\/functions\/v1)?\/api\/v1\/([^/]+(?:\/[^/]+)*)\/?$/.exec(url.pathname);
      if (!route) throw new ApiProblem(404, "NOT_FOUND", "Route not found");
      const parts = route[1].split("/");
      if (route[1] === "app/version") {
        if (request.method !== "GET") throw new ApiProblem(405, "METHOD_NOT_ALLOWED", "Use GET");
        const result = await version(new Supabase(config));
        if (result.cache) headers.set("Cache-Control", "public, max-age=60");
        return json(result.data, 200);
      }
      const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
      if (!token) throw new ApiProblem(401, "UNAUTHORIZED", "Supply a Supabase access token");
      const db = new Supabase(config, token);
      const user = await db.user();
      const result = await authenticatedRoute(request, db, user.id, parts, url.searchParams, config.url, config);
      return result.status === 204 ? empty(204) : json(result.data, result.status ?? 200);
    } catch (error) {
      const problem = error instanceof ApiProblem ? error : error instanceof InvalidSchedule
        ? new ApiProblem(400, "INVALID_SCHEDULE", error.message)
        : new ApiProblem(503, "SERVICE_UNAVAILABLE", "Service is temporarily unavailable");
      const body: ApiError = { error: { code: problem.code, message: problem.message, fields: problem.fields } };
      return json(body, problem.status);
    }
  };
  return handle;
}
