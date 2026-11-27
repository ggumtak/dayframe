import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AiIcon } from '@/components/AiIcon';
import { Button, Card, Chip, Txt } from '@/components/ui';
import { useHabitActions, useHabits } from '@/data/habits';
import { nextPosition, useProjects, useTaskActions, useTasks } from '@/data/tasks';
import { runAi } from '@/features/ai/client';
import { AiErrorView, AiLoading, AiScreen, KeyGate, Toggle, UsageLine } from '@/features/ai/components';
import { useAiKeyStatus } from '@/features/ai/keyStore';
import { PRIORITY_LABEL } from '@/features/ai/labels';
import { COMMAND_SYSTEM, type CommandHabitInput, type CommandTaskInput, commandUser } from '@/features/ai/prompts';
import { type CommandAction, type CommandActionKind, type CommandReply, commandSchema } from '@/features/ai/schemas';
import { nowContext, parseHHMM, parseIsoDate } from '@/features/ai/time';
import { useAiRequest } from '@/features/ai/useAiRequest';
import { KEY_PRIORITY, matchesCombo, useKeyHandler, useScreenFocused } from '@/features/keyboard';
import { leadLabel } from '@/features/reminders/lead';
import { type ReminderOverrides, setHabitReminder, setTaskReminder, useReminderOverrides } from '@/features/reminders/overrides';
import type { TimeFormat } from '@/features/settings/prefs';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { priorityMark } from '@/features/tasks/priority';
import { schedulePatch } from '@/features/tasks/useTaskFlow';
import { deviceTimeZone, dueDate, dueMinutes, formatDate, formatDurationMinutes, formatTime, instantFor, Temporal, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Habit, Task, TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { fontFamily, radius, space, useTheme } from '@/theme';

const MAX_CONTEXT_TASKS = 80;

const EXAMPLES: readonly { label: string; prompt: string }[] = [
  { label: '내일 3시 치과 · 30분 전 알람', prompt: '내일 오후 3시에 치과 예약 추가하고 30분 전 알람 맞춰줘' },
  { label: '급한 일 오후 2시로 변경', prompt: '오늘 할 일 중 가장 급한 일 시간을 오후 2시로 바꾸고 15분 전 알람 설정해줘' },
  { label: '매일 아침 8시 습관 추가', prompt: '매일 아침 물 한 잔 마시기 습관 추가하고 오전 8시 알림 맞춰줘' },
];

const KIND_LABEL: Record<CommandActionKind, string> = {
  add_task: '추가',
  update_task: '수정',
  complete_task: '완료',
  delete_task: '삭제',
  add_habit: '습관 추가',
  set_habit_reminder: '습관 알림',
};

interface DraftAction {
  key: number;
  action: CommandAction;
  include: boolean;
}

interface ActionSummary {
  title: string;
  detail: string | null;
  priority: 1 | 2 | 3 | 4 | null;
  subtasks: string[];
  danger: boolean;
}

function formatClock(hhmm: string, timeFormat: TimeFormat): string {
  const minutes = parseHHMM(hhmm);
  return minutes !== null ? formatTime(minutes, timeFormat) : hhmm;
}

function formatTaskReminder(value: number | 'off', prefix: 'lead-first' | 'alarm-first'): string {
  if (value === 'off') return '알람 끔';
  if (value === 0) return prefix === 'lead-first' ? '정시 알람' : '알람 정시';
  const label = leadLabel(value);
  return prefix === 'lead-first' ? `${label} 알람` : `알람 ${label}`;
}

function formatDateTime(dateIso: string | null, minutes: number | null, now: Temporal.PlainDate, timeFormat: TimeFormat): string | null {
  const date = parseIsoDate(dateIso);
  if (!date) return minutes !== null ? formatTime(minutes, timeFormat) : null;
  return formatDate(date, now) + (minutes !== null ? ' ' + formatTime(minutes, timeFormat) : '');
}

function describeScheduleDiff(
  action: CommandAction,
  existing: Task | undefined,
  now: Temporal.PlainDate,
  timeFormat: TimeFormat,
): string | null {
  if (action.date === 'clear') return '일정 삭제';
  if (action.date === null && action.minutes === null) return null;

  const oldDate = existing ? dueDate(existing) : null;
  const oldMinutes = existing ? dueMinutes(existing) : null;
  const nextDate = action.date ? parseIsoDate(action.date) : (oldDate ?? now);
  const nextMinutes = action.minutes === 'clear' ? null : action.minutes !== null ? action.minutes : oldMinutes;

  if (action.minutes === 'clear' && (!action.date || (oldDate && nextDate && oldDate.equals(nextDate)))) {
    return '시간 삭제 (종일)';
  }

  const sameDay = !!(oldDate && nextDate && oldDate.equals(nextDate));
  if (sameDay && oldMinutes !== null && nextMinutes !== null && oldMinutes !== nextMinutes) {
    return `${formatTime(oldMinutes, timeFormat)} → ${formatTime(nextMinutes, timeFormat)}`;
  }

  const nextLabel = nextDate
    ? formatDate(nextDate, now) + (nextMinutes !== null ? ' ' + formatTime(nextMinutes, timeFormat) : '')
    : null;
  if (!nextLabel) return null;

  const oldLabel = oldDate
    ? formatDate(oldDate, now) + (oldMinutes !== null ? ' ' + formatTime(oldMinutes, timeFormat) : '')
    : null;
  return oldLabel && oldLabel !== nextLabel ? `${oldLabel} → ${nextLabel}` : nextLabel;
}

function describeAction(
  action: CommandAction,
  context: {
    taskById: Map<string, Task>;
    habitById: Map<string, Habit>;
    overrides: ReminderOverrides;
    now: Temporal.PlainDate;
    timeFormat: TimeFormat;
  },
): ActionSummary {
  const { taskById, habitById, overrides, now, timeFormat } = context;

  if (action.kind === 'add_task') {
    const parts = [
      formatDateTime(action.date !== 'clear' ? action.date : null, typeof action.minutes === 'number' ? action.minutes : null, now, timeFormat),
      action.reminderMinutes !== null ? formatTaskReminder(action.reminderMinutes, 'lead-first') : null,
      typeof action.durationMinutes === 'number' ? formatDurationMinutes(action.durationMinutes) : null,
      action.list && action.list !== 'inbox' ? `#${action.list}` : null,
    ].filter(Boolean);
    return {
      title: action.title ?? '새 할 일',
      detail: parts.length ? parts.join(' · ') : null,
      priority: action.priority && action.priority < 4 ? action.priority : null,
      subtasks: action.subtasks,
      danger: false,
    };
  }

  if (action.kind === 'update_task') {
    const existing = action.taskId ? taskById.get(action.taskId) : undefined;
    const parts: string[] = [];
    if (action.title && existing && action.title !== existing.title) parts.push(`제목 → ${action.title}`);
    const schedule = describeScheduleDiff(action, existing, now, timeFormat);
    if (schedule) parts.push(schedule);
    if (action.reminderMinutes !== null) parts.push(formatTaskReminder(action.reminderMinutes, 'alarm-first'));
    if (action.durationMinutes === 'clear') parts.push('소요 시간 삭제');
    else if (typeof action.durationMinutes === 'number') parts.push(`소요 ${formatDurationMinutes(action.durationMinutes)}`);
    if (action.priority !== null) parts.push(PRIORITY_LABEL[action.priority]);
    if (action.list === 'inbox') parts.push('미분류');
    else if (action.list) parts.push(`#${action.list}`);
    if (action.notes !== null) parts.push('메모 변경');
    if (action.subtasks.length > 0) parts.push(`하위 작업 ${action.subtasks.length}개 추가`);
    return {
      title: existing?.title ?? action.title ?? '할 일',
      detail: parts.length ? parts.join(' · ') : null,
      priority: null,
      subtasks: action.subtasks,
      danger: false,
    };
  }

  if (action.kind === 'complete_task') {
    const existing = action.taskId ? taskById.get(action.taskId) : undefined;
    return { title: existing?.title ?? '할 일', detail: '완료 처리', priority: null, subtasks: [], danger: false };
  }

  if (action.kind === 'delete_task') {
    const existing = action.taskId ? taskById.get(action.taskId) : undefined;
    return { title: existing?.title ?? '할 일', detail: '목록에서 삭제', priority: null, subtasks: [], danger: true };
  }

  if (action.kind === 'add_habit') {
    const cadence = action.habitCadence === 'weekly' ? `주 ${action.habitTarget ?? 1}회` : `매일 ${action.habitTarget ?? 1}회`;
    const reminder = action.habitReminderTime && action.habitReminderTime !== 'off'
      ? `${formatClock(action.habitReminderTime, timeFormat)} 알림`
      : null;
    return {
      title: action.title ?? '새 습관',
      detail: [cadence, reminder].filter(Boolean).join(' · '),
      priority: null,
      subtasks: [],
      danger: false,
    };
  }

  const existing = action.habitId ? habitById.get(action.habitId) : undefined;
  const previous = existing ? overrides.habits[existing.id] : undefined;
  let detail: string | null = null;
  if (action.habitReminderTime === 'off') {
    detail = '알림 끔';
  } else if (action.habitReminderTime) {
    const nextLabel = formatClock(action.habitReminderTime, timeFormat);
    detail = previous && previous !== action.habitReminderTime
      ? `${formatClock(previous, timeFormat)} → ${nextLabel}`
      : `${nextLabel} 알림`;
  }
  return { title: existing?.name ?? '습관', detail, priority: null, subtasks: [], danger: false };
}

function ActionPreviewRow({
  draft,
  summary,
  onToggle,
}: {
  draft: DraftAction;
  summary: ActionSummary;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  const tagTextColor = summary.danger ? colors.danger : colors.textMuted;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: draft.include }}
      accessibilityLabel={`${KIND_LABEL[draft.action.kind]} ${summary.title}`}
      onPress={onToggle}
      style={[styles.row, { borderBottomColor: colors.border, opacity: draft.include ? 1 : 0.55 }]}>
      <Toggle on={draft.include} onPress={onToggle} label={`${summary.title} 선택`} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.rowTitleLine}>
          <View style={[styles.tag, { backgroundColor: colors.surfaceMuted }]}>
            <Txt variant="caption" style={{ color: tagTextColor, fontWeight: '600' }}>
              {KIND_LABEL[draft.action.kind]}
            </Txt>
          </View>
          <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
            {summary.title}
          </Txt>
        </View>
        {summary.priority || summary.detail ? (
          <View style={styles.metaLine}>
            {summary.priority ? (
              <View style={styles.priorityMeta}>
                <Txt variant="caption" style={{ fontWeight: '700' }}>{priorityMark(summary.priority)}</Txt>
                <Txt variant="caption" tone="muted">{PRIORITY_LABEL[summary.priority]}</Txt>
              </View>
            ) : null}
            {summary.detail ? (
              <Txt variant="caption" tone={summary.danger ? 'danger' : 'muted'}>
                {summary.detail}
              </Txt>
            ) : null}
          </View>
        ) : null}
        {summary.subtasks.map((sub, idx) => (
          <View key={`${sub}-${idx}`} style={styles.sub}>
            <View style={[styles.subDot, { borderColor: colors.textFaint }]} />
            <Txt variant="small" tone="muted" style={{ flex: 1 }}>{sub}</Txt>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

/** 자유 부탁: natural-language command center for tasks, reminders, and habits with preview before applying. */
export default function AskAssistant() {
  const { colors } = useTheme();
  const isFocused = useScreenFocused();
  const zone = deviceTimeZone();
  const now = today(zone);
  const { timeFormat } = usePersonalPrefs();
  const { data: projects } = useProjects();
  const { data: openTasks } = useTasks();
  const { data: allHabits } = useHabits();
  const overrides = useReminderOverrides();
  const taskActions = useTaskActions();
  const habitActions = useHabitActions();
  const { ready: keyReady, hasKey } = useAiKeyStatus();
  const request = useAiRequest<CommandReply>();

  const { q, text: carried } = useLocalSearchParams<{ q?: string; text?: string }>();
  const initialQuery = typeof q === 'string' && q.trim() ? q.trim() : '';
  const [promptText, setPromptText] = useState(initialQuery || (typeof carried === 'string' ? carried : ''));
  const [replyText, setReplyText] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftAction[] | null>(null);

  const sortedProjects = useMemo(
    () => (projects ?? []).slice().sort((a, b) => a.position - b.position),
    [projects],
  );
  const listNames = useMemo(() => sortedProjects.map((project) => project.name), [sortedProjects]);
  const projectById = useMemo(() => new Map(sortedProjects.map((project) => [project.id, project.name])), [sortedProjects]);
  const projectByName = useMemo(() => new Map(sortedProjects.map((project) => [project.name, project.id])), [sortedProjects]);

  const activeTasks = useMemo(() => (openTasks ?? []).filter((task) => !task.completed_at), [openTasks]);
  const taskById = useMemo(() => new Map(activeTasks.map((task) => [task.id, task])), [activeTasks]);

  const activeHabits = useMemo(() => (allHabits ?? []).filter((habit) => !habit.archived_at), [allHabits]);
  const habitById = useMemo(() => new Map(activeHabits.map((habit) => [habit.id, habit])), [activeHabits]);

  const contextTasks = useMemo<CommandTaskInput[]>(() => {
    const prioritized = activeTasks.slice().sort((a, b) => {
      if (a.due_at && b.due_at) return a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : a.priority - b.priority;
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return a.priority - b.priority;
    }).slice(0, MAX_CONTEXT_TASKS);

    return prioritized.map((task) => ({
      id: task.id,
      title: task.title,
      dueDate: dueDate(task)?.toString() ?? null,
      dueMinutes: dueMinutes(task),
      durationMinutes: task.duration_minutes,
      priority: task.priority,
      list: task.project_id ? projectById.get(task.project_id) ?? null : null,
      reminder: overrides.tasks[task.id] ?? null,
    }));
  }, [activeTasks, projectById, overrides.tasks]);

  const contextHabits = useMemo<CommandHabitInput[]>(() => activeHabits.map((habit) => ({
    id: habit.id,
    name: habit.name,
    cadence: habit.cadence,
    target: habit.target_count,
    reminderTime: overrides.habits[habit.id] ?? null,
  })), [activeHabits, overrides.habits]);

  const chosen = drafts?.filter((draft) => draft.include) ?? [];
  const { state } = request;
  const preview = state.status === 'done' && replyText !== null && drafts !== null;

  const submit = async (override?: string) => {
    const text = (override ?? promptText).trim();
    if (!text) return;
    const result = await request.run((signal) => runAi({
      feature: 'ask',
      system: COMMAND_SYSTEM,
      user: commandUser(text, nowContext(Temporal.Now.instant(), zone), {
        listNames,
        tasks: contextTasks,
        habits: contextHabits,
      }),
      schema: commandSchema({
        listNames,
        taskIds: contextTasks.map((task) => task.id),
        habitIds: contextHabits.map((habit) => habit.id),
        today: now,
      }),
      effort: 'medium',
      signal,
    }));
    if (result) {
      setReplyText(result.data.reply);
      setDrafts(result.data.actions.map((action, index) => ({ key: index, action, include: true })));
    }
  };

  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (autoSubmitted.current || !initialQuery || !keyReady || !hasKey) return;
    autoSubmitted.current = true;
    void submit(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, keyReady, hasKey]);

  const resetToInput = () => {
    setDrafts(null);
    setReplyText(null);
    request.reset();
  };

  const clearAndReset = () => {
    setPromptText('');
    resetToInput();
  };

  const apply = () => {
    if (!chosen.length) return;
    const placed = new Map<string, number>();
    const undoSteps: (() => void)[] = [];
    let appliedCount = 0;
    let allUndoable = true;

    for (const { action } of chosen) {
      if (action.kind === 'add_task' && action.title) {
        const projectId = action.list && action.list !== 'inbox' ? projectByName.get(action.list) ?? null : null;
        const slot = projectId ?? '';
        const base = placed.get(slot)
          ?? nextPosition(activeTasks.filter((task) => !task.parent_task_id && (task.project_id ?? '') === slot));
        placed.set(slot, base + 1024);
        const date = action.date && action.date !== 'clear' ? parseIsoDate(action.date) : null;
        const minutes = typeof action.minutes === 'number' ? action.minutes : null;
        const parentId = taskActions.create({
          input: {
            title: action.title,
            priority: action.priority ?? 4,
            timezone: zone,
            position: base,
            ...(projectId ? { project_id: projectId } : {}),
            ...(date ? { due_at: instantFor(date, minutes, zone), all_day: minutes === null } : {}),
            ...(typeof action.durationMinutes === 'number' ? { duration_minutes: action.durationMinutes } : {}),
            ...(action.notes ? { notes: action.notes } : {}),
          },
        });
        action.subtasks.forEach((subTitle, index) => {
          taskActions.create({
            input: { title: subTitle, priority: 4, timezone: zone, position: (index + 1) * 1024, parent_task_id: parentId },
          });
        });
        if (action.reminderMinutes !== null) setTaskReminder(parentId, action.reminderMinutes);
        undoSteps.push(() => {
          taskActions.remove(parentId);
          setTaskReminder(parentId, null);
        });
        appliedCount += 1;
      } else if (action.kind === 'update_task' && action.taskId) {
        const existing = taskById.get(action.taskId);
        if (!existing) continue;

        const patch: TaskPatch = {};
        const revert: TaskPatch = {};
        if (action.title !== null) {
          patch.title = action.title;
          revert.title = existing.title;
        }
        if (action.date === 'clear') {
          Object.assign(patch, schedulePatch(existing, null));
          Object.assign(revert, {
            due_at: existing.due_at,
            all_day: existing.all_day,
            recurrence_rule: existing.recurrence_rule,
            recurrence_mode: existing.recurrence_mode,
            recurrence_local_time: existing.recurrence_local_time,
          });
        } else if (action.date !== null || action.minutes !== null) {
          const targetDate = action.date ? parseIsoDate(action.date) : (dueDate(existing) ?? now);
          const targetMinutes = action.minutes === 'clear'
            ? null
            : action.minutes !== null ? action.minutes : dueMinutes(existing);
          if (targetDate) {
            Object.assign(patch, schedulePatch(existing, targetDate, targetMinutes));
            Object.assign(revert, {
              due_at: existing.due_at,
              all_day: existing.all_day,
              recurrence_rule: existing.recurrence_rule,
              recurrence_mode: existing.recurrence_mode,
              recurrence_local_time: existing.recurrence_local_time,
            });
          }
        }
        if (action.durationMinutes === 'clear') {
          patch.duration_minutes = null;
          revert.duration_minutes = existing.duration_minutes;
        } else if (typeof action.durationMinutes === 'number') {
          patch.duration_minutes = action.durationMinutes;
          revert.duration_minutes = existing.duration_minutes;
        }
        if (action.priority !== null) {
          patch.priority = action.priority;
          revert.priority = existing.priority;
        }
        if (action.list === 'inbox') {
          patch.project_id = null;
          patch.section_id = null;
          revert.project_id = existing.project_id;
          revert.section_id = existing.section_id;
        } else if (action.list !== null) {
          const pid = projectByName.get(action.list);
          if (pid !== undefined) {
            patch.project_id = pid;
            patch.section_id = null;
            revert.project_id = existing.project_id;
            revert.section_id = existing.section_id;
          }
        }
        if (action.notes !== null) {
          patch.notes = action.notes;
          revert.notes = existing.notes;
        }

        const localUndo: (() => void)[] = [];
        if (Object.keys(patch).length > 0) {
          taskActions.update(existing.id, patch);
          localUndo.push(() => taskActions.update(existing.id, revert));
        }
        if (action.subtasks.length > 0) {
          const base = nextPosition(activeTasks.filter((task) => task.parent_task_id === existing.id));
          action.subtasks.forEach((subTitle, index) => {
            const subId = taskActions.create({
              input: {
                title: subTitle,
                priority: 4,
                timezone: zone,
                position: base + index * 1024,
                parent_task_id: existing.id,
              },
            });
            localUndo.push(() => taskActions.remove(subId));
          });
        }
        if (action.reminderMinutes !== null) {
          const prevReminder = overrides.tasks[existing.id] ?? null;
          setTaskReminder(existing.id, action.reminderMinutes);
          localUndo.push(() => setTaskReminder(existing.id, prevReminder));
        }
        if (localUndo.length > 0) {
          undoSteps.push(() => localUndo.forEach((step) => step()));
          appliedCount += 1;
        }
      } else if (action.kind === 'complete_task' && action.taskId) {
        const existing = taskById.get(action.taskId);
        if (!existing) continue;
        taskActions.complete(existing);
        if (!existing.recurrence_rule) {
          undoSteps.push(() => taskActions.reopen(existing));
        } else {
          allUndoable = false;
        }
        appliedCount += 1;
      } else if (action.kind === 'delete_task' && action.taskId) {
        const existing = taskById.get(action.taskId);
        if (!existing) continue;
        taskActions.remove(existing.id);
        allUndoable = false;
        appliedCount += 1;
      } else if (action.kind === 'add_habit' && action.title) {
        const cadence = action.habitCadence ?? 'daily';
        const maxTarget = cadence === 'weekly' ? 7 : 20;
        const target = Math.max(1, Math.min(maxTarget, action.habitTarget ?? 1));
        const habitId = habitActions.create({
          name: action.title,
          cadence,
          target_count: target,
          timezone: zone,
        });
        if (action.habitReminderTime && action.habitReminderTime !== 'off') {
          setHabitReminder(habitId, action.habitReminderTime);
        }
        undoSteps.push(() => {
          habitActions.remove(habitId);
          setHabitReminder(habitId, null);
        });
        appliedCount += 1;
      } else if (action.kind === 'set_habit_reminder' && action.habitId && action.habitReminderTime) {
        const existing = habitById.get(action.habitId);
        if (!existing) continue;
        const prevTime = overrides.habits[existing.id] ?? null;
        setHabitReminder(existing.id, action.habitReminderTime === 'off' ? null : action.habitReminderTime);
        undoSteps.push(() => setHabitReminder(existing.id, prevTime));
        appliedCount += 1;
      }
    }

    if (appliedCount === 0) {
      showToast('적용할 수 있는 항목이 없습니다.');
      return;
    }

    haptic.success();
    clearAndReset();
    if (allUndoable && undoSteps.length > 0) {
      showToast(`${appliedCount}개 반영했습니다.`, {
        actionLabel: '실행 취소',
        onAction: () => undoSteps.forEach((step) => step()),
      });
    } else {
      showToast(`${appliedCount}개 반영했습니다.`);
    }
  };

  useKeyHandler(
    (event) => {
      if (event.modal) return false;
      if (matchesCombo(event, 'mod+enter')) {
        if (!event.repeat) {
          if (preview && chosen.length > 0) apply();
          else if (!preview && state.status !== 'loading' && promptText.trim()) void submit();
        }
        return true;
      }
      if (!event.editing && matchesCombo(event, 'escape')) {
        if (!event.repeat) router.back();
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.screen, enabled: isFocused },
  );

  const footer = state.status === 'loading' || state.status === 'error' ? undefined : preview ? (
    drafts.length > 0 ? (
      <View style={styles.footerRow}>
        <Button label="다시 적기" kind="secondary" onPress={resetToInput} style={{ flex: 1 }} />
        <Button
          label={chosen.length ? `선택한 ${chosen.length}개 적용` : '선택한 항목 없음'}
          icon="check"
          disabled={!chosen.length}
          onPress={apply}
          style={{ flex: 2 }}
        />
      </View>
    ) : (
      <Button
        label="새로 부탁하기"
        leading={<AiIcon size={16} color={colors.onAccent} />}
        onPress={clearAndReset}
      />
    )
  ) : (
    <Button
      label="부탁하기"
      leading={<AiIcon size={16} color={colors.onAccent} />}
      disabled={!promptText.trim()}
      onPress={() => void submit()}
    />
  );

  return (
    <AiScreen title="자유 부탁" footer={footer}>
      <KeyGate>
        {state.status === 'loading' ? (
          <AiLoading message="부탁하신 내용을 정리하고 있습니다" onCancel={request.cancel} />
        ) : state.status === 'error' ? (
          <AiErrorView kind={state.kind} detail={state.detail} onRetry={() => void submit()} />
        ) : preview ? (
          <>
            <Card style={styles.replyCard}>
              <View style={styles.replyRow}>
                <View style={styles.replyIcon}>
                  <AiIcon size={18} color={colors.accentText} />
                </View>
                <Txt variant="body" style={{ flex: 1 }}>{replyText}</Txt>
              </View>
            </Card>
            {drafts.length > 0 ? (
              <View>
                {drafts.map((draft) => (
                  <ActionPreviewRow
                    key={draft.key}
                    draft={draft}
                    summary={describeAction(draft.action, { taskById, habitById, overrides, now, timeFormat })}
                    onToggle={() => setDrafts((list) => list?.map((item) => (
                      item.key === draft.key ? { ...item, include: !item.include } : item
                    )) ?? null)}
                  />
                ))}
              </View>
            ) : null}
            <UsageLine result={state.result} />
          </>
        ) : (
          <>
            <View style={[styles.inputBox, { backgroundColor: colors.surfaceMuted }]}>
              <TextInput
                value={promptText}
                onChangeText={setPromptText}
                multiline
                textAlignVertical="top"
                accessibilityLabel="부탁할 내용"
                placeholder="예: 내일 3시 치과, 30분 전 알람"
                placeholderTextColor={colors.textFaint}
                style={[styles.textInput, { color: colors.text, fontFamily }]}
              />
            </View>
            {promptText.trim() === '' ? (
              <View style={styles.examples}>
                {EXAMPLES.map((example) => (
                  <Chip
                    key={example.label}
                    label={example.label}
                    onPress={() => setPromptText(example.prompt)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.clearRow}>
                <Pressable accessibilityRole="button" accessibilityLabel="지우기" onPress={() => setPromptText('')} hitSlop={6} style={styles.clearBtn}>
                  <Txt variant="smallStrong" tone="muted">지우기</Txt>
                </Pressable>
              </View>
            )}
          </>
        )}
      </KeyGate>
    </AiScreen>
  );
}

const styles = StyleSheet.create({
  inputBox: { borderRadius: radius.lg, padding: space.md, minHeight: 200 },
  textInput: { flex: 1, fontSize: 16, lineHeight: 24, minHeight: 176 },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  clearRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
  footerRow: { flexDirection: 'row', gap: space.sm },
  replyCard: { padding: space.md },
  replyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  replyIcon: { marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  metaLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.sm, rowGap: 2 },
  priorityMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  subDot: { width: 10, height: 10, borderRadius: 3, borderWidth: 1.5 },
});
