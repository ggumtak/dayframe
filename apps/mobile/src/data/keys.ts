export const keys = {
  me: ['me'] as const,
  projects: ['projects'] as const,
  tags: ['tags'] as const,
  tasks: ['tasks', 'open'] as const,
  taskTags: ['task-tags'] as const,
  habits: ['habits'] as const,
  habitLogs: (id: string) => ['habit-logs', id] as const,
  habitStats: (id: string) => ['habit-stats', id] as const,
  focus: ['focus-sessions'] as const,
  update: ['app-update'] as const,
};

/** Mutation keys double as the lookup for defaults, so queued writes survive an app restart. */
export const writes = {
  createTask: ['write', 'task', 'create'] as const,
  updateTask: ['write', 'task', 'update'] as const,
  completeTask: ['write', 'task', 'complete'] as const,
  reopenTask: ['write', 'task', 'reopen'] as const,
  deleteTask: ['write', 'task', 'delete'] as const,
  reorderTasks: ['write', 'task', 'reorder'] as const,
  rescheduleOverdue: ['write', 'task', 'reschedule-overdue'] as const,
  setTaskTags: ['write', 'task', 'tags'] as const,
  createHabit: ['write', 'habit', 'create'] as const,
  updateHabit: ['write', 'habit', 'update'] as const,
  deleteHabit: ['write', 'habit', 'delete'] as const,
  setHabitLog: ['write', 'habit', 'log'] as const,
  startFocus: ['write', 'focus', 'start'] as const,
  finishFocus: ['write', 'focus', 'finish'] as const,
};
