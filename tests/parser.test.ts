import { test } from "node:test";
import assert from "node:assert/strict";
import { Temporal } from "@js-temporal/polyfill";
import { parseTask } from "../supabase/functions/api/parser.ts";
import { instantOn, nextOccurrence, recurrence } from "../supabase/functions/api/schedule.ts";

const parse = (text: string, now = "2026-11-22T09:00:00Z", timezone = "Asia/Seoul") =>
  parseTask({ text, now, timezone });

test("Korean recurring task, title quantity, #project and P1", () => {
  assert.deepEqual(parse("매일 오전 8시 영단어 30개 #공부 p1"), {
    title: "영단어 30개", due_at: "2026-11-22T23:00:00Z", all_day: false,
    timezone: "Asia/Seoul", recurrence_rule: "FREQ=DAILY", recurrence_local_time: "08:00:00", project: "공부", tags: [], priority: 1,
  });
});

test("English task with explicit tomorrow and weekly Monday/Wednesday", () => {
  assert.deepEqual(parse("Tomorrow 7pm gym every Mon, Wed #health p2"), {
    title: "gym", due_at: "2026-11-23T10:00:00Z", all_day: false,
    timezone: "Asia/Seoul", recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,WE", recurrence_local_time: "19:00:00", project: "health", tags: [], priority: 2,
  });
  assert.equal(parse("Tomorrow 7pm gym every Mon, Wed", "2026-11-23T09:00:00Z").due_at, "2026-11-25T10:00:00Z");
});

test("Korean relative dates and next ISO week", () => {
  assert.equal(parse("내일 운동").due_at, "2026-11-22T15:00:00Z");
  assert.equal(parse("모레 운동").due_at, "2026-11-23T15:00:00Z");
  assert.equal(parse("다음주 화요일 운동").due_at, "2026-11-23T15:00:00Z");
  assert.equal(parse("다음 주 화요일 운동", "2026-11-23T00:00:00Z").due_at, "2026-11-30T15:00:00Z");
  assert.equal(parse("내일오전8시회의").title, "회의");
  assert.equal(parse("내일오전8시회의").due_at, "2026-11-22T23:00:00Z");
  assert.equal(parse("오늘 고양이 목욕", "2026-11-22T16:00:00Z").due_at, "2026-11-22T15:00:00Z");
});

test("Korean compact and comma-separated weekly weekdays", () => {
  for (const dates of ["월수금", "월, 수, 금요일", "월요일 수요일 금요일", "월/수/금"]) {
    const result = parse("매주 " + dates + " 오후 6시 30분 달리기");
    assert.equal(result.title, "달리기");
    assert.equal(result.recurrence_rule, "FREQ=WEEKLY;BYDAY=MO,WE,FR");
    assert.equal(result.due_at, "2026-11-23T09:30:00Z");
  }
});

test("title boundaries, project names and case-insensitive tag deduplication", () => {
  const result = parse('오늘의 기록 1시간 @집 @"Read Later" @"read later" #"나의 기록" p3');
  assert.equal(result.title, "오늘의 기록 1시간");
  assert.equal(result.due_at, null);
  assert.equal(result.project, "나의 기록");
  assert.deepEqual(result.tags, ["집", "Read Later"]);
  assert.equal(result.priority, 3);
  assert.equal(parse("Follow up on Sunday paper").title, "Follow up on Sunday paper");
  assert.equal(parse("Review p123 and 30 pages").priority, 4);
});

test("calendar, ISO dates, leap days, malformed clocks and conflicts", () => {
  assert.equal(parse("2028-02-29 00:00 check leap day").due_at, "2028-02-28T15:00:00Z");
  assert.equal(parse("tomorrow 12 am run").due_at, "2026-11-22T15:00:00Z");
  assert.equal(parse("tomorrow 12 pm run").due_at, "2026-11-23T03:00:00Z");
  assert.equal(parse("every 2 weeks review").recurrence_rule, "FREQ=WEEKLY;INTERVAL=2");
  for (const text of ["2027-02-29 run", "25:00 run", "내일 모레 운동", "7:79 run", "13pm run",
    "run #a #b", "run p1 p2", "tomorrow", "daily every week run", "every 0 days run"]) {
    assert.throws(() => parse(text), text);
  }
});

test("DST disambiguation, anchor recovery, interval and stale occurrence skipping", () => {
  const zone = "America/New_York";
  assert.equal(parse("2026-03-08 2:30am gym", "2026-03-07T00:00:00Z", zone).due_at, "2026-03-08T07:30:00Z");
  const firstInGap = parse("2026-03-08 2:30am daily gym", "2026-03-07T00:00:00Z", zone);
  assert.equal(firstInGap.recurrence_local_time, "02:30:00");
  assert.equal(nextOccurrence("FREQ=DAILY", zone, firstInGap.due_at!, Temporal.Instant.from(firstInGap.due_at!),
    false, firstInGap.recurrence_local_time), "2026-03-09T06:30:00Z");
  const anchor = "2026-03-07T07:30:00Z";
  assert.equal(nextOccurrence("FREQ=DAILY", zone, anchor, Temporal.Instant.from(anchor), false), "2026-03-08T07:30:00Z");
  assert.equal(nextOccurrence("FREQ=DAILY", zone, anchor, Temporal.Instant.from("2026-03-08T07:30:00Z"), false),
    "2026-03-09T06:30:00Z");
  assert.equal(nextOccurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE", "UTC", "2026-11-23T08:00:00Z",
    Temporal.Instant.from("2026-11-25T08:00:00Z"), false), "2026-12-07T08:00:00Z");
  assert.equal(instantOn(Temporal.PlainDate.from("2026-11-01"), Temporal.PlainTime.from("01:30"), zone)
    .toInstant().toString(), "2026-11-01T05:30:00Z");
  assert.throws(() => recurrence("FREQ=DAILY;BYDAY=MO"));
  assert.throws(() => recurrence("FREQ=WEEKLY;BYDAY=MO,MO"));
});
