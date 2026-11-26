import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { type ComponentProps, memo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  Extrapolation, interpolate, type SharedValue, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { Density, SwipeAction as SwipeActionKind, SwipeRightSecondary } from '@/features/settings/prefs';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { priorityMark, taskA11yLabel } from '@/features/tasks/priority';
import { describeRecurrence, dueBucket, dueMinutes, formatDue, formatDurationMinutes, formatTime, isPastDue } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Task } from '@/lib/shared';
import type { SubtaskProgress } from '@/lib/smart';
import { fontFamily, radius, space, type, useTheme } from '@/theme';

import { Checkbox } from './Checkbox';

type AnySwipeAction = SwipeActionKind | SwipeRightSecondary;
type SwipeIconName = 'check' | 'sunrise' | 'clock' | 'play' | 'trash-2';

const LEFT_THRESHOLD = 72;
const RIGHT_THRESHOLD = 40;

const DENSITY_METRICS: Record<Density, { paddingVertical: number; minHeight: number; checkTop: number; noteLines: number }> = {
  compact: { paddingVertical: 7, minHeight: 40, checkTop: 7, noteLines: 0 },
  default: { paddingVertical: 11, minHeight: 46, checkTop: 11, noteLines: 1 },
  comfortable: { paddingVertical: 14, minHeight: 52, checkTop: 14, noteLines: 2 },
};

export interface TaskRowProps {
  task: Task;
  projectName?: string;
  projectIcon?: ComponentProps<typeof Feather>['name'];
  tagNames?: string[];
  /** Active alert indicator for Android notifications, with optional custom lead text. */
  reminderBadge?: { active: boolean; label?: string };
  /** Open and completed direct subtasks, shown as a compact counter (`3` or `2/5`). */
  subtaskProgress?: SubtaskProgress;
  /** Whether inline subtasks beneath this row are currently expanded. */
  subtasksExpanded?: boolean;
  /** Toggles inline subtasks when tapping the subtask counter. */
  onToggleSubtasks?: (task: Task) => void;
  /** Hides the date when the surrounding section already states it. */
  hideDate?: boolean;
  /** Omits the bottom hairline border so sections and cards end cleanly. */
  isLast?: boolean;
  /** Pinned as one of Today's Top 3 MITs ("오늘의 핵심"). */
  isMit?: boolean;
  /** Marked for "오늘 저녁". */
  isEvening?: boolean;
  /** Selection mode for batch operations. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (task: Task) => void;
  onPress: (task: Task) => void;
  onComplete: (task: Task) => void;
  onSchedule?: (task: Task) => void;
  onPostpone?: (task: Task) => void;
  onFocus?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  /** Long press: the quick menu. */
  onLongPress?: (task: Task) => void;
  /** The list handles long presses itself (drag or menu), so releasing one must not count as a tap. */
  holdHandled?: boolean;
  swipeEnabled?: boolean;
  /** The row sits on a card, so its resting background is `colors.surface` instead of the page's. */
  onSurface?: boolean;
  /** Highlighted by keyboard list navigation. */
  focused?: boolean;
}

function triggerThresholdHaptic() {
  haptic.tap();
}

function SwipeIconMotion({ translation, side, threshold, children }: {
  translation: SharedValue<number>; side: 'left' | 'right'; threshold: number; children: ReactNode;
}) {
  const anim = useAnimatedStyle(() => {
    const dist = side === 'left' ? translation.value : -translation.value;
    if (dist <= 0) return { opacity: 0, transform: [{ scale: 0.75 }] };
    return {
      opacity: interpolate(dist, [0, threshold * 0.7, threshold], [0.55, 0.92, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(dist, [0, threshold * 0.85, threshold], [0.75, 1, 1.1], Extrapolation.CLAMP) }],
    };
  }, [side, threshold, translation]);
  return <Animated.View style={anim}>{children}</Animated.View>;
}

function SwipeActionButton({ icon, label, color, foreground, translation, threshold, onPress }: {
  icon: SwipeIconName; label: string; color: string; foreground: string;
  translation: SharedValue<number>; threshold: number; onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.action, { backgroundColor: color }]}>
      <SwipeIconMotion translation={translation} side="right" threshold={threshold}>
        <Feather name={icon} size={20} color={foreground} />
      </SwipeIconMotion>
      <Text style={[styles.actionLabel, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

function SwipeSide({ translation, side, threshold, style, children }: {
  translation: SharedValue<number>; side: 'left' | 'right'; threshold: number;
  style: ComponentProps<typeof Animated.View>['style']; children: ReactNode;
}) {
  useAnimatedReaction(
    () => (side === 'left' ? translation.value >= threshold : translation.value <= -threshold),
    (crossed, prev) => {
      if (crossed && !prev) {
        scheduleOnRN(triggerThresholdHaptic);
      }
    },
    [side, threshold, translation],
  );
  const shown = useAnimatedStyle(() => {
    const dist = side === 'left' ? translation.value : -translation.value;
    if (dist <= 0) return { opacity: 0 };
    return {
      opacity: interpolate(dist, [0, threshold * 0.45, threshold], [0.45, 0.9, 1], Extrapolation.CLAMP),
    };
  }, [side, threshold, translation]);
  return <Animated.View style={[style, shown]}>{children}</Animated.View>;
}

function firstNoteLine(notes: string | null): string | undefined {
  if (!notes) return undefined;
  for (const raw of notes.split(/\r?\n/)) {
    const cleaned = raw.replace(/^[-*•]\s*(?:\[[ xX]\]\s*)?/, '').trim();
    if (cleaned) return cleaned;
  }
  return undefined;
}

export const TaskRow = memo(function TaskRow({
  task, projectName, projectIcon, tagNames, reminderBadge, subtaskProgress, subtasksExpanded, onToggleSubtasks, hideDate,
  isLast, isMit, isEvening, selectable, selected, onToggleSelect,
  onPress, onComplete, onSchedule, onPostpone, onFocus, onDelete, onLongPress, holdHandled, swipeEnabled = true, onSurface, focused,
}: TaskRowProps) {
  const { colors } = useTheme();
  const prefs = usePersonalPrefs();
  const metrics = DENSITY_METRICS[prefs.density];
  const swipe = useRef<SwipeableMethods>(null);
  const [checked, setChecked] = useState(false);
  const finishing = useRef(false);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleOpacity = useSharedValue(1);

  const clearTimers = useCallback(() => {
    if (finishTimer.current) {
      clearTimeout(finishTimer.current);
      finishTimer.current = null;
    }
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // If the same row instance receives a different task or updated occurrence, restore visual state.
  useEffect(() => {
    if (!finishing.current && checked) {
      setChecked(false);
      settleOpacity.set(1);
    }
  }, [task.id, task.due_at, checked, settleOpacity]);

  const settleStyle = useAnimatedStyle(() => ({ opacity: settleOpacity.value }));

  const due = formatDue(task, prefs.timeFormat);
  const repeat = describeRecurrence(task.recurrence_rule, task.recurrence_mode);
  const late = isPastDue(task);
  const bucket = dueBucket(task);

  const subtaskCount = subtaskProgress?.total ?? 0;
  const subtaskLabel = subtaskProgress
    ? (subtaskProgress.completed > 0 ? `${subtaskProgress.completed}/${subtaskProgress.total}` : String(subtaskProgress.open))
    : '';
  const hasProgress = (subtaskProgress?.completed ?? 0) > 0;
  const noteSnippet = prefs.showNotePreview && metrics.noteLines > 0 ? firstNoteLine(task.notes) : undefined;

  const resetFinishing = useCallback(() => {
    finishing.current = false;
    setChecked(false);
    settleOpacity.set(withTiming(1, { duration: 140 }));
  }, [settleOpacity]);

  const finish = useCallback(() => {
    if (checked || finishing.current) return;
    finishing.current = true;
    setChecked(true);
    settleOpacity.set(withTiming(0.45, { duration: 220 }));
    clearTimers();
    finishTimer.current = setTimeout(() => {
      finishTimer.current = null;
      try {
        onComplete(task);
      } catch {
        resetFinishing();
        return;
      }
      if (task.recurrence_rule) {
        resetFinishing();
      } else {
        // Safety net: if completion fails or the task remains mounted/open, restore the row cleanly.
        resetTimer.current = setTimeout(() => {
          resetTimer.current = null;
          resetFinishing();
        }, 650);
      }
    }, 240);
  }, [checked, clearTimers, onComplete, resetFinishing, settleOpacity, task]);

  const runFocus = useCallback(() => {
    if (onFocus) {
      onFocus(task);
      return;
    }
    router.navigate({
      pathname: '/focus',
      params: {
        taskId: task.id,
        title: task.title,
        autostart: '1',
        at: String(Date.now()),
        ...(task.duration_minutes ? { duration: String(task.duration_minutes), minutes: String(task.duration_minutes) } : {}),
      },
    });
  }, [onFocus, task]);

  const swipeVisual = (kind: AnySwipeAction): {
    key: AnySwipeAction; icon: SwipeIconName; label: string; color: string; foreground: string;
  } | null => {
    if (kind === 'none') return null;
    if (kind === 'complete') return { key: kind, icon: 'check', label: '완료', color: colors.accent, foreground: colors.onAccent };
    if (kind === 'tomorrow') {
      if (!onPostpone && !onSchedule) return null;
      return { key: kind, icon: 'sunrise', label: '내일', color: colors.textMuted, foreground: colors.background };
    }
    if (kind === 'schedule') {
      if (!onSchedule) return null;
      return { key: kind, icon: 'clock', label: '일정', color: colors.textMuted, foreground: colors.background };
    }
    if (kind === 'focus') return { key: kind, icon: 'play', label: '집중', color: colors.accent, foreground: colors.onAccent };
    if (kind === 'delete') {
      if (!onDelete) return null;
      return { key: kind, icon: 'trash-2', label: '삭제', color: colors.danger, foreground: colors.onDanger };
    }
    return null;
  };

  const executeSwipeAction = useCallback((kind: AnySwipeAction) => {
    if (kind === 'complete') {
      if (checked || finishing.current) return;
      haptic.success();
      finish();
    } else if (kind === 'tomorrow') {
      const handler = onPostpone ?? onSchedule;
      if (!handler) return;
      haptic.tap();
      handler(task);
    } else if (kind === 'schedule') {
      onSchedule?.(task);
    } else if (kind === 'focus') {
      haptic.tap();
      runFocus();
    } else if (kind === 'delete') {
      if (!onDelete) return;
      haptic.warning();
      onDelete(task);
    }
  }, [checked, finish, onDelete, onPostpone, onSchedule, runFocus, task]);

  const meta: {
    key: string; icon?: 'calendar' | 'clock' | 'repeat' | 'git-merge' | 'bell'; text: string; color: string; iconColor?: string;
    weight?: '500' | '600'; tabular?: boolean;
  }[] = [];
  const minutes = dueMinutes(task);
  if (due && !(hideDate && minutes === null)) {
    const timeOnly = hideDate && minutes !== null;
    meta.push({
      key: 'due', icon: timeOnly && !late ? undefined : 'calendar', text: timeOnly ? formatTime(minutes, prefs.timeFormat) : due,
      color: late ? colors.danger : colors.textMuted, iconColor: late ? colors.danger : colors.textFaint,
      weight: late || (!timeOnly && bucket === 'today') ? '600' : timeOnly ? '500' : undefined,
      tabular: true,
    });
  }
  if (task.duration_minutes) {
    meta.push({ key: 'duration', icon: 'clock', text: formatDurationMinutes(task.duration_minutes), color: colors.textMuted, tabular: true });
  }
  if (repeat) meta.push({ key: 'repeat', icon: 'repeat', text: repeat, color: colors.textMuted });
  if (reminderBadge?.active) {
    meta.push({ key: 'reminder', icon: 'bell', text: reminderBadge.label ?? '', color: colors.textMuted, tabular: true });
  }
  for (const name of tagNames ?? []) meta.push({ key: 'tag-' + name, text: '#' + name, color: colors.textFaint });
  if (subtaskCount && !onToggleSubtasks) {
    meta.push({ key: 'subtasks', icon: 'git-merge', text: subtaskLabel, color: colors.textMuted, tabular: true });
  }
  const mark = priorityMark(task.priority);
  const subtaskTone = subtasksExpanded ? colors.accentText : colors.textMuted;

  const row = (
    <Animated.View style={settleStyle}>
      <Pressable
        accessibilityRole={selectable ? 'checkbox' : 'button'}
        accessibilityState={selectable ? { checked: !!selected } : undefined}
        accessibilityLabel={taskA11yLabel(task.title, task.priority)}
        accessibilityHint={selectable ? '눌러서 선택 또는 해제' : '눌러서 자세히 보기'}
        onPress={() => {
          if (selectable && onToggleSelect) {
            haptic.tap();
            onToggleSelect(task);
            return;
          }
          onPress(task);
        }}
        onLongPress={!selectable && onLongPress ? () => {
          haptic.medium();
          onLongPress(task);
        } : !selectable && holdHandled ? () => {} : undefined}
        delayLongPress={350}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfaceMuted : focused ? colors.accentSoft : onSurface ? colors.surface : colors.background },
        ]}>
        {focused ? <View pointerEvents="none" style={[styles.focusBar, { backgroundColor: colors.accent }]} /> : null}
        <View style={[styles.check, { paddingTop: metrics.checkTop }]}>
          {selectable ? (
            <View
              style={[
                styles.selectBox,
                {
                  borderColor: selected ? colors.accent : colors.control,
                  backgroundColor: selected ? colors.accent : 'transparent',
                },
              ]}>
              {selected ? <Feather name="check" size={14} color={colors.onAccent} /> : null}
            </View>
          ) : (
            <Checkbox checked={checked} onPress={finish} label={task.title + ' 완료'} />
          )}
        </View>
        <View
          style={[
            styles.body,
            {
              paddingVertical: metrics.paddingVertical,
              minHeight: metrics.minHeight,
              borderBottomColor: colors.border,
              borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
            },
          ]}>
          <View style={styles.titleRow}>
            <Text
              numberOfLines={2}
              style={[
                type.body as TextStyle,
                styles.titleText,
                { color: checked ? colors.textFaint : colors.text },
                checked && { textDecorationLine: 'line-through' },
              ]}>
              {mark ? <Text style={styles.mark}>{mark + ' '}</Text> : null}
              {task.title}
            </Text>
            {isMit || isEvening ? (
              <View style={styles.badges}>
                {isMit ? <Feather name="star" size={13} color={colors.accentText} accessibilityLabel="오늘의 핵심" /> : null}
                {isEvening ? <Feather name="moon" size={13} color={colors.textMuted} accessibilityLabel="오늘 저녁" /> : null}
              </View>
            ) : null}
          </View>
          {!checked && noteSnippet ? (
            <Text numberOfLines={metrics.noteLines} style={[type.meta as TextStyle, { color: colors.textMuted }]}>
              {noteSnippet}
            </Text>
          ) : null}
          {meta.length || projectName || (subtaskCount && onToggleSubtasks) ? (
            <View style={styles.metaRow}>
              <View style={styles.meta}>
                {meta.map((item) => (
                  <View key={item.key} style={styles.metaItem}>
                    {item.icon ? <Feather name={item.icon} size={11} color={item.iconColor ?? colors.textFaint} /> : null}
                    {item.text ? (
                      <Text
                        style={[
                          type.meta as TextStyle,
                          { color: item.color },
                          item.weight && { fontWeight: item.weight },
                          item.tabular && styles.tabular,
                        ]}
                        numberOfLines={1}>
                        {item.text}
                      </Text>
                    ) : null}
                  </View>
                ))}
                {subtaskCount && onToggleSubtasks ? (
                  <Pressable
                    accessibilityRole="button" accessibilityLabel={`하위 작업 ${subtaskLabel} ${subtasksExpanded ? '접기' : '펼치기'}`}
                    hitSlop={6}
                    onPress={(event) => {
                      event.stopPropagation();
                      haptic.tap();
                      onToggleSubtasks(task);
                    }}
                    style={[
                      styles.subtaskPill,
                      { backgroundColor: subtasksExpanded ? colors.accentSoft : colors.surfaceMuted },
                    ]}>
                    <Feather name={hasProgress ? 'check-square' : 'git-merge'} size={11} color={subtaskTone} />
                    <Text style={[type.metaStrong as TextStyle, styles.tabular, { color: subtaskTone }]}>{subtaskLabel}</Text>
                    <Feather name={subtasksExpanded ? 'chevron-up' : 'chevron-down'} size={12} color={subtaskTone} />
                  </Pressable>
                ) : null}
              </View>
              {projectName ? (
                <View style={styles.metaItem}>
                  <Feather name={projectIcon ?? 'hash'} size={11} color={colors.textFaint} />
                  <Text style={[type.meta as TextStyle, { color: colors.textFaint }]} numberOfLines={1}>{projectName}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );

  const leftAction = swipeVisual(prefs.swipeLeft);
  const rightPrimary = swipeVisual(prefs.swipeRightPrimary);
  const rightSecondary = prefs.swipeRightSecondary !== prefs.swipeRightPrimary ? swipeVisual(prefs.swipeRightSecondary) : null;
  const rightActions = [rightPrimary, rightSecondary].filter((item): item is NonNullable<typeof item> => item !== null);

  if (!swipeEnabled || selectable || (!leftAction && rightActions.length === 0)) return row;
  return (
    <Swipeable
      ref={swipe} friction={1.6} overshootFriction={8} leftThreshold={LEFT_THRESHOLD} rightThreshold={RIGHT_THRESHOLD}
      renderLeftActions={leftAction ? (_progress, translation) => (
        <SwipeSide translation={translation} side="left" threshold={LEFT_THRESHOLD} style={[styles.complete, { backgroundColor: leftAction.color }]}>
          <SwipeIconMotion translation={translation} side="left" threshold={LEFT_THRESHOLD}>
            <Feather name={leftAction.icon} size={22} color={leftAction.foreground} />
          </SwipeIconMotion>
          <Text style={[styles.actionLabel, { color: leftAction.foreground }]}>{leftAction.label}</Text>
        </SwipeSide>
      ) : undefined}
      renderRightActions={rightActions.length > 0 ? (_progress, translation) => (
        <SwipeSide translation={translation} side="right" threshold={RIGHT_THRESHOLD} style={styles.actions}>
          {rightActions.map((item) => (
            <SwipeActionButton
              key={item.key} icon={item.icon} label={item.label} color={item.color} foreground={item.foreground}
              translation={translation} threshold={RIGHT_THRESHOLD}
              onPress={() => {
                swipe.current?.close();
                executeSwipeAction(item.key);
              }} />
          ))}
        </SwipeSide>
      ) : undefined}
      onSwipeableWillOpen={(direction) => {
        if (direction !== 'right' || !leftAction) return;
        swipe.current?.close();
        executeSwipeAction(leftAction.key);
      }}>
      {row}
    </Swipeable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: space.lg },
  focusBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  check: { paddingTop: 11, paddingRight: space.md },
  selectBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.8, alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, gap: 3, paddingVertical: 11, paddingRight: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 46 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  titleText: { flex: 1 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  meta: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: 190 },
  subtaskPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 28, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm,
  },
  tabular: { fontVariant: ['tabular-nums'] },
  complete: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.xl },
  actions: { flexDirection: 'row' },
  action: { width: 76, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionLabel: { fontFamily, fontSize: 12, fontWeight: '600' },
  mark: { fontWeight: '700' },
});
