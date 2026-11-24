import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  alertPreview, allDayLeadLabel, cleanReminder, joinLead, leadAhead, leadLabel, reminderSummary, splitLead,
} from './lead.ts';
import { alertTime, defaultReminderSettings, planReminders, type ReminderTask } from './plan.ts';

const now = Date.parse('2026-11-24T03:00:00Z'); // Tuesday 12:00 in Seoul

test('lead labels read naturally for presets, stored values and custom amounts', () => {
  assert.equal(leadLabel(0), '정시');
  assert.equal(leadLabel(5), '5분 전');
  assert.equal(leadLabel(10), '10분 전'); // stored by older versions
  assert.equal(leadLabel(60), '1시간 전');
  assert.equal(leadLabel(90), '1시간 30분 전');
  assert.equal(leadLabel(1440), '1일 전');
  assert.equal(leadLabel(1440 + 125), '1일 2시간 5분 전');
  assert.equal(leadAhead(30), '30분 후');
  assert.equal(leadAhead(60), '1시간 후');
  assert.equal(allDayLeadLabel(0, 9), '오전 9시');
  assert.equal(allDayLeadLabel(1440, 9), '하루 전 오전 9시');
  assert.equal(allDayLeadLabel(2 * 1440, 20), '2일 전 오후 8시');
  // A lead left over from when the task had a time still rings on its day.
  assert.equal(allDayLeadLabel(30, 8), '오전 8시');
});

test('custom leads split into days, hours and minutes and back', () => {
  assert.deepEqual(splitLead(1440 + 125), { days: 1, hours: 2, minutes: 5 });
  assert.equal(joinLead({ days: 1, hours: 2, minutes: 5 }), 1440 + 125);
  assert.equal(joinLead({ days: 0, hours: -1, minutes: 0 }), 0);
  assert.equal(joinLead({ days: 99, hours: 0, minutes: 0 }), 30 * 1440);
});

test('stored values migrate unchanged and junk is dropped', () => {
  for (const value of [0, 5, 10, 30, 60, 'off'] as const) assert.equal(cleanReminder(value), value);
  assert.equal(cleanReminder(2880), 2880);
  assert.equal(cleanReminder(12.6), 13);
  assert.equal(cleanReminder(-5), 0);
  assert.equal(cleanReminder('soon'), undefined);
  assert.equal(cleanReminder(null), undefined);
  assert.equal(cleanReminder(Number.NaN), undefined);
});

test('the summary follows the task, then the settings', () => {
  const settings = defaultReminderSettings;
  assert.deepEqual(reminderSummary(undefined, settings, false), { label: '정시 알림', off: false });
  assert.deepEqual(reminderSummary(10, settings, false), { label: '10분 전', off: false });
  assert.deepEqual(reminderSummary(1440, settings, false), { label: '1일 전', off: false });
  assert.deepEqual(reminderSummary('off', settings, false), { label: '알림 끔', off: true });
  assert.deepEqual(reminderSummary(1440, settings, true), { label: '하루 전 오전 9시', off: false });
  assert.deepEqual(reminderSummary(undefined, { ...settings, allDayHour: null }, true), { label: '알림 없음', off: true });
  assert.deepEqual(reminderSummary(30, { ...settings, enabled: false }, false), { label: '알림 꺼짐', off: true });
});

test('alert moments: leads of a day or more, all-day days before, and the preview line', () => {
  const timed = { all_day: false, timezone: 'Asia/Seoul' };
  const due = '2026-11-24T09:00:00Z'; // 18:00 in Seoul
  assert.equal(alertPreview(alertTime(timed, due, defaultReminderSettings, 15), 'Asia/Seoul', now), '11월 24일 오후 5:45에 알림');
  assert.equal(alertPreview(alertTime(timed, due, defaultReminderSettings, 1440), 'Asia/Seoul', now), '11월 23일 오후 6:00에 알림 · 이미 지난 시각이라 울리지 않습니다');
  assert.match(alertPreview(alertTime(timed, due, defaultReminderSettings, 1440), 'Asia/Seoul', now, true)!, /다음 반복부터/);
  assert.equal(alertPreview(alertTime(timed, '2027-01-02T00:00:00Z', defaultReminderSettings, 1440 + 60), 'Asia/Seoul', now), '2027년 1월 1일 오전 8:00에 알림');
  const allDay = { all_day: true, timezone: 'Asia/Seoul' };
  const day = '2026-11-26T15:00:00Z'; // 2026-11-27 in Seoul
  assert.equal(alertPreview(alertTime(allDay, day, defaultReminderSettings), 'Asia/Seoul', now), '11월 27일 오전 9:00에 알림');
  assert.equal(alertPreview(alertTime(allDay, day, defaultReminderSettings, 1440), 'Asia/Seoul', now), '11월 26일 오전 9:00에 알림');
  assert.equal(alertTime(allDay, day, { ...defaultReminderSettings, allDayHour: null }, 1440), null);
  assert.equal(alertPreview(null, 'Asia/Seoul', now), null);
});

test('the planner rings a day early, skips alerts already past, and keeps later repeats', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const task: ReminderTask = {
    id, title: 'x', due_at: '2026-11-26T09:00:00Z', all_day: false, timezone: 'Asia/Seoul', completed_at: null, recurrence_rule: null,
  };
  const daily = (_task: ReminderTask, after: string) => new Date(Date.parse(after) + 86_400_000).toISOString();
  const kst = (at: number) => new Date(at).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
  assert.deepEqual(planReminders([task], defaultReminderSettings, now, daily, { leadFor: () => 1440 }).map((item) => kst(item.at)), ['2026-11-25 18:00']);
  // Due tomorrow 18:00 with a two-day lead: the alert would have been yesterday, so nothing fires late.
  const soon = { ...task, due_at: '2026-11-25T09:00:00Z' };
  assert.deepEqual(planReminders([soon], defaultReminderSettings, now, daily, { leadFor: () => 2880 }), []);
  // A daily repeat skips the passed alert but still holds the following ones.
  const repeating = { ...soon, recurrence_rule: 'FREQ=DAILY' };
  assert.deepEqual(planReminders([repeating], defaultReminderSettings, now, daily, { leadFor: () => 2880 }).map((item) => kst(item.at)),
    ['2026-11-24 18:00', '2026-11-25 18:00', '2026-11-26 18:00']);
  // An all-day task set to the day before rings at the settings hour of that day.
  const allDay = { ...task, all_day: true, due_at: '2026-11-26T15:00:00Z' };
  assert.deepEqual(planReminders([allDay], defaultReminderSettings, now, daily, { leadFor: () => 1440 }).map((item) => kst(item.at)), ['2026-11-26 09:00']);
  assert.deepEqual(planReminders([allDay], defaultReminderSettings, now, daily, { leadFor: () => 30 }).map((item) => kst(item.at)), ['2026-11-27 09:00']);
});
