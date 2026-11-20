import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../supabase/functions/api/handler.ts";

const upstream = "https://supabase.invalid";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const habitId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request = (path: string, method = "GET", body?: object, token = "signed-session") =>
  new Request("https://edge.invalid/functions/v1/api/v1/" + path, {
    method,
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body && JSON.stringify(body),
  });

test("private routes check the user token, even for stateless parsing", async () => {
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async (input, init) => {
    assert.equal(new URL(String(input)).pathname, "/auth/v1/user");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer signed-session");
    return Response.json({ id: userId });
  } });
  assert.equal((await handler(request("me", "GET", undefined, ""))).status, 401);
  const invalid = await handler(request("tasks/parse", "POST", { text: "내일 운동", timezone: "Mars/Olympus" }));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "INVALID_INPUT");
  const result = await handler(request("tasks/parse", "POST", {
    text: "내일 운동 #건강 @외출 p2", timezone: "Asia/Seoul", now: "2026-11-22T09:00:00Z",
  }));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), { title: "운동", due_at: "2026-11-22T15:00:00Z",
    all_day: true, timezone: "Asia/Seoul", recurrence_rule: null, recurrence_local_time: null, project: "건강", tags: ["외출"], priority: 2 });
});

test("version endpoint is anonymous and maps published GitHub release metadata", async () => {
  let hasRelease = true;
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/rest/v1/app_releases");
    assert.equal(url.searchParams.get("order"), "version_code.desc");
    assert.equal(new Headers(init?.headers).get("Authorization"), null);
    return Response.json(hasRelease ? [{
      latest_version: "1.0.0", version_code: 4, min_supported_version: "1.0.0", release_notes: "First build",
      apk_download_url: "https://github.com/a/b/releases/download/v1.0.0/dayframe.apk",
      ios_store_or_test_flight_url: null,
    }] : []);
  } });
  const result = await handler(request("app/version", "GET", undefined, ""));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "public, max-age=60");
  assert.deepEqual(await result.json(), { latestVersion: "1.0.0", versionCode: 4, minSupportedVersion: "1.0.0",
    releaseNotes: "First build", apkDownloadUrl: "https://github.com/a/b/releases/download/v1.0.0/dayframe.apk",
    iosStoreOrTestFlightUrl: null });
  hasRelease = false;
  assert.equal((await handler(request("app/version"))).status, 404);
});

test("habit log retries are upserts scoped to the caller", async () => {
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer signed-session");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
    assert.equal(url.pathname, "/rest/v1/habit_logs");
    assert.equal(url.searchParams.get("on_conflict"), "user_id,habit_id,log_date");
    assert.equal(headers.get("Prefer"), "resolution=merge-duplicates,return=representation");
    const row = { user_id: userId, habit_id: habitId, log_date: "2026-11-22", status: "frozen", count: 0 };
    assert.deepEqual(JSON.parse(String(init?.body)), row);
    return Response.json([row]);
  } });
  const result = await handler(request("habits/" + habitId + "/logs/2026-11-22", "PUT", { status: "frozen" }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).count, 0);
});

test("pagination computes nextOffset and database errors never expose SQL details", async () => {
  let reject = false;
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
    if (reject) return Response.json({ code: "23503", details: "private SQL parameters" }, { status: 400 });
    assert.equal(url.pathname, "/rest/v1/tasks");
    assert.equal(url.searchParams.get("limit"), "3");
    assert.equal(url.searchParams.get("parent_task_id"), "is.null");
    assert.equal(url.searchParams.get("completed_at"), "is.null");
    return Response.json([{ id: "a" }, { id: "b" }, { id: "c" }]);
  } });
  const result = await handler(request("tasks?limit=2&offset=4&parent_task_id=root&state=open"));
  assert.deepEqual(await result.json(), { items: [{ id: "a" }, { id: "b" }], nextOffset: 6 });
  reject = true;
  const denied = await handler(request("tasks", "POST", { title: "Hello", project_id: habitId, timezone: "UTC" }));
  assert.equal(denied.status, 400);
  const error = await denied.json();
  assert.equal(error.error.code, "INVALID_REFERENCE");
  assert.ok(!JSON.stringify(error).includes("SQL"));
});

test("invalid JSON, oversized streaming input and malformed methods receive stable error codes", async () => {
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async () => Response.json({ id: userId }) });
  const path = "https://edge.invalid/api/v1/tasks/parse";
  for (const [body, status] of [["{", 400], [" ".repeat(65_537), 413]] as const) {
    const result = await handler(new Request(path, { method: "POST", body, headers: {
      Authorization: "Bearer t", "Content-Type": "application/json",
    } }));
    assert.equal(result.status, status);
  }
  assert.equal((await handler(request("tasks/parse", "GET"))).status, 405);
  assert.equal((await handler(request("tasks", "OPTIONS", undefined, ""))).status, 204);
});
