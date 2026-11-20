import { useMutation, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { uuid } from '@/lib/ids';
import type { FocusSession } from '@/lib/shared';

import { queryClient } from './client';
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
  mutationFn: (vars: StartFocusVars) => api.startFocus(vars),
  onMutate: (vars: StartFocusVars) => {
    const draft: FocusSession = {
      id: vars.id, user_id: '', created_at: vars.started_at, task_id: vars.task_id ?? null, habit_id: vars.habit_id ?? null,
      started_at: vars.started_at, ended_at: null, planned_seconds: vars.planned_seconds, status: 'running',
    };
    editSessions((sessions) => [draft, ...sessions.filter((session) => session.id !== vars.id)]);
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: keys.focus }),
});

export interface FinishFocusVars { id: string; status: 'completed' | 'cancelled'; ended_at: string }

queryClient.setMutationDefaults(writes.finishFocus, {
  scope,
  mutationFn: ({ id, ...input }: FinishFocusVars) => api.finishFocus(id, input),
  onMutate: (vars: FinishFocusVars) => {
    editSessions((sessions) => sessions.map((session) => (session.id === vars.id
      ? { ...session, status: vars.status, ended_at: vars.ended_at } : session)));
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: keys.focus }),
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
