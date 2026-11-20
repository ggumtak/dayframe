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
  `);
  for (const file of ["20261121000000_core.sql", "20261121000100_operations.sql"]) {
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
