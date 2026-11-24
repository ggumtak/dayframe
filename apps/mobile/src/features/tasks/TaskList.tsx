import { router } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Checkbox } from '@/components/Checkbox';
import { SortableList } from '@/components/SortableList';
import { TaskRow } from '@/components/TaskRow';
import { useProjects, useSubtaskProgress, useTagNames, useTaskIndex } from '@/data/tasks';
import { AiBreakdownSheet } from '@/features/ai';
import { haptic } from '@/lib/haptics';
import type { Task } from '@/lib/shared';
import type { SubtaskProgress } from '@/lib/smart';
import { space, type, useTheme } from '@/theme';

import { type ProjectMeta, useProjectMetaMap } from './projectMeta';
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

/** Everything the rows of a task list share: lookups, row callbacks and the inline-subtask state. */
export interface TaskListModel {
  children: Map<string, Task[]>;
  completedChildren: Map<string, Task[]>;
  progress: Map<string, SubtaskProgress>;
  projectNames: Map<string, string>;
  projectMeta: Record<string, ProjectMeta>;
  tagNames: Map<string, string[]>;
  expanded: Set<string>;
  open: (task: Task) => void;
  toggleSubtasks: (task: Task) => void;
  complete: (task: Task) => void;
  remove: (task: Task) => void;
  reopen: (task: Task) => void;
  reorder: (vars: { id: string; position: number }[]) => void;
  setScheduling: (task: Task | null) => void;
  setMenu: (task: Task | null) => void;
}

/** Which task the date sheet or the long-press menu is open for. */
export interface TaskListSheetState {
  scheduling: Task | null;
  menu: Task | null;
  setScheduling: (task: Task | null) => void;
  setMenu: (task: Task | null) => void;
  reschedule: ReturnType<typeof useTaskFlow>['reschedule'];
}

/**
 * The data and state behind task rows. A screen that shows several lists (the grouped Today tab) calls
 * this once and hands the model to each `TaskRows`, so the query subscriptions and the two sheets are not
 * repeated per list. The model only changes when its data does, so memoised rows stay put on re-renders.
 */
export function useTaskListModel(): { model: TaskListModel; sheets: TaskListSheetState } {
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
  const { complete, remove, reopen, reorder, reschedule } = flow;
  const model = useMemo<TaskListModel>(() => ({
    children, completedChildren, progress, projectNames, projectMeta, tagNames, expanded,
    open, toggleSubtasks, complete, remove, reopen, reorder, setScheduling, setMenu,
  }), [children, completedChildren, progress, projectNames, projectMeta, tagNames, expanded, open, toggleSubtasks, complete, remove, reopen, reorder]);
  const sheets = useMemo<TaskListSheetState>(
    () => ({ scheduling, menu, setScheduling, setMenu, reschedule }),
    [scheduling, menu, reschedule],
  );
  return { model, sheets };
}

/** The date sheet, long-press menu and AI로 쪼개기 for lists driven by `useTaskListModel`; renders nothing while all are closed. */
export function TaskListSheets({ sheets, onStartSelect }: { sheets: TaskListSheetState; onStartSelect?: (task: Task) => void }) {
  const { scheduling, menu, setScheduling, setMenu, reschedule } = sheets;
  const [breakdown, setBreakdown] = useState<Task | null>(null);
  return (
    <>
      <ScheduleSheet task={scheduling} onClose={() => setScheduling(null)} onPick={reschedule} />
      <TaskMenu task={menu} onClose={() => setMenu(null)} onSchedule={setScheduling} onStartSelect={onStartSelect} onBreakdown={setBreakdown} />
      {breakdown ? <AiBreakdownSheet task={breakdown} visible onClose={() => setBreakdown(null)} /> : null}
    </>
  );
}

export interface TaskRowsProps {
  model: TaskListModel;
  tasks: Task[];
  hideDate?: boolean;
  /** Leaves the project name off each row, for lists already grouped by project. */
  hideProject?: boolean;
  /** Long-press rows to drag them into a new order (for lists sorted by position). */
  sortable?: boolean;
  /** When provided, the list enters multi-select mode for batch editing. */
  selectedIds?: Set<string> | null;
  onToggleSelect?: (task: Task) => void;
  /** Rows sit on a card (`colors.surface`) rather than on the page background. */
  onSurface?: boolean;
}

/** The rows of a task list without its sheets; see `useTaskListModel`. */
export const TaskRows = memo(function TaskRows({
  model, tasks, hideDate, hideProject, sortable, selectedIds, onToggleSelect, onSurface,
}: TaskRowsProps) {
  const { colors } = useTheme();
  const {
    children, completedChildren, progress, projectNames, projectMeta, tagNames, expanded,
    open, toggleSubtasks, complete, remove, reopen, reorder, setScheduling, setMenu,
  } = model;
  const selecting = selectedIds !== null && selectedIds !== undefined;
  const allowSort = !!sortable && !selecting;
  const rowBackground = onSurface ? colors.surface : colors.background;

  const row = (task: Task, nested = false) => {
    const openSubtasks = children.get(task.id) ?? [];
    const doneSubtasks = completedChildren.get(task.id) ?? [];
    const subProgress = progress.get(task.id);
    const hasAnySubtasks = openSubtasks.length + doneSubtasks.length > 0;
    const isExpanded = !nested && !selecting && expanded.has(task.id) && hasAnySubtasks;
    const projectId = hideProject ? null : task.project_id;
    const projMeta = projectId ? projectMeta[projectId] : undefined;
    return (
      <View>
        <TaskRow
          task={task} hideDate={hideDate} projectName={projectId ? projectNames.get(projectId) : undefined}
          projectIcon={projMeta?.icon}
          tagNames={tagNames.get(task.id)} subtaskProgress={subProgress}
          subtasksExpanded={isExpanded} onToggleSubtasks={!nested && !selecting && hasAnySubtasks ? toggleSubtasks : undefined}
          selectable={selecting && !nested} selected={selecting ? selectedIds.has(task.id) : false}
          onToggleSelect={onToggleSelect}
          onPress={open} onComplete={complete} onSchedule={setScheduling} onDelete={remove}
          onLongPress={allowSort && !nested ? undefined : setMenu} holdHandled={allowSort && !nested}
          swipeEnabled={!selecting} onSurface={onSurface} />
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
                  reopen(child);
                }}
                style={({ pressed }) => [styles.doneSubRow, { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
                <Checkbox checked done size={19} onPress={() => reopen(child)} label={child.title + ' 완료 해제'} />
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

  if (allowSort) {
    return (
      <SortableList
        items={tasks} keyOf={(task) => task.id} renderItem={row}
        onReorder={(ordered, moved) => reorder(positionsFor(ordered, moved))} onHold={setMenu} />
    );
  }
  return (
    <>
      {tasks.map((task) => (
        <Animated.View
          key={task.id} layout={LinearTransition.duration(180)} entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)}
          style={{ backgroundColor: rowBackground }}>
          {row(task)}
        </Animated.View>
      ))}
    </>
  );
});

/** Task rows with their gestures wired up: tap to open, swipe to complete, reschedule or delete, plus multi-select. */
export const TaskList = memo(function TaskList({
  tasks, hideDate, hideProject, sortable, selectedIds, onToggleSelect, onStartSelect,
}: {
  tasks: Task[];
  hideDate?: boolean;
  /** Leaves the project name off each row, for lists already grouped by project. */
  hideProject?: boolean;
  /** Long-press rows to drag them into a new order (for lists sorted by position). */
  sortable?: boolean;
  /** When provided, the list enters multi-select mode for batch editing. */
  selectedIds?: Set<string> | null;
  onToggleSelect?: (task: Task) => void;
  /** Offered in the long-press menu to enter multi-select starting from that task. */
  onStartSelect?: (task: Task) => void;
}) {
  const { model, sheets } = useTaskListModel();
  return (
    <View>
      <TaskRows
        model={model} tasks={tasks} hideDate={hideDate} hideProject={hideProject} sortable={sortable}
        selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
      <TaskListSheets sheets={sheets} onStartSelect={onStartSelect} />
    </View>
  );
});

const styles = StyleSheet.create({
  doneSubRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingRight: space.lg,
    paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
