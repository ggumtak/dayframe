import { test } from "node:test";
import assert from "node:assert/strict";
import { Temporal } from "@js-temporal/polyfill";
import { createHandler } from "../supabase/functions/api/handler.ts";
import { hashToken, tools } from "../supabase/functions/api/mcp.ts";

const upstream = "https://project.supabase.invalid";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const token = "A".repeat(43);
const taskId = "33333333-3333-4333-8333-333333333333";
const projectId = "11111111-1111-4111-8111-111111111111";

/** A stand-in for Supabase Auth and PostgREST that records every data request the tools make. */
async function backend(options: { tasks?: object[] } = {}) {
  const hash = await hashToken(token);
  const calls: Array<{ method: string; path: string; query: URLSearchParams; body?: Record<string, unknown>; bearer: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const bearer = (headers.get("Authorization") ?? "").replace("Bearer ", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;
    if (path === "/rest/v1/mcp_connections" && bearer === "service-key") {
      if (method === "PATCH") return new Response(null, { status: 204 });
      return Response.json(url.searchParams.get("token_hash") === "eq." + hash ? [{ id: "c1", user_id: owner }] : []);
    }
    if (path === "/auth/v1/admin/users/" + owner && bearer === "service-key") return Response.json({ email: "me@example.com" });
    if (path === "/auth/v1/admin/generate_link" && bearer === "service-key") {
      return Response.json({ hashed_token: "hashed", verification_type: "magiclink" });
    }
    if (path === "/auth/v1/verify" && body.token_hash === "hashed") return Response.json({ access_token: "owner-session", expires_in: 3600 });
    if (path === "/auth/v1/user") return bearer === "owner-session" ? Response.json({ id: owner }) : Response.json({}, { status: 401 });
    assert.equal(bearer, "owner-session", "data requests must run as the connection's owner, never as the service role");
    calls.push({ method, path, query: url.searchParams, body, bearer });
    if (path === "/rest/v1/users") return Response.json([{ id: owner, timezone: "Asia/Seoul" }]);
    if (path === "/rest/v1/projects") return Response.json(method === "POST" ? [{ id: projectId, ...body }] : []);
    if (path === "/rest/v1/tasks" && method === "POST") {
      return Response.json([{ id: taskId, project_id: null, parent_task_id: null, notes: null, recurrence_rule: null, timezone: "Asia/Seoul", ...body }]);
    }
    if (path === "/rest/v1/tasks" && method === "DELETE") return new Response(null, { status: 204 });
    if (path === "/rest/v1/tasks") return Response.json(options.tasks ?? []);
    return Response.json([]);
  };
  const handler = createHandler({ url: upstream, key: "anon-key", serviceKey: "service-key", fetch: fetcher });
  let nextId = 1;
  const rpc = async (method: string, params?: object, path = token) => {
    const response = await handler(new Request("https://edge.invalid/functions/v1/api/mcp/" + path, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }));
    return { status: response.status, body: response.status === 200 ? await response.json() : null };
  };
  const call = async (name: string, args: object = {}) => {
    const { body } = await rpc("tools/call", { name, arguments: args });
    return { isError: body.result.isError === true, text: body.result.content[0].text as string };
  };
  return { handler, calls, rpc, call };
}

test("a connection URL is the only credential and unknown ones are refused without a sign-in challenge", async () => {
  const { handler, rpc } = await backend();
  assert.equal((await rpc("ping", undefined, "B".repeat(43))).status, 404);
  assert.equal((await rpc("ping")).status, 200);
  const get = await handler(new Request("https://edge.invalid/functions/v1/api/mcp/" + token));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST, OPTIONS");
  const unconfigured = createHandler({ url: upstream, key: "anon-key", fetch: async () => Response.json([]) });
  const response = await unconfigured(new Request("https://edge.invalid/api/mcp/" + token, { method: "POST", body: "{}" }));
  assert.equal(response.status, 503);
});

test("protocol handshake, tool listing, notifications and batches", async () => {
  const { handler, rpc } = await backend();
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.body.result.capabilities, { tools: { listChanged: false } });
  assert.equal(init.body.result.serverInfo.name, "dayframe");
  assert.equal((await rpc("initialize", { protocolVersion: "1999-01-01" })).body.result.protocolVersion, "2025-11-25");

  const listed = (await rpc("tools/list")).body.result.tools as Array<{ name: string; inputSchema: { type: string }; annotations: Record<string, boolean> }>;
  assert.deepEqual(listed.map((tool) => tool.name), tools.map((tool) => tool.name));
  assert.ok(listed.every((tool) => tool.inputSchema.type === "object" && !("run" in tool)));
  assert.deepEqual(listed.filter((tool) => tool.annotations.destructiveHint).map((tool) => tool.name), ["delete_task", "remove_habit"]);
  assert.deepEqual(listed.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name), ["list_tasks", "list_projects", "list_habits"]);

  const post = (body: unknown) => handler(new Request("https://edge.invalid/functions/v1/api/mcp/" + token, { method: "POST", body: JSON.stringify(body) }));
  assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const batch = await (await post([{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: "b", method: "resources/list" }])).json();
  assert.deepEqual(batch, [{ jsonrpc: "2.0", id: "a", result: {} }, { jsonrpc: "2.0", id: "b", error: { code: -32601, message: "Method not found" } }]);
  const malformed = await handler(new Request("https://edge.invalid/functions/v1/api/mcp/" + token, { method: "POST", body: "{" }));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, -32700);
  assert.equal((await rpc("tools/call", { name: "drop_database" })).body.error.code, -32602);
});

test("add_task parses natural language, creates the project and stores the task as the owner", async () => {
  const { calls, call } = await backend();
  const result = await call("add_task", { text: "내일 저녁 7시 운동 #건강 p1", notes: "준비물: 운동화" });
  assert.equal(result.isError, false);
  const created = calls.find((item) => item.path === "/rest/v1/tasks" && item.method === "POST")!.body!;
  assert.equal(created.title, "운동");
  assert.equal(created.priority, 1);
  assert.equal(created.project_id, projectId);
  assert.equal(created.notes, "준비물: 운동화");
  assert.equal(created.position, 1024);
  const due = Temporal.Instant.from(created.due_at as string).toZonedDateTimeISO("Asia/Seoul");
  assert.equal(due.toPlainTime().toString(), "19:00:00");
  assert.equal(due.toPlainDate().toString(), Temporal.Now.plainDateISO("Asia/Seoul").add({ days: 1 }).toString());
  assert.deepEqual(calls.find((item) => item.path === "/rest/v1/projects" && item.method === "POST")!.body, { name: "건강" });
  const added = JSON.parse(result.text).added;
  assert.deepEqual([added.title, added.priority, added.project, added.status], ["운동", "p1", "건강", "upcoming"]);
});

test("tool failures are returned to the assistant as readable errors", async () => {
  const { calls, call } = await backend();
  const conflict = await call("add_task", { text: "내일 모레 운동" });
  assert.deepEqual(conflict, { isError: true, text: "Use one due date per task" });
  assert.equal((await call("add_task", {})).isError, true);
  assert.equal((await call("update_task", { task_id: taskId })).text, "Nothing to change: pass at least one field besides task_id");
  assert.equal((await call("complete_task", { task_id: "not-an-id" })).text, "task_id must be an ID returned by a list tool");
  assert.equal((await call("update_task", { task_id: taskId, schedule: "언젠가 한가할 때" })).isError, true);
  assert.equal(calls.some((item) => item.method !== "GET"), false);
});

test("list_tasks filters by view and delete_task removes the named task", async () => {
  const day = (offset: number) => Temporal.Now.plainDateISO("Asia/Seoul").add({ days: offset })
    .toZonedDateTime({ timeZone: "Asia/Seoul", plainTime: "09:00" }).toInstant().toString();
  const base = { project_id: null, parent_task_id: null, notes: null, recurrence_rule: null, timezone: "Asia/Seoul", all_day: false, priority: 4 };
  const { calls, call } = await backend({ tasks: [
    { ...base, id: taskId, title: "어제 일", due_at: day(-1) }, { ...base, id: "t2", title: "오늘 일", due_at: day(0), priority: 1 },
    { ...base, id: "t3", title: "다음 주", due_at: day(7) }, { ...base, id: "t4", title: "언젠가", due_at: null },
  ] });
  const titles = async (view?: string) => JSON.parse((await call("list_tasks", view ? { view } : {})).text).tasks.map((task: { title: string }) => task.title);
  assert.deepEqual(await titles(), ["어제 일", "오늘 일"]);
  assert.deepEqual(await titles("upcoming"), ["다음 주"]);
  assert.deepEqual(await titles("all"), ["어제 일", "오늘 일", "다음 주", "언젠가"]);
  const listed = JSON.parse((await call("list_tasks", { view: "overdue" })).text);
  assert.deepEqual([listed.total, listed.tasks[0].status, listed.tasks[0].due.slice(11)], [1, "overdue", "09:00"]);

  assert.equal((await call("delete_task", { task_id: taskId })).isError, false);
  const removed = calls.find((item) => item.method === "DELETE")!;
  assert.deepEqual([removed.path, removed.query.get("id")], ["/rest/v1/tasks", "eq." + taskId]);
});

test("connections are created with a one-time URL, listed without secrets and capped", async () => {
  const stored: Array<Record<string, string>> = [];
  const handler = createHandler({ url: upstream, key: "anon-key", serviceKey: "service-key", fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: owner });
    assert.equal(url.pathname, "/rest/v1/mcp_connections");
    if (init?.method === "POST") {
      assert.equal(url.searchParams.get("select"), "id,label,created_at,last_used_at");
      stored.push(JSON.parse(String(init.body)));
      return Response.json([{ id: "c" + stored.length, label: stored.at(-1)!.label ?? "AI", created_at: "2026-11-21T00:00:00+00:00", last_used_at: null }]);
    }
    assert.ok(!url.searchParams.get("select")!.includes("token_hash"));
    return Response.json(stored.map((_, index) => ({ id: "c" + index })));
  } });
  const request = (method: string, body?: object) => handler(new Request("https://edge.invalid/functions/v1/api/v1/mcp-connections", {
    method, headers: { Authorization: "Bearer session", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body && JSON.stringify(body),
  }));
  const created = await request("POST", { label: "Claude" });
  assert.equal(created.status, 201);
  const connection = await created.json();
  const secret = /^https:\/\/project\.supabase\.invalid\/functions\/v1\/api\/mcp\/([A-Za-z0-9_-]{43})$/.exec(connection.url)![1];
  assert.deepEqual(stored[0], { user_id: owner, token_hash: await hashToken(secret), label: "Claude" });
  assert.equal(JSON.stringify(connection).includes(stored[0].token_hash), false);
  for (let count = 1; count < 5; count++) assert.equal((await request("POST", {})).status, 201);
  assert.equal((await request("POST", {})).status, 409);
  assert.equal(new Set(stored.map((row) => row.token_hash)).size, 5);
  assert.equal((await request("POST", { label: "x", admin: true })).status, 400);
});
