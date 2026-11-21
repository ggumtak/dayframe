import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { queryClient } from '@/data/client';
import { useProjects, useTaskIndex } from '@/data/tasks';
import { saveWidget } from '@/features/widget/render';
import type { Task } from '@/lib/shared';

import { listenForReminders, requestReminderPermission, syncReminders } from './notify';
import { useReminderSettings } from './settings';

/**
 * Keeps what lives outside the app in step with the task list while someone is signed in: the alerts
 * the system holds and the home-screen widget. Renders nothing.
 */
export function BackgroundSync() {
  const { tasks, children, isLoading } = useTaskIndex();
  const { data: projects } = useProjects();
  const settings = useReminderSettings();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (timer.current) clearTimeout(timer.current);
    // Quick edits arrive in bursts; the system's alarm list is rewritten once they settle.
    timer.current = setTimeout(() => {
      const names = new Map((projects ?? []).map((project) => [project.id, project.name]));
      void saveWidget(tasks);
      void syncReminders(tasks, settings, {
        projectName: (task: Task) => (task.project_id ? names.get(task.project_id) : undefined),
        openSubtasks: (task: Task) => children.get(task.id)?.length ?? 0,
      });
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tasks, children, projects, settings, isLoading]);

  useEffect(() => {
    if (settings.enabled) void requestReminderPermission();
  }, [settings.enabled]);

  useEffect(() => listenForReminders(
    (taskId) => router.push({ pathname: '/task/[id]', params: { id: taskId } }),
    () => void queryClient.invalidateQueries(),
  ), []);

  return null;
}
