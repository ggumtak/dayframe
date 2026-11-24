import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const alice = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bob = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const project = "11111111-1111-4111-8111-111111111111";
const section = "22222222-2222-4222-8222-222222222222";
const task = "33333333-3333-4333-8333-333333333333";
const child = "44444444-4444-4444-8444-444444444444";
const habit = "55555555-5555-4555-8555-555555555555";
const weekHabit = "56555555-5555-4555-8555-555555555555";
const tag = "66666666-6666-4666-8666-666666666666";
const completeId = "77777777-7777-4777-8777-777777777777";
const recurring = "88888888-8888-4888-8888-888888888888";
const otherProject = "99999999-9999-4999-8999-999999999999";

async function as(role: "authenticated" | "anon" | "service_role", user = "") {
  await db.exec("reset role; set role " + role);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
}
async function count(table: string): Promise<number> {
  return (await db.query<{ count: number }>("select count(*)::integer from public." + table)).rows[0].count;
}
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text not null, public boolean not null default false);
  `);
  for (const file of ["20261121000000_core.sql", "20261121000100_operations.sql", "20261122000000_mcp_connections.sql",
    "20261122000100_calendar_recurrence.sql", "20261123000000_occurrence_slot.sql",
    "20261123000100_new_task_date.sql", "20261123000200_duration_and_completion_recurrence.sql",
    "20261124000000_app_updates.sql"]) {
    await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  }
  await db.query("insert into auth.users values ($1), ($2)", [alice, bob]);
});
after(() => db.close());

test("owner CRUD, nested tree, profile privacy and cross-owner constraints", async () => {
  await as("authenticated", alice);
  assert.equal(await count("users"), 1);
  await db.query("insert into projects(id,name) values ($1,'Work'),($2,'Second')", [project, otherProject]);
  await db.query("insert into sections(id,project_id,name) values ($1,$2,'Build')", [section, project]);
  await assert.rejects(db.query("insert into tasks(project_id,section_id,title) values ($1,$2,'bad')", [otherProject, section]),
    { code: "23503" });
  await db.query("insert into tasks(id,project_id,section_id,title) values ($1,$2,$3,'Goal')", [task, project, section]);
  await db.query("insert into tasks(id,parent_task_id,title) values ($1,$2,'Child')", [child, task]);
  await db.query("insert into tasks(parent_task_id,title) values ($1,'Grandchild')", [child]);
  assert.equal(await count("subtasks"), 2);
  await assert.rejects(db.query("update tasks set parent_task_id=$1 where id=$2", [child, task]), { code: "23514" });
  await db.query("insert into tags(id,name) values ($1,'Test')", [tag]);
  await db.query("insert into task_tags(task_id,tag_id) values ($1,$2)", [task, tag]);
  await db.query("insert into focus_sessions(task_id) values ($1)", [task]);

  await as("authenticated", bob);
  for (const table of ["projects", "sections", "tasks", "subtasks", "tags", "task_tags", "focus_sessions"]) {
    assert.equal(await count(table), 0, table);
  }
  assert.equal(await count("users"), 1);
  await assert.rejects(db.query("insert into tasks(user_id,title) values ($1,'Spoof')", [alice]), { code: "42501" });
  for (const query of [
    "insert into tasks(project_id,title) values ($1,'Foreign')",
    "insert into sections(project_id,name) values ($1,'Foreign')",
  ]) await assert.rejects(db.query(query, [project]), { code: "23503" });
  await assert.rejects(db.query("insert into tasks(parent_task_id,title) values ($1,'Foreign')", [task]), { code: "23503" });
  await assert.rejects(db.query("insert into task_tags(task_id,tag_id) values ($1,$2)", [task, tag]), { code: "23503" });
  await assert.rejects(db.query("insert into focus_sessions(task_id) values ($1)", [task]), { code: "23503" });
  await assert.rejects(db.query("select complete_task($1,$2,now())", [task, completeId]), { code: "PT404" });
  assert.equal((await db.query("delete from tasks where id=$1 returning id", [task])).rows.length, 0);
  await assert.rejects(db.query("insert into project_members(project_owner_id,project_id,user_id,role) values ($1,$2,$3,'editor')", [alice, project, bob]),
    { code: "42501" });
});

test("task completion is atomic, skips repeats on retry and uses optimistic revisions", async () => {
  await as("authenticated", alice);
  await db.query("insert into tasks(id,title,due_at,recurrence_rule) values ($1,'Daily','2001-01-01T10:00Z','FREQ=DAILY')", [recurring]);
  const anchor = "2001-01-01 10:00:00+00";
  const revision = (await db.query<{ rev: string }>("select updated_at::text as rev from tasks where id=$1", [recurring])).rows[0].rev;
  const first = await db.query("select complete_task($1,$2,$3,'2099-12-31T10:00Z') as result", [recurring, completeId, revision]);
  const retry = await db.query("select complete_task($1,$2,$3,null) as result", [recurring, completeId, revision]);
  assert.deepEqual(retry.rows, first.rows);
  assert.equal(await count("task_completions"), 1);
  const current = await db.query("select recurrence_anchor_at::text,due_at::text,completed_at from tasks where id=$1", [recurring]);
  assert.deepEqual(current.rows, [{ recurrence_anchor_at: anchor, due_at: "2099-12-31 10:00:00+00", completed_at: null }]);
  await assert.rejects(db.query("select complete_task($1,gen_random_uuid(),$2,'2100-01-01T10:00Z')", [recurring, revision]), { code: "PT409" });
  await assert.rejects(db.query("select complete_task($1,$2,$3)", [task, completeId, revision]), { code: "23505" });
  await assert.rejects(db.query("delete from task_completions"), { code: "42501" });
});

test("new tasks land on today by default, and the owner can keep them undated instead", async () => {
  await as("authenticated", alice);
  const setting = async () => (await db.query<{ value: string }>("select new_task_date as value from users")).rows;
  assert.deepEqual(await setting(), [{ value: "today" }]);
  await db.query("update users set new_task_date='none'");
  assert.deepEqual(await setting(), [{ value: "none" }]);
  await assert.rejects(db.query("update users set new_task_date='tomorrow'"), { code: "23514" });
  await db.query("update users set new_task_date='today'");
});

test("a moved occurrence remembers its slot until it is completed or the series changes", async () => {
  await as("authenticated", alice);
  await db.query("insert into tasks(title,due_at,recurrence_rule) values ('Weekly','2099-01-07T10:00Z','FREQ=WEEKLY')");
  const slot = async () => (await db.query<{ slot: string | null }>("select occurrence_at::text as slot from tasks where title='Weekly'")).rows[0].slot;
  // A one-time move keeps the anchor, so the slot it came from is kept as sent.
  await db.query("update tasks set due_at='2099-01-05T10:00Z', occurrence_at='2099-01-07T10:00Z' where title='Weekly'");
  assert.equal(await slot(), "2099-01-07 10:00:00+00");
  const { id, rev } = (await db.query<{ id: string; rev: string }>("select id, updated_at::text as rev from tasks where title='Weekly'")).rows[0];
  await db.query("select complete_task($1,gen_random_uuid(),$2,'2099-01-14T10:00Z')", [id, rev]);
  assert.equal(await slot(), null);
  await db.query("update tasks set due_at='2099-01-12T10:00Z', occurrence_at='2099-01-14T10:00Z' where title='Weekly'");
  // Editing the schedule itself re-anchors the series, which forgets the slot.
  await db.query("update tasks set due_at='2099-01-20T10:00Z', recurrence_anchor_at='2099-01-20T10:00Z' where title='Weekly'");
  assert.equal(await slot(), null);
  await db.query("update tasks set due_at='2099-01-19T10:00Z', occurrence_at='2099-01-20T10:00Z' where title='Weekly'");
  await db.query("update tasks set recurrence_rule=null where title='Weekly'");
  assert.equal(await slot(), null);
  await db.query("delete from tasks where title='Weekly'");
});

test("bulk rescheduling is owner-only, uses local dates, and retains anchor/time", async () => {
  await as("authenticated", bob);
  await db.query("insert into tasks(title,due_at) values ('Bob','2001-01-01T10:00Z')");
  await as("authenticated", alice);
  await db.query("insert into tasks(title,due_at,timezone,recurrence_rule) values ('Move','2001-01-01T10:00Z','Asia/Seoul','FREQ=DAILY')");
  assert.deepEqual((await db.query("select reschedule_overdue() as result")).rows, [{ result: { count: 1 } }]);
  assert.deepEqual((await db.query("select reschedule_overdue() as result")).rows, [{ result: { count: 0 } }]);
  const moved = await db.query(`select (due_at at time zone timezone)::date = (now() at time zone timezone)::date as today,
    (due_at at time zone timezone)::time::text as time, recurrence_anchor_at::text from tasks where title='Move'`);
  assert.deepEqual(moved.rows, [{ today: true, time: "19:00:00", recurrence_anchor_at: "2001-01-01 10:00:00+00" }]);
  await as("authenticated", bob);
  assert.deepEqual((await db.query("select due_at::text from tasks")).rows, [{ due_at: "2001-01-01 10:00:00+00" }]);
});

test("calendar repeat rules persist and a one-time move keeps the series anchor and time", async () => {
  await as("authenticated", alice);
  await db.query("insert into tasks(title,due_at,timezone,recurrence_rule) values ('Month end','2099-01-31T10:00Z','Asia/Seoul','FREQ=MONTHLY;BYMONTHDAY=-1')");
  await db.query("insert into tasks(title,due_at,recurrence_rule) values ('Annual','2099-01-31T10:00Z','FREQ=YEARLY;INTERVAL=2')");
  const moved = await db.query("update tasks set due_at='2099-02-01T10:00Z' where title='Month end' " +
    "returning due_at::text,recurrence_anchor_at::text,recurrence_local_time::text");
  assert.deepEqual(moved.rows, [{
    due_at: "2099-02-01 10:00:00+00", recurrence_anchor_at: "2099-01-31 10:00:00+00", recurrence_local_time: "19:00:00",
  }]);
  for (const rule of ["FREQ=YEARLY;BYDAY=MO", "FREQ=WEEKLY;BYMONTHDAY=-1", "FREQ=MONTHLY;INTERVAL=53"]) {
    await assert.rejects(db.query("update tasks set recurrence_rule=$1 where title='Month end'", [rule]), { code: "23514" });
  }
});

test("daily and weekly stats, freeze/skip, upsert and ownership of logs", async () => {
  await as("authenticated", alice);
  await db.query("insert into habits(id,name,cadence,target_count,timezone,start_date) values ($1,'Study','daily',2,'UTC','2020-01-01'),($2,'Train','weekly',3,'UTC','2020-01-01')",
    [habit, weekHabit]);
  await db.query(`insert into habit_logs(habit_id,log_date,status,count) values
    ($1,'2020-01-01','completed',2),($1,'2020-01-02','frozen',0),($1,'2020-01-03','completed',2),
    ($1,'2020-01-04','skipped',0),($1,'2020-01-05','completed',2),
    ($2,'2020-01-01','completed',1),($2,'2020-01-05','completed',2),($2,'2020-01-08','completed',1)
  `, [habit, weekHabit]);
  const daily = (await db.query<{ stats: unknown }>("select to_jsonb(s) as stats from habit_stats($1,'2020-01-05') s", [habit])).rows[0].stats;
  assert.deepEqual(daily, {
    as_of: "2020-01-05", current_streak: 1, longest_streak: 2, completed_periods: 3,
    evaluated_periods: 3, completion_rate: 1, current_period_count: 2,
  });
  const weekly = (await db.query<{ stats: unknown }>("select to_jsonb(s) as stats from habit_stats($1,'2020-01-08') s", [weekHabit])).rows[0].stats;
  assert.deepEqual(weekly, {
    as_of: "2020-01-08", current_streak: 1, longest_streak: 1, completed_periods: 1,
    evaluated_periods: 1, completion_rate: 1, current_period_count: 1,
  });
  await db.query(`insert into habit_logs(habit_id,log_date,status,count) values ($1,'2020-01-05','completed',2)
    on conflict (user_id,habit_id,log_date) do update set status=excluded.status,count=excluded.count`, [habit]);
  assert.equal(await count("habit_logs"), 8);
  await assert.rejects(db.query("insert into habit_logs(habit_id,log_date,status,count) values ($1,'2099-01-01','frozen',0)", [habit]), { code: "23514" });
  await assert.rejects(db.query("update habits set target_count=3 where id=$1", [habit]), { code: "23514" });
  await as("authenticated", bob);
  assert.equal(await count("habit_logs"), 0);
  await assert.rejects(db.query("select * from habit_stats($1)", [habit]), { code: "PT404" });
  await assert.rejects(db.query("insert into habit_logs(habit_id,log_date,status,count) values ($1,'2020-02-01','frozen',0)", [habit]), { code: "23503" });
});

test("focus running constraint, distinct users, and links survive deletion", async () => {
  await as("authenticated", alice);
  await assert.rejects(db.query("insert into focus_sessions default values"), { code: "23505" });
  await db.query("update focus_sessions set status='completed',ended_at=now()", []);
  await db.query("delete from sections where id=$1", [section]);
  assert.deepEqual((await db.query("select project_id,section_id from tasks where id=$1", [task])).rows,
    [{ project_id: project, section_id: null }]);
  await db.query("delete from tasks where id=$1", [task]);
  assert.equal(await count("subtasks"), 0);
  assert.deepEqual((await db.query("select task_id from focus_sessions")).rows, [{ task_id: null }]);
  await db.query("insert into focus_sessions default values");
  await as("authenticated", bob);
  await db.query("insert into focus_sessions default values");
  assert.equal(await count("focus_sessions"), 1);
});

test("release metadata exposes only published rows and prevents user writes", async () => {
  await as("service_role");
  await db.exec(`insert into app_releases(version_code,latest_version,min_supported_version,apk_download_url,published_at) values
    (1,'1.1.0','1.0.0','https://github.com/a/b/releases/download/v1.1.0/dayframe.apk',now()),
    (2,'1.2.0','1.0.0','https://github.com/a/b/releases/download/v1.2.0/dayframe.apk',null),
    (3,'1.3.0','1.0.0','https://github.com/a/b/releases/download/v1.3.0/dayframe.apk',now()+interval '1 day')`);
  await as("anon");
  assert.equal(await count("app_releases"), 1);
  await assert.rejects(db.query("select * from tasks"), { code: "42501" });
  await as("authenticated", alice);
  await assert.rejects(db.query("update app_releases set published_at=now()"), { code: "42501" });
});

test("over-the-air updates are readable and writable only by the service role, and stay consistent", async () => {
  const id = "0f8b7c1e-8d0a-4c55-9a43-5a3c2d1e0b9f";
  const manifest = (fields: object) => JSON.stringify({ id, createdAt: "2026-11-24T03:00:00.000Z", runtimeVersion: "abc123",
    launchAsset: {}, assets: [], metadata: {}, extra: {}, ...fields });
  const insert = "insert into app_updates(id, platform, runtime_version, manifest, signature, message) values ($1, 'android', 'abc123', $2, $3, $4)";
  for (const role of ["anon", "authenticated"] as const) {
    await as(role, alice);
    await assert.rejects(db.query("select id from app_updates"), { code: "42501" });
    await assert.rejects(db.query(insert, [id, manifest({}), null, ""]), { code: "42501" });
  }
  await as("service_role");
  // The stored manifest must describe the row it sits in.
  await assert.rejects(db.query(insert, [id, manifest({ id: "11111111-1111-4111-8111-111111111111" }), null, ""]), { code: "23514" });
  await assert.rejects(db.query(insert, [id, manifest({ runtimeVersion: "other" }), null, ""]), { code: "23514" });
  await assert.rejects(db.query(insert, [id, manifest({}), "sig\r\ninjected", ""]), { code: "23514" });
  await assert.rejects(db.query(insert, [id, "not json", null, ""]), { code: "22P02" });
  const signature = 'sig="abc=", keyid="dayframe-0123456789ab", alg="rsa-v1_5-sha256"';
  await db.query(insert, [id, manifest({}), signature, "빠른 추가 개선"]);
  const row = (await db.query<{ manifest: string; signature: string }>("select manifest, signature from app_updates")).rows[0];
  assert.equal(row.manifest, manifest({}), "manifest bytes are kept exactly as signed");
  assert.equal(row.signature, signature);
  await assert.rejects(db.query("update app_updates set message = 'x'"), { code: "42501" });
  await db.exec("reset role");
  assert.deepEqual((await db.query("select id, public from storage.buckets")).rows, [{ id: "app-updates", public: true }]);
});

test("AI connection tokens are write-only for their owner and readable only by the service role", async () => {
  const hash = "ab".repeat(32);
  await as("authenticated", alice);
  await db.query("insert into mcp_connections(user_id, label, token_hash) values ($1, 'Claude', $2)", [alice, hash]);
  const visible = await db.query<{ label: string }>("select id, label, created_at, last_used_at from mcp_connections");
  assert.deepEqual(visible.rows.map((row) => row.label), ["Claude"]);
  await assert.rejects(db.query("select token_hash from mcp_connections"), { code: "42501" });
  await assert.rejects(db.query("update mcp_connections set label = 'x'"), { code: "42501" });
  await assert.rejects(db.query("insert into mcp_connections(user_id, token_hash) values ($1, $2)", [bob, "cd".repeat(32)]), { code: "42501" });
  await assert.rejects(db.query("insert into mcp_connections(user_id, token_hash) values ($1, 'short')", [alice]), { code: "23514" });

  await as("authenticated", bob);
  assert.equal((await db.query("select id from mcp_connections")).rows.length, 0);
  assert.equal((await db.query("delete from mcp_connections returning id")).rows.length, 0);
  await as("anon");
  await assert.rejects(db.query("select id from mcp_connections"), { code: "42501" });

  await as("service_role");
  const found = await db.query<{ user_id: string }>("select id, user_id from mcp_connections where token_hash = $1", [hash]);
  assert.equal(found.rows[0].user_id, alice);
  await db.query("update mcp_connections set last_used_at = now() where token_hash = $1", [hash]);
  await as("authenticated", alice);
  assert.equal((await db.query("delete from mcp_connections returning id")).rows.length, 1);
});

test("duration_minutes and completion-based recurrence constraints, subtasks view, and early completion", async () => {
  await as("authenticated", alice);
  const compId = "12121212-1212-4121-8121-121212121212";
  const compReq = "34343434-3434-4343-8343-343434343434";
  // Insert task due far in the future with completion-based recurrence and 45m duration.
  await db.query(
    "insert into tasks(id,title,due_at,recurrence_rule,recurrence_mode,duration_minutes) values ($1,'Filter','2099-05-01T10:00Z','FREQ=DAILY;INTERVAL=3','completion',45)",
    [compId],
  );
  // Early completion: next occurrence is 3 days from now (well before 2099-05-01), allowed in completion mode!
  const rev = (await db.query<{ rev: string }>("select updated_at::text as rev from tasks where id=$1", [compId])).rows[0].rev;
  const earlyNext = new Date(Date.now() + 3 * 86_400_000).toISOString();
  await db.query("select complete_task($1,$2,$3,$4)", [compId, compReq, rev, earlyNext]);
  const after = await db.query<{ same_anchor: boolean; duration_minutes: number; recurrence_mode: string }>(
    "select due_at = recurrence_anchor_at as same_anchor, duration_minutes, recurrence_mode from tasks where id=$1",
    [compId],
  );
  assert.deepEqual(after.rows, [{ same_anchor: true, duration_minutes: 45, recurrence_mode: "completion" }]);

  // Clearing recurrence_rule automatically resets recurrence_mode back to 'schedule'.
  const cleared = await db.query<{ recurrence_mode: string }>(
    "update tasks set recurrence_rule=null where id=$1 returning recurrence_mode",
    [compId],
  );
  assert.deepEqual(cleared.rows, [{ recurrence_mode: "schedule" }]);

  // Duration bounds (1..1440) and subtasks view exposes new columns.
  await assert.rejects(db.query("update tasks set duration_minutes=0 where id=$1", [compId]), { code: "23514" });
  await assert.rejects(db.query("update tasks set duration_minutes=1441 where id=$1", [compId]), { code: "23514" });
  await db.query("insert into tasks(parent_task_id,title,duration_minutes) values ($1,'Sub',15)", [compId]);
  const sub = await db.query<{ duration_minutes: number; recurrence_mode: string }>(
    "select duration_minutes, recurrence_mode from subtasks where parent_task_id=$1",
    [compId],
  );
  assert.deepEqual(sub.rows, [{ duration_minutes: 15, recurrence_mode: "schedule" }]);
});
