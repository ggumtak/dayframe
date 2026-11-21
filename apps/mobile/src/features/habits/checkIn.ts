import type { HabitLogStatus } from '@/lib/shared';

/**
 * What one tap on a habit does. Daily habits count up to the goal, then a tap undoes today; weekly habits
 * tick once per day. Shared by the habit card, the widget and the habit alert so they never disagree.
 */
export function nextCheckIn(habit: { cadence: 'daily' | 'weekly'; target_count: number }, todayCount: number, progress: number):
  { status: HabitLogStatus | null; count: number; reaches: boolean } {
  const weekly = habit.cadence === 'weekly';
  const done = progress >= habit.target_count;
  const next = weekly ? (todayCount ? 0 : 1) : done ? 0 : todayCount + 1;
  if (next === 0) return { status: null, count: 0, reaches: false };
  return { status: 'completed', count: next, reaches: (weekly ? progress + 1 : next) >= habit.target_count };
}
