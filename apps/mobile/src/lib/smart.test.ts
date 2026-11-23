import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Temporal } from '@js-temporal/polyfill';

import type { Task } from './shared';
import {
  bySmartRank, classifyEisenhower, computeUrgencyScore, isStaleTask, planBalancedReschedule, suggestForToday,
} from './smart.ts';

const nowMs = Date.parse('2026-11-23T03:00:00Z'); // Monday 2026-11-23 12:00 KST
const todayDate = Temporal.PlainDate.from('2026-11-23');

function makeTask(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    user_id: 'u',
    project_id: null,
    section_id: null,
    parent_task_id: null,
    title: id,
    notes: null,
    priority: 4,
    position: 1024,
    due_at: null,
    all_day: false,
    timezone: 'Asia/Seoul',
    recurrence_rule: null,
    recurrence_mode: 'schedule',
    recurrence_anchor_at: null,
    recurrence_local_time: null,
    occurrence_at: null,
    duration_minutes: null,
    completed_at: null,
    created_at: '2026-11-20T00:00:00Z',
    updated_at: '2026-11-20T00:00:00Z',
    ...extra,
  };
}

const dummyNext = (_rule: string, _tz: string, _anchor: string, after: Temporal.Instant) =>
  Temporal.Instant.fromEpochMilliseconds(after.epochMilliseconds + 86_400_000).toString();

test('computeUrgencyScore ranks P1 today above stale P4 overdue and rewards partial subtask progress', () => {
  const p1Today = makeTask('p1-today', { priority: 1, due_at: '2026-11-23T04:00:00Z' }); // due in 1h
  const staleP4 = makeTask('stale-p4', { priority: 4, due_at: '2026-10-20T00:00:00Z', all_day: true });
  const freshP3 = makeTask('fresh-p3', { priority: 3, due_at: '2026-11-22T15:00:00Z', all_day: true }); // today all-day
  const inProgressP3 = makeTask('progress-p3', { priority: 3, due_at: '2026-11-22T15:00:00Z', all_day: true });

  const progress = new Map([['progress-p3', { open: 1, completed: 3, total: 4 }]]);
  assert.ok(computeUrgencyScore(p1Today, { nowMs }) > computeUrgencyScore(staleP4, { nowMs }));
  assert.ok(
    computeUrgencyScore(inProgressP3, { nowMs, subtaskProgress: progress })
    > computeUrgencyScore(freshP3, { nowMs, subtaskProgress: progress }),
  );

  const sorted = [staleP4, freshP3, inProgressP3, p1Today].sort((a, b) => bySmartRank(a, b, { nowMs, subtaskProgress: progress }));
  assert.equal(sorted[0].id, 'p1-today');
});

test('classifyEisenhower partitions tasks accurately into Q1–Q4', () => {
  assert.equal(classifyEisenhower(makeTask('q1', { priority: 1, due_at: '2026-11-22T15:00:00Z', all_day: true }), nowMs), 'q1');
  assert.equal(classifyEisenhower(makeTask('q2', { priority: 2, due_at: '2026-11-25T15:00:00Z', all_day: true }), nowMs), 'q2');
  assert.equal(classifyEisenhower(makeTask('q2-none', { priority: 1 }), nowMs), 'q2');
  assert.equal(classifyEisenhower(makeTask('q3', { priority: 4, due_at: '2026-11-20T15:00:00Z', all_day: true }), nowMs), 'q3');
  assert.equal(classifyEisenhower(makeTask('q4', { priority: 3 }), nowMs), 'q4');
});

test('isStaleTask flags unscheduled or overdue tasks older than threshold', () => {
  assert.equal(isStaleTask(makeTask('old-inbox', { updated_at: '2026-11-01T00:00:00Z' }), nowMs, 14), true);
  assert.equal(isStaleTask(makeTask('fresh-inbox', { updated_at: '2026-11-20T00:00:00Z' }), nowMs, 14), false);
  assert.equal(isStaleTask(makeTask('old-overdue', { due_at: '2026-11-01T00:00:00Z' }), nowMs, 14), true);
  assert.equal(isStaleTask(makeTask('future', { due_at: '2026-11-28T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }), nowMs, 14), false);
});

test('planBalancedReschedule keeps P1 urgent on today/tomorrow and balances P4 onto lighter days', () => {
  // Today already has 5 tasks (at capacity).
  const existingToday = Array.from({ length: 5 }, (_, i) =>
    makeTask('today-' + i, { due_at: '2026-11-22T15:00:00Z', all_day: true }));
  const overdueP1 = makeTask('ov-p1', { priority: 1, due_at: '2026-11-21T00:00:00Z', all_day: true });
  const overdueP4a = makeTask('ov-p4-a', { priority: 4, due_at: '2026-11-20T00:00:00Z', all_day: true });
  const overdueP4b = makeTask('ov-p4-b', { priority: 4, due_at: '2026-11-19T00:00:00Z', all_day: true });
  const overdue = [overdueP4a, overdueP1, overdueP4b];

  const proposals = planBalancedReschedule(overdue, [...existingToday, ...overdue], todayDate, dummyNext, {
    horizonDays: 5, dailyCap: 5,
  });
  assert.equal(proposals.length, 3);
  assert.equal(proposals[0].task.id, 'ov-p1');
  // P1 should land on today or tomorrow (within 1 day)
  assert.ok(todayDate.until(proposals[0].targetDate).days <= 1);
  // P4 items should spread off Today (which is already full) onto lighter days!
  const p4Dates = proposals.slice(1).map((p) => p.targetDate.toString());
  assert.ok(p4Dates.every((d) => d !== '2026-11-23'));
  // And should distribute across distinct days instead of piling onto one day
  assert.equal(new Set(p4Dates).size, 2);
});

test('suggestForToday recommends in-progress checklists and high-priority items while skipping already-today tasks', () => {
  const alreadyToday = makeTask('today', { priority: 1, due_at: '2026-11-22T15:00:00Z', all_day: true });
  const inProgress = makeTask('in-prog', { priority: 4 });
  const p1Unscheduled = makeTask('p1-box', { priority: 1 });
  const tomorrow = makeTask('tmrw', { priority: 4, due_at: '2026-11-23T15:00:00Z', all_day: true });
  const progress = new Map([['in-prog', { open: 2, completed: 3, total: 5 }]]);

  const suggestions = suggestForToday([alreadyToday, tomorrow, p1Unscheduled, inProgress], progress, nowMs, 5);
  assert.deepEqual(suggestions.map((s) => s.task.id), ['in-prog', 'p1-box', 'tmrw']);
  assert.match(suggestions[0].reason, /진행 중/);

  // An appointment a month away stays where it was put, even with a half-done checklist or a high priority.
  const nextMonth = makeTask('meet', { priority: 1, due_at: '2026-12-26T15:00:00Z', all_day: true });
  const later = suggestForToday([nextMonth, inProgress], new Map([...progress, ['meet', { open: 2, completed: 1, total: 3 }]]), nowMs, 5);
  assert.deepEqual(later.map((s) => s.task.id), ['in-prog']);
});
