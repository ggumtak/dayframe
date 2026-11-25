import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Chip, Divider, Icon, IconButton, ProgressBar, Txt } from '@/components/ui';
import { useHabitActions } from '@/data/habits';
import { KEY_PRIORITY, matchesCombo, useKeyHandler } from '@/features/keyboard';
import { formatDuration } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useLayout } from '@/lib/layoutContext';
import type { Habit, HabitLog } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

import { habitLook } from './display';
import { logsByDate, periodProgress } from './goal';
import { HabitAvatar } from './HabitAvatar';
import type { HabitMeta } from './habitMeta';

export interface RoutineRunnerItem {
  habit: Habit;
  logs: HabitLog[];
  meta?: HabitMeta;
  date: string;
}

type TimerMode =
  | { kind: 'countdown'; totalSeconds: number }
  | { kind: 'stopwatch' };

const TIMER_PRESETS: readonly { label: string; mode: TimerMode }[] = [
  { label: '1분', mode: { kind: 'countdown', totalSeconds: 60 } },
  { label: '3분', mode: { kind: 'countdown', totalSeconds: 180 } },
  { label: '5분', mode: { kind: 'countdown', totalSeconds: 300 } },
  { label: '10분', mode: { kind: 'countdown', totalSeconds: 600 } },
  { label: '스톱워치', mode: { kind: 'stopwatch' } },
];

function isSettledItem(item: RoutineRunnerItem): boolean {
  const byDate = logsByDate(item.logs);
  const todayCount = byDate.get(item.date)?.count ?? 0;
  const progress = periodProgress(item.habit, item.logs, item.date);
  return progress >= item.habit.target_count || (item.habit.cadence === 'weekly' && todayCount > 0);
}

/**
 * Distraction-free step-by-step runner for a time-of-day routine or today's habits.
 * Keeps strictly one filled accent button on screen and an optional built-in step timer.
 */
export function RoutineRunner({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: RoutineRunnerItem[];
  onClose: () => void;
}) {
  if (!visible) return null;
  return <RoutineRunnerBody title={title} items={items} onClose={onClose} />;
}

function RoutineRunnerBody({
  title,
  items,
  onClose,
}: {
  title: string;
  items: RoutineRunnerItem[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { column } = useLayout();
  const actions = useHabitActions();

  const [stepIndex, setStepIndex] = useState(() => {
    const firstOpen = items.findIndex((item) => !isSettledItem(item));
    return firstOpen >= 0 ? firstOpen : 0;
  });
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  const [finished, setFinished] = useState(() => items.length > 0 && items.every((item) => isSettledItem(item)));

  // Built-in lightweight step timer state (pure outside the interval subscription).
  const [timerMode, setTimerMode] = useState<TimerMode | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const resetTimer = () => {
    setTimerMode(null);
    setTimerRunning(false);
    setElapsedMs(0);
  };

  // Tick elapsed milliseconds using monotonic delta inside the interval callback.
  useEffect(() => {
    if (!timerRunning || !timerMode) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const delta = Math.max(0, now - last);
      last = now;
      setElapsedMs((prev) => {
        const next = prev + delta;
        if (timerMode.kind === 'countdown' && next >= timerMode.totalSeconds * 1000) {
          setTimerRunning(false);
          haptic.success();
          return timerMode.totalSeconds * 1000;
        }
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, [timerRunning, timerMode]);

  const totalElapsedSeconds = Math.floor(elapsedMs / 1000);
  const countdownRemaining = timerMode?.kind === 'countdown'
    ? Math.max(0, timerMode.totalSeconds - totalElapsedSeconds)
    : 0;
  const countdownDone = timerMode?.kind === 'countdown' && countdownRemaining === 0 && elapsedMs > 0;

  const states = useMemo(() => items.map((item) => {
    const byDate = logsByDate(item.logs);
    const todayLog = byDate.get(item.date);
    const todayCount = todayLog?.count ?? 0;
    const progress = periodProgress(item.habit, item.logs, item.date);
    const settled = progress >= item.habit.target_count || (item.habit.cadence === 'weekly' && todayCount > 0);
    return { item, todayLog, todayCount, progress, settled };
  }), [items]);

  const safeIndex = Math.max(0, Math.min(stepIndex, Math.max(0, states.length - 1)));
  const current = states[safeIndex];
  const doneCount = states.filter((entry) => entry.settled).length;
  const remainingCount = states.filter((entry) => !entry.settled && !skippedIds.has(entry.item.habit.id)).length;

  const findNextStep = (fromIndex: number, justCompletedId?: string, nextSkipped?: Set<string>): number => {
    const skipSet = nextSkipped ?? skippedIds;
    const isPending = (index: number) => {
      const entry = states[index];
      if (!entry) return false;
      const id = entry.item.habit.id;
      if (id === justCompletedId) return false;
      if (entry.settled) return false;
      if (skipSet.has(id)) return false;
      return true;
    };
    for (let i = fromIndex + 1; i < states.length; i += 1) {
      if (isPending(i)) return i;
    }
    for (let i = 0; i < fromIndex; i += 1) {
      if (isPending(i)) return i;
    }
    return -1;
  };

  const jumpTo = (index: number) => {
    if (index < 0 || index >= states.length) return;
    haptic.tap();
    resetTimer();
    setFinished(false);
    setStepIndex(index);
  };

  const completeCurrent = () => {
    if (!current) return;
    const { item, todayLog, todayCount, settled } = current;
    const { habit, date } = item;
    resetTimer();
    if (!settled) {
      const prevStatus = todayLog?.status ?? null;
      const prevCount = todayLog?.count ?? 0;
      const targetCount = habit.cadence === 'weekly' ? 1 : Math.max(todayCount + 1, habit.target_count);
      haptic.success();
      actions.setLog({ habitId: habit.id, date, status: 'completed', count: targetCount });
      showToast(`‘${habit.name}’ 완료했습니다.`, {
        actionLabel: '실행 취소',
        onAction: () => {
          haptic.light();
          actions.setLog({ habitId: habit.id, date, status: prevStatus, count: prevCount });
        },
      });
    } else {
      haptic.tap();
    }
    const next = findNextStep(safeIndex, habit.id);
    if (next >= 0) setStepIndex(next);
    else setFinished(true);
  };

  const incrementCurrent = () => {
    if (!current) return;
    const { item, todayLog, todayCount } = current;
    const { habit, date } = item;
    if (habit.cadence !== 'daily' || habit.target_count <= 1) return;
    const prevStatus = todayLog?.status ?? null;
    const prevCount = todayLog?.count ?? 0;
    const nextCount = todayCount + 1;
    const reaches = nextCount >= habit.target_count;
    if (reaches) haptic.success();
    else haptic.light();
    actions.setLog({ habitId: habit.id, date, status: 'completed', count: nextCount });
    showToast(
      reaches ? `‘${habit.name}’ 오늘 목표를 달성했습니다!` : `‘${habit.name}’ ${nextCount}/${habit.target_count}회 기록했습니다.`,
      {
        actionLabel: '실행 취소',
        onAction: () => {
          haptic.light();
          actions.setLog({ habitId: habit.id, date, status: prevStatus, count: prevCount });
        },
      },
    );
    if (reaches) {
      resetTimer();
      const next = findNextStep(safeIndex, habit.id);
      if (next >= 0) setStepIndex(next);
      else setFinished(true);
    }
  };

  const skipCurrent = () => {
    if (!current) return;
    haptic.tap();
    resetTimer();
    const nextSkipped = new Set(skippedIds);
    nextSkipped.add(current.item.habit.id);
    setSkippedIds(nextSkipped);
    const next = findNextStep(safeIndex, undefined, nextSkipped);
    if (next >= 0) setStepIndex(next);
    else setFinished(true);
  };

  const selectTimerPreset = (mode: TimerMode) => {
    haptic.tap();
    const same = timerMode
      && timerMode.kind === mode.kind
      && (mode.kind === 'stopwatch' || (timerMode.kind === 'countdown' && timerMode.totalSeconds === mode.totalSeconds));
    if (same) {
      resetTimer();
      return;
    }
    setTimerMode(mode);
    setElapsedMs(0);
    setTimerRunning(true);
  };

  const toggleTimerRunning = () => {
    if (!timerMode) return;
    haptic.tap();
    if (timerRunning) {
      setTimerRunning(false);
    } else {
      if (timerMode.kind === 'countdown' && countdownRemaining === 0) {
        setElapsedMs(0);
      }
      setTimerRunning(true);
    }
  };

  const restartTimer = () => {
    if (!timerMode) return;
    haptic.tap();
    setElapsedMs(0);
    setTimerRunning(false);
  };

  useKeyHandler(
    (event) => {
      if (event.editing) return false;
      if (matchesCombo(event, 'escape')) {
        if (!event.repeat) onClose();
        return true;
      }
      if (finished) {
        if (matchesCombo(event, 'enter') || matchesCombo(event, 'space')) {
          if (!event.repeat) onClose();
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'enter') || matchesCombo(event, 'space')) {
        if (!event.repeat) completeCurrent();
        return true;
      }
      if (matchesCombo(event, 's')) {
        if (!event.repeat) skipCurrent();
        return true;
      }
      if (matchesCombo(event, 'arrowright')) {
        if (!event.repeat && safeIndex < states.length - 1) jumpTo(safeIndex + 1);
        return true;
      }
      if (matchesCombo(event, 'arrowleft')) {
        if (!event.repeat && safeIndex > 0) jumpTo(safeIndex - 1);
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: true },
  );

  const look = current ? habitLook(current.item.habit.name, current.item.meta) : null;
  const isMultiDaily = !!current && current.item.habit.cadence === 'daily' && current.item.habit.target_count > 1;
  const progressRatio = states.length > 0 ? doneCount / states.length : 0;
  const primaryLabel = current?.settled
    ? (remainingCount > 0 ? '완료됨 · 다음 습관' : '완료 화면 보기')
    : (remainingCount <= 1 ? '완료하기' : '완료하고 다음');

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[styles.column, column.maxWidth ? { maxWidth: column.maxWidth } : null]}>
          {/* Top bar: title, step counter, close */}
          <View style={styles.topBar}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="section" tone="muted">{title}</Txt>
              <Txt variant="small" tone="faint" tabular>
                {finished ? `${doneCount} / ${states.length} 완료` : `${safeIndex + 1} / ${states.length}`}
              </Txt>
            </View>
            <IconButton name="x" label="루틴 닫기" onPress={onClose} color={colors.textMuted} />
          </View>

          <View style={{ paddingHorizontal: space.lg }}>
            <ProgressBar value={progressRatio} height={4} />
          </View>

          {finished || !current ? (
            <ScrollView contentContainerStyle={styles.doneScroll} showsVerticalScrollIndicator={false}>
              <View style={[styles.doneIcon, { backgroundColor: colors.accentSoft }]}>
                <Icon name="check" size={32} color={colors.accent} />
              </View>
              <Txt variant="title" tabular style={{ textAlign: 'center' }}>
                {title} {doneCount}/{states.length} 완료!
              </Txt>
              <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
                {doneCount === states.length
                  ? '오늘의 루틴을 모두 마쳤습니다. 차분하게 다음 일정을 이어가 보세요.'
                  : '건너뛴 습관은 오늘 안에 언제든 이어서 완료할 수 있습니다.'}
              </Txt>

              <Card style={{ alignSelf: 'stretch', paddingVertical: space.xs, marginTop: space.md }}>
                {states.map((entry, idx) => {
                  const entryLook = habitLook(entry.item.habit.name, entry.item.meta);
                  return (
                    <View key={entry.item.habit.id}>
                      {idx > 0 ? <Divider /> : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${entry.item.habit.name} 단계로 이동`}
                        onPress={() => jumpTo(idx)}
                        style={styles.summaryRow}>
                        <HabitAvatar name={entry.item.habit.name} emoji={entryLook.emoji} size={28} />
                        <Txt variant="body" style={{ flex: 1 }} numberOfLines={1}>{entry.item.habit.name}</Txt>
                        {entry.settled ? (
                          <View style={styles.summaryStatus}>
                            <Icon name="check" size={14} color={colors.accentText} />
                            <Txt variant="smallStrong" tone="accent">완료</Txt>
                          </View>
                        ) : (
                          <Txt variant="small" tone="faint">건너뜀</Txt>
                        )}
                      </Pressable>
                    </View>
                  );
                })}
              </Card>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.stepScroll} showsVerticalScrollIndicator={false}>
              {/* Tappable step dots */}
              <View style={styles.dots} accessibilityRole="tablist" accessibilityLabel="루틴 단계">
                {states.map((entry, idx) => {
                  const active = idx === safeIndex;
                  const skipped = skippedIds.has(entry.item.habit.id) && !entry.settled;
                  return (
                    <Pressable
                      key={entry.item.habit.id}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${idx + 1}단계 ${entry.item.habit.name}${entry.settled ? ', 완료됨' : ''}`}
                      hitSlop={8}
                      onPress={() => jumpTo(idx)}
                      style={[
                        styles.dot,
                        {
                          width: active ? 22 : 8,
                          backgroundColor: entry.settled
                            ? colors.accent
                            : active
                              ? colors.text
                              : skipped
                                ? 'transparent'
                                : colors.border,
                          borderWidth: skipped ? 1.5 : 0,
                          borderColor: skipped ? colors.control : 'transparent',
                        },
                      ]}
                    />
                  );
                })}
              </View>

              {/* Current habit focal card */}
              <View style={styles.focusArea}>
                <HabitAvatar name={current.item.habit.name} emoji={look?.emoji} size={76} />
                <Txt variant="title" style={{ textAlign: 'center', marginTop: space.md }}>
                  {current.item.habit.name}
                </Txt>
                {current.item.meta?.quote ? (
                  <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
                    “{current.item.meta.quote}”
                  </Txt>
                ) : null}

                {/* Progress pill */}
                <View style={[styles.progressPill, { backgroundColor: current.settled ? colors.accentSoft : colors.surfaceMuted }]}>
                  <Icon
                    name={current.settled ? 'check-circle' : 'circle'}
                    size={14}
                    color={current.settled ? colors.accentText : colors.textMuted}
                  />
                  <Txt variant="smallStrong" tone={current.settled ? 'accent' : 'muted'} tabular>
                    {current.item.habit.cadence === 'weekly'
                      ? `이번 주 ${current.progress}/${current.item.habit.target_count}회`
                      : `${current.progress}/${current.item.habit.target_count}`}
                  </Txt>
                  {isMultiDaily && !current.settled ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${current.item.habit.name} 1회 추가 기록`}
                      hitSlop={6}
                      onPress={incrementCurrent}
                      style={[styles.plusOne, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Txt variant="metaStrong" tone="accent">+1</Txt>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {/* Optional built-in step timer */}
              <Card style={styles.timerCard}>
                <View style={styles.timerHeader}>
                  <Icon name="clock" size={14} color={colors.textMuted} />
                  <Txt variant="smallStrong" tone="muted" style={{ flex: 1 }}>단계 타이머 (선택)</Txt>
                  {timerMode ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="타이머 닫기" hitSlop={8} onPress={resetTimer}>
                      <Txt variant="meta" tone="faint">닫기</Txt>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.presetRow}>
                  {TIMER_PRESETS.map((preset) => {
                    const selected = !!timerMode
                      && timerMode.kind === preset.mode.kind
                      && (preset.mode.kind === 'stopwatch'
                        || (timerMode.kind === 'countdown' && timerMode.totalSeconds === preset.mode.totalSeconds));
                    return (
                      <Chip
                        key={preset.label}
                        label={preset.label}
                        selected={selected}
                        onPress={() => selectTimerPreset(preset.mode)}
                      />
                    );
                  })}
                </View>

                {timerMode ? (
                  <View style={styles.timerBody}>
                    <Txt variant="title" tabular style={styles.timerReadout}>
                      {timerMode.kind === 'countdown'
                        ? formatDuration(countdownRemaining)
                        : formatDuration(totalElapsedSeconds)}
                    </Txt>
                    {timerMode.kind === 'countdown' ? (
                      <View style={{ alignSelf: 'stretch' }}>
                        <ProgressBar
                          value={timerMode.totalSeconds > 0 ? 1 - countdownRemaining / timerMode.totalSeconds : 1}
                          height={4}
                        />
                      </View>
                    ) : null}
                    {countdownDone ? (
                      <Txt variant="smallStrong" tone="accent">타이머가 완료되었습니다</Txt>
                    ) : null}
                    <View style={styles.timerControls}>
                      <Button
                        label={timerRunning ? '일시정지' : countdownDone ? '다시 시작' : '재개'}
                        icon={timerRunning ? 'pause' : 'play'}
                        kind="secondary"
                        onPress={toggleTimerRunning}
                        style={styles.timerBtn}
                      />
                      <IconButton
                        name="rotate-ccw"
                        label="타이머 초기화"
                        onPress={restartTimer}
                        color={colors.textMuted}
                        style={{ backgroundColor: colors.surfaceMuted }}
                      />
                    </View>
                  </View>
                ) : null}
              </Card>
            </ScrollView>
          )}

          {/* Thumb-friendly bottom actions: strictly 1 filled accent button */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            {finished || !current ? (
              <Button label="마치기" icon="check" onPress={onClose} />
            ) : (
              <>
                <Button label={primaryLabel} icon="check" onPress={completeCurrent} />
                <Button label="건너뛰기" kind="secondary" icon="skip-forward" onPress={skipCurrent} />
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: '100%', alignSelf: 'center' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm,
  },
  dots: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    flexWrap: 'wrap', gap: 6, paddingTop: space.sm,
  },
  dot: { height: 8, borderRadius: radius.pill },
  stepScroll: {
    flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl,
    gap: space.xl, justifyContent: 'space-between',
  },
  focusArea: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  progressPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.xs,
    paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill,
  },
  plusOne: {
    marginLeft: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1,
  },
  timerCard: { gap: space.md, paddingVertical: space.md },
  timerHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  timerBody: { alignItems: 'center', gap: space.md, paddingTop: space.xs },
  timerReadout: { fontSize: 36, lineHeight: 42 },
  timerControls: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'stretch' },
  timerBtn: { flex: 1, minHeight: 42 },
  doneScroll: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: space.lg, paddingVertical: space.xl, gap: space.md,
  },
  doneIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  summaryStatus: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footer: {
    paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth, gap: space.sm,
  },
});
