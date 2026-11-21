import { test } from "node:test";
import assert from "node:assert/strict";
import { Temporal } from "@js-temporal/polyfill";
import { analyzeTask, parseTask } from "../supabase/functions/api/parser.ts";
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

test("Korean day periods, half hours and particles", () => {
  const local = (text: string) => {
    const due = parse(text).due_at;
    return due && Temporal.Instant.from(due).toZonedDateTimeISO("Asia/Seoul").toPlainDateTime().toString().slice(0, 16);
  };
  // The reference time is Sunday 2026-11-22 18:00 in Seoul.
  assert.equal(local("저녁 7시 운동"), "2026-11-22T19:00");
  assert.equal(local("아침 8시 조깅"), "2026-11-23T08:00");
  assert.equal(local("새벽 2시 축구"), "2026-11-23T02:00");
  assert.equal(local("낮 12시 점심"), "2026-11-23T12:00");
  assert.equal(local("낮 1시 미팅"), "2026-11-23T13:00");
  assert.equal(local("밤 11시 취침"), "2026-11-22T23:00");
  assert.equal(local("내일 밤 12시 마감"), "2026-11-24T00:00");
  assert.equal(local("내일 자정 마감"), "2026-11-23T00:00");
  assert.equal(local("정오 점심"), "2026-11-23T12:00");
  assert.equal(local("at noon lunch"), "2026-11-23T12:00");
  assert.equal(local("7시 반 저녁식사"), "2026-11-22T19:30");
  assert.equal(parse("7시 반 저녁식사").title, "저녁식사");
  assert.equal(parse("7시 반복 학습").title, "반복 학습");
  assert.equal(parse("오후 3시쯤 전화").title, "전화");
  assert.equal(parse("내일 3시에 회의").title, "회의");
  assert.equal(parse("BMW 3시리즈 시승").due_at, null);
  assert.throws(() => parse("저녁 13시 운동"));
});

test("an hour without 오전/오후 takes the natural half of the day", () => {
  const at = (clock: string) => (text: string) => {
    const now = Temporal.PlainDateTime.from("2026-11-21T" + clock).toZonedDateTime("Asia/Seoul").toInstant().toString();
    const task = parse(text, now);
    return Temporal.Instant.from(task.due_at!).toZonedDateTimeISO("Asia/Seoul").toPlainDateTime().toString().slice(0, 16);
  };
  // Saturday 2026-11-21, 16:19 in Seoul.
  const afternoon = at("16:19");
  assert.equal(afternoon("7시 운동"), "2026-11-21T19:00");
  assert.equal(afternoon("오늘 7시 운동"), "2026-11-21T19:00");
  assert.equal(afternoon("5시 운동"), "2026-11-21T17:00");
  assert.equal(afternoon("7:30 운동"), "2026-11-21T19:30");
  assert.equal(afternoon("3시 회의"), "2026-11-22T15:00");
  assert.equal(afternoon("오늘 3시 회의"), "2026-11-21T15:00");
  assert.equal(afternoon("12시 점심"), "2026-11-22T12:00");
  assert.equal(afternoon("11시 반 통화"), "2026-11-21T23:30");
  // 6시–11시 on another day or on a repeating task reads as the morning; 1시–5시 never does.
  assert.equal(afternoon("내일 9시 회의"), "2026-11-22T09:00");
  assert.equal(afternoon("내일 2시 미팅"), "2026-11-22T14:00");
  assert.equal(afternoon("매일 7시 운동"), "2026-11-22T07:00");
  assert.equal(parse("매일 7시 운동").recurrence_local_time, "07:00:00");
  assert.equal(parse("매일 3시 간식").recurrence_local_time, "15:00:00");
  // Words in the title settle it either way.
  assert.equal(afternoon("내일 7시 저녁 약속"), "2026-11-22T19:00");
  assert.equal(afternoon("5시 기상"), "2026-11-22T05:00");
  // What was written as a 24-hour or explicit time is never reinterpreted.
  assert.equal(afternoon("07:30 운동"), "2026-11-22T07:30");
  assert.equal(afternoon("19시 운동"), "2026-11-21T19:00");
  assert.equal(afternoon("오전 5시 운동"), "2026-11-22T05:00");
  assert.equal(afternoon("7am run"), "2026-11-22T07:00");

  const morning = at("08:00");
  assert.equal(morning("9시 회의"), "2026-11-21T09:00");
  assert.equal(morning("7시 운동"), "2026-11-21T19:00");
  assert.equal(morning("5시 운동"), "2026-11-21T17:00");

  const night = at("22:30");
  assert.equal(night("9시 회의"), "2026-11-22T09:00");
  assert.equal(night("오늘 9시 회의"), "2026-11-21T21:00");
  assert.equal(night("5시 운동"), "2026-11-22T17:00");
  assert.equal(night("11시 취침"), "2026-11-21T23:00");
});

test("Korean calendar dates, relative offsets and deadlines", () => {
  assert.deepEqual([parse("11월 25일 회의").due_at, parse("11월 25일 회의").all_day], ["2026-11-24T15:00:00Z", true]);
  assert.equal(parse("12월25일 오후 3시 파티").due_at, "2026-12-25T06:00:00Z");
  assert.equal(parse("1월 3일 신년회").due_at, "2027-01-02T15:00:00Z");
  assert.equal(parse("11월 22일 정리").due_at, "2026-11-21T15:00:00Z");
  assert.equal(parse("내일까지 보고서 제출").title, "보고서 제출");
  assert.equal(parse("내일까지 보고서 제출").due_at, "2026-11-22T15:00:00Z");
  assert.equal(parse("이번주 금요일 회식").due_at, "2026-11-19T15:00:00Z");
  assert.equal(parse("this Fri demo").due_at, "2026-11-19T15:00:00Z");
  assert.equal(parse("3일 뒤 병원").due_at, "2026-11-24T15:00:00Z");
  assert.equal(parse("2주 후 여행").due_at, "2026-12-05T15:00:00Z");
  assert.equal(parse("in 3 days review").due_at, "2026-11-24T15:00:00Z");
  assert.equal(parse("5월 5일간 휴가").due_at, null);
  for (const text of ["2월 30일 운동", "13월 1일 운동", "내일 11월 25일 운동"]) assert.throws(() => parse(text), text);
});

test("weekday, weekend and interval recurrences in Korean and English", () => {
  const rule = (text: string) => parse(text).recurrence_rule;
  assert.equal(rule("평일마다 아침 7시 기상"), "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  assert.equal(parse("평일마다 아침 7시 기상").due_at, "2026-11-22T22:00:00Z");
  assert.equal(rule("매주 주말 등산"), "FREQ=WEEKLY;BYDAY=SA,SU");
  assert.equal(rule("every weekday standup"), "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  assert.equal(rule("every weekend hike"), "FREQ=WEEKLY;BYDAY=SA,SU");
  assert.equal(rule("격주 화요일 회의"), "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU");
  assert.equal(rule("격주 스터디"), "FREQ=WEEKLY;INTERVAL=2");
  assert.equal(rule("every other week sync"), "FREQ=WEEKLY;INTERVAL=2");
  assert.equal(rule("every other day stretch"), "FREQ=DAILY;INTERVAL=2");
  assert.equal(rule("3일마다 물주기"), "FREQ=DAILY;INTERVAL=3");
  assert.equal(rule("2주마다 청소"), "FREQ=WEEKLY;INTERVAL=2");
  assert.equal(rule("월요일마다 회의"), "FREQ=WEEKLY;BYDAY=MO");
  assert.equal(rule("매주 월요일마다 회의"), "FREQ=WEEKLY;BYDAY=MO");
  assert.equal(rule("월수금마다 운동"), "FREQ=WEEKLY;BYDAY=MO,WE,FR");
  assert.equal(parse("3일마다 물주기").title, "물주기");
  assert.throws(() => parse("매일 평일마다 운동"));
  assert.throws(() => parse("60일마다 점검"));
});

test("token offsets index the normalized text for inline highlighting", () => {
  const text = "내일 저녁 7시 운동 매주 월수금 #건강 @외출 p2";
  const { task, tokens, text: normalized } = analyzeTask({ text, now: "2026-11-22T09:00:00Z", timezone: "Asia/Seoul" });
  assert.equal(normalized, text);
  assert.equal(task.title, "운동");
  assert.deepEqual(tokens.map((token) => [token.kind, text.slice(token.start, token.end)]), [
    ["date", "내일"], ["time", "저녁 7시"], ["recurrence", "매주 월수금"],
    ["project", "#건강"], ["tag", "@외출"], ["priority", "p2"],
  ]);
  for (const token of tokens) assert.equal(token.text, text.slice(token.start, token.end));
  assert.deepEqual(analyzeTask({ text: "plain title", timezone: "UTC" }).tokens, []);
});

test("a draft entry reports its tokens before a title is typed", () => {
  const input = { text: "오늘 7시", now: "2026-11-21T07:19:00Z", timezone: "Asia/Seoul" };
  assert.throws(() => analyzeTask(input));
  const draft = analyzeTask(input, { draft: true });
  assert.deepEqual(draft.tokens.map((token) => [token.kind, token.text]), [["date", "오늘"], ["time", "7시"]]);
  assert.deepEqual([draft.task.title, draft.task.due_at], ["", "2026-11-21T10:00:00Z"]);
});
