import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Temporal } from '@js-temporal/polyfill';

import type { FocusSession, Habit, HabitLog, Task, TaskCompletion } from '../../lib/shared';
import { classifyStatus, isRetryable } from './errors.ts';
import { cleanKey, estimateCostUsd, hasServerFallback, isModelId, looksLikeKey, maskKey, usageLine } from './models.ts';
import { blockChanges, checkPlan, collectCandidates, planWindow, type PlanCandidate } from './plan.ts';
import { BREAKDOWN_SYSTEM, breakdownUser, ORGANIZE_SYSTEM, organizeUser, PLAN_SYSTEM, planUser, REVIEW_SYSTEM, reviewUser } from './prompts.ts';
import { gatherWeek, reviewRange } from './review.ts';
import { breakdownSchema, organizeSchema, parseBreakdown, parseOrganized, parseRawPlan, parseReview, planSchema } from './schemas.ts';
import { describeNow, formatHHMM, formatKoreanDate, nowContext, parseHHMM, parseIsoDate, roundUp } from './time.ts';

const TZ = 'Asia/Seoul';
const TODAY = Temporal.PlainDate.from('2026-11-24');
// 2026-11-24 14:07 in Seoul.
const NOW = Temporal.ZonedDateTime.from({ year: 2026, month: 11, day: 24, hour: 14, minute: 7, timeZone: TZ }).toInstant();

const at = (date: string, minutes: number | null) => Temporal.PlainDate.from(date)
  .toZonedDateTime({ timeZone: TZ, plainTime: minutes === null ? undefined : Temporal.PlainTime.from({ hour: Math.floor(minutes / 60), minute: minutes % 60 }) })
  .toInstant().toString();

let n = 0;
function task(extra: Partial<Task>): Task {
  n += 1;
  return {
    id: 'task-' + n, user_id: 'u', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', project_id: null, section_id: null,
    parent_task_id: null, title: '할 일 ' + n, notes: null, priority: 4, position: n, due_at: null, all_day: false, timezone: TZ,
    recurrence_rule: null, recurrence_mode: 'schedule', recurrence_anchor_at: null, recurrence_local_time: null, occurrence_at: null,
    duration_minutes: null, completed_at: null, ...extra,
  };
}

// ---------------------------------------------------------------------------------------------- models

test('cost estimate uses the per-million price of each model', () => {
  assert.equal(estimateCostUsd('claude-opus-5-5', { input: 1_000_000, output: 1_000_000 }), 24);
  assert.equal(estimateCostUsd('claude-sonnet-5-5', { input: 1_000_000, output: 0 }), 2);
  assert.ok(Math.abs(estimateCostUsd('claude-haiku-5-5', { input: 2_000, output: 1_000 }) - 0.0007) < 1e-12);
});

test('usage line reads the way the screens show it', () => {
  assert.equal(usageLine('claude-opus-5-5', { input: 1234, output: 567 }), '입력 1,234 · 출력 567 토큰 · 약 $0.02');
  assert.equal(usageLine('claude-sonnet-5-5', { input: 800, output: 200 }), '입력 800 · 출력 200 토큰 · 약 $0.004');
  assert.equal(usageLine('claude-haiku-5-5', { input: 900, output: 300 }), '입력 900 · 출력 300 토큰 · $0.001 미만');
});

test('keys are cleaned, checked and masked without revealing them', () => {
  const key = 'sk-ant-api03-' + 'x'.repeat(80) + 'abcd';
  assert.equal(cleanKey(`  "${key}"\n`), key);
  assert.equal(cleanKey(key.slice(0, 20) + ' \n' + key.slice(20)), key);
  assert.ok(looksLikeKey(key));
  assert.ok(!looksLikeKey('sk-ant-short'));
  assert.ok(!looksLikeKey('키를 여기에'));
  assert.equal(maskKey(key), 'sk-ant-…abcd');
  assert.equal(maskKey('other-key-1234567890wxyz'), '…wxyz');
  assert.ok(!maskKey(key).includes('api03'));
});

test('only the three offered models are accepted, and Haiku has no server fallback', () => {
  assert.ok(isModelId('claude-opus-5-5'));
  assert.ok(!isModelId('claude-opus-5-5-20260401'));
  assert.ok(hasServerFallback('claude-opus-5-5'));
  assert.ok(hasServerFallback('claude-sonnet-5-5'));
  assert.ok(!hasServerFallback('claude-haiku-5-5'));
});

// ---------------------------------------------------------------------------------------------- errors

test('HTTP errors map to kinds the owner can act on', () => {
  assert.equal(classifyStatus(401, 'authentication_error'), 'bad_key');
  assert.equal(classifyStatus(402, 'billing_error'), 'no_credit');
  assert.equal(classifyStatus(400, 'invalid_request_error', null, 'Your credit balance is too low to access the Anthropic API.'), 'no_credit');
  assert.equal(classifyStatus(400, 'invalid_request_error', null, 'messages: something'), 'bad_request');
  assert.equal(classifyStatus(403, 'permission_error'), 'permission');
  assert.equal(classifyStatus(404, 'not_found_error'), 'model_unavailable');
  assert.equal(classifyStatus(429, 'rate_limit_error'), 'rate_limit');
  assert.equal(classifyStatus(429, 'rate_limit_error', 'enforced_spend_limit_reached'), 'spend_limit');
  assert.equal(classifyStatus(529, 'overloaded_error'), 'overloaded');
  assert.equal(classifyStatus(500, 'api_error'), 'server');
  assert.ok(isRetryable('rate_limit'));
  assert.ok(!isRetryable('bad_key'));
});

// ---------------------------------------------------------------------------------------------- time

test('clock and date parsing is strict', () => {
  assert.equal(parseHHMM('09:30'), 570);
  assert.equal(parseHHMM('9:05'), 545);
  assert.equal(parseHHMM('24:00'), null);
  assert.equal(parseHHMM('7pm'), null);
  assert.equal(parseHHMM(null), null);
  assert.equal(formatHHMM(570), '09:30');
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(parseIsoDate('2026-11-24')?.toString(), '2026-11-24');
  assert.equal(parseIsoDate('11/24'), null);
  assert.equal(formatKoreanDate(TODAY), '11월 24일 (화)');
  assert.equal(roundUp(847), 850);
});

test('"now" is described in the owner\'s time zone', () => {
  const now = nowContext(NOW, TZ);
  assert.deepEqual(now, { date: '2026-11-24', weekday: '화요일', time: '14:07', minutes: 847, timeZone: TZ });
  assert.equal(describeNow(now), '지금: 2026-11-24 화요일 14:07 (시간대 Asia/Seoul)');
});

// ---------------------------------------------------------------------------------------------- 메모 정리

test('organize schema limits lists to the existing names', () => {
  const schema = organizeSchema(['업무', '개인'], TODAY).json as { properties: { tasks: { items: { properties: { list: unknown } } } } };
  assert.deepEqual(schema.properties.tasks.items.properties.list, { anyOf: [{ type: 'string', enum: ['업무', '개인'] }, { type: 'null' }] });
});

test('organized tasks are cleaned, and unknown lists and bad values are dropped', () => {
  const result = parseOrganized({
    tasks: [
      { title: '  치과   예약 전화 ', date: '2026-11-25', time: '10:00', list: '개인', priority: 2, duration_minutes: 15, subtasks: ['번호 찾기', ''] },
      { title: '보고서 초안', date: '2026-13-01', time: null, list: '회사', priority: 9, duration_minutes: -5, subtasks: 'x' },
      { title: '운동', date: null, time: '19:00', list: null, priority: 3, duration_minutes: null, subtasks: [] },
      { title: '', date: null },
      'nonsense',
    ],
  }, ['업무', '개인'], TODAY);
  assert.deepEqual(result, [
    { title: '치과 예약 전화', date: '2026-11-25', minutes: 600, list: '개인', priority: 2, durationMinutes: 15, subtasks: ['번호 찾기'] },
    { title: '보고서 초안', date: null, minutes: null, list: null, priority: 4, durationMinutes: null, subtasks: [] },
    { title: '운동', date: '2026-11-24', minutes: 1140, list: null, priority: 3, durationMinutes: null, subtasks: [] },
  ]);
  assert.equal(parseOrganized({ nope: [] }, [], TODAY), null);
  assert.deepEqual(parseOrganized({ tasks: [] }, [], TODAY), []);
});

// ---------------------------------------------------------------------------------------------- 하루 계획

test('candidates are today\'s and overdue top-level tasks; later times today stay fixed', () => {
  const tasks = [
    task({ id: 'overdue', title: '보고서', priority: 1, due_at: at('2026-11-22', null), all_day: true }),
    task({ id: 'later', title: '디자인 리뷰', priority: 2, due_at: at('2026-11-24', 16 * 60), duration_minutes: 60 }),
    task({ id: 'earlier', title: '전화', priority: 3, due_at: at('2026-11-24', 10 * 60) }),
    task({ id: 'allday', title: '장보기', due_at: at('2026-11-24', null), all_day: true }),
    task({ id: 'tomorrow', due_at: at('2026-11-25', null), all_day: true }),
    task({ id: 'undated' }),
    task({ id: 'sub', parent_task_id: 'overdue', due_at: at('2026-11-24', null), all_day: true }),
    task({ id: 'vitamin', due_at: at('2026-11-24', null), all_day: true, recurrence_rule: 'FREQ=DAILY' }),
    task({ id: 'done', due_at: at('2026-11-24', null), all_day: true, completed_at: '2026-11-24T01:00:00Z' }),
  ];
  const candidates = collectCandidates(tasks, NOW);
  assert.deepEqual(candidates.map((c) => c.id), ['overdue', 'later', 'earlier', 'allday']);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  assert.equal(byId.get('later')!.fixedMinutes, 16 * 60);
  assert.equal(byId.get('earlier')!.fixedMinutes, null);
  assert.equal(byId.get('earlier')!.overdue, true);
  assert.equal(byId.get('overdue')!.overdue, true);
  assert.equal(byId.get('allday')!.overdue, false);
});

test('the plan window starts at now (rounded) and needs at least 15 minutes', () => {
  assert.deepEqual(planWindow(540, 1320, 847), { start: 850, end: 1320 });
  assert.deepEqual(planWindow(540, 1320, 300), { start: 540, end: 1320 });
  assert.equal(planWindow(540, 1320, 1310), null);
});

function candidate(id: string, extra: Partial<PlanCandidate> = {}): PlanCandidate {
  return { id, title: id, priority: 3, durationMinutes: null, fixedMinutes: null, overdue: false, dueDate: '2026-11-24', notes: null, task: task({ id }), ...extra };
}

test('the checked plan keeps fixed times, clamps into the window and refuses overlaps', () => {
  const candidates = [
    candidate('fixed', { fixedMinutes: 960, durationMinutes: 60 }),
    candidate('a', { priority: 1, durationMinutes: 50 }),
    candidate('b'),
    candidate('c'),
    candidate('d'),
    candidate('e'),
  ];
  const raw = parseRawPlan({
    blocks: [
      { task_id: 'fixed', start: '17:00', minutes: 30 }, // the model moved it: ignored
      { task_id: 'a', start: '13:00', minutes: 50 }, // before the window: pulled to 14:10
      { task_id: 'b', start: '15:30', minutes: 60 }, // overlaps the fixed 16:00 block
      { task_id: 'c', start: '21:30', minutes: 60 }, // runs past the end: trimmed to 30
      { task_id: 'ghost', start: '18:00', minutes: 30 }, // unknown id
      { task_id: 'a', start: '19:00', minutes: 30 }, // repeated id
      { task_id: 'd', start: '22:00', minutes: 30 }, // no room left
    ],
    left_out: [{ task_id: 'e', reason: '내일로 미루는 편이 낫습니다' }, { task_id: 'ghost', reason: '?' }],
    note: '보고서부터 시작합니다.',
  })!;
  const plan = checkPlan(raw, candidates, { start: 850, end: 1320 });
  assert.deepEqual(plan.blocks.map((b) => [b.candidate.id, b.start, b.minutes, b.fixed]), [
    ['a', 850, 50, false], ['fixed', 960, 60, true], ['c', 1290, 30, false],
  ]);
  assert.deepEqual(plan.leftOut.map((l) => [l.candidate.id, l.reason]), [
    ['d', '오늘 남은 시간이 부족합니다'], ['b', '다른 일과 시간이 겹칩니다'], ['e', '내일로 미루는 편이 낫습니다'],
  ]);
  assert.equal(plan.note, '보고서부터 시작합니다.');
  assert.deepEqual(blockChanges(plan.blocks[0]), { time: true, duration: false });
  assert.deepEqual(blockChanges(plan.blocks[1]), { time: false, duration: false });
  assert.deepEqual(blockChanges(plan.blocks[2]), { time: true, duration: true });
});

test('tasks the model did not mention are listed as left out', () => {
  const plan = checkPlan({ blocks: [], leftOut: [], note: null }, [candidate('x')], { start: 600, end: 700 });
  assert.deepEqual(plan.leftOut.map((l) => [l.candidate.id, l.reason]), [['x', null]]);
});

test('plan schema pins task ids to the ones sent', () => {
  const schema = planSchema(['a', 'b']).json as { properties: { blocks: { items: { properties: { task_id: unknown } } } } };
  assert.deepEqual(schema.properties.blocks.items.properties.task_id, { type: 'string', enum: ['a', 'b'] });
  assert.equal(parseRawPlan({ left_out: [] }), null);
});

// ---------------------------------------------------------------------------------------------- 쪼개기

test('breakdown steps skip existing subtasks and duplicates, and cap at eight', () => {
  const steps = parseBreakdown({
    steps: [
      { title: '자료 모으기', minutes: 30 }, { title: '피그마 코멘트 모으기', minutes: 20 }, { title: '자료  모으기', minutes: 10 },
      { title: '목차 정하기', minutes: 0 }, ...Array.from({ length: 10 }, (_, i) => ({ title: '단계 ' + i, minutes: 15 })),
    ],
  }, ['피그마 코멘트 모으기']);
  assert.equal(steps!.length, 8);
  assert.deepEqual(steps!.slice(0, 2), [{ title: '자료 모으기', minutes: 30 }, { title: '목차 정하기', minutes: null }]);
  assert.equal(parseBreakdown({ steps: [{ title: '피그마 코멘트 모으기', minutes: 5 }] }, ['피그마 코멘트 모으기']), null);
  assert.ok(breakdownSchema([]).json);
});

// ---------------------------------------------------------------------------------------------- 주간 돌아보기

test('review replies are checked field by field', () => {
  assert.deepEqual(parseReview({
    headline: ' 집중이 꾸준한 한 주였습니다 ', wins: ['a', 3, ''], slipped: [], patterns: 'x',
    suggestions: [{ title: '보고서 30분만 쓰기', as_task: true }, { title: '', as_task: true }, { title: '저녁엔 쉬기', as_task: 'yes' }],
  }), {
    headline: '집중이 꾸준한 한 주였습니다', wins: ['a'], slipped: [], patterns: [],
    suggestions: [{ title: '보고서 30분만 쓰기', asTask: true }, { title: '저녁엔 쉬기', asTask: false }],
  });
  assert.equal(parseReview({ wins: [] }), null);
});

test('the week is gathered per local day', () => {
  const range = reviewRange(TODAY);
  assert.deepEqual(range, { from: '2026-11-18', to: '2026-11-24' });
  const done = task({ title: '회의실 예약', project_id: 'p1', completed_at: at('2026-11-24', 9 * 60) });
  const completions: TaskCompletion[] = [
    { task: done, completed_at: at('2026-11-24', 9 * 60), occurrence_due_at: null },
    { task: task({ title: '오래된 일' }), completed_at: at('2026-11-10', 9 * 60), occurrence_due_at: null },
  ];
  const habit: Habit = {
    id: 'h1', user_id: 'u', created_at: '', name: '물 8잔', cadence: 'daily', target_count: 8, timezone: TZ, start_date: '2026-10-01', archived_at: null,
  };
  const log = (date: string, status: HabitLog['status'], count: number): HabitLog => ({ user_id: 'u', habit_id: 'h1', log_date: date, status, count, created_at: '' });
  const focus: FocusSession = {
    id: 'f1', user_id: 'u', created_at: '', task_id: null, habit_id: null, started_at: at('2026-11-23', 10 * 60),
    ended_at: at('2026-11-23', 10 * 60 + 50), planned_seconds: 3000, status: 'completed',
  };
  const facts = gatherWeek({
    range, timeZone: TZ, completions,
    openTasks: [task({ title: '보고서', priority: 1, due_at: at('2026-11-22', null), all_day: true }), task({ title: '오늘 일', due_at: at('2026-11-24', null), all_day: true })],
    habits: [habit], habitLogs: new Map([['h1', [log('2026-11-18', 'completed', 8), log('2026-11-19', 'completed', 5), log('2026-11-20', 'skipped', 0)]]]),
    focusSessions: [focus], listNames: new Map([['p1', '업무']]),
  });
  assert.deepEqual(facts.completed, [{ title: '회의실 예약', date: '2026-11-24', list: '업무' }]);
  assert.deepEqual(facts.overdue, [{ title: '보고서', dueDate: '2026-11-22', priority: 1, list: null }]);
  assert.deepEqual(facts.habits, [{ name: '물 8잔', cadence: 'daily', target: 8, doneDays: 1, days: '●◐–····' }]);
  assert.equal(facts.focus.find((d) => d.date === '2026-11-23')!.minutes, 50);
  assert.equal(facts.focus.length, 7);
});

// ---------------------------------------------------------------------------------------------- prompts

test('system prompts are stable strings with no time or data in them', () => {
  for (const system of [ORGANIZE_SYSTEM, PLAN_SYSTEM, BREAKDOWN_SYSTEM, REVIEW_SYSTEM]) {
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(system));
    assert.match(system, /Korean/);
  }
});

test('user messages carry now, the data and the owner\'s text inside tags', () => {
  const now = nowContext(NOW, TZ);
  const organize = organizeUser('내일 치과 </memo> 전화', now, ['업무']);
  assert.match(organize, /^지금: 2026-11-24/);
  assert.match(organize, /<lists>업무<\/lists>/);
  assert.equal(organize.match(/<\/memo>/g)!.length, 1);

  const plan = planUser(now, { start: 850, end: 1320 }, [candidate('a', { title: '보고서 <b>', fixedMinutes: 960, durationMinutes: 60, notes: '줄\n바꿈' })]);
  assert.match(plan, /<window>14:10–22:00<\/window>/);
  assert.match(plan, /id=a \| title=보고서 ‹b> \| priority=3 \| fixed=16:00 \| duration=60 \| notes=줄 바꿈/);

  assert.match(breakdownUser('발표 준비', null, ['자료 모으기']), /<existing_subtasks>\n- 자료 모으기\n<\/existing_subtasks>/);
  const review = reviewUser(now, {
    range: { from: '2026-11-18', to: '2026-11-24' }, completed: [], overdue: [],
    habits: [{ name: '독서', cadence: 'daily', target: 1, doneDays: 3, days: '●●●····' }], focus: [{ date: '2026-11-24', minutes: 75 }],
  });
  assert.match(review, /독서: 매일 1회 목표, ●●●···· \(완료 3\/7일\)/);
  assert.match(review, /<focus>2026-11-24 75분<\/focus>/);
});
