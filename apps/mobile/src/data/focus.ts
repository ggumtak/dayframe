import { useMutation, useQuery } from '@tanstack/react-query';

import { api, ApiFailure } from '@/lib/api';
import { uuid } from '@/lib/ids';
import type { FocusSession } from '@/lib/shared';

import { hold, queryClient, settle } from './client';
import { keys, writes } from './keys';

const scope = { id: 'dayframe-writes' };
const editSessions = (edit: (sessions: FocusSession[]) => FocusSession[]) =>
  queryClient.setQueryData<FocusSession[]>(keys.focus, (sessions) => edit(sessions ?? []));

export interface StartFocusVars {
  id: string;
  started_at: string;
  planned_seconds: number;
  task_id?: string | null;
  habit_id?: string | null;
}

queryClient.setMutationDefaults(writes.startFocus, {
  scope,
  mutationFn: async (vars: StartFocusVars) => {
    try {
      return await api.startFocus(vars);
    } catch (error) {
      // The ID already exists when an earlier attempt reached the server but its reply was lost.
      if (!(error instanceof ApiFailure && error.status === 409)) throw error;
      const existing = (await api.focusSessions()).find((session) => session.id === vars.id);
      if (!existing) throw error;
      return existing;
    }
  },
  onMutate: async (vars: StartFocusVars) => {
    await hold(keys.focus);
    const draft: FocusSession = {
      id: vars.id, user_id: '', created_at: vars.started_at, task_id: vars.task_id ?? null, habit_id: vars.habit_id ?? null,
      started_at: vars.started_at, ended_at: null, planned_seconds: vars.planned_seconds, status: 'running',
    };
    editSessions((sessions) => [draft, ...sessions.filter((session) => session.id !== vars.id)]);
  },
  onSuccess: (session: FocusSession) => editSessions((sessions) => sessions.map((item) => (item.id === session.id ? session : item))),
  onSettled: () => settle(keys.focus),
});

export interface FinishFocusVars { id: string; status: 'completed' | 'cancelled'; ended_at: string }

queryClient.setMutationDefaults(writes.finishFocus, {
  scope,
  mutationFn: ({ id, ...input }: FinishFocusVars) => api.finishFocus(id, input),
  onMutate: async (vars: FinishFocusVars) => {
    await hold(keys.focus);
    editSessions((sessions) => sessions.map((session) => (session.id === vars.id
      ? { ...session, status: vars.status, ended_at: vars.ended_at } : session)));
  },
  onSettled: () => settle(keys.focus),
});

queryClient.setMutationDefaults(writes.deleteFocus, {
  scope,
  mutationFn: (id: string) => api.deleteFocus(id),
  onMutate: async (id: string) => {
    await hold(keys.focus);
    queryClient.setQueryData<FocusSession[]>(keys.focus, (sessions) => sessions?.filter((session) => session.id !== id));
  },
  onSettled: () => settle(keys.focus),
});

export const useFocusSessions = () => useQuery({ queryKey: keys.focus, queryFn: api.focusSessions });

export function useFocusActions() {
  const start = useMutation<FocusSession, Error, StartFocusVars>({ mutationKey: writes.startFocus });
  const finish = useMutation<FocusSession, Error, FinishFocusVars>({ mutationKey: writes.finishFocus });
  return {
    start: (vars: Omit<StartFocusVars, 'id' | 'started_at'>) =>
      start.mutate({ ...vars, id: uuid(), started_at: new Date().toISOString() }),
    finish: (vars: FinishFocusVars) => finish.mutate(vars),
  };
}

/** Removes a focus record, such as a test round, from the timeline and the day's totals. */
export function useDeleteFocus() {
  return useMutation<void, Error, string>({ mutationKey: writes.deleteFocus, scope });
}
