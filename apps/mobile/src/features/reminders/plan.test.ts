import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  defaultReminderSettings, parseBriefingReminderId, parseHabitReminderId, parseReminderId,
  planBriefingReminders, planHabitReminders, planReminders, reminderId, type ReminderTask, stableUuid,
} from './plan.ts';

const now = Date.parse('2026-11-21T09:00:00Z'); // Saturday 18:00 in Seoul
const task = (id: string, extra: Partial<ReminderTask>): ReminderTask => ({
  id: id.repeat(8) + '-' + id.repeat(4) + '-4' + id.repeat(3) + '-8' + id.repeat(3) + '-' + id.repeat(12),
  title: id, due_at: null, all_day: false, timezone: 'Asia/Seoul', completed_at: null, recurrence_rule: null, ...extra,
});
const daily = (_task: ReminderTask, after: string) => new Date(Date.parse(after) + 86_400_000).toISOString();
const kst = (at: number) => new Date(at).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);

test('timed tasks ring at their time, earlier by the lead, and never in the past', () => {
  const tasks = [
    task('a', { due_at: '2026-11-21T10:00:00Z' }), // today 19:00
    task('b', { due_at: '2026-11-21T08:00:00Z' }), // already past
    task('c', { due_at: '2026-11-23T00:00:00Z', completed_at: '2026-11-21T01:00:00Z' }),
    task('d', {}),
  ];
  assert.deepEqual(planReminders(tasks, defaultReminderSettings, now, daily).map((item) => [item.taskId[0], kst(item.at)]), [['a', '2026-11-21 19:00']]);
  const early = planReminders(tasks, { ...defaultReminderSettings, leadMinutes: 30 }, now, daily);
  assert.equal(kst(early[0].at), '2026-11-21 18:30');
  assert.deepEqual(planReminders(tasks, { ...defaultReminderSettings, enabled: false }, now, daily), []);
});

test('all-day tasks ring at the chosen hour of their own day, or not at all', () => {
  const tasks = [task('e', { due_at: '2026-11-22T15:00:00Z', all_day: true })]; // 2026-11-23 in Seoul
  assert.equal(kst(planReminders(tasks, defaultReminderSettings, now, daily)[0].at), '2026-11-23 09:00');
  assert.deepEqual(planReminders(tasks, { ...defaultReminderSettings, allDayHour: null }, now, daily), []);
});

test('repeating tasks hold their next few occurrences inside the horizon, earliest first', () => {
  const tasks = [task('f', { due_at: '2026-11-21T22:00:00Z', recurrence_rule: 'FREQ=DAILY' }), task('a', { due_at: '2026-11-21T10:00:00Z' })];
  const planned = planReminders(tasks, defaultReminderSettings, now, daily);
  assert.deepEqual(planned.map((item) => kst(item.at)), ['2026-11-21 19:00', '2026-11-22 07:00', '2026-11-23 07:00', '2026-11-24 07:00', '2026-11-25 07:00']);
  assert.equal(planReminders(tasks, defaultReminderSettings, now, daily, { limit: 2 }).length, 2);
  const far = [task('g', { due_at: '2026-12-25T00:00:00Z' })];
  assert.deepEqual(planReminders(far, defaultReminderSettings, now, daily), []);
  // A rule the device cannot expand still rings once.
  const broken = [task('h', { due_at: '2026-11-21T10:00:00Z', recurrence_rule: 'FREQ=BROKEN' })];
  assert.equal(planReminders(broken, defaultReminderSettings, now, () => { throw new Error('bad rule'); }).length, 1);
  // Completion-based repeats only schedule the current occurrence, never speculative future ones.
  const completion = [task('i', { due_at: '2026-11-21T22:00:00Z', recurrence_rule: 'FREQ=DAILY', recurrence_mode: 'completion' })];
  assert.deepEqual(planReminders(completion, defaultReminderSettings, now, daily).map((item) => kst(item.at)), ['2026-11-22 07:00']);
});

test('identifiers round-trip and request ids are stable UUIDs', () => {
  const id = reminderId('11111111-1111-4111-8111-111111111111', '2026-11-21T10:00:00Z');
  assert.deepEqual(parseReminderId(id), { taskId: '11111111-1111-4111-8111-111111111111', occurrence: '2026-11-21T10:00:00.000Z' });
  assert.deepEqual(parseReminderId(id.replace('task-', 'snooze-')), parseReminderId(id));
  assert.equal(parseReminderId('dayframe-focus'), null);
  assert.equal(stableUuid(id), stableUuid(id));
  assert.notEqual(stableUuid(id), stableUuid(id + '1'));
  assert.match(stableUuid(id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('a task can ring earlier than the default, or not at all', () => {
  const a = task('a', { due_at: '2026-11-21T10:00:00Z' });
  const b = task('b', { due_at: '2026-11-21T11:00:00Z' });
  const planned = planReminders([a, b], defaultReminderSettings, now, daily, { leadFor: (item) => (item.id === a.id ? 30 : item.id === b.id ? 'off' : undefined) });
  assert.deepEqual(planned.map((item) => kst(item.at)), ['2026-11-21 18:30']);
});

test('habit alerts come daily at their time, support snooze IDs, and skip today once done', () => {
  const habit = { id: '33333333-3333-4333-8333-333333333333', time: '21:00', timezone: 'Asia/Seoul', doneThrough: null };
  const planned = planHabitReminders([habit], now, 3);
  assert.deepEqual(planned.map((item) => kst(item.at)), ['2026-11-21 21:00', '2026-11-22 21:00', '2026-11-23 21:00']);
  assert.deepEqual(planHabitReminders([{ ...habit, doneThrough: '2026-11-21' }], now, 3).map((item) => item.date), ['2026-11-22', '2026-11-23']);
  assert.deepEqual(planHabitReminders([{ ...habit, doneThrough: '2026-11-22' }], now, 3).map((item) => item.date), ['2026-11-23']);
  assert.deepEqual(planHabitReminders([{ ...habit, time: '07:00' }], now, 2).map((item) => item.date), ['2026-11-22']);
  assert.deepEqual(parseHabitReminderId(planned[0].id), { habitId: habit.id, date: '2026-11-21' });
  assert.deepEqual(parseHabitReminderId('habit-snooze-' + habit.id + '-2026-11-21'), { habitId: habit.id, date: '2026-11-21' });
  assert.equal(planHabitReminders([{ ...habit, time: 'soon' }], now).length, 0);
});

test('daily briefing schedules only on days with open or overdue tasks', () => {
  const earlyMorning = Date.parse('2026-11-20T22:00:00Z'); // Saturday 2026-11-21 07:00 KST (before 08:00 briefing)
  const tasks: ReminderTask[] = [
    { ...task('1', { due_at: '2026-11-19T15:00:00Z', all_day: true, priority: 2 }), title: '지연된 보고서' }, // 11-20 overdue
    { ...task('2', { due_at: '2026-11-21T06:00:00Z', priority: 1 }), title: '오후 미팅' }, // 11-21 today
    { ...task('3', { due_at: '2026-11-23T00:00:00Z', priority: 3 }), title: '월요일 점검' }, // 11-23
  ];
  const briefings = planBriefingReminders(tasks, { ...defaultReminderSettings, briefingHour: 8 }, earlyMorning, 'Asia/Seoul', daily, 4);
  assert.deepEqual(briefings.map((b) => [b.date, kst(b.at), b.todayCount, b.overdueCount]), [
    ['2026-11-21', '2026-11-21 08:00', 1, 1],
    ['2026-11-23', '2026-11-23 08:00', 1, 0],
  ]);
  assert.deepEqual(briefings[0].topTitles, ['오후 미팅', '지연된 보고서']);
  assert.deepEqual(parseBriefingReminderId(briefings[0].id), { date: '2026-11-21' });
  assert.deepEqual(planBriefingReminders(tasks, { ...defaultReminderSettings, briefingHour: null }, earlyMorning, 'Asia/Seoul', daily, 4), []);
});

test('daily briefing carries overdue tasks onto the next morning after briefing hour, defaults undefined hour, and expands >14d overdue repeats', () => {
  // `now` is Saturday 2026-11-21 18:00 KST (after the 08:00 briefing hour has already passed).
  const tasks: ReminderTask[] = [
    { ...task('1', { due_at: '2026-11-19T15:00:00Z', all_day: true, priority: 2 }), title: '지연된 보고서' }, // 11-20 overdue
    { ...task('2', { due_at: '2026-11-21T11:00:00Z', priority: 1 }), title: '오늘 저녁 운동', recurrence_rule: 'FREQ=DAILY' }, // 11-21 today + daily repeat
    { ...task('3', { due_at: '2026-11-23T00:00:00Z', priority: 3 }), title: '월요일 점검' }, // 11-23
    { ...task('4', { due_at: '2026-10-31T15:00:00Z', all_day: true, priority: 4, recurrence_rule: 'FREQ=DAILY' }), title: '장기 미룬 매일 습관' }, // 11-01 (20d overdue daily)
  ];

  // Omitted `briefingHour` falls back to defaultReminderSettings.briefingHour (8).
  const legacySettings = { enabled: true, leadMinutes: 0 as const, allDayHour: 9 };
  const briefings = planBriefingReminders(tasks, legacySettings, now, 'Asia/Seoul', daily, 3);
  assert.deepEqual(briefings.map((b) => [b.date, kst(b.at), b.todayCount, b.overdueCount]), [
    ['2026-11-22', '2026-11-22 08:00', 1, 2], // first future briefing: carries both overdue tasks (< 11-21) + tomorrow's repeat of task 2
    ['2026-11-23', '2026-11-23 08:00', 3, 0], // subsequent day: no overdue carryover, task 2 + task 3 + 20d-overdue daily task 4 expanded within 64-step cap
  ]);
  assert.deepEqual(briefings[0].topTitles, ['오늘 저녁 운동', '지연된 보고서', '장기 미룬 매일 습관']);
  assert.deepEqual(briefings[1].topTitles, ['오늘 저녁 운동', '월요일 점검', '장기 미룬 매일 습관']);
});
