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
import {
  assignRowTracks,
  BASE_HOUR_HEIGHT,
  computeHourOffsets,
  EXTRA_TRACK_HEIGHT,
  FOCUS_STRIP_HEIGHT,
  type HourSlice,
  hourRowHeight,
  sliceIntervalByHour,
  snapMinutesFromDrag,
} from './timelineLayout';
import { useTaskFlow } from './useTaskFlow';

const GUTTER = 58;
const EARLY_END_HOUR = 6;
const EARLY_BANNER_HEIGHT = 40;
const DEFAULT_BLOCK_MINUTES = 30;
const SNAP_MINUTES = 10;
const MAX_SLOT_MINUTES = 23 * 60 + 50;
const MINUTE_MARKS = [0, 10, 20, 30, 40, 50] as const;
const DURATION_PRESETS = [10, 15, 30, 45, 60, 90] as const;

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

interface TaskSlice extends HourSlice {
  entry: Placed;
}

interface FocusBlock {
  id: string;
  start: number;
  minutes: number;
  end: number;
  spent: number;
  label: string;
}

interface FocusSlice extends HourSlice {
  block: FocusBlock;
}

/** Collects timed tasks with their exact start minute and true duration (default 30 min). */
function place(entries: PlaceEntry[]): Placed[] {
  return entries
    .map((entry) => {
      const start = dueMinutes(entry.task);
      if (start === null) return null;
      const raw = entry.task.duration_minutes ?? DEFAULT_BLOCK_MINUTES;
      const duration = Math.max(5, Math.min(1440 - start, raw));
      return { ...entry, start, duration };
    })
    .filter((item): item is Placed => item !== null)
    .sort((a, b) => a.start - b.start || b.duration - a.duration);
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

function HorizontalTaskBar({
  slice,
  track,
  trackHeight,
  topOffset,
  laneWidth,
  rowHeight,
  nowMinutes,
  startHour,
  timeFormat,
  onComplete,
  onUncomplete,
  onTapTask,
  onRescheduleTime,
  onDragPreview,
}: {
  slice: TaskSlice;
  track: number;
  trackHeight: number;
  topOffset: number;
  laneWidth: number;
  rowHeight: number;
  nowMinutes: number;
  startHour: number;
  timeFormat: TimeFormat;
  onComplete: (task: Task) => void;
  onUncomplete: (task: Task, occurrenceDueAt: string | null) => void;
  onTapTask: (task: Task) => void;
  onRescheduleTime?: (task: Task, minutes: number) => void;
  onDragPreview: (preview: { title: string; start: number; duration: number } | null) => void;
}) {
  const { colors } = useTheme();
  const { entry, leftPct, widthPct, isFirst, isLast } = slice;
  const { task, start, duration, completed, undoable, occurrenceDueAt } = entry;
  const mark = priorityMark(task.priority);
  const minMinutes = startHour * 60;

  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastSnap = useSharedValue(start);

  const pan = Gesture.Pan()
    .enabled(!completed && isFirst && !!onRescheduleTime)
    .activateAfterLongPress(220)
    .runOnJS(true)
    .onStart(() => {
      haptic.medium();
      dragging.set(true);
      lastSnap.set(start);
      onDragPreview({ title: task.title, start, duration });
    })
    .onUpdate((event) => {
      dragX.set(event.translationX);
      dragY.set(event.translationY);
      const next = snapMinutesFromDrag(start, event.translationX, event.translationY, laneWidth, rowHeight, SNAP_MINUTES, minMinutes);
      if (next !== lastSnap.get()) {
        lastSnap.set(next);
        haptic.tap();
        onDragPreview({ title: task.title, start: next, duration });
      }
    })
    .onEnd(() => {
      const target = lastSnap.get();
      dragging.set(false);
      dragX.set(withSpring(0, { damping: 20, stiffness: 280 }));
      dragY.set(withSpring(0, { damping: 20, stiffness: 280 }));
      onDragPreview(null);
      if (target !== start) {
        onRescheduleTime?.(task, target);
      }
    })
    .onFinalize((_event, success) => {
      if (!success) {
        dragging.set(false);
        dragX.set(withSpring(0, { damping: 20, stiffness: 280 }));
        dragY.set(withSpring(0, { damping: 20, stiffness: 280 }));
        onDragPreview(null);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }, { scale: dragging.value ? 1.03 : 1 }],
    zIndex: dragging.value ? 30 : completed ? 1 : 4,
    opacity: dragging.value ? 0.94 : completed ? 0.55 : 1,
  }));

  const end = (start + duration) % 1440;
  const isPastDue = !completed && start + duration <= nowMinutes;
  const rangeLabel = `${formatTime(start, timeFormat)} ~ ${formatTime(end, timeFormat)} · ${formatDurationMinutes(duration)}`;
  const showCheckbox = isFirst && widthPct >= 33;
  const showTime = isFirst && widthPct >= 62;
  const compactBar = widthPct < 28;

  const edgeColor = completed
    ? colors.border
    : isPastDue
      ? colors.danger
      : colors.accent;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.barWrap,
          {
            top: topOffset + track * EXTRA_TRACK_HEIGHT,
            height: trackHeight,
            left: `${leftPct}%`,
            width: `${widthPct}%`,
          },
          animatedStyle,
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={(completed ? '완료됨 ' : '') + rangeLabel + ' ' + task.title}
          accessibilityHint={!completed && onRescheduleTime ? '누르면 빠른 조작, 길게 눌러 옮기면 시간을 바꿀 수 있습니다' : undefined}
          onPress={() => {
            haptic.tap();
            if (completed) {
              router.push({ pathname: '/task/[id]', params: { id: task.id } });
            } else {
              onTapTask(task);
            }
          }}
          style={({ pressed }) => [
            styles.barInner,
            compactBar && styles.barInnerCompact,
            {
              backgroundColor: completed ? colors.surface : colors.surfaceMuted,
              borderColor: colors.border,
              borderLeftWidth: isFirst ? 3 : StyleSheet.hairlineWidth,
              borderLeftColor: isFirst ? edgeColor : colors.border,
              borderTopLeftRadius: isFirst ? radius.sm : 2,
              borderBottomLeftRadius: isFirst ? radius.sm : 2,
              borderTopRightRadius: isLast ? radius.sm : 2,
              borderBottomRightRadius: isLast ? radius.sm : 2,
              opacity: pressed ? 0.8 : 1,
            },
          ]}>
          {showCheckbox ? (
            <Checkbox
              checked={!!completed}
              done={!!completed}
              size={16}
              onPress={() => {
                if (completed) {
                  if (undoable) onUncomplete(task, occurrenceDueAt ?? null);
                } else {
                  onComplete(task);
                }
              }}
              label={task.title + (completed ? ' 완료 취소' : ' 완료')} />
          ) : null}
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              (compactBar ? type.caption : type.small) as TextStyle,
              {
                color: completed ? colors.textFaint : isFirst ? colors.text : colors.textMuted,
                fontWeight: isFirst && !completed ? '600' : '400',
                flex: 1,
              },
              completed && styles.struck,
            ]}>
            {isFirst && !completed && mark ? <Text style={styles.mark}>{mark + ' '}</Text> : null}
            {isFirst ? task.title : `${task.title} (이어짐)`}
          </Text>
          {showTime ? (
            <Txt variant="caption" tone={isPastDue ? 'danger' : 'faint'} tabular numberOfLines={1}>
              {`${formatTime(start, timeFormat)}`}
            </Txt>
          ) : null}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * A day laid out as a horizontal 60-minute-per-row time grid (00–60 min across each hour row):
 * every task and focus bar spans strictly its exact minute interval (e.g. 12:10–12:40 -> 16.7%–66.7% of hour 12).
 */
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
  const [pickedFocus, setPickedFocus] = useState<FocusBlock | null>(null);
  const [pickedTaskId, setPickedTaskId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const selectedSlotRef = useRef<number | null>(null);
  const [dragPreview, setDragPreview] = useState<{ title: string; start: number; duration: number } | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [laneWidth, setLaneWidth] = useState(320);

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

  const focusBlocks = useMemo<FocusBlock[]>(() => sessions.flatMap((session) => {
    if (session.status !== 'completed' || !session.ended_at) return [];
    const start = Temporal.Instant.from(session.started_at).toZonedDateTimeISO(timeZone);
    if (Temporal.PlainDate.compare(start.toPlainDate(), logicalDay) !== 0) return [];
    const totalMinutes = Temporal.Instant.from(session.started_at).until(Temporal.Instant.from(session.ended_at)).total('minutes');
    const minutes = Math.max(5, totalMinutes);
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
      spent: Math.round(totalMinutes),
      label,
    }];
  }), [sessions, timeZone, logicalDay, titleByTaskId, nameByHabitId]);

  const taskSlicesByHour = useMemo(() => {
    const byHour = new Map<number, TaskSlice[]>();
    for (const entry of placed) {
      for (const slice of sliceIntervalByHour(entry.start, entry.duration)) {
        const list = byHour.get(slice.hour) ?? [];
        list.push({ ...slice, entry });
        byHour.set(slice.hour, list);
      }
    }
    const tracked = new Map<number, ReturnType<typeof assignRowTracks<TaskSlice>>>();
    byHour.forEach((list, hour) => {
      tracked.set(hour, assignRowTracks(list));
    });
    return tracked;
  }, [placed]);

  const focusSlicesByHour = useMemo(() => {
    const byHour = new Map<number, (FocusSlice & { showLabel: boolean })[]>();
    for (const block of focusBlocks) {
      const slices = sliceIntervalByHour(block.start, block.minutes);
      let labelIndex = -1;
      let maxWidth = 0;
      slices.forEach((slice, index) => {
        if (slice.widthPct > maxWidth) {
          maxWidth = slice.widthPct;
          labelIndex = index;
        }
      });
      slices.forEach((slice, index) => {
        const list = byHour.get(slice.hour) ?? [];
        list.push({ ...slice, block, showLabel: index === labelIndex && slice.widthPct >= 25 });
        byHour.set(slice.hour, list);
      });
    }
    return byHour;
  }, [focusBlocks]);

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
  const gridOffsetTop = showEarlyToggle ? EARLY_BANNER_HEIGHT : 0;

  const visibleHours = useMemo(
    () => Array.from({ length: 24 - startHour }, (_, index) => startHour + index),
    [startHour],
  );

  const heightsByHour = useMemo(() => {
    const map = new Map<number, number>();
    for (const hour of visibleHours) {
      const taskTracks = taskSlicesByHour.get(hour)?.[0]?.trackCount ?? 0;
      const hasFocus = (focusSlicesByHour.get(hour)?.length ?? 0) > 0;
      map.set(hour, hourRowHeight(taskTracks, hasFocus));
    }
    return map;
  }, [visibleHours, taskSlicesByHour, focusSlicesByHour]);

  const { offsets: hourOffsets } = useMemo(
    () => computeHourOffsets(visibleHours, heightsByHour),
    [visibleHours, heightsByHour],
  );

  const updateSlot = useCallback((next: number | null) => {
    selectedSlotRef.current = next;
    setSelectedSlot(next);
  }, []);

  const yForMinutes = useCallback(
    (minutes: number) => {
      const hour = Math.max(startHour, Math.min(23, Math.floor(minutes / 60)));
      const offset = hourOffsets.get(hour) ?? (hour - startHour) * BASE_HOUR_HEIGHT;
      return gridOffsetTop + offset;
    },
    [gridOffsetTop, hourOffsets, startHour],
  );

  const scrollToMinutes = useCallback((minutes: number, animated = true) => {
    if (minutes < startHour * 60) {
      setEarlyExpanded(true);
      scroll.current?.scrollTo({ y: Math.max(0, Math.floor(minutes / 60) * BASE_HOUR_HEIGHT - BASE_HOUR_HEIGHT), animated });
      return;
    }
    const y = Math.max(0, yForMinutes(minutes) - BASE_HOUR_HEIGHT * 1.5);
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

  const nowY = yForMinutes(nowMinutes);
  const nowRowH = heightsByHour.get(now.hour) ?? BASE_HOUR_HEIGHT;
  const nowOffscreen = viewportH > 0 && (nowY + nowRowH < scrollY + 16 || nowY > scrollY + viewportH - 32);

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
    const clamped = Math.max(5, Math.min(480, minutes));
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
          <Txt variant="caption" tone="faint" tabular style={{ width: GUTTER - space.sm, paddingTop: 8 }}>종일 {allDay.length}</Txt>
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

      {/* Box-less 60-minute horizontal ruler header (00, 10, 20, 30, 40, 50) */}
      <View style={[styles.rulerRow, { borderBottomColor: colors.border }]}>
        <View style={styles.gutterCol}>
          <Txt variant="caption" tone="faint">시간</Txt>
        </View>
        <View
          style={styles.rulerTrack}
          onLayout={(event) => {
            const w = event.nativeEvent.layout.width;
            if (w > 0) setLaneWidth(w);
          }}>
          {MINUTE_MARKS.map((mark) => (
            <View key={mark} style={styles.rulerCell}>
              <Txt variant="caption" tone="faint" tabular>{String(mark).padStart(2, '0')}</Txt>
            </View>
          ))}
        </View>
      </View>

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

          {visibleHours.map((hour) => {
            const rowHeight = heightsByHour.get(hour) ?? BASE_HOUR_HEIGHT;
            const trackedTasks = taskSlicesByHour.get(hour) ?? [];
            const rowFocus = focusSlicesByHour.get(hour) ?? [];
            const isNowHour = hour === now.hour;
            const hasTasks = trackedTasks.length > 0;
            const taskBarHeight = 32;
            const taskTopOffset = rowFocus.length > 0 ? 6 : Math.max(6, (BASE_HOUR_HEIGHT - taskBarHeight) / 2);

            return (
              <View
                key={hour}
                style={[styles.hourRow, { height: rowHeight, borderBottomColor: colors.border }]}>
                <View style={styles.gutterCol}>
                  {isNowHour ? (
                    <View style={[styles.nowHourPill, { backgroundColor: colors.text }]}>
                      <Text numberOfLines={1} style={[styles.nowHourText, { color: colors.background }]}>
                        {hourLabel(hour, timeFormat)}
                      </Text>
                    </View>
                  ) : (
                    <Txt variant="caption" tone="faint" tabular numberOfLines={1}>
                      {hourLabel(hour, timeFormat)}
                    </Txt>
                  )}
                </View>

                <View style={styles.hourGrid}>
                  {/* Six 10-minute background grid cells (00, 10, 20, 30, 40, 50) */}
                  <View style={styles.slotRow}>
                    {MINUTE_MARKS.map((mark, index) => {
                      const slotMinutes = hour * 60 + mark;
                      const slotSelected = activeSlot !== null && activeSlot >= slotMinutes && activeSlot < slotMinutes + 10;
                      const isHalfHour = mark === 30;
                      return (
                        <Pressable
                          key={mark}
                          accessibilityRole="button"
                          accessibilityLabel={formatTime(slotMinutes, timeFormat) + '에 할 일 추가'}
                          onPress={() => onAddAt(slotMinutes)}
                          style={({ pressed }) => [
                            styles.slotCell,
                            index > 0 && {
                              borderLeftWidth: StyleSheet.hairlineWidth,
                              borderLeftColor: colors.border,
                              opacity: isHalfHour ? 0.85 : 0.45,
                            },
                            pressed && { backgroundColor: colors.surfaceMuted, opacity: 1 },
                            slotSelected && { backgroundColor: colors.accentSoft, opacity: 1 },
                          ]} />
                      );
                    })}
                  </View>

                  {/* Focus sessions placed strictly on their exact minute span */}
                  {rowFocus.map((slice) => {
                    const { block, leftPct, widthPct, isFirst, isLast, showLabel } = slice;
                    const focusBottom = hasTasks ? 4 : Math.max(8, (rowHeight - FOCUS_STRIP_HEIGHT) / 2);
                    return (
                      <Pressable
                        key={`${block.id}:${hour}`}
                        accessibilityRole="button"
                        accessibilityLabel={`집중 기록 ${block.label} ${formatTime(block.start, timeFormat)}, ${block.spent}분`}
                        onPress={() => {
                          haptic.tap();
                          setPickedFocus(block);
                        }}
                        style={({ pressed }) => [
                          styles.focusBar,
                          {
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            bottom: focusBottom,
                            height: hasTasks ? FOCUS_STRIP_HEIGHT : 26,
                            backgroundColor: colors.accentRamp[0],
                            borderLeftWidth: isFirst ? 2 : 0,
                            borderLeftColor: colors.accent,
                            borderTopLeftRadius: isFirst ? 5 : 1,
                            borderBottomLeftRadius: isFirst ? 5 : 1,
                            borderTopRightRadius: isLast ? 5 : 1,
                            borderBottomRightRadius: isLast ? 5 : 1,
                            opacity: pressed ? 0.72 : 1,
                          },
                        ]}>
                        {showLabel ? (
                          <View style={styles.focusRow}>
                            <Icon name="clock" size={10} color={colors.accentText} />
                            <Txt variant="caption" tone="accent" numberOfLines={1} style={{ flex: 1 }}>
                              {block.label}
                            </Txt>
                            {widthPct >= 45 && block.spent >= 1 ? (
                              <Txt variant="caption" tone="accent" tabular>{block.spent}분</Txt>
                            ) : null}
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}

                  {/* Scheduled tasks placed strictly on their exact minute span */}
                  {trackedTasks.map(({ item: slice, track }) => (
                    <HorizontalTaskBar
                      key={`${slice.entry.completed ? 'done:' : ''}${slice.entry.task.id}:${hour}`}
                      slice={slice}
                      track={track}
                      trackHeight={taskBarHeight}
                      topOffset={taskTopOffset}
                      laneWidth={laneWidth}
                      rowHeight={rowHeight}
                      nowMinutes={nowMinutes}
                      startHour={startHour}
                      timeFormat={timeFormat}
                      onComplete={onComplete}
                      onUncomplete={flow.uncomplete}
                      onTapTask={(task) => setPickedTaskId(task.id)}
                      onRescheduleTime={onRescheduleTime}
                      onDragPreview={setDragPreview} />
                  ))}

                  {/* Vertical current-time indicator at exact minute position inside current hour */}
                  {isNowHour ? (
                    <View
                      pointerEvents="none"
                      style={[styles.nowLineWrap, { left: `${(now.minute / 60) * 100}%` }]}>
                      <View style={[styles.nowDot, { backgroundColor: colors.text }]} />
                      <View style={[styles.nowLine, { backgroundColor: colors.text }]} />
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>

        {dragPreview ? (
          <View
            pointerEvents="none"
            style={[
              styles.dragBanner,
              { backgroundColor: colors.text },
              elevation(colors, 2),
            ]}>
            <Text numberOfLines={1} style={[styles.dragBannerText, { color: colors.background }]}>
              {`${formatTime(dragPreview.start, timeFormat)} ~ ${formatTime((dragPreview.start + dragPreview.duration) % 1440, timeFormat)} · ${dragPreview.title}`}
            </Text>
          </View>
        ) : null}

        {nowOffscreen && !dragPreview ? (
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
                <Chip label="-30분" onPress={() => shiftPickedStart(-30)} style={{ flex: 1, justifyContent: 'center' }} />
                <Chip label="-10분" onPress={() => shiftPickedStart(-10)} style={{ flex: 1, justifyContent: 'center' }} />
                <Chip label="+10분" onPress={() => shiftPickedStart(10)} style={{ flex: 1, justifyContent: 'center' }} />
                <Chip label="+30분" onPress={() => shiftPickedStart(30)} style={{ flex: 1, justifyContent: 'center' }} />
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
  rulerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingLeft: space.sm, paddingRight: space.lg, height: 26,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gutterCol: { width: GUTTER, paddingRight: space.sm, alignItems: 'flex-end', justifyContent: 'center' },
  rulerTrack: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  rulerCell: { flex: 1, paddingLeft: 2 },
  earlyToggle: {
    height: EARLY_BANNER_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hourRow: {
    flexDirection: 'row', paddingLeft: space.sm, paddingRight: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hourGrid: { flex: 1, position: 'relative' },
  slotRow: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row' },
  slotCell: { flex: 1, height: '100%' },
  barWrap: { position: 'absolute', paddingHorizontal: 1 },
  barInner: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 7, overflow: 'hidden',
  },
  barInnerCompact: { paddingHorizontal: 4, gap: 3 },
  struck: { textDecorationLine: 'line-through' },
  focusBar: {
    position: 'absolute', justifyContent: 'center', paddingHorizontal: 5, overflow: 'hidden', zIndex: 2,
  },
  focusRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  nowHourPill: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
  },
  nowHourText: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  nowLineWrap: {
    position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, alignItems: 'center', zIndex: 10,
  },
  nowDot: { width: 6, height: 6, borderRadius: 3, marginTop: -2 },
  nowLine: { flex: 1, width: 1.5 },
  dragBanner: {
    position: 'absolute', top: space.sm, alignSelf: 'center', maxWidth: '88%',
    borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6,
  },
  dragBannerText: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  jumpNowPill: {
    position: 'absolute', top: space.sm, right: space.lg,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill,
    paddingHorizontal: space.md, minHeight: 34,
  },
  mark: { fontWeight: '700' },
});
