import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, type TextInputInstance, type TextStyle, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig, LinearTransition } from 'react-native-reanimated';

import { Checkbox } from '@/components/Checkbox';
import { SortableList } from '@/components/SortableList';
import { TaskRow } from '@/components/TaskRow';
import { nextPosition, useProjects, useSubtaskProgress, useTagNames, useTaskIndex } from '@/data/tasks';
import { AiBreakdownSheet } from '@/features/ai';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { taskReminderBadge } from '@/features/reminders/lead';
import { type ReminderOverrides, useReminderOverrides } from '@/features/reminders/overrides';
import type { ReminderSettings } from '@/features/reminders/plan';
import { useReminderSettings } from '@/features/reminders/settings';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { deviceTimeZone, logicalToday } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Task } from '@/lib/shared';
import type { SubtaskProgress } from '@/lib/smart';
import { radius, space, type, useTheme } from '@/theme';

import { useDailyFocus } from './mitStore';
import { type ProjectMeta, useProjectMetaMap } from './projectMeta';
import { ScheduleSheet } from './ScheduleSheet';
import { TaskMenu } from './TaskMenu';
import { useTaskFlow } from './useTaskFlow';

// Persist expanded subtask parent IDs across view switches (e.g. Today 목록 ↔ 타임라인).
let expandedSnapshot = new Set<string>();
const expandedListeners = new Set<() => void>();

function toggleExpandedParent(id: string) {
  const next = new Set(expandedSnapshot);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedSnapshot = next;
  expandedListeners.forEach((listener) => listener());
}

function subscribeExpanded(listener: () => void) {
  expandedListeners.add(listener);
  return () => { expandedListeners.delete(listener); };
}

const getExpandedSnapshot = () => expandedSnapshot;

// Intern active reminder badge objects so memo(TaskRow) is never defeated by fresh literal instances on Android.
const reminderBadgePool = new Map<string, { active: boolean; label?: string }>();
function internReminderBadge(badge: { active: boolean; label?: string } | undefined): { active: boolean; label?: string } | undefined {
  if (!badge?.active) return undefined;
  const key = badge.label ?? '';
  let cached = reminderBadgePool.get(key);
  if (!cached) {
    cached = badge.label ? { active: true, label: badge.label } : { active: true };
    reminderBadgePool.set(key, cached);
  }
  return cached;
}

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
  reminderSettings: ReminderSettings;
  reminderOverrides: ReminderOverrides;
  expanded: Set<string>;
  isMit?: (taskId: string) => boolean;
  isEvening?: (taskId: string) => boolean;
  open: (task: Task) => void;
  toggleSubtasks: (task: Task) => void;
  addSubtask: (task: Task) => void;
  createSubtask?: (parent: Task, title: string, siblings: Task[]) => void;
  complete: (task: Task) => void;
  postpone?: (task: Task) => void;
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

export function useTaskListModel(): { model: TaskListModel; sheets: TaskListSheetState } {
  const flow = useTaskFlow();
  const quickAdd = useQuickAdd();
  const prefs = usePersonalPrefs();
  const logicalDate = logicalToday(deviceTimeZone(), prefs.dayStartHour).toString();
  const dailyFocus = useDailyFocus(logicalDate);
  const { children } = useTaskIndex();
  const { completedChildren, progress } = useSubtaskProgress();
  const { data: projects } = useProjects();
  const projectMeta = useProjectMetaMap();
  const tagNames = useTagNames();
  const reminderSettings = useReminderSettings();
  const reminderOverrides = useReminderOverrides();
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [menu, setMenu] = useState<Task | null>(null);
  const expanded = useSyncExternalStore(subscribeExpanded, getExpandedSnapshot, getExpandedSnapshot);
  const projectNames = useMemo(() => new Map((projects ?? []).map((project) => [project.id, project.name])), [projects]);
  const open = useCallback((task: Task) => router.push({ pathname: '/task/[id]', params: { id: task.id } }), []);
  const toggleSubtasks = useCallback((task: Task) => {
    toggleExpandedParent(task.id);
  }, []);
  const addSubtask = useCallback((task: Task) => {
    quickAdd.open({ parentTaskId: task.id });
  }, [quickAdd]);
  const { create, complete, postpone, remove, reopen, reorder, reschedule } = flow;
  const createSubtask = useCallback((parent: Task, title: string, siblings: Task[]) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    create({
      input: {
        title: trimmed,
        parent_task_id: parent.id,
        timezone: parent.timezone,
        position: nextPosition(siblings),
      },
    });
  }, [create]);
  const { isMit, isEvening } = dailyFocus;
  const model = useMemo<TaskListModel>(() => ({
    children, completedChildren, progress, projectNames, projectMeta, tagNames,
    reminderSettings, reminderOverrides, expanded, isMit, isEvening,
    open, toggleSubtasks, addSubtask, createSubtask, complete, postpone, remove, reopen, reorder, setScheduling, setMenu,
  }), [
    children, completedChildren, progress, projectNames, projectMeta, tagNames,
    reminderSettings, reminderOverrides, expanded, isMit, isEvening,
    open, toggleSubtasks, addSubtask, createSubtask, complete, postpone, remove, reopen, reorder,
  ]);
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

const InlineSubtaskAdd = memo(function InlineSubtaskAdd({
  parentTask, openSubtasks, onSubmit, onFallbackModal, isLast,
}: {
  parentTask: Task;
  openSubtasks: Task[];
  onSubmit?: (parent: Task, title: string, siblings: Task[]) => void;
  onFallbackModal: (parent: Task) => void;
  isLast?: boolean;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInputInstance>(null);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    haptic.tap();
    if (onSubmit) {
      onSubmit(parentTask, trimmed, openSubtasks);
    } else {
      onFallbackModal(parentTask);
    }
    setDraft('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <View
      style={[
        styles.addSubRow,
        {
          borderBottomColor: colors.border,
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
        },
      ]}>
      <Feather name="plus" size={14} color={colors.textFaint} />
      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={setDraft}
        placeholder="하위 작업 바로 추가..."
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={parentTask.title + '에 하위 작업 추가'}
        returnKeyType="done"
        submitBehavior="submit"
        onSubmitEditing={commit}
        maxLength={300}
        style={[type.small as TextStyle, styles.addSubInput, { color: colors.text }]} />
      {draft.trim().length > 0 ? (
        <Pressable
          accessibilityRole="button" accessibilityLabel="하위 작업 저장" hitSlop={8} onPress={commit}
          style={({ pressed }) => [styles.addSubSubmit, { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.6 : 1 }]}>
          <Feather name="corner-down-left" size={13} color={colors.accentText} />
        </Pressable>
      ) : null}
    </View>
  );
});

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
  /** Task currently highlighted by keyboard navigation. */
  focusedTaskId?: string | null;
}

/** The rows of a task list without its sheets; see `useTaskListModel`. */
export const TaskRows = memo(function TaskRows({
  model, tasks, hideDate, hideProject, sortable, selectedIds, onToggleSelect, onSurface, focusedTaskId,
}: TaskRowsProps) {
  const { colors } = useTheme();
  const {
    children, completedChildren, progress, projectNames, projectMeta, tagNames,
    reminderSettings, reminderOverrides, expanded, isMit, isEvening,
    open, toggleSubtasks, addSubtask, createSubtask, complete, postpone, remove, reopen, reorder, setScheduling, setMenu,
  } = model;
  const [expandedDone, setExpandedDone] = useState<Set<string>>(() => new Set());
  const selecting = selectedIds !== null && selectedIds !== undefined;
  const allowSort = !!sortable && !selecting;
  const rowBackground = onSurface ? colors.surface : colors.background;

  const toggleDoneSubtasks = useCallback((parentId: string) => {
    haptic.tap();
    setExpandedDone((current) => {
      const next = new Set(current);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }, []);

  // Memoize Android reminder badges once per list update so memo(TaskRow) keeps hit rate high.
  const reminderBadges = useMemo(() => {
    if (Platform.OS !== 'android') return null;
    const map = new Map<string, { active: boolean; label?: string } | undefined>();
    const record = (t: Task) => {
      const badge = internReminderBadge(taskReminderBadge(t, reminderSettings, reminderOverrides.tasks[t.id]));
      if (badge) map.set(t.id, badge);
    };
    for (const task of tasks) {
      record(task);
      const subs = children.get(task.id);
      if (subs) {
        for (const child of subs) record(child);
      }
    }
    return map;
  }, [tasks, children, reminderSettings, reminderOverrides]);

  const renderTask = (task: Task, isLastRow: boolean, nested = false) => {
    const openSubtasks = children.get(task.id) ?? [];
    const doneSubtasks = completedChildren.get(task.id) ?? [];
    const subProgress = progress.get(task.id);
    const hasAnySubtasks = openSubtasks.length + doneSubtasks.length > 0;
    const isExpanded = !nested && !selecting && expanded.has(task.id) && hasAnySubtasks;
    const projectId = hideProject ? null : task.project_id;
    const projMeta = projectId ? projectMeta[projectId] : undefined;
    const reminder = reminderBadges?.get(task.id);
    const collapseDone = doneSubtasks.length > 2 && !expandedDone.has(task.id);
    return (
      <View>
        <TaskRow
          task={task} hideDate={hideDate} isLast={isLastRow && !isExpanded}
          isMit={!nested && isMit ? isMit(task.id) : false}
          isEvening={!nested && isEvening ? isEvening(task.id) : false}
          projectName={projectId ? projectNames.get(projectId) : undefined}
          projectIcon={projMeta?.icon}
          tagNames={tagNames.get(task.id)} reminderBadge={reminder} subtaskProgress={subProgress}
          subtasksExpanded={isExpanded} onToggleSubtasks={!nested && !selecting && hasAnySubtasks ? toggleSubtasks : undefined}
          selectable={selecting && !nested} selected={selecting ? selectedIds.has(task.id) : false}
          onToggleSelect={onToggleSelect}
          onPress={open} onComplete={complete} onSchedule={setScheduling} onPostpone={postpone} onDelete={remove}
          onLongPress={allowSort && !nested ? undefined : setMenu} holdHandled={allowSort && !nested}
          swipeEnabled={!selecting} onSurface={onSurface} focused={focusedTaskId === task.id} />
        {isExpanded ? (
          <View style={{ marginLeft: 28, borderLeftWidth: 1.5, borderLeftColor: colors.border }}>
            {openSubtasks.map((child) => (
              <View key={child.id}>{renderTask(child, false, true)}</View>
            ))}
            {collapseDone ? (
              <Pressable
                accessibilityRole="button" accessibilityLabel={`완료한 하위 작업 ${doneSubtasks.length}개 보기`}
                onPress={() => toggleDoneSubtasks(task.id)}
                style={({ pressed }) => [styles.doneToggleRow, { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
                <Feather name="chevron-down" size={14} color={colors.textFaint} />
                <Text style={[type.metaStrong as TextStyle, { color: colors.textMuted }]}>완료 {doneSubtasks.length}개 보기</Text>
              </Pressable>
            ) : (
              <>
                {doneSubtasks.map((child) => (
                  <Pressable
                    key={child.id} accessibilityRole="button" accessibilityLabel={child.title + ' 완료 해제'}
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
                {doneSubtasks.length > 2 ? (
                  <Pressable
                    accessibilityRole="button" accessibilityLabel="완료한 하위 작업 접기"
                    onPress={() => toggleDoneSubtasks(task.id)}
                    style={({ pressed }) => [styles.doneToggleRow, { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
                    <Feather name="chevron-up" size={14} color={colors.textFaint} />
                    <Text style={[type.metaStrong as TextStyle, { color: colors.textMuted }]}>완료 {doneSubtasks.length}개 접기</Text>
                  </Pressable>
                ) : null}
              </>
            )}
            <InlineSubtaskAdd
              parentTask={task}
              openSubtasks={openSubtasks}
              onSubmit={createSubtask}
              onFallbackModal={addSubtask}
              isLast={isLastRow} />
          </View>
        ) : null}
      </View>
    );
  };

  if (allowSort) {
    return (
      <SortableList
        items={tasks} keyOf={(task) => task.id}
        renderItem={(task, index) => renderTask(task, index === tasks.length - 1)}
        onReorder={(ordered, moved) => reorder(positionsFor(ordered, moved))} onHold={setMenu} />
    );
  }
  return (
    <LayoutAnimationConfig skipEntering skipExiting>
      <View>
        {tasks.map((task, index) => (
          <Animated.View
            key={task.id} layout={LinearTransition.duration(180)} entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)}
            style={{ backgroundColor: rowBackground }}>
            {renderTask(task, index === tasks.length - 1)}
          </Animated.View>
        ))}
      </View>
    </LayoutAnimationConfig>
  );
});

/** Task rows with their gestures wired up: tap to open, swipe to complete, reschedule or delete, plus multi-select. */
export const TaskList = memo(function TaskList({
  tasks, hideDate, hideProject, sortable, selectedIds, onToggleSelect, onStartSelect, focusedTaskId,
}: {
  tasks: Task[];
  hideDate?: boolean;
  hideProject?: boolean;
  sortable?: boolean;
  selectedIds?: Set<string> | null;
  onToggleSelect?: (task: Task) => void;
  onStartSelect?: (task: Task) => void;
  focusedTaskId?: string | null;
}) {
  const { model, sheets } = useTaskListModel();
  return (
    <View>
      <TaskRows
        model={model} tasks={tasks} hideDate={hideDate} hideProject={hideProject} sortable={sortable}
        selectedIds={selectedIds} onToggleSelect={onToggleSelect} focusedTaskId={focusedTaskId} />
      <TaskListSheets sheets={sheets} onStartSelect={onStartSelect} />
    </View>
  );
});

const styles = StyleSheet.create({
  doneSubRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingRight: space.lg,
    paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  doneToggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.lg,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addSubRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.lg,
    minHeight: 38, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addSubInput: { flex: 1, paddingVertical: 4 },
  addSubSubmit: {
    width: 28, height: 28, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
  },
});
