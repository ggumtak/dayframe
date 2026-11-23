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
    all_day: true, timezone: "Asia/Seoul", recurrence_rule: null, recurrence_mode: "schedule",
    recurrence_local_time: null, duration_minutes: null, project: "건강", tags: ["외출"], priority: 2 });
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

test("calendar requests combine normalized due bounds and state filters", async () => {
  const calls: URL[] = [];
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
    calls.push(url);
    return Response.json([]);
  } });
  const from = "due_from=2027-02-01T00%3A00%3A00%2B09%3A00";
  const before = "due_before=2027-03-01T00%3A00%3A00%2B09%3A00";
  assert.equal((await handler(request("tasks?state=open&" + from + "&" + before))).status, 200);
  assert.equal(calls[0].searchParams.get("and"), "(due_at.gte.2027-01-31T15:00:00Z,due_at.lt.2027-02-28T15:00:00Z)");
  assert.equal(calls[0].searchParams.get("completed_at"), "is.null");
  assert.equal(calls[0].searchParams.get("order"), "due_at.asc,priority.asc,position.asc,id.asc");
  assert.equal((await handler(request("subtasks?" + before))).status, 200);
  assert.equal(calls[1].searchParams.get("and"), "(due_at.lt.2027-02-28T15:00:00Z)");
  for (const invalid of ["due_from=2027-02-01", from + "&due_before=2027-01-31T15:00:00Z"]) {
    assert.equal((await handler(request("tasks?" + invalid))).status, 400);
  }
  assert.equal(calls.length, 2);
});

test("one-time moves leave the series intact, retry safely and reject stale occurrences", async () => {
  const updates: unknown[] = [];
  const oldDue = "2027-01-31T00:00:00Z";
  const newDue = "2027-02-01T00:00:00Z";
  const nextDue = "2027-02-28T00:00:00Z";
  let current = oldDue;
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
    if (init?.method === "PATCH") {
      const patch = JSON.parse(String(init.body));
      updates.push(patch);
      const guard = url.searchParams.get("due_at");
      if (guard) {
        assert.equal(guard, "eq." + oldDue);
        assert.equal(url.searchParams.get("completed_at"), "is.null");
        assert.equal(url.searchParams.get("recurrence_rule"), "not.is.null");
        if (guard !== "eq." + current) return Response.json([]);
      }
      current = patch.due_at;
    }
    return Response.json([{ id: habitId, due_at: current, recurrence_rule: "FREQ=MONTHLY", recurrence_anchor_at: oldDue,
      timezone: "UTC", all_day: true, recurrence_local_time: null, occurrence_at: null, completed_at: null }]);
  } });
  const path = "tasks/" + habitId;
  const move = { due_at: newDue, expected_due_at: oldDue, preserve_recurrence: true };
  assert.equal((await handler(request(path, "PATCH", move))).status, 200);
  assert.equal((await handler(request(path, "PATCH", move))).status, 200);
  current = nextDue;
  const stale = await handler(request(path, "PATCH", move));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "STALE_RESOURCE");
  assert.equal(current, nextDue);
  assert.equal((await handler(request(path, "PATCH", { due_at: newDue }))).status, 200);
  assert.equal((await handler(request(path, "PATCH", { due_at: newDue, preserve_recurrence: true }))).status, 400);
  assert.equal((await handler(request(path, "PATCH", { ...move, due_at: null }))).status, 400);
  assert.equal((await handler(request(path, "PATCH", { ...move, all_day: true }))).status, 400);
  // Only the first move writes: the retry finds it applied, and the stale one never reaches the database.
  // 2027-02-01 is off the monthly series, so the slot it left is remembered.
  assert.deepEqual(updates, [{ due_at: newDue, occurrence_at: oldDue }, { due_at: newDue, recurrence_anchor_at: newDue }]);
});

test("completing a monthly task sends the next valid date to the database", async () => {
  const due_at = "2099-01-31T10:00:00Z";
  const revision = "2026-11-22T09:00:00.123456Z";
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async (input, init) => {
    switch (new URL(String(input)).pathname) {
      case "/auth/v1/user": return Response.json({ id: userId });
      case "/rest/v1/task_completions": return Response.json([]);
      case "/rest/v1/tasks": return Response.json([{ due_at, recurrence_anchor_at: due_at, all_day: false,
        recurrence_rule: "FREQ=MONTHLY", timezone: "Asia/Seoul", recurrence_local_time: "19:00:00", updated_at: revision }]);
      case "/rest/v1/rpc/complete_task": {
        const payload = JSON.parse(String(init?.body));
        assert.deepEqual(payload, { p_task: habitId, p_request: userId, p_revision: revision, p_next_due: "2099-03-31T10:00:00Z" });
        return Response.json({ occurrence_due_at: due_at });
      }
      default: throw new Error("Unexpected request");
    }
  } });
  const result = await handler(request("tasks/" + habitId + "/complete", "POST", { request_id: userId, expected_updated_at: revision }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).occurrence_due_at, due_at);
});

test("completing an occurrence moved before its slot continues after that slot", async () => {
  // A weekly Wednesday 19:00 (Seoul) task done early on Monday: the next one is the following Wednesday.
  const slot = "2099-01-07T10:00:00Z";
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async (input, init) => {
    switch (new URL(String(input)).pathname) {
      case "/auth/v1/user": return Response.json({ id: userId });
      case "/rest/v1/task_completions": return Response.json([]);
      case "/rest/v1/tasks": return Response.json([{ due_at: "2099-01-05T10:00:00Z", occurrence_at: slot, recurrence_anchor_at: slot,
        all_day: false, recurrence_rule: "FREQ=WEEKLY", timezone: "Asia/Seoul", recurrence_local_time: "19:00:00", updated_at: slot }]);
      case "/rest/v1/rpc/complete_task":
        assert.equal(JSON.parse(String(init?.body)).p_next_due, "2099-01-14T10:00:00Z");
        return Response.json({});
      default: throw new Error("Unexpected request");
    }
  } });
  const result = await handler(request("tasks/" + habitId + "/complete", "POST", { request_id: userId, expected_updated_at: slot }));
  assert.equal(result.status, 200);
});

test("completions are listed newest first from a given instant, as stored results", async () => {
  const seen: URL[] = [];
  const stored = { task: { id: habitId, title: "운동" }, completed_at: "2026-11-23T01:00:00Z", occurrence_due_at: null };
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
    seen.push(url);
    return Response.json([{ result: stored }]);
  } });
  const result = await handler(request("task-completions?from=2026-11-22T15:00:00Z"));
  assert.deepEqual(await result.json(), { items: [stored], nextOffset: null });
  assert.equal(seen[0].pathname, "/rest/v1/task_completions");
  assert.equal(seen[0].searchParams.get("completed_at"), "gte.2026-11-22T15:00:00Z");
  assert.equal(seen[0].searchParams.get("order"), "completed_at.desc,request_id.asc");
  assert.equal(seen[0].searchParams.get("select"), "result");
  assert.equal((await handler(request("task-completions?from=yesterday"))).status, 400);
  assert.equal((await handler(request("task-completions", "POST", {}))).status, 405);
});

test("completing a completion-based recurring task computes next due from completion time, not due_at", async () => {
  const due_at = "2099-01-31T10:00:00Z";
  const revision = "2026-11-22T09:00:00.123456Z";
  let sentNext = "";
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async (input, init) => {
    switch (new URL(String(input)).pathname) {
      case "/auth/v1/user": return Response.json({ id: userId });
      case "/rest/v1/task_completions": return Response.json([]);
      case "/rest/v1/tasks": return Response.json([{ due_at, recurrence_anchor_at: due_at, all_day: true,
        recurrence_rule: "FREQ=DAILY;INTERVAL=3", recurrence_mode: "completion", timezone: "Asia/Seoul",
        recurrence_local_time: null, updated_at: revision }]);
      case "/rest/v1/rpc/complete_task": {
        const payload = JSON.parse(String(init?.body)) as { p_next_due: string };
        sentNext = payload.p_next_due;
        return Response.json({ occurrence_due_at: due_at });
      }
      default: throw new Error("Unexpected request");
    }
  } });
  const result = await handler(request("tasks/" + habitId + "/complete", "POST", { request_id: userId, expected_updated_at: revision }));
  assert.equal(result.status, 200);
  const diffDays = Math.abs(Date.parse(sentNext) - Date.now()) / 86_400_000;
  assert.ok(diffDays >= 2 && diffDays <= 4, `expected ~3 days from now, got ${sentNext}`);
});

test("tag links are listed across tasks with an optional tag filter", async () => {
  const seen: URL[] = [];
  const handler = createHandler({ url: upstream, key: "anon-key", fetch: async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
    seen.push(url);
    return Response.json([{ user_id: userId, task_id: habitId, tag_id: habitId }]);
  } });
  const all = await handler(request("task-tags?limit=100"));
  assert.deepEqual(await all.json(), { items: [{ user_id: userId, task_id: habitId, tag_id: habitId }], nextOffset: null });
  assert.equal(seen[0].pathname, "/rest/v1/task_tags");
  assert.equal(seen[0].searchParams.get("order"), "task_id.asc,tag_id.asc");
  assert.equal(seen[0].searchParams.get("tag_id"), null);
  await handler(request("task-tags?tag_id=" + habitId));
  assert.equal(seen[1].searchParams.get("tag_id"), "eq." + habitId);
  assert.equal((await handler(request("task-tags?tag_id=nope"))).status, 400);
  assert.equal((await handler(request("task-tags", "POST", {}))).status, 405);
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
