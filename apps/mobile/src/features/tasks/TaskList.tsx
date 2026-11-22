import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { SortableList } from '@/components/SortableList';
import { TaskRow } from '@/components/TaskRow';
import { useProjects, useTagNames, useTaskIndex } from '@/data/tasks';
import type { Task } from '@/lib/shared';
import { useTheme } from '@/theme';

import { ScheduleSheet } from './ScheduleSheet';
import { TaskMenu } from './TaskMenu';
import { useTaskFlow } from './useTaskFlow';

/** Positions that put `ordered` in sequence, touching as few tasks as possible. */
export function positionsFor(ordered: Task[], moved: Task): { id: string; position: number }[] {
  const index = ordered.findIndex((task) => task.id === moved.id);
  const others = ordered.filter((task) => task.id !== moved.id);
  const increasing = others.every((task, at) => at === 0 || others[at - 1].position < task.position);
  const before = ordered[index - 1]?.position;
  const after = ordered[index + 1]?.position;
  if (increasing && (before !== undefined || after !== undefined)) {
    const low = before ?? after! - 2048;
    const high = after ?? before! + 2048;
    const middle = Math.floor((low + high) / 2);
    if (middle > low && middle < high) return [{ id: moved.id, position: middle }];
  }
  // No room between the neighbours (or the list was never ordered): renumber with gaps.
  return ordered
    .map((task, at) => ({ id: task.id, position: (at + 1) * 1024, previous: task.position }))
    .filter((item) => item.position !== item.previous)
    .map(({ id, position }) => ({ id, position }));
}

/** Task rows with their gestures wired up: tap to open, swipe to complete, reschedule or delete. */
export function TaskList({ tasks, hideDate, sortable }: {
  tasks: Task[];
  hideDate?: boolean;
  /** Long-press rows to drag them into a new order (for lists sorted by position). */
  sortable?: boolean;
}) {
  const { colors } = useTheme();
  const flow = useTaskFlow();
  const { children } = useTaskIndex();
  const { data: projects } = useProjects();
  const tagNames = useTagNames();
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [menu, setMenu] = useState<Task | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const projectNames = useMemo(() => new Map((projects ?? []).map((project) => [project.id, project.name])), [projects]);
  const open = useCallback((task: Task) => router.push({ pathname: '/task/[id]', params: { id: task.id } }), []);
  const toggleSubtasks = useCallback((task: Task) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  }, []);

  const row = (task: Task, nested = false) => {
    const subtasks = children.get(task.id) ?? [];
    const isExpanded = !nested && expanded.has(task.id) && subtasks.length > 0;
    return (
      <View>
        <TaskRow
          task={task} hideDate={hideDate} projectName={task.project_id ? projectNames.get(task.project_id) : undefined}
          tagNames={tagNames.get(task.id)} subtaskCount={subtasks.length || undefined}
          subtasksExpanded={isExpanded} onToggleSubtasks={!nested && subtasks.length ? toggleSubtasks : undefined}
          onPress={open} onComplete={flow.complete} onSchedule={setScheduling} onDelete={flow.remove}
          onLongPress={sortable && !nested ? undefined : setMenu} holdHandled={sortable && !nested} />
        {isExpanded ? (
          <View style={{ marginLeft: 28, borderLeftWidth: 1.5, borderLeftColor: colors.border }}>
            {subtasks.map((child) => (
              <View key={child.id}>{row(child, true)}</View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View>
      {sortable ? (
        <SortableList
          items={tasks} keyOf={(task) => task.id} renderItem={row}
          onReorder={(ordered, moved) => flow.reorder(positionsFor(ordered, moved))} onHold={setMenu} />
      ) : tasks.map((task) => (
        <Animated.View
          key={task.id} layout={LinearTransition.duration(180)} entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)}
          style={{ backgroundColor: colors.background }}>
          {row(task)}
        </Animated.View>
      ))}
      <ScheduleSheet task={scheduling} onClose={() => setScheduling(null)} onPick={flow.reschedule} />
      <TaskMenu task={menu} onClose={() => setMenu(null)} onSchedule={setScheduling} />
    </View>
  );
}
