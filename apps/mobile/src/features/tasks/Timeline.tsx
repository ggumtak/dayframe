import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, type ScrollViewInstance, StyleSheet, Text, type TextStyle, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Checkbox } from '@/components/Checkbox';
import { Button, Icon, IconButton, Sheet, Txt } from '@/components/ui';
import { useDeleteFocus } from '@/data/focus';
import { dueMinutes, formatDurationMinutes, formatTime, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { FocusSession, Task } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { elevation, priorityColor, radius, space, type, useTheme } from '@/theme';

const HOUR = 76;
const GUTTER = 62;
const DEFAULT_BLOCK_MINUTES = 30;
const MIN_VISUAL_MINUTES = 24;
const SNAP_MINUTES = 15;

const hourLabel = (hour: number) => (hour < 12 ? '오전 ' : '오후 ') + (hour % 12 === 0 ? 12 : hour % 12) + '시';

interface Placed { task: Task; start: number; duration: number; column: number; columns: number }

/** Lays out timed tasks using each task's estimated duration (default 30 min); overlapping blocks share the row width. */
function place(tasks: Task[]): Placed[] {
  const timed = tasks
    .map((task) => {
      const start = dueMinutes(task);
      if (start === null) return null;
      const raw = task.duration_minutes ?? DEFAULT_BLOCK_MINUTES;
      const duration = Math.max(MIN_VISUAL_MINUTES, Math.min(1440 - start, raw));
      return { task, start, duration };
    })
    .filter((item): item is { task: Task; start: number; duration: number } => item !== null)
    .sort((a, b) => a.start - b.start || b.duration - a.duration);

  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const close = () => {
    const columns = Math.max(1, ...group.map((item) => item.column + 1));
    group.forEach((item) => { item.columns = columns; });
    group = [];
  };
  for (const { task, start, duration } of timed) {
    if (start >= groupEnd) close();
    const taken = new Set(group.filter((item) => item.start + item.duration > start).map((item) => item.column));
    let column = 0;
    while (taken.has(column)) column++;
    const item = { task, start, duration, column, columns: 1 };
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
  item, nowMinutes, onComplete, onRescheduleTime,
}: {
  item: Placed;
  nowMinutes: number;
  onComplete: (task: Task) => void;
  onRescheduleTime?: (task: Task, minutes: number) => void;
}) {
  const { colors } = useTheme();
  const { task, start, duration, column, columns } = item;
  const tint = priorityColor(colors, task.priority);
  const blockHeight = Math.max(30, (duration / 60) * HOUR - 2);
  const tall = blockHeight >= 52;

  const dragY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastSnap = useSharedValue(start);
  const [previewMinutes, setPreviewMinutes] = useState<number | null>(null);

  const pan = Gesture.Pan()
    .enabled(!!onRescheduleTime)
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
      const clamped = Math.max(0, Math.min(24 * 60 - SNAP_MINUTES, start + deltaMin));
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
    zIndex: dragging.value ? 20 : 1,
    opacity: dragging.value ? 0.95 : 1,
  }));

  const shownStart = previewMinutes ?? start;
  const end = (shownStart + (task.duration_minutes ?? DEFAULT_BLOCK_MINUTES)) % 1440;
  const rangeLabel = task.duration_minutes
    ? `${formatTime(shownStart)} ~ ${formatTime(end)} · ${formatDurationMinutes(task.duration_minutes)}`
    : formatTime(shownStart);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.block,
          {
            top: (start / 60) * HOUR + 1,
            height: blockHeight,
            left: `${(column / columns) * 100}%`,
            width: `${100 / columns}%`,
          },
          animatedStyle,
        ]}>
        <Pressable
          accessibilityRole="button" accessibilityLabel={rangeLabel + ' ' + task.title}
          accessibilityHint={onRescheduleTime ? '길게 눌러 위아래로 끌면 시간이 바뀝니다' : undefined}
          onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
          style={[
            styles.blockInner,
            { backgroundColor: colors.surface, borderColor: previewMinutes !== null ? colors.accent : colors.border, borderLeftColor: tint },
            tall && styles.blockInnerTall,
            previewMinutes !== null && elevation(colors, 2),
          ]}>
          <Checkbox checked={false} size={18} color={tint} onPress={() => onComplete(task)} label={task.title + ' 완료'} />
          {tall ? (
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={2} style={[type.smallStrong as TextStyle, { color: colors.text }]}>{task.title}</Text>
              <Txt variant="caption" tone={previewMinutes !== null ? 'accent' : start < nowMinutes ? 'danger' : 'muted'} numberOfLines={1}>
                {rangeLabel}
              </Txt>
            </View>
          ) : (
            <>
              <Text numberOfLines={1} style={[type.small as TextStyle, { color: colors.text, flex: 1 }]}>{task.title}</Text>
              {columns === 1 ? (
                <Txt variant="caption" tone={previewMinutes !== null ? 'accent' : start < nowMinutes ? 'danger' : 'muted'}>
                  {previewMinutes !== null ? formatTime(previewMinutes) : task.duration_minutes ? formatDurationMinutes(task.duration_minutes) : formatTime(start)}
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
  tasks, sessions, timeZone, overdueCount = 0, onComplete, onAddAt, onRescheduleTime, onPlanOverdue,
}: {
  tasks: Task[];
  sessions: FocusSession[];
  timeZone: string;
  overdueCount?: number;
  onComplete: (task: Task) => void;
  onAddAt: (minutes: number) => void;
  onRescheduleTime?: (task: Task, minutes: number) => void;
  onPlanOverdue?: () => void;
}) {
  const { colors } = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const scrolled = useRef(false);
  const [now, setNow] = useState(() => Temporal.Now.zonedDateTimeISO(timeZone));
  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const nowMinutes = now.hour * 60 + now.minute;
  const placed = useMemo(() => place(tasks), [tasks]);
  const allDay = tasks.filter((task) => task.all_day);
  const shownAllDay = allDayExpanded ? allDay : allDay.slice(0, 2);
  const hiddenAllDay = allDay.length - shownAllDay.length;
  const [picked, setPicked] = useState<{ id: string; start: number; end: number; spent: number } | null>(null);
  const deleteFocus = useDeleteFocus();

  useEffect(() => {
    const timer = setInterval(() => setNow(Temporal.Now.zonedDateTimeISO(timeZone)), 60_000);
    return () => clearInterval(timer);
  }, [timeZone]);

  const focusBlocks = useMemo(() => sessions.flatMap((session) => {
    if (session.status !== 'completed' || !session.ended_at) return [];
    const start = Temporal.Instant.from(session.started_at).toZonedDateTimeISO(timeZone);
    if (Temporal.PlainDate.compare(start.toPlainDate(), now.toPlainDate()) !== 0) return [];
    const minutes = Math.max(10, Temporal.Instant.from(session.started_at).until(Temporal.Instant.from(session.ended_at)).total('minutes'));
    const end = Temporal.Instant.from(session.ended_at).toZonedDateTimeISO(timeZone);
    return [{
      id: session.id, start: start.hour * 60 + start.minute, minutes, end: end.hour * 60 + end.minute,
      spent: Math.round(Temporal.Instant.from(session.started_at).until(Temporal.Instant.from(session.ended_at)).total('minutes')),
    }];
  }), [sessions, timeZone, now]);

  const plannedTotalMinutes = useMemo(
    () => tasks.reduce((sum, task) => sum + (task.duration_minutes ?? (!task.all_day && task.due_at ? DEFAULT_BLOCK_MINUTES : 0)), 0),
    [tasks],
  );
  const focusTotalMinutes = useMemo(
    () => focusBlocks.reduce((sum, block) => sum + block.spent, 0),
    [focusBlocks],
  );

  const nowClock = `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;

  return (
    <View style={{ flex: 1 }}>
      {overdueCount > 0 && onPlanOverdue ? (
        <Pressable
          accessibilityRole="button" accessibilityLabel={`지연된 할 일 ${overdueCount}개 정리하기`}
          onPress={onPlanOverdue}
          style={({ pressed }) => [styles.overdueBar, { backgroundColor: colors.dangerSoft, borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
          <Icon name="alert-circle" size={14} color={colors.danger} />
          <Txt variant="caption" style={{ color: colors.danger, fontWeight: '700', flex: 1 }}>
            지연된 할 일 {overdueCount}개가 타임라인 밖에 있습니다
          </Txt>
          <Txt variant="caption" style={{ color: colors.danger, fontWeight: '700' }}>정리하기 →</Txt>
        </Pressable>
      ) : null}

      <View style={[styles.budgetBar, { backgroundColor: colors.surfaceMuted, borderBottomColor: colors.border }]}>
        <Icon name="clock" size={13} color={colors.accent} />
        <Txt variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={1}>
          {plannedTotalMinutes > 0 || focusTotalMinutes > 0
            ? [
              plannedTotalMinutes > 0 ? `오늘 예정 ${formatDurationMinutes(plannedTotalMinutes)}` : null,
              focusTotalMinutes > 0 ? `집중 ${formatDurationMinutes(focusTotalMinutes)}` : null,
            ].filter(Boolean).join(' · ')
            : '빈 시간 눌러 추가 · 블록 길게 눌러 이동'}
        </Txt>
        {plannedTotalMinutes > 0 || focusTotalMinutes > 0 ? (
          <Txt variant="caption" tone="faint">블록 길게 눌러 이동</Txt>
        ) : null}
      </View>

      {allDay.length ? (
        <View style={[styles.allDay, { borderBottomColor: colors.border }]}>
          <Txt variant="caption" tone="faint" style={{ width: GUTTER - space.lg, paddingTop: 8 }}>종일 {allDay.length}</Txt>
          <View style={{ flex: 1, gap: 6 }}>
            {shownAllDay.map((task) => (
              <Pressable
                key={task.id} accessibilityRole="button" accessibilityLabel={task.title}
                onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
                style={[styles.allDayItem, { backgroundColor: colors.surfaceMuted }]}>
                <Checkbox checked={false} size={18} color={priorityColor(colors, task.priority)} onPress={() => onComplete(task)} label={task.title + ' 완료'} />
                <Text numberOfLines={1} style={[type.small as TextStyle, { color: colors.text, flex: 1 }]}>{task.title}</Text>
                {task.duration_minutes ? (
                  <Txt variant="caption" tone="faint">{formatDurationMinutes(task.duration_minutes)}</Txt>
                ) : null}
                {onRescheduleTime ? (
                  <IconButton
                    name="clock" label={task.title + ' 빈 시간에 자동 배치'} size={14} color={colors.accent}
                    onPress={() => {
                      const slot = findNextFreeSlot(placed, nowMinutes, task.duration_minutes ?? DEFAULT_BLOCK_MINUTES);
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
                <Icon name={allDayExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.accent} />
                <Txt variant="caption" tone="accent" style={{ fontWeight: '600' }}>
                  {allDayExpanded ? '종일 할 일 접기' : `종일 할 일 ${hiddenAllDay}개 더 보기`}
                </Txt>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <ScrollView
        ref={scroll} contentContainerStyle={{ paddingBottom: 140 }}
        onLayout={() => {
          if (scrolled.current) return;
          scrolled.current = true;
          scroll.current?.scrollTo({ y: Math.max(0, (nowMinutes / 60 - 1.5) * HOUR), animated: false });
        }}>
        <View style={{ height: HOUR * 24, marginTop: space.md }}>
          {Array.from({ length: 24 }, (_, hour) => (
            <View key={hour} style={[styles.hour, { top: hour * HOUR, borderTopColor: colors.border }]}>
              <Txt variant="caption" tone="faint" style={styles.hourLabel} numberOfLines={1}>{hourLabel(hour)}</Txt>
              <Pressable
                accessibilityRole="button" accessibilityLabel={formatTime(hour * 60) + '에 할 일 추가'}
                onPress={() => onAddAt(hour * 60)}
                style={styles.halfHour} />
              <Pressable
                accessibilityRole="button" accessibilityLabel={formatTime(hour * 60 + 30) + '에 할 일 추가'}
                onPress={() => onAddAt(hour * 60 + 30)}
                style={[styles.halfHour, styles.halfHourBottom, { borderTopColor: colors.border }]} />
            </View>
          ))}

          {focusBlocks.map((block) => (
            <Pressable
              key={block.id} accessibilityRole="button" accessibilityLabel={`집중 기록 ${formatTime(block.start)}, ${block.spent}분`}
              onPress={() => setPicked(block)}
              style={[styles.focus, { top: (block.start / 60) * HOUR, height: (block.minutes / 60) * HOUR, backgroundColor: colors.accentSoft, borderLeftColor: colors.accent }]} />
          ))}

          <View pointerEvents="box-none" style={styles.lane}>
            {placed.map((item) => (
              <DraggableBlock
                key={item.task.id} item={item} nowMinutes={nowMinutes}
                onComplete={onComplete} onRescheduleTime={onRescheduleTime} />
            ))}
          </View>

          <View pointerEvents="none" style={[styles.now, { top: (nowMinutes / 60) * HOUR - 9 }]}>
            <View style={[styles.nowPill, { backgroundColor: colors.danger }]}>
              <Text style={styles.nowPillText}>{nowClock}</Text>
            </View>
            <View style={{ flex: 1, height: 1.5, backgroundColor: colors.danger }} />
          </View>
        </View>
      </ScrollView>
      <Sheet visible={!!picked} onClose={() => setPicked(null)} title="집중 기록">
        {picked ? (
          <View style={{ gap: space.sm }}>
            <Txt tone="muted">{formatTime(picked.start) + ' ~ ' + formatTime(picked.end) + ' · ' + (picked.spent < 1 ? '1분 미만' : picked.spent + '분')}</Txt>
            <Txt variant="small" tone="faint" style={{ marginBottom: space.md }}>타임라인의 막대는 마친 집중 시간입니다. 잠깐 시험해 본 기록이라면 지워도 됩니다.</Txt>
            <Button
              label="이 기록 삭제" kind="danger" icon="trash-2"
              onPress={() => {
                deleteFocus.mutate(picked.id);
                setPicked(null);
                showToast('집중 기록을 지웠습니다.');
              }} />
            <Button label="닫기" kind="secondary" onPress={() => setPicked(null)} />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  overdueBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  budgetBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  allDay: { flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  allDayItem: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.sm, paddingLeft: space.sm, paddingRight: 4, minHeight: 34 },
  // Every layer stops at the same right margin as the rest of the app.
  hour: { position: 'absolute', left: GUTTER, right: space.lg, height: HOUR, borderTopWidth: StyleSheet.hairlineWidth },
  halfHour: { flex: 1 },
  halfHourBottom: { borderTopWidth: StyleSheet.hairlineWidth, opacity: 0.45 },
  hourLabel: { position: 'absolute', left: -GUTTER + space.sm, top: -7, width: GUTTER - space.md },
  lane: { position: 'absolute', top: 0, bottom: 0, left: GUTTER + 4, right: space.lg },
  block: { position: 'absolute', paddingRight: 4 },
  blockInner: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3, paddingHorizontal: space.sm,
  },
  blockInnerTall: { alignItems: 'flex-start', paddingVertical: 6 },
  focus: { position: 'absolute', left: GUTTER + 4, right: space.lg, borderRadius: radius.sm, borderLeftWidth: 3, opacity: 0.7 },
  now: { position: 'absolute', left: space.xs, right: space.lg, flexDirection: 'row', alignItems: 'center' },
  nowPill: {
    width: GUTTER - space.xs - 2, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginRight: 2,
  },
  nowPillText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
