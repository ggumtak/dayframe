import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '@/lib/api';
import { Temporal, today, weekStart } from '@/lib/dates';
import { uuid } from '@/lib/ids';
import type { Habit, HabitInput, HabitLog, HabitLogStatus, HabitStats } from '@/lib/shared';

import { queryClient } from './client';
import { keys, writes } from './keys';

const scope = { id: 'dayframe-writes' };

export type CreateHabitVars = HabitInput & { id: string };

queryClient.setMutationDefaults(writes.createHabit, {
  scope,
  mutationFn: (vars: CreateHabitVars) => api.createHabit(vars),
  onMutate: (vars: CreateHabitVars) => {
    const draft: Habit = {
      id: vars.id, user_id: '', created_at: new Date().toISOString(), name: vars.name, cadence: vars.cadence,
      target_count: vars.target_count ?? 1, timezone: vars.timezone,
      start_date: vars.start_date ?? today(vars.timezone).toString(), archived_at: null,
    };
    queryClient.setQueryData<Habit[]>(keys.habits, (habits) => [draft, ...(habits ?? [])]);
    queryClient.setQueryData<HabitLog[]>(keys.habitLogs(vars.id), []);
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: keys.habits }),
});

export interface UpdateHabitVars { id: string; name?: string; archive?: true }

queryClient.setMutationDefaults(writes.updateHabit, {
  scope,
  mutationFn: ({ id, ...patch }: UpdateHabitVars) => api.updateHabit(id, patch),
  onMutate: (vars: UpdateHabitVars) => {
    queryClient.setQueryData<Habit[]>(keys.habits, (habits) => habits?.map((habit) => (habit.id !== vars.id ? habit : {
      ...habit, name: vars.name ?? habit.name, archived_at: vars.archive ? new Date().toISOString() : habit.archived_at,
    })));
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: keys.habits }),
});

queryClient.setMutationDefaults(writes.deleteHabit, {
  scope,
  mutationFn: (id: string) => api.deleteHabit(id),
  onMutate: (id: string) => {
    queryClient.setQueryData<Habit[]>(keys.habits, (habits) => habits?.filter((habit) => habit.id !== id));
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: keys.habits }),
});

/** Sets one day's total. A null status clears the day. */
export interface SetHabitLogVars { habitId: string; date: string; status: HabitLogStatus | null; count: number }

/** The start of the day or ISO week that `date` falls in. */
export function periodStart(habit: Pick<Habit, 'cadence'>, date: string): string {
  const day = Temporal.PlainDate.from(date);
  return (habit.cadence === 'weekly' ? weekStart(day) : day).toString();
}

export function periodProgress(habit: Pick<Habit, 'cadence'>, logs: HabitLog[], date: string): number {
  const start = periodStart(habit, date);
  return logs.reduce((sum, log) => (periodStart(habit, log.log_date) === start ? sum + log.count : sum), 0);
}

queryClient.setMutationDefaults(writes.setHabitLog, {
  scope,
  mutationFn: (vars: SetHabitLogVars) => (vars.status === null
    ? api.deleteHabitLog(vars.habitId, vars.date)
    : api.setHabitLog(vars.habitId, vars.date, { status: vars.status, count: vars.count })),
  onMutate: (vars: SetHabitLogVars) => {
    const habit = queryClient.getQueryData<Habit[]>(keys.habits)?.find((item) => item.id === vars.habitId);
    const before = queryClient.getQueryData<HabitLog[]>(keys.habitLogs(vars.habitId)) ?? [];
    const rest = before.filter((log) => log.log_date !== vars.date);
    const after = vars.status === null ? rest : [...rest, {
      user_id: '', habit_id: vars.habitId, log_date: vars.date, status: vars.status, count: vars.count,
      created_at: new Date().toISOString(),
    }].sort((a, b) => (a.log_date < b.log_date ? 1 : -1));
    queryClient.setQueryData<HabitLog[]>(keys.habitLogs(vars.habitId), after);
    if (!habit) return;
    // Nudge the streak right away; the server's figures replace this once the write lands.
    const [was, now] = [before, after].map((logs) => periodProgress(habit, logs, vars.date) >= habit.target_count);
    const current = periodStart(habit, vars.date) === periodStart(habit, today(habit.timezone).toString());
    queryClient.setQueryData<HabitStats>(keys.habitStats(vars.habitId), (stats) => {
      if (!stats || !current) return stats;
      const streak = Math.max(0, stats.current_streak + (now === was ? 0 : now ? 1 : -1));
      return {
        ...stats, current_streak: streak, longest_streak: Math.max(stats.longest_streak, streak),
        current_period_count: periodProgress(habit, after, vars.date),
      };
    });
  },
  onSettled: (_data: unknown, _error: unknown, vars: SetHabitLogVars) => Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.habitLogs(vars.habitId) }),
    queryClient.invalidateQueries({ queryKey: keys.habitStats(vars.habitId) }),
  ]),
});

export const useHabits = () => useQuery({ queryKey: keys.habits, queryFn: api.habits });
export const useHabitLogs = (id: string) => useQuery({ queryKey: keys.habitLogs(id), queryFn: () => api.habitLogs(id) });
export const useHabitStats = (id: string) => useQuery({ queryKey: keys.habitStats(id), queryFn: () => api.habitStats(id) });

/** Logs and stats for every listed habit, fetched side by side. */
export function useHabitDetails(habits: Habit[]) {
  const logs = useQueries({
    queries: habits.map((habit) => ({ queryKey: keys.habitLogs(habit.id), queryFn: () => api.habitLogs(habit.id) })),
  });
  const stats = useQueries({
    queries: habits.map((habit) => ({ queryKey: keys.habitStats(habit.id), queryFn: () => api.habitStats(habit.id) })),
  });
  return useMemo(() => new Map(habits.map((habit, index) => [habit.id, {
    logs: logs[index]?.data ?? [], stats: stats[index]?.data,
  }])), [habits, logs, stats]);
}

export function useHabitActions() {
  const create = useMutation<Habit, Error, CreateHabitVars>({ mutationKey: writes.createHabit });
  const update = useMutation<Habit, Error, UpdateHabitVars>({ mutationKey: writes.updateHabit });
  const remove = useMutation<void, Error, string>({ mutationKey: writes.deleteHabit });
  const setLog = useMutation<unknown, Error, SetHabitLogVars>({ mutationKey: writes.setHabitLog });
  return {
    create: (input: HabitInput) => create.mutate({ ...input, id: uuid() }),
    rename: (id: string, name: string) => update.mutate({ id, name }),
    archive: (id: string) => update.mutate({ id, archive: true }),
    remove: (id: string) => remove.mutate(id),
    setLog: (vars: SetHabitLogVars) => setLog.mutate(vars),
  };
}
