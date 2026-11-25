import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { periodProgress, periodStart } from '@/features/habits/goal';
import { api, ApiFailure } from '@/lib/api';
import { today } from '@/lib/dates';
import { uuid } from '@/lib/ids';
import type { Habit, HabitInput, HabitLog, HabitLogStatus, HabitStats } from '@/lib/shared';

import { hold, queryClient, settle } from './client';
import { keys, writes } from './keys';

const scope = { id: 'dayframe-writes' };

// The goal rules live in a pure module so every habit screen and its tests share them.
export { periodProgress, periodStart };

export type CreateHabitVars = HabitInput & { id: string };

queryClient.setMutationDefaults(writes.createHabit, {
  scope,
  mutationFn: async (vars: CreateHabitVars) => {
    try {
      return await api.createHabit(vars);
    } catch (error) {
      // The ID already exists when an earlier attempt reached the server but its reply was lost.
      if (!(error instanceof ApiFailure && error.status === 409)) throw error;
      const existing = (await api.habits()).find((habit) => habit.id === vars.id);
      if (!existing) throw error;
      return existing;
    }
  },
  onMutate: async (vars: CreateHabitVars) => {
    await hold(keys.habits);
    const draft: Habit = {
      id: vars.id, user_id: '', created_at: new Date().toISOString(), name: vars.name, cadence: vars.cadence,
      target_count: vars.target_count ?? 1, timezone: vars.timezone,
      start_date: vars.start_date ?? today(vars.timezone).toString(), archived_at: null,
    };
    queryClient.setQueryData<Habit[]>(keys.habits, (habits) => [draft, ...(habits ?? []).filter((item) => item.id !== vars.id)]);
    queryClient.setQueryData<HabitLog[]>(keys.habitLogs(vars.id), []);
  },
  onSuccess: (habit: Habit) => {
    queryClient.setQueryData<Habit[]>(keys.habits, (habits) => habits?.map((item) => (item.id === habit.id ? habit : item)));
  },
  onSettled: () => settle(keys.habits),
});

export interface UpdateHabitVars { id: string; name?: string; archive?: boolean }

queryClient.setMutationDefaults(writes.updateHabit, {
  scope,
  mutationFn: ({ id, ...patch }: UpdateHabitVars) => api.updateHabit(id, patch),
  onMutate: async (vars: UpdateHabitVars) => {
    await hold(keys.habits);
    queryClient.setQueryData<Habit[]>(keys.habits, (habits) => habits?.map((habit) => (habit.id !== vars.id ? habit : {
      ...habit,
      name: vars.name ?? habit.name,
      archived_at: vars.archive === undefined ? habit.archived_at : vars.archive ? new Date().toISOString() : null,
    })));
  },
  onSettled: () => settle(keys.habits),
});

queryClient.setMutationDefaults(writes.deleteHabit, {
  scope,
  mutationFn: (id: string) => api.deleteHabit(id),
  onMutate: async (id: string) => {
    await hold(keys.habits);
    queryClient.setQueryData<Habit[]>(keys.habits, (habits) => habits?.filter((habit) => habit.id !== id));
  },
  onSettled: () => settle(keys.habits),
});

/** Sets one day's total. A null status clears the day. */
export interface SetHabitLogVars { habitId: string; date: string; status: HabitLogStatus | null; count: number }

queryClient.setMutationDefaults(writes.setHabitLog, {
  scope,
  mutationFn: (vars: SetHabitLogVars) => (vars.status === null
    ? api.deleteHabitLog(vars.habitId, vars.date)
    : api.setHabitLog(vars.habitId, vars.date, { status: vars.status, count: vars.count })),
  onMutate: async (vars: SetHabitLogVars) => {
    await hold(keys.habitLogs(vars.habitId), keys.habitStats(vars.habitId));
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
  onSettled: (_data: unknown, _error: unknown, vars: SetHabitLogVars) =>
    settle(keys.habitLogs(vars.habitId), keys.habitStats(vars.habitId)),
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
    // The start date is fixed now, so check-ins made offline still fall inside the habit once it syncs.
    create: (input: HabitInput) => {
      const id = uuid();
      create.mutate({
        ...input, id, start_date: input.start_date ?? today(input.timezone).toString(),
      });
      return id;
    },
    rename: (id: string, name: string) => update.mutate({ id, name }),
    archive: (id: string) => update.mutate({ id, archive: true }),
    unarchive: (id: string) => update.mutate({ id, archive: false }),
    remove: (id: string) => remove.mutate(id),
    setLog: (vars: SetHabitLogVars) => setLog.mutate(vars),
  };
}
