import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Checkbox } from '@/components/Checkbox';
import { SortableList } from '@/components/SortableList';
import { TaskRow } from '@/components/TaskRow';
import { useProjects, useSubtaskProgress, useTagNames, useTaskIndex } from '@/data/tasks';
import { haptic } from '@/lib/haptics';
import type { Task } from '@/lib/shared';
import { space, type, useTheme } from '@/theme';

import { useProjectMetaMap } from './projectMeta';
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

/** Task rows with their gestures wired up: tap to open, swipe to complete, reschedule or delete, plus multi-select. */
export function TaskList({
  tasks, hideDate, sortable, selectedIds, onToggleSelect, onStartSelect,
}: {
  tasks: Task[];
  hideDate?: boolean;
  /** Long-press rows to drag them into a new order (for lists sorted by position). */
  sortable?: boolean;
  /** When provided, the list enters multi-select mode for batch editing. */
  selectedIds?: Set<string> | null;
  onToggleSelect?: (task: Task) => void;
  /** Offered in the long-press menu to enter multi-select starting from that task. */
  onStartSelect?: (task: Task) => void;
}) {
  const { colors } = useTheme();
  const flow = useTaskFlow();
  const { children } = useTaskIndex();
  const { completedChildren, progress } = useSubtaskProgress();
  const { data: projects } = useProjects();
  const projectMeta = useProjectMetaMap();
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

  const selecting = selectedIds !== null && selectedIds !== undefined;
  const allowSort = !!sortable && !selecting;

  const row = (task: Task, nested = false) => {
    const openSubtasks = children.get(task.id) ?? [];
    const doneSubtasks = completedChildren.get(task.id) ?? [];
    const subProgress = progress.get(task.id);
    const hasAnySubtasks = openSubtasks.length + doneSubtasks.length > 0;
    const isExpanded = !nested && !selecting && expanded.has(task.id) && hasAnySubtasks;
    const projMeta = task.project_id ? projectMeta[task.project_id] : undefined;
    return (
      <View>
        <TaskRow
          task={task} hideDate={hideDate} projectName={task.project_id ? projectNames.get(task.project_id) : undefined}
          projectColor={projMeta?.color} projectIcon={projMeta?.icon}
          tagNames={tagNames.get(task.id)} subtaskProgress={subProgress}
          subtasksExpanded={isExpanded} onToggleSubtasks={!nested && !selecting && hasAnySubtasks ? toggleSubtasks : undefined}
          selectable={selecting && !nested} selected={selecting ? selectedIds.has(task.id) : false}
          onToggleSelect={onToggleSelect}
          onPress={open} onComplete={flow.complete} onSchedule={setScheduling} onDelete={flow.remove}
          onLongPress={allowSort && !nested ? undefined : setMenu} holdHandled={allowSort && !nested}
          swipeEnabled={!selecting} />
        {isExpanded ? (
          <View style={{ marginLeft: 28, borderLeftWidth: 1.5, borderLeftColor: colors.border }}>
            {openSubtasks.map((child) => (
              <View key={child.id}>{row(child, true)}</View>
            ))}
            {doneSubtasks.map((child) => (
              <Pressable
                key={child.id} accessibilityRole="button" accessibilityLabel={child.title + ' 다시 열기'}
                onPress={() => {
                  haptic.tap();
                  flow.reopen(child);
                }}
                style={({ pressed }) => [styles.doneSubRow, { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
                <Checkbox checked size={19} color={colors.success} onPress={() => flow.reopen(child)} label={child.title + ' 완료 해제'} />
                <Text numberOfLines={1} style={[type.small as TextStyle, { color: colors.textFaint, textDecorationLine: 'line-through', flex: 1 }]}>
                  {child.title}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View>
      {allowSort ? (
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
      <TaskMenu task={menu} onClose={() => setMenu(null)} onSchedule={setScheduling} onStartSelect={onStartSelect} />
    </View>
  );
}

const styles = StyleSheet.create({
  doneSubRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingRight: space.lg,
    paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
