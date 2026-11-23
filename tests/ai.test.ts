import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../supabase/functions/api/handler.ts";

const upstream = "https://supabase.invalid";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const health = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const work = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const outside = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

const request = (path: string, method = "GET", body?: object) =>
  new Request("https://edge.invalid/functions/v1/api/v1/" + path, {
    method, headers: { Authorization: "Bearer session", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body && JSON.stringify(body),
  });

interface Call { url: URL; headers: Headers; body: Record<string, unknown> }

/** A backend whose Anthropic calls are answered by `reply`, which sees each request in turn. */
function backend(reply: (call: Call, count: number) => Response, key: string | null = "sk-test") {
  const calls: Call[] = [];
  const handler = createHandler({ url: upstream, key: "anon-key", anthropicKey: key ?? undefined, fetch: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.anthropic.com") {
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
      const raw = input instanceof Request ? await input.text() : String(init?.body);
      const call = { url, headers, body: JSON.parse(raw) as Record<string, unknown> };
      calls.push(call);
      return reply(call, calls.length);
    }
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
    if (url.pathname === "/rest/v1/projects") return Response.json([{ id: health, name: "건강" }, { id: work, name: "회사" }]);
    if (url.pathname === "/rest/v1/tags") return Response.json([{ id: outside, name: "외출" }]);
    if (url.pathname === "/rest/v1/tasks") {
      assert.equal(url.searchParams.get("completed_at"), "is.null");
      return Response.json(ids.map((id, index) => ({
        id, title: ["운동", "보고서", "장보기"][index], timezone: "Asia/Seoul", priority: index + 1, all_day: true,
        due_at: "2099-01-01T15:00:00Z", duration_minutes: index === 0 ? 45 : null, project_id: index === 1 ? work : null,
      })));
    }
    throw new Error("Unexpected request " + url);
  } });
  return { handler, calls };
}

const answer = (payload: object, extra: object = {}) => Response.json({
  id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text: JSON.stringify(payload) }], usage: { input_tokens: 10, output_tokens: 10 }, ...extra,
});

test("AI routes say when no key is configured instead of calling out", async () => {
  const { handler, calls } = backend(() => { throw new Error("must not be called"); }, null);
  assert.deepEqual(await (await handler(request("ai/status"))).json(), { available: false });
  const refused = await handler(request("ai/classify", "POST", { title: "운동" }));
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).error.code, "AI_UNAVAILABLE");
  assert.equal(calls.length, 0);
});

test("classifying a task offers only what already exists and leaves the rest empty", async () => {
  const { handler, calls } = backend(() => answer({ project: " 건강 ", tags: ["외출", "없는 태그"], priority: 0, duration_minutes: 45 }));
  assert.deepEqual(await (await handler(request("ai/status"))).json(), { available: true });
  const result = await handler(request("ai/classify", "POST", { title: "저녁 러닝 5km", notes: null }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { project_id: health, tag_ids: [outside], priority: null, duration_minutes: 45 });

  const [call] = calls;
  assert.equal(call.url.pathname, "/v1/messages");
  assert.equal(call.headers.get("authorization"), "Bearer sk-test");
  assert.equal(call.body.model, "claude-sonnet-5-5");
  assert.equal(call.body.fallbacks, "default");
  assert.match(call.headers.get("anthropic-beta") ?? "", /server-side-fallback-2026-07-01/);
  const config = call.body.output_config as { effort: string; format: { type: string } };
  assert.deepEqual([config.effort, config.format.type], ["low", "json_schema"]);
  const sent = JSON.parse((call.body.messages as { content: string }[])[0].content);
  assert.deepEqual(sent, { task: { title: "저녁 러닝 5km" }, existing_projects: ["건강", "회사"], existing_tags: ["외출"] });

  // Out-of-range answers are dropped rather than passed on.
  const odd = backend(() => answer({ project: "여행", tags: [], priority: 2, duration_minutes: 9999 }));
  assert.deepEqual(await (await odd.handler(request("ai/classify", "POST", { title: "항공권 예매 꼭" }))).json(),
    { project_id: null, tag_ids: [], priority: 2, duration_minutes: null });
  assert.equal((await handler(request("ai/classify", "POST", { title: "" }))).status, 400);
  assert.equal((await handler(request("ai/classify"))).status, 405);
});

test("a request the fallback option does not fit is sent again without it", async () => {
  const { handler, calls } = backend((_call, count) => (count === 1
    ? Response.json({ type: "error", error: { type: "invalid_request_error", message: "fallbacks unsupported" } }, { status: 400 })
    : answer({ project: "", tags: [], priority: 0, duration_minutes: 0 })));
  const result = await handler(request("ai/classify", "POST", { title: "우유 사기" }));
  assert.deepEqual(await result.json(), { project_id: null, tag_ids: [], priority: null, duration_minutes: null });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.fallbacks, undefined);
});

test("planning today returns every task once, whatever the model answers", async () => {
  const { handler, calls } = backend(() => answer({
    order: [{ key: "t3", reason: "가는 길에 처리" }, { key: "t1", reason: "오전에 집중" }, { key: "t1", reason: "중복" }, { key: "t9", reason: "없는 키" }],
    note: "오전에 운동부터 끝내는 것을 권합니다.",
  }));
  const result = await handler(request("ai/plan-today", "POST", { task_ids: ids }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    order: [{ task_id: ids[2], reason: "가는 길에 처리" }, { task_id: ids[0], reason: "오전에 집중" }, { task_id: ids[1], reason: "" }],
    note: "오전에 운동부터 끝내는 것을 권합니다.",
  });
  assert.equal(calls[0].body.model, "claude-opus-5-5");
  const sent = JSON.parse((calls[0].body.messages as { content: string }[])[0].content);
  assert.deepEqual(sent.tasks[0], { key: "t1", title: "운동", priority: "p1", minutes: 45 });
  assert.deepEqual(sent.tasks[1], { key: "t2", title: "보고서", priority: "p2", project: "회사" });
  assert.equal((await handler(request("ai/plan-today", "POST", { task_ids: [] }))).status, 400);
  assert.equal((await handler(request("ai/plan-today", "POST", { task_ids: ["nope"] }))).status, 400);
});

test("a declined, rejected or malformed answer becomes a clear error", async () => {
  const declined = backend(() => answer({}, { stop_reason: "refusal", content: [] }));
  const refusal = await declined.handler(request("ai/classify", "POST", { title: "운동" }));
  assert.deepEqual([refusal.status, (await refusal.json()).error.code], [422, "AI_DECLINED"]);

  const badKey = backend(() => Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 }));
  const rejected = await badKey.handler(request("ai/classify", "POST", { title: "운동" }));
  assert.deepEqual([rejected.status, (await rejected.json()).error.code], [503, "AI_UNAVAILABLE"]);

  const garbled = backend(() => answer({ project: 3 }));
  const malformed = await garbled.handler(request("ai/classify", "POST", { title: "운동" }));
  assert.deepEqual([malformed.status, (await malformed.json()).error.code], [502, "AI_FAILED"]);
});
