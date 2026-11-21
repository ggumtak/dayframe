import { router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';

import { queryClient } from '@/data/client';
import { useFocusSessions } from '@/data/focus';
import { periodProgress, useHabitDetails, useHabits } from '@/data/habits';
import { useProjects, useTaskIndex } from '@/data/tasks';
import type { WidgetFocus, WidgetHabit } from '@/features/widget/items';
import { saveWidget } from '@/features/widget/render';
import { deviceTimeZone, Temporal, today } from '@/lib/dates';
import type { Task } from '@/lib/shared';

import { type HabitReminderInfo, listenForReminders, requestReminderPermission, syncReminders } from './notify';
import { useReminderOverrides } from './overrides';
import { useReminderSettings } from './settings';

/**
 * Keeps what lives outside the app in step with the task list while someone is signed in: the alerts
 * the system holds and the home-screen widget. Renders nothing.
 */
export function BackgroundSync() {
  const { tasks, children, isLoading } = useTaskIndex();
  const { data: projects } = useProjects();
  const settings = useReminderSettings();
  const overrides = useReminderOverrides();
  const { data: allHabits } = useHabits();
  const habits = useMemo(() => (allHabits ?? []).filter((habit) => !habit.archived_at), [allHabits]);
  const details = useHabitDetails(habits);
  const { data: sessions } = useFocusSessions();

  // What the habit and focus widgets show; recomputed only when their data changes.
  const widgetHabits = useMemo<WidgetHabit[]>(() => habits.map((habit) => {
    const date = today(habit.timezone).toString();
    const logs = details.get(habit.id)?.logs ?? [];
    return {
      id: habit.id, name: habit.name, cadence: habit.cadence, target_count: habit.target_count, timezone: habit.timezone, date,
      todayCount: logs.find((log) => log.log_date === date)?.count ?? 0, progress: periodProgress(habit, logs, date),
    };
  }), [habits, details]);
  const widgetFocus = useMemo<WidgetFocus | null>(() => {
    if (!sessions) return null;
    const zone = deviceTimeZone();
    const date = today(zone).toString();
    const running = sessions.find((session) => session.status === 'running');
    const done = sessions.filter((session) => session.status === 'completed' && session.ended_at
      && Temporal.Instant.from(session.started_at).toZonedDateTimeISO(zone).toPlainDate().toString() === date);
    return {
      date, count: done.length,
      seconds: done.reduce((sum, session) => sum + (Date.parse(session.ended_at!) - Date.parse(session.started_at)) / 1000, 0),
      running: running ? { id: running.id, startedAt: running.started_at, plannedSeconds: running.planned_seconds } : null,
    };
  }, [sessions]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (timer.current) clearTimeout(timer.current);
    // Quick edits arrive in bursts; the system's alarm list is rewritten once they settle.
    timer.current = setTimeout(() => {
      const names = new Map((projects ?? []).map((project) => [project.id, project.name]));
      void saveWidget(tasks, { habits: widgetHabits, focus: widgetFocus });
      const habitAlerts: HabitReminderInfo[] = widgetHabits.flatMap((habit) => {
        const time = overrides.habits[habit.id];
        if (!time) return [];
        const weekly = habit.cadence === 'weekly';
        return [{
          id: habit.id, name: habit.name, time, timezone: habit.timezone, doneToday: habit.progress >= habit.target_count,
          progress: (weekly ? '이번 주 ' : '오늘 ') + habit.progress + '/' + habit.target_count + '회 · 눌러서 기록',
        }];
      });
      void syncReminders(tasks, settings, {
        projectName: (task: Task) => (task.project_id ? names.get(task.project_id) : undefined),
        openSubtasks: (task: Task) => children.get(task.id)?.length ?? 0,
      }, { overrides, habits: habitAlerts });
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tasks, children, projects, settings, overrides, isLoading, widgetHabits, widgetFocus]);

  useEffect(() => {
    if (settings.enabled) void requestReminderPermission();
  }, [settings.enabled]);

  useEffect(() => listenForReminders(
    (target) => ('taskId' in target
      ? router.push({ pathname: '/task/[id]', params: { id: target.taskId } })
      : router.push({ pathname: '/habit/[id]', params: { id: target.habitId } })),
    () => void queryClient.invalidateQueries(),
  ), []);

  return null;
}
