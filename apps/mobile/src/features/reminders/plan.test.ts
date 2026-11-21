import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  defaultReminderSettings, parseHabitReminderId, parseReminderId, planHabitReminders, planReminders, reminderId, type ReminderTask, stableUuid,
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

test('habit alerts come daily at their time and skip today once done', () => {
  const habit = { id: '33333333-3333-4333-8333-333333333333', time: '21:00', timezone: 'Asia/Seoul', doneThrough: null };
  const planned = planHabitReminders([habit], now, 3);
  assert.deepEqual(planned.map((item) => kst(item.at)), ['2026-11-21 21:00', '2026-11-22 21:00', '2026-11-23 21:00']);
  assert.deepEqual(planHabitReminders([{ ...habit, doneThrough: '2026-11-21' }], now, 3).map((item) => item.date), ['2026-11-22', '2026-11-23']);
  // A weekly goal met on Saturday also covers Sunday; Monday starts a new week.
  assert.deepEqual(planHabitReminders([{ ...habit, doneThrough: '2026-11-22' }], now, 3).map((item) => item.date), ['2026-11-23']);
  assert.deepEqual(planHabitReminders([{ ...habit, time: '07:00' }], now, 2).map((item) => item.date), ['2026-11-22']);
  assert.deepEqual(parseHabitReminderId(planned[0].id), { habitId: habit.id, date: '2026-11-21' });
  assert.equal(planHabitReminders([{ ...habit, time: 'soon' }], now).length, 0);
});
