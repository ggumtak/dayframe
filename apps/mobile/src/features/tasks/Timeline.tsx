import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type NativeScrollEvent, type NativeSyntheticEvent, Pressable, type ScrollViewInstance, StyleSheet, Text, type TextStyle, View,
} from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Checkbox } from '@/components/Checkbox';
import { Button, Chip, Icon, IconButton, Row, Sheet, Txt } from '@/components/ui';
import { useDeleteFocus } from '@/data/focus';
import { useHabits } from '@/data/habits';
import { type DoneToday, useCompletedTasks, useTaskIndex } from '@/data/tasks';
import { type HardwareKeyEvent, KEY_PRIORITY, matchesCombo, useKeyboard, useKeyHandler } from '@/features/keyboard';
import type { TimeFormat } from '@/features/settings/prefs';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { useMinute } from '@/lib/clock';
import { dueDate, dueMinutes, formatDurationMinutes, formatTime, logicalToday, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import type { FocusSession, Task, TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { elevation, radius, space, type, useTheme } from '@/theme';

import { OverdueBar } from './OverdueBar';
import { priorityMark } from './priority';
import { useTaskFlow } from './useTaskFlow';

const HOUR = 76;
const GUTTER = 66;
const EARLY_END_HOUR = 6;
const EARLY_BANNER_HEIGHT = 40;
const DEFAULT_BLOCK_MINUTES = 30;
const MIN_VISUAL_MINUTES = 24;
const SNAP_MINUTES = 15;
const MAX_SLOT_MINUTES = 23 * 60 + 30;
const DURATION_PRESETS = [15, 30, 45, 60, 90] as const;

const clampSlot = (minutes: number) => Math.max(0, Math.min(MAX_SLOT_MINUTES, minutes));
const nearestHalfHour = (minutes: number) => clampSlot(Math.round(minutes / 30) * 30);

const hourLabel = (hour: number, timeFormat: TimeFormat) =>
  timeFormat === '24h'
    ? `${String(hour).padStart(2, '0')}:00`
    : (hour < 12 ? '오전 ' : '오후 ') + (hour % 12 === 0 ? 12 : hour % 12) + '시';

interface Placed {
  task: Task;
  start: number;
  duration: number;
  column: number;
  columns: number;
  completed?: boolean;
  undoable?: boolean;
  occurrenceDueAt?: string | null;
}

interface PlaceEntry {
  task: Task;
  completed?: boolean;
  undoable?: boolean;
  occurrenceDueAt?: string | null;
}

/** Lays out timed tasks using each task's estimated duration (default 30 min); overlapping blocks share the row width. */
function place(entries: PlaceEntry[]): Placed[] {
  const timed = entries
    .map((entry) => {
      const start = dueMinutes(entry.task);
      if (start === null) return null;
      const raw = entry.task.duration_minutes ?? DEFAULT_BLOCK_MINUTES;
      const duration = Math.max(MIN_VISUAL_MINUTES, Math.min(1440 - start, raw));
      return { ...entry, start, duration };
    })
    .filter((item): item is PlaceEntry & { start: number; duration: number } => item !== null)
    .sort((a, b) => a.start - b.start || b.duration - a.duration);

  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const close = () => {
    const columns = Math.max(1, ...group.map((item) => item.column + 1));
    group.forEach((item) => { item.columns = columns; });
    group = [];
  };
  for (const { task, start, duration, completed, undoable, occurrenceDueAt } of timed) {
    if (start >= groupEnd) close();
    const taken = new Set(group.filter((item) => item.start + item.duration > start).map((item) => item.column));
    let column = 0;
    while (taken.has(column)) column++;
    const item: Placed = { task, start, duration, column, columns: 1, completed, undoable, occurrenceDueAt };
    group.push(item);
    placed.push(item);
    groupEnd = Math.max(groupEnd, start + duration);
  }
  close();
  return placed;
}

/** Finds the next open 30-minute slot after `nowMinutes` that fits `duration` without overlapping existing blocks. */
export function findNextFreeSlot(placed: Pick<Placed, 'start' | 'duration'>[], nowMinutes: number, duration = 30): number {
  const rounded = Math.ceil((nowMinutes + 5) / 30) * 30;
  for (let slot = Math.min(23 * 60 + 30, rounded); slot <= 24 * 60 - Math.min(30, duration); slot += 30) {
    const overlaps = placed.some((b) => slot < b.start + b.duration && slot + duration > b.start);
    if (!overlaps) return slot;
  }
  return Math.min(23 * 60 + 30, rounded);
}

function DraggableBlock({
  item, nowMinutes, startHour, timeFormat, onComplete, onUncomplete, onTapTask, onRescheduleTime,
}: {
  item: Placed;
  nowMinutes: number;
  startHour: number;
  timeFormat: TimeFormat;
  onComplete: (task: Task) => void;
  onUncomplete: (task: Task, occurrenceDueAt: string | null) => void;
  onTapTask: (task: Task) => void;
  onRescheduleTime?: (task: Task, minutes: number) => void;
}) {
  const { colors } = useTheme();
  const { task, start, duration, column, columns, completed, undoable, occurrenceDueAt } = item;
  const mark = priorityMark(task.priority);
  const blockHeight = Math.max(30, (duration / 60) * HOUR - 2);
  const tall = blockHeight >= 52;
  const minMinutes = startHour * 60;

  const dragY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastSnap = useSharedValue(start);
  const [previewMinutes, setPreviewMinutes] = useState<number | null>(null);

  const pan = Gesture.Pan()
    .enabled(!completed && !!onRescheduleTime)
    .activateAfterLongPress(220)
    .runOnJS(true)
    .onStart(() => {
      haptic.medium();
      dragging.set(true);
      lastSnap.set(start);
      setPreviewMinutes(start);
    })
    .onUpdate((event) => {
      const deltaMin = Math.round(((event.translationY / HOUR) * 60) / SNAP_MINUTES) * SNAP_MINUTES;
      const clamped = Math.max(minMinutes, Math.min(24 * 60 - SNAP_MINUTES, start + deltaMin));
      const snappedPx = ((clamped - start) / 60) * HOUR;
      dragY.set(snappedPx);
      if (clamped !== lastSnap.get()) {
        lastSnap.set(clamped);
        haptic.tap();
        setPreviewMinutes(clamped);
      }
    })
    .onEnd(() => {
      const target = lastSnap.get();
      dragging.set(false);
      dragY.set(withSpring(0, { damping: 20, stiffness: 280 }));
      setPreviewMinutes(null);
      if (target !== start) {
        onRescheduleTime?.(task, target);
      }
    })
    .onFinalize((_event, success) => {
      if (!success) {
        dragging.set(false);
        dragY.set(withSpring(0, { damping: 20, stiffness: 280 }));
        setPreviewMinutes(null);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }, { scale: dragging.value ? 1.02 : 1 }],
    zIndex: dragging.value ? 20 : completed ? 0 : 1,
    opacity: dragging.value ? 0.95 : completed ? 0.55 : 1,
  }));

  const shownStart = previewMinutes ?? start;
  const end = (shownStart + (task.duration_minutes ?? DEFAULT_BLOCK_MINUTES)) % 1440;
  const rangeLabel = task.duration_minutes
    ? `${formatTime(shownStart, timeFormat)} ~ ${formatTime(end, timeFormat)} · ${formatDurationMinutes(task.duration_minutes)}`
    : formatTime(shownStart, timeFormat);
  const shortMeta = previewMinutes !== null
    ? formatTime(previewMinutes, timeFormat)
    : task.duration_minutes
      ? `${formatTime(start, timeFormat)} · ${formatDurationMinutes(task.duration_minutes)}`
      : formatTime(start, timeFormat);

  const metaTone = completed
    ? 'faint'
    : previewMinutes !== null
      ? 'accent'
      : start < nowMinutes
        ? 'danger'
        : 'muted';

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.block,
          {
            top: ((start - startHour * 60) / 60) * HOUR + 1,
            height: blockHeight,
            left: `${(column / columns) * 100}%`,
            width: `${100 / columns}%`,
          },
          animatedStyle,
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={(completed ? '완료됨 ' : '') + rangeLabel + ' ' + task.title}
          accessibilityHint={!completed && onRescheduleTime ? '누르면 빠른 조작, 길게 눌러 위아래로 옮기면 시간을 바꿀 수 있습니다' : undefined}
          onPress={() => {
            haptic.tap();
            if (completed) {
              router.push({ pathname: '/task/[id]', params: { id: task.id } });
            } else {
              onTapTask(task);
            }
          }}
          style={[
            styles.blockInner,
            {
              backgroundColor: completed ? colors.surfaceMuted : colors.surface,
              borderColor: previewMinutes !== null ? colors.accent : colors.border,
            },
            tall && styles.blockInnerTall,
            previewMinutes !== null && elevation(colors, 2),
          ]}>
          <Checkbox
            checked={!!completed}
            done={!!completed}
            size={18}
            onPress={() => {
              if (completed) {
                if (undoable) onUncomplete(task, occurrenceDueAt ?? null);
              } else {
                onComplete(task);
              }
            }}
            label={task.title + (completed ? ' 완료 취소' : ' 완료')} />
          {tall ? (
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                numberOfLines={2}
                style={[
                  type.smallStrong as TextStyle,
                  { color: completed ? colors.textFaint : colors.text },
                  completed && styles.struck,
                ]}>
                {!completed && mark ? <Text style={styles.mark}>{mark + ' '}</Text> : null}{task.title}
              </Text>
              <Txt variant="caption" tone={metaTone} tabular numberOfLines={1}>
                {rangeLabel}
              </Txt>
            </View>
          ) : (
            <>
              <Text
                numberOfLines={1}
                style={[
                  type.small as TextStyle,
                  { color: completed ? colors.textFaint : colors.text, flex: 1 },
                  completed && styles.struck,
                ]}>
                {!completed && mark ? <Text style={styles.mark}>{mark + ' '}</Text> : null}{task.title}
              </Text>
              {columns === 1 ? (
                <Txt variant="caption" tone={metaTone} tabular numberOfLines={1}>
                  {shortMeta}
                </Txt>
              ) : null}
            </>
          )}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

/** A day laid out by the clock: draggable duration-scaled blocks, 30-min tap slots, collapsible all-day tray, and focus sessions. */
export function Timeline({
  tasks, sessions, timeZone, overdueCount = 0, completedToday = [], onComplete, onAddAt, onRescheduleTime,
  onPlanOverdue, onMoveOverdueToday, keyboardActive = false,
}: {
  tasks: Task[];
  sessions: FocusSession[];
  timeZone: string;
  overdueCount?: number;
  completedToday?: DoneToday[];
  onComplete: (task: Task) => void;
  onAddAt: (minutes: number) => void;
  onRescheduleTime?: (task: Task, minutes: number) => void;
  onPlanOverdue?: () => void;
  onMoveOverdueToday?: () => void;
  keyboardActive?: boolean;
}) {
  const { colors } = useTheme();
  const { keyboardMode } = useKeyboard();
  const { dayStartHour, timeFormat } = usePersonalPrefs();
  const flow = useTaskFlow();
  const { byId: openById } = useTaskIndex();
  const { data: completedAll } = useCompletedTasks();
  const { data: habits } = useHabits();
  const deleteFocus = useDeleteFocus();

  const scroll = useRef<ScrollViewInstance>(null);
  const scrolled = useRef(false);
  const minute = useMinute();
  const nowInstant = useMemo(() => Temporal.Instant.fromEpochMilliseconds(minute * 60_000), [minute]);
  const now = useMemo(() => nowInstant.toZonedDateTimeISO(timeZone), [nowInstant, timeZone]);
  const logicalDay = useMemo(() => logicalToday(timeZone, dayStartHour, nowInstant), [timeZone, dayStartHour, nowInstant]);
  const nowMinutes = now.hour * 60 + now.minute;

  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const [earlyExpanded, setEarlyExpanded] = useState(false);
  const [pickedFocus, setPickedFocus] = useState<{ id: string; start: number; end: number; spent: number; label: string } | null>(null);
  const [pickedTaskId, setPickedTaskId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const selectedSlotRef = useRef<number | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  const pickedTask = useMemo(
    () => (pickedTaskId ? tasks.find((task) => task.id === pickedTaskId) ?? null : null),
    [pickedTaskId, tasks],
  );

  const titleByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    openById.forEach((task, id) => map.set(id, task.title));
    for (const task of completedAll ?? []) {
      if (!map.has(task.id)) map.set(task.id, task.title);
    }
    for (const item of completedToday) {
      if (!map.has(item.completion.task.id)) map.set(item.completion.task.id, item.completion.task.title);
    }
    return map;
  }, [openById, completedAll, completedToday]);

  const nameByHabitId = useMemo(
    () => new Map((habits ?? []).map((habit) => [habit.id, habit.name])),
    [habits],
  );

  const placed = useMemo(() => {
    const openIds = new Set(tasks.map((t) => t.id));
    const entries: PlaceEntry[] = tasks.map((task) => ({ task }));
    for (const { completion, undoable } of completedToday) {
      const { task } = completion;
      if (openIds.has(task.id) || task.all_day) continue;
      const effectiveDueAt = completion.occurrence_due_at ?? task.due_at;
      if (!effectiveDueAt) continue;
      const effectiveTask = effectiveDueAt === task.due_at ? task : { ...task, due_at: effectiveDueAt };
      const d = dueDate(effectiveTask);
      if (!d || Temporal.PlainDate.compare(d, logicalDay) !== 0) continue;
      entries.push({ task: effectiveTask, completed: true, undoable, occurrenceDueAt: completion.occurrence_due_at });
    }
    return place(entries);
  }, [tasks, completedToday, logicalDay]);

  const openPlaced = useMemo(() => placed.filter((item) => !item.completed), [placed]);
  const allDay = useMemo(() => tasks.filter((task) => task.all_day), [tasks]);
  const shownAllDay = allDayExpanded ? allDay : allDay.slice(0, 2);
  const hiddenAllDay = allDay.length - shownAllDay.length;

  const focusBlocks = useMemo(() => sessions.flatMap((session) => {
    if (session.status !== 'completed' || !session.ended_at) return [];
    const start = Temporal.Instant.from(session.started_at).toZonedDateTimeISO(timeZone);
    if (Temporal.PlainDate.compare(start.toPlainDate(), logicalDay) !== 0) return [];
    const minutes = Math.max(10, Temporal.Instant.from(session.started_at).until(Temporal.Instant.from(session.ended_at)).total('minutes'));
    const end = Temporal.Instant.from(session.ended_at).toZonedDateTimeISO(timeZone);
    const label = session.task_id
      ? (titleByTaskId.get(session.task_id) ?? '집중')
      : session.habit_id
        ? (nameByHabitId.get(session.habit_id) ?? '습관 집중')
        : '집중';
    return [{
      id: session.id,
      start: start.hour * 60 + start.minute,
      minutes,
      end: end.hour * 60 + end.minute,
      spent: Math.round(Temporal.Instant.from(session.started_at).until(Temporal.Instant.from(session.ended_at)).total('minutes')),
      label,
    }];
  }), [sessions, timeZone, logicalDay, titleByTaskId, nameByHabitId]);

  const activeSlot = keyboardActive && keyboardMode ? selectedSlot : null;
  const hasEarlyContent = useMemo(
    () => placed.some((item) => item.start < EARLY_END_HOUR * 60)
      || focusBlocks.some((block) => block.start < EARLY_END_HOUR * 60)
      || nowMinutes < EARLY_END_HOUR * 60
      || (activeSlot !== null && activeSlot < EARLY_END_HOUR * 60),
    [placed, focusBlocks, nowMinutes, activeSlot],
  );
  const startHour = !hasEarlyContent && !earlyExpanded ? EARLY_END_HOUR : 0;
  const showEarlyToggle = !hasEarlyContent;
  const gridOffsetTop = space.md + (showEarlyToggle ? EARLY_BANNER_HEIGHT : 0);

  const updateSlot = useCallback((next: number | null) => {
    selectedSlotRef.current = next;
    setSelectedSlot(next);
  }, []);

  const yForMinutes = useCallback(
    (minutes: number) => gridOffsetTop + ((minutes - startHour * 60) / 60) * HOUR,
    [gridOffsetTop, startHour],
  );

  const scrollToMinutes = useCallback((minutes: number, animated = true) => {
    if (minutes < startHour * 60) {
      setEarlyExpanded(true);
      scroll.current?.scrollTo({ y: Math.max(0, (minutes / 60 - 1.5) * HOUR), animated });
      return;
    }
    const y = Math.max(0, yForMinutes(minutes) - 1.5 * HOUR);
    scroll.current?.scrollTo({ y, animated });
  }, [startHour, yForMinutes]);

  const handleKey = useCallback((event: HardwareKeyEvent): boolean => {
    if (event.editing || event.modal) return false;

    if (matchesCombo(event, 'j') || matchesCombo(event, 'arrowdown')) {
      const current = selectedSlotRef.current;
      const next = current === null ? nearestHalfHour(nowMinutes) : clampSlot(current + 30);
      updateSlot(next);
      scrollToMinutes(next);
      return true;
    }
    if (matchesCombo(event, 'k') || matchesCombo(event, 'arrowup')) {
      const current = selectedSlotRef.current;
      const next = current === null ? nearestHalfHour(nowMinutes) : clampSlot(current - 30);
      updateSlot(next);
      scrollToMinutes(next);
      return true;
    }
    if (matchesCombo(event, 'enter')) {
      const current = selectedSlotRef.current;
      if (current !== null) {
        if (!event.repeat) {
          haptic.tap();
          onAddAt(current);
        }
        return true;
      }
      return false;
    }
    if (matchesCombo(event, 't')) {
      if (!event.repeat) {
        haptic.tap();
        const target = nearestHalfHour(nowMinutes);
        updateSlot(target);
        scrollToMinutes(nowMinutes);
      }
      return true;
    }
    if (matchesCombo(event, 'escape')) {
      if (selectedSlotRef.current !== null) {
        if (!event.repeat) updateSlot(null);
        return true;
      }
      return false;
    }
    return false;
  }, [nowMinutes, onAddAt, scrollToMinutes, updateSlot]);

  useKeyHandler(handleKey, {
    enabled: keyboardActive && !pickedFocus && !pickedTask,
    priority: KEY_PRIORITY.screen,
  });

  const nowClock = formatTime(nowMinutes, timeFormat);
  const nowY = yForMinutes(nowMinutes);
  const nowOffscreen = viewportH > 0 && (nowY < scrollY + 20 || nowY > scrollY + viewportH - 36);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setScrollY(event.nativeEvent.contentOffset.y);
  }, []);

  const shiftPickedStart = (deltaMinutes: number) => {
    if (!pickedTask) return;
    const current = dueMinutes(pickedTask);
    if (current === null) return;
    const next = Math.max(0, Math.min(24 * 60 - SNAP_MINUTES, current + deltaMinutes));
    if (next === current) return;
    haptic.tap();
    if (onRescheduleTime) {
      onRescheduleTime(pickedTask, next);
    } else {
      flow.reschedule(pickedTask, logicalDay, next);
    }
  };

  const setPickedDuration = (minutes: number) => {
    if (!pickedTask) return;
    const clamped = Math.max(15, Math.min(480, minutes));
    haptic.tap();
    flow.update(pickedTask.id, { duration_minutes: clamped });
  };

  const movePickedToAllDay = () => {
    if (!pickedTask) return;
    const target = pickedTask;
    const prevPatch: TaskPatch = {
      due_at: target.due_at,
      all_day: target.all_day,
      recurrence_rule: target.recurrence_rule,
      recurrence_mode: target.recurrence_mode,
      recurrence_local_time: target.recurrence_local_time,
    };
    setPickedTaskId(null);
    haptic.tap();
    flow.reschedule(target, logicalDay, null);
    showToast(`‘${target.title}’${josa(target.title, '을/를')} 종일 할 일로 옮겼습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => flow.update(target.id, prevPatch),
    });
  };

  const startFocusForPicked = () => {
    if (!pickedTask) return;
    const target = pickedTask;
    setPickedTaskId(null);
    haptic.light();
    router.navigate({
      pathname: '/focus',
      params: {
        taskId: target.id,
        title: target.title,
        ...(target.duration_minutes ? { minutes: String(target.duration_minutes), duration: String(target.duration_minutes) } : {}),
        autostart: '1',
        at: String(Date.now()),
      },
    });
  };

  const pickedStart = pickedTask ? dueMinutes(pickedTask) : null;
  const pickedDuration = pickedTask?.duration_minutes ?? DEFAULT_BLOCK_MINUTES;
  const pickedEnd = pickedStart !== null ? (pickedStart + pickedDuration) % 1440 : null;
  const visibleHours = useMemo(
    () => Array.from({ length: 24 - startHour }, (_, index) => startHour + index),
    [startHour],
  );

  return (
    <View style={{ flex: 1 }}>
      {overdueCount > 0 && onPlanOverdue && onMoveOverdueToday ? (
        <OverdueBar
          count={overdueCount} separator
          onSpread={onPlanOverdue} spreadLabel={`기한이 지난 할 일 ${overdueCount}개 일정 분산`}
          onMoveToday={onMoveOverdueToday} moveTodayLabel="기한 지난 할 일 모두 오늘로 옮기기" />
      ) : null}

      {allDay.length ? (
        <View style={[styles.allDay, { borderBottomColor: colors.border }]}>
          <Txt variant="caption" tone="faint" tabular style={{ width: GUTTER - space.lg, paddingTop: 8 }}>종일 {allDay.length}</Txt>
          <View style={{ flex: 1, gap: 6 }}>
            {shownAllDay.map((task) => (
              <Pressable
                key={task.id} accessibilityRole="button" accessibilityLabel={task.title}
                onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
                style={[styles.allDayItem, { backgroundColor: colors.surfaceMuted }]}>
                <Checkbox checked={false} size={18} onPress={() => onComplete(task)} label={task.title + ' 완료'} />
                <Text numberOfLines={1} style={[type.small as TextStyle, { color: colors.text, flex: 1 }]}>{task.title}</Text>
                {task.duration_minutes ? (
                  <Txt variant="caption" tone="faint" tabular>{formatDurationMinutes(task.duration_minutes)}</Txt>
                ) : null}
                {onRescheduleTime ? (
                  <IconButton
                    name="clock" label={task.title + ' 빈 시간에 자동 배치'} size={14} color={colors.textMuted}
                    onPress={() => {
                      const slot = findNextFreeSlot(openPlaced, nowMinutes, task.duration_minutes ?? DEFAULT_BLOCK_MINUTES);
                      haptic.success();
                      onRescheduleTime(task, slot);
                    }}
                    style={{ width: 28, height: 28 }} />
                ) : null}
              </Pressable>
            ))}
            {allDay.length > 2 ? (
              <Pressable
                hitSlop={6}
                onPress={() => {
                  haptic.tap();
                  setAllDayExpanded((open) => !open);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 }}>
                <Icon name={allDayExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textFaint} />
                <Txt variant="caption" tone="muted" tabular style={{ fontWeight: '600' }}>
                  {allDayExpanded ? '종일 할 일 접기' : `종일 할 일 ${hiddenAllDay}개 더 보기`}
                </Txt>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={{ flex: 1, position: 'relative' }}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={{ paddingBottom: 140 }}
          onScroll={handleScroll}
          scrollEventThrottle={64}
          onLayout={(event) => {
            const h = event.nativeEvent.layout.height;
            if (h > 0) setViewportH(h);
            if (scrolled.current) return;
            scrolled.current = true;
            scrollToMinutes(nowMinutes, false);
          }}>
          {showEarlyToggle ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={earlyExpanded ? '새벽 0~6시 접기' : '새벽 0~6시 펼치기'}
              onPress={() => {
                haptic.tap();
                setEarlyExpanded((open) => !open);
              }}
              style={({ pressed }) => [
                styles.earlyToggle,
                { borderBottomColor: colors.border, backgroundColor: pressed ? colors.surfaceMuted : 'transparent' },
              ]}>
              <Icon name="moon" size={13} color={colors.textFaint} />
              <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>
                {earlyExpanded ? '새벽 0~6시 접기' : '새벽 0~6시 펼치기'}
              </Txt>
              <Icon name={earlyExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textFaint} />
            </Pressable>
          ) : null}

          <View style={{ height: HOUR * visibleHours.length, marginTop: space.md }}>
            {visibleHours.map((hour) => (
              <View key={hour} style={[styles.hour, { top: (hour - startHour) * HOUR, borderTopColor: colors.border }]}>
                <Txt variant="caption" tone="faint" tabular style={styles.hourLabel} numberOfLines={1}>
                  {hourLabel(hour, timeFormat)}
                </Txt>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={formatTime(hour * 60, timeFormat) + '에 할 일 추가'}
                  onPress={() => onAddAt(hour * 60)}
                  style={[
                    styles.halfHour,
                    activeSlot === hour * 60 && [
                      styles.halfHourSelected,
                      { backgroundColor: colors.accentSoft, borderLeftColor: colors.accent },
                    ],
                  ]} />
                <Pressable
                  accessibilityRole="button" accessibilityLabel={formatTime(hour * 60 + 30, timeFormat) + '에 할 일 추가'}
                  onPress={() => onAddAt(hour * 60 + 30)}
                  style={[
                    styles.halfHour,
                    styles.halfHourBottom,
                    { borderTopColor: colors.border },
                    activeSlot === hour * 60 + 30 && [
                      styles.halfHourSelected,
                      { backgroundColor: colors.accentSoft, borderLeftColor: colors.accent },
                    ],
                  ]} />
              </View>
            ))}

            {focusBlocks.map((block) => {
              const blockHeight = Math.max(16, (block.minutes / 60) * HOUR);
              return (
                <Pressable
                  key={block.id}
                  accessibilityRole="button"
                  accessibilityLabel={`집중 기록 ${block.label} ${formatTime(block.start, timeFormat)}, ${block.spent}분`}
                  onPress={() => {
                    haptic.tap();
                    setPickedFocus(block);
                  }}
                  style={[
                    styles.focus,
                    {
                      top: ((block.start - startHour * 60) / 60) * HOUR,
                      height: blockHeight,
                      backgroundColor: colors.surfaceMuted,
                      borderLeftColor: colors.textFaint,
                    },
                  ]}>
                  {blockHeight >= 18 ? (
                    <View style={styles.focusRow}>
                      <Icon name="clock" size={11} color={colors.textFaint} />
                      <Txt variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                        {block.label}
                      </Txt>
                      {block.spent >= 1 ? (
                        <Txt variant="caption" tone="faint" tabular>{block.spent}분</Txt>
                      ) : null}
                    </View>
                  ) : null}
                </Pressable>
              );
            })}

            <View pointerEvents="box-none" style={styles.lane}>
              {placed.map((item) => (
                <DraggableBlock
                  key={(item.completed ? 'done:' : '') + item.task.id}
                  item={item}
                  nowMinutes={nowMinutes}
                  startHour={startHour}
                  timeFormat={timeFormat}
                  onComplete={onComplete}
                  onUncomplete={flow.uncomplete}
                  onTapTask={(task) => setPickedTaskId(task.id)}
                  onRescheduleTime={onRescheduleTime} />
              ))}
            </View>

            <View pointerEvents="none" style={[styles.now, { top: ((nowMinutes - startHour * 60) / 60) * HOUR - 9 }]}>
              {/* Now is a neutral ink line: red stays for what is overdue. */}
              <View style={[styles.nowPill, { backgroundColor: colors.text }]}>
                <Text numberOfLines={1} style={[styles.nowPillText, { color: colors.background }]}>{nowClock}</Text>
              </View>
              <View style={{ flex: 1, height: 1.5, backgroundColor: colors.text }} />
            </View>
          </View>
        </ScrollView>

        {nowOffscreen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="현재 시간으로 이동"
            onPress={() => {
              haptic.tap();
              scrollToMinutes(nowMinutes, true);
            }}
            style={({ pressed }) => [
              styles.jumpNowPill,
              { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.78 : 1 },
              elevation(colors, 1),
            ]}>
            <Icon name="clock" size={13} color={colors.accentText} />
            <Txt variant="smallStrong" tone="accent">지금</Txt>
          </Pressable>
        ) : null}
      </View>

      <Sheet visible={!!pickedFocus} onClose={() => setPickedFocus(null)} title={pickedFocus?.label ?? '집중 기록'}>
        {pickedFocus ? (
          <View style={{ gap: space.sm }}>
            <Txt tone="muted" tabular style={{ marginBottom: space.md }}>
              {formatTime(pickedFocus.start, timeFormat) + ' ~ ' + formatTime(pickedFocus.end, timeFormat) + ' · ' + (pickedFocus.spent < 1 ? '1분 미만' : pickedFocus.spent + '분')}
            </Txt>
            <Button
              label="이 기록 삭제" kind="danger" icon="trash-2"
              onPress={() => {
                deleteFocus.mutate(pickedFocus.id);
                setPickedFocus(null);
                showToast('집중 기록을 삭제했습니다.');
              }} />
            <Button label="닫기" kind="secondary" onPress={() => setPickedFocus(null)} />
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={!!pickedTask} onClose={() => setPickedTaskId(null)} title={pickedTask?.title}>
        {pickedTask ? (
          <View style={{ gap: space.md }}>
            {pickedStart !== null && pickedEnd !== null ? (
              <Txt variant="small" tone="muted" tabular>
                {`${formatTime(pickedStart, timeFormat)} ~ ${formatTime(pickedEnd, timeFormat)} · ${formatDurationMinutes(pickedDuration)}`}
              </Txt>
            ) : null}

            <View style={{ gap: 6 }}>
              <Txt variant="caption" tone="muted">시작 시간 조절</Txt>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Chip icon="minus" label="15분 앞당기기" onPress={() => shiftPickedStart(-15)} style={{ flex: 1, justifyContent: 'center' }} />
                <Chip icon="plus" label="15분 미루기" onPress={() => shiftPickedStart(15)} style={{ flex: 1, justifyContent: 'center' }} />
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Txt variant="caption" tone="muted">소요 시간</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {DURATION_PRESETS.map((mins) => (
                  <Chip
                    key={mins}
                    label={formatDurationMinutes(mins)}
                    selected={pickedTask.duration_minutes === mins}
                    onPress={() => setPickedDuration(mins)} />
                ))}
              </View>
            </View>

            <View>
              <Row icon="play" label="집중 시작" detail={formatDurationMinutes(pickedDuration)} onPress={startFocusForPicked} />
              <Row
                icon="check" label="완료"
                onPress={() => {
                  const target = pickedTask;
                  setPickedTaskId(null);
                  onComplete(target);
                }} />
              <Row icon="calendar" label="종일로 빼기" onPress={movePickedToAllDay} />
              <Row
                icon="maximize-2" label="자세히 보기"
                onPress={() => {
                  const id = pickedTask.id;
                  setPickedTaskId(null);
                  router.push({ pathname: '/task/[id]', params: { id } });
                }} />
            </View>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  allDay: { flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  allDayItem: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.sm, paddingLeft: space.sm, paddingRight: 4, minHeight: 34 },
  earlyToggle: {
    height: EARLY_BANNER_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Every layer stops at the same right margin as the rest of the app.
  hour: { position: 'absolute', left: GUTTER, right: space.lg, height: HOUR, borderTopWidth: StyleSheet.hairlineWidth },
  halfHour: { flex: 1 },
  halfHourBottom: { borderTopWidth: StyleSheet.hairlineWidth, opacity: 0.45 },
  halfHourSelected: { borderLeftWidth: 3, opacity: 1 },
  hourLabel: { position: 'absolute', left: -GUTTER + space.sm, top: -7, width: GUTTER - space.md },
  lane: { position: 'absolute', top: 0, bottom: 0, left: GUTTER + 4, right: space.lg },
  block: { position: 'absolute', paddingRight: 4 },
  blockInner: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
  },
  blockInnerTall: { alignItems: 'flex-start', paddingVertical: 6 },
  struck: { textDecorationLine: 'line-through' },
  focus: {
    position: 'absolute', left: GUTTER + 4, right: space.lg, borderRadius: radius.sm, borderLeftWidth: 3, opacity: 0.85,
    paddingHorizontal: space.sm, justifyContent: 'center',
  },
  focusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  now: { position: 'absolute', left: space.xs, right: space.lg, flexDirection: 'row', alignItems: 'center' },
  nowPill: {
    width: GUTTER - space.xs - 2, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3, marginRight: 2,
  },
  nowPillText: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  jumpNowPill: {
    position: 'absolute', top: space.sm, right: space.lg,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill,
    paddingHorizontal: space.md, minHeight: 34,
  },
  mark: { fontWeight: '700' },
});
