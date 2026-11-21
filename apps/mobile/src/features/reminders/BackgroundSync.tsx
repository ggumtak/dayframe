import { useQueries } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { queryClient } from '@/data/client';
import { useFocusSessions } from '@/data/focus';
import { keys } from '@/data/keys';
import { periodProgress, useHabits } from '@/data/habits';
import { useProjects, useTaskIndex, useTasks } from '@/data/tasks';
import { onExternalChange } from '@/features/widget/events';
import { CALENDAR_RANGE, type WidgetFocus, type WidgetHabit } from '@/features/widget/items';
import { saveWidget } from '@/features/widget/render';
import { api } from '@/lib/api';
import { deviceTimeZone, Temporal, today, weekStart } from '@/lib/dates';
import { countByDate } from '@/lib/occurrences';
import { type Habit, type HabitLog, nextOccurrence, type Task } from '@/lib/shared';

import { type HabitReminderInfo, listenForReminders, requestReminderPermission, syncReminders } from './notify';
import { useReminderOverrides } from './overrides';
import { useReminderSettings } from './settings';

function habitFigures(habit: Habit, logs: HabitLog[]): WidgetHabit {
  const date = today(habit.timezone).toString();
  return {
    id: habit.id, name: habit.name, cadence: habit.cadence, target_count: habit.target_count, timezone: habit.timezone, date,
    todayCount: logs.find((log) => log.log_date === date)?.count ?? 0, progress: periodProgress(habit, logs, date),
  };
}

function focusFigures(sessions: { id: string; status: string; started_at: string; ended_at: string | null; planned_seconds: number }[]): WidgetFocus {
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
}

/**
 * Keeps what lives outside the app in step with its data while someone is signed in: the alerts the system
 * holds and the home-screen widgets. Renders nothing.
 */
export function BackgroundSync() {
  const { tasks, children } = useTaskIndex();
  // Nothing is synced until the task list has really loaded; an empty list would withdraw every alert.
  const loaded = useTasks().data !== undefined;
  const { data: projects } = useProjects();
  const settings = useReminderSettings();
  const overrides = useReminderOverrides();
  const { data: allHabits } = useHabits();
  const habits = (allHabits ?? []).filter((habit) => !habit.archived_at);
  const habitLogs = useQueries({
    queries: habits.map((habit) => ({ queryKey: keys.habitLogs(habit.id), queryFn: () => api.habitLogs(habit.id) })),
  });
  const { data: sessions } = useFocusSessions();

  // Figures for the widgets and habit alerts. Data still loading is left out (undefined), never written as empty.
  const habitsReady = allHabits !== undefined && habitLogs.every((query) => query.data !== undefined);
  const widgetHabits = habitsReady ? habits.map((habit, index) => habitFigures(habit, habitLogs[index].data!)) : undefined;
  const widgetFocus = sessions ? focusFigures(sessions) : undefined;

  // Rendering happens often; the work below runs only when what it writes would actually differ.
  const signature = JSON.stringify([tasks.map((task) => [task.id, task.updated_at, task.due_at]), [...children].map(([id, list]) => [id, list.length]),
    projects?.map((project) => [project.id, project.name]), settings, overrides, widgetHabits, widgetFocus, today(deviceTimeZone()).toString()]);
  const latest = useRef({ tasks, children, projects, settings, overrides, widgetHabits, widgetFocus });
  useEffect(() => {
    latest.current = { tasks, children, projects, settings, overrides, widgetHabits, widgetFocus };
  });

  useEffect(() => {
    if (!loaded) return;
    // Quick edits arrive in bursts; the system's alarm list is rewritten once they settle.
    const timer = setTimeout(() => {
      const { tasks: list, children: kids, projects: groups, settings: options, overrides: own, widgetHabits: habitRows, widgetFocus: focus } = latest.current;
      const names = new Map((groups ?? []).map((project) => [project.id, project.name]));
      const month = today(deviceTimeZone()).toPlainYearMonth();
      const end = month.add({ months: CALENDAR_RANGE.ahead });
      const calendar = countByDate(list, month.subtract({ months: CALENDAR_RANGE.back }).toPlainDate({ day: 1 }),
        end.toPlainDate({ day: end.daysInMonth }), nextOccurrence);
      void saveWidget(list, { habits: habitRows, focus, calendar });

      const habitAlerts: HabitReminderInfo[] | undefined = habitRows?.flatMap((habit) => {
        const time = own.habits[habit.id];
        if (!time) return [];
        const weekly = habit.cadence === 'weekly';
        const day = Temporal.PlainDate.from(habit.date);
        const met = habit.progress >= habit.target_count;
        return [{
          id: habit.id, name: habit.name, time, timezone: habit.timezone,
          doneThrough: met ? (weekly ? weekStart(day).add({ days: 6 }).toString() : habit.date) : null,
          progress: (weekly ? '이번 주 ' : '오늘 ') + habit.progress + '/' + habit.target_count + '회 · 눌러서 기록',
        }];
      });
      void syncReminders(list, options, {
        projectName: (task: Task) => (task.project_id ? names.get(task.project_id) : undefined),
        openSubtasks: (task: Task) => kids.get(task.id)?.length ?? 0,
      }, { overrides: own, habits: habitAlerts });
    }, 800);
    return () => clearTimeout(timer);
  }, [loaded, signature]);

  useEffect(() => {
    if (settings.enabled) void requestReminderPermission();
  }, [settings.enabled]);

  // A widget tap or a notification button changed data behind the app's back: reload it.
  useEffect(() => onExternalChange(() => void queryClient.invalidateQueries()), []);

  useEffect(() => listenForReminders(
    (target) => ('taskId' in target
      ? router.push({ pathname: '/task/[id]', params: { id: target.taskId } })
      : router.push({ pathname: '/habit/[id]', params: { id: target.habitId } })),
    () => void queryClient.invalidateQueries(),
  ), []);

  return null;
}
