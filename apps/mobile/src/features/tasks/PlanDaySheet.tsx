import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';

import { AiIcon } from '@/components/AiIcon';
import { Button, Chip, Icon, Segmented, Sheet, Txt } from '@/components/ui';
import { AI_ROUTES } from '@/features/ai/routes';
import { KEY_PRIORITY, matchesCombo, useKeyHandler, useListCursor } from '@/features/keyboard';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueDate, dueMinutes, formatDate, formatDurationMinutes, formatTime, logicalToday, type PlainDate, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { nextOccurrence, type Task, type TaskPatch } from '@/lib/shared';
import { planBalancedReschedule, type SubtaskProgress, suggestForToday } from '@/lib/smart';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

import { priorityMark } from './priority';
import { planAutoTimeSlots } from './todayList';
import { useTaskFlow } from './useTaskFlow';

const itemTaskId = (item: { task: Task }) => item.task.id;

function snapshotSchedule(task: Task): TaskPatch {
  return {
    due_at: task.due_at,
    all_day: task.all_day,
    recurrence_rule: task.recurrence_rule,
    recurrence_mode: task.recurrence_mode,
    recurrence_local_time: task.recurrence_local_time,
  };
}

/**
 * Daily planning ritual combining Todoist Smart Schedule (load-balanced overdue redistribution),
 * Any.do Plan My Day (1-tap overdue triage), and Microsoft To Do "My Day" suggestions.
 */
export function PlanDaySheet({
  visible, onClose, overdue, allOpen, openRoots, subtaskProgress, initialTab,
}: {
  visible: boolean;
  onClose: () => void;
  overdue: Task[];
  allOpen: Task[];
  openRoots: Task[];
  subtaskProgress: Map<string, SubtaskProgress>;
  initialTab?: 'overdue' | 'suggest';
}) {
  const { colors } = useTheme();
  const flow = useTaskFlow();
  const { dayStartHour, timeFormat } = usePersonalPrefs();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const nowMs = useMinute() * 60_000;
  const zone = deviceTimeZone();
  const nowInstant = useMemo(() => Temporal.Instant.fromEpochMilliseconds(nowMs), [nowMs]);
  const now = useMemo(() => logicalToday(zone, dayStartHour, nowInstant), [zone, dayStartHour, nowInstant]);
  const zonedNow = useMemo(() => nowInstant.toZonedDateTimeISO(zone), [nowInstant, zone]);
  const nowMinutes = zonedNow.hour * 60 + zonedNow.minute;

  const [tab, setTab] = useState<'overdue' | 'suggest'>(
    initialTab ?? (overdue.length > 0 ? 'overdue' : 'suggest'),
  );
  const wasVisible = useRef(visible);

  useEffect(() => {
    if (visible && !wasVisible.current) {
      const target = initialTab ?? (overdue.length > 0 ? 'overdue' : 'suggest');
      setTab(target === 'overdue' && overdue.length === 0 ? 'suggest' : target);
    }
    wasVisible.current = visible;
  }, [visible, initialTab, overdue.length]);

  const proposals = useMemo(
    () => planBalancedReschedule(overdue, allOpen, now, nextOccurrence, { horizonDays: 7, dailyCap: 5 }),
    [overdue, allOpen, now],
  );

  const suggestions = useMemo(
    () => suggestForToday(openRoots, subtaskProgress, nowMs, 8),
    [openRoots, subtaskProgress, nowMs],
  );

  const autoSlotPlan = useMemo(() => {
    const allDayToday: Task[] = [];
    const timedBlocks: { start: number; duration: number }[] = [];
    for (const task of openRoots) {
      const d = dueDate(task);
      if (!d || Temporal.PlainDate.compare(d, now) !== 0) continue;
      if (task.all_day) {
        allDayToday.push(task);
      } else {
        const start = dueMinutes(task);
        if (start !== null) timedBlocks.push({ start, duration: task.duration_minutes ?? 30 });
      }
    }
    return planAutoTimeSlots(allDayToday, timedBlocks, nowMinutes);
  }, [openRoots, now, nowMinutes]);

  const rescheduleWithUndo = (task: Task, targetDate: PlainDate, label: string) => {
    const previousPatch = snapshotSchedule(task);
    haptic.tap();
    flow.reschedule(task, targetDate);
    showToast(`‘${task.title}’${josa(task.title, '을/를')} ${label}${josa(label, '으로/로')} 옮겼습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => flow.update(task.id, previousPatch),
    });
  };

  const applyBalanced = () => {
    if (!proposals.length) return;
    const snapshots = proposals.map((item) => ({ id: item.task.id, patch: snapshotSchedule(item.task) }));
    haptic.success();
    for (const item of proposals) {
      flow.reschedule(item.task, item.targetDate);
    }
    showToast(`기한이 지난 할 일 ${proposals.length}개를 여러 날에 나누어 옮겼습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => {
        for (const snap of snapshots) flow.update(snap.id, snap.patch);
      },
    });
    onClose();
  };

  const applyAllToday = () => {
    if (!overdue.length) return;
    const snapshots = overdue.map((task) => ({ id: task.id, patch: snapshotSchedule(task) }));
    haptic.success();
    flow.rescheduleOverdue();
    showToast(`기한이 지난 할 일 ${overdue.length}개를 모두 오늘로 옮겼습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => {
        for (const snap of snapshots) flow.update(snap.id, snap.patch);
      },
    });
    onClose();
  };

  const applyAutoSlots = () => {
    if (!autoSlotPlan.length) return;
    const snapshots = autoSlotPlan.map((item) => ({ id: item.task.id, patch: snapshotSchedule(item.task) }));
    haptic.success();
    for (const item of autoSlotPlan) {
      flow.reschedule(item.task, now, item.minutes);
    }
    showToast(`오늘 할 일 ${autoSlotPlan.length}개를 빈 시간에 배치했습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => {
        for (const snap of snapshots) flow.update(snap.id, snap.patch);
      },
    });
    onClose();
  };

  const addSuggestionToToday = (task: Task) => {
    const previousPatch = snapshotSchedule(task);
    haptic.success();
    flow.reschedule(task, now);
    showToast(`‘${task.title}’${josa(task.title, '을/를')} 오늘로 옮겼습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => flow.update(task.id, previousPatch),
    });
  };

  const tomorrow = now.add({ days: 1 });
  const nextMonday = now.add({ days: 8 - now.dayOfWeek });
  const activeTab = overdue.length === 0 ? 'suggest' : tab;
  const activeItems: readonly { task: Task }[] = activeTab === 'overdue' ? proposals : suggestions;
  const cursor = useListCursor(activeItems, itemTaskId, {
    enabled: visible,
    scrollRef,
    estimatedRowHeight: activeTab === 'overdue' ? 96 : 60,
  });

  useKeyHandler(
    (event) => {
      if (matchesCombo(event, 'escape')) {
        onClose();
        return true;
      }

      if (event.editing) return false;

      if (matchesCombo(event, 'tab')) {
        if (overdue.length > 0) {
          setTab((cur) => (cur === 'overdue' ? 'suggest' : 'overdue'));
        }
        return true;
      }

      if (matchesCombo(event, 'j') || matchesCombo(event, 'arrowdown')) {
        cursor.move(1);
        return true;
      }
      if (matchesCombo(event, 'k') || matchesCombo(event, 'arrowup')) {
        cursor.move(-1);
        return true;
      }

      if (activeTab === 'overdue') {
        if (matchesCombo(event, 'mod+enter') || matchesCombo(event, 'a')) {
          applyBalanced();
          return true;
        }
        if (matchesCombo(event, 'shift+t')) {
          applyAllToday();
          return true;
        }
        const item = cursor.focusedItem;
        if (item) {
          if (matchesCombo(event, 't')) {
            rescheduleWithUndo(item.task, now, '오늘');
            return true;
          }
          if (matchesCombo(event, 'w')) {
            rescheduleWithUndo(item.task, tomorrow, '내일');
            return true;
          }
          if (matchesCombo(event, 'x') || matchesCombo(event, 'space')) {
            haptic.success();
            flow.complete(item.task);
            return true;
          }
        }
      } else {
        const item = cursor.focusedItem;
        if (item && (matchesCombo(event, 'enter') || matchesCombo(event, 'space'))) {
          addSuggestionToToday(item.task);
          return true;
        }
      }

      return true;
    },
    { priority: KEY_PRIORITY.sheet, enabled: visible },
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="하루 계획">
      {overdue.length > 0 ? (
        <View style={{ marginBottom: space.md }}>
          <Segmented<'overdue' | 'suggest'>
            value={activeTab} onChange={setTab}
            options={[
              { value: 'overdue', label: `기한 지남 ${overdue.length}`, icon: 'alert-circle' },
              { value: 'suggest', label: `추천 ${suggestions.length}`, icon: 'star' },
            ]} />
        </View>
      ) : null}

      <ScrollView ref={scrollRef} style={{ maxHeight: 460 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
        {activeTab === 'overdue' ? (
          <>
            <View style={[styles.banner, { backgroundColor: colors.surfaceMuted }]}>
              <View style={styles.bannerHeader}>
                <Icon name="zap" size={14} color={colors.textMuted} />
                <Txt variant="smallStrong" style={{ flex: 1 }}>자동 분산</Txt>
                <Txt variant="caption" tone="faint" tabular>{proposals.length}개</Txt>
              </View>
              <View style={styles.bannerActions}>
                <Button label="적용" icon="zap" onPress={applyBalanced} style={{ flex: 1, minHeight: 38 }} />
                <Button label="모두 오늘로" kind="secondary" onPress={applyAllToday} style={{ minHeight: 38 }} />
              </View>
            </View>

            {proposals.map(({ task, targetDate }) => {
              const targetLabel = formatDate(targetDate, now);
              const showProposedChip = Temporal.PlainDate.compare(targetDate, now) !== 0
                && Temporal.PlainDate.compare(targetDate, tomorrow) !== 0;
              const showNextMondayChip = !showProposedChip || Temporal.PlainDate.compare(targetDate, nextMonday) !== 0;
              return (
                <View
                  key={task.id}
                  style={[
                    styles.item,
                    { borderBottomColor: colors.border },
                    cursor.focusedId === task.id && { backgroundColor: colors.accentSoft, borderRadius: radius.sm },
                  ]}>
                  <View style={styles.itemHeader}>
                    <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                      {task.priority < 4 ? priorityMark(task.priority) + ' ' : ''}{task.title}
                    </Txt>
                    <Txt variant="smallStrong" tone="muted">
                      → {targetLabel}
                    </Txt>
                  </View>
                  <View style={styles.chipRow}>
                    <Chip
                      icon="sun" label="오늘"
                      onPress={() => rescheduleWithUndo(task, now, '오늘')} />
                    <Chip
                      icon="sunrise" label="내일"
                      onPress={() => rescheduleWithUndo(task, tomorrow, '내일')} />
                    {showProposedChip ? (
                      <Chip
                        icon="zap" label={targetLabel} tone="set"
                        onPress={() => rescheduleWithUndo(task, targetDate, targetLabel)} />
                    ) : null}
                    {showNextMondayChip ? (
                      <Chip
                        icon="arrow-right" label="다음 주"
                        onPress={() => rescheduleWithUndo(task, nextMonday, '다음 주')} />
                    ) : null}
                    <Chip
                      icon="inbox" label="보류"
                      onPress={() => {
                        haptic.tap();
                        flow.reschedule(task, null);
                      }} />
                    <Chip
                      icon="check" label="완료"
                      onPress={() => {
                        haptic.success();
                        flow.complete(task);
                      }} />
                  </View>
                </View>
              );
            })}
          </>
        ) : (
          <>
            {autoSlotPlan.length > 0 ? (
              <View style={[styles.banner, { backgroundColor: colors.surfaceMuted }]}>
                <View style={styles.bannerHeader}>
                  <Icon name="clock" size={14} color={colors.textMuted} />
                  <Txt variant="smallStrong" style={{ flex: 1 }}>빈 시간 배치</Txt>
                  <Txt variant="caption" tone="faint" tabular>{autoSlotPlan.length}개</Txt>
                </View>
                <View style={{ gap: 3 }}>
                  {autoSlotPlan.slice(0, 3).map((item) => (
                    <View key={item.task.id} style={styles.slotPreviewRow}>
                      <Txt variant="caption" tone="accent" tabular style={{ minWidth: 56 }}>
                        {formatTime(item.minutes, timeFormat)}
                      </Txt>
                      <Txt variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                        {item.task.title}
                      </Txt>
                    </View>
                  ))}
                  {autoSlotPlan.length > 3 ? (
                    <Txt variant="caption" tone="faint" tabular>
                      +{autoSlotPlan.length - 3}
                    </Txt>
                  ) : null}
                </View>
                <Button label="자동 배치" icon="clock" onPress={applyAutoSlots} style={{ minHeight: 38, marginTop: 2 }} />
              </View>
            ) : null}

            {suggestions.length > 0 ? (
              <>
                {suggestions.map(({ task }) => {
                  const taskDate = dueDate(task);
                  const dateLabel = taskDate ? formatDate(taskDate, now) : null;
                  const progress = subtaskProgress.get(task.id);
                  const progressLabel = progress && progress.completed > 0
                    ? `${progress.completed}/${progress.total}`
                    : null;
                  const durationLabel = task.duration_minutes ? formatDurationMinutes(task.duration_minutes) : null;
                  const hasMeta = !!(dateLabel || progressLabel || durationLabel);
                  return (
                    <View
                      key={task.id}
                      style={[
                        styles.suggestRow,
                        { borderColor: colors.border },
                        cursor.focusedId === task.id && { backgroundColor: colors.accentSoft, borderRadius: radius.sm },
                      ]}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Txt variant="bodyStrong" numberOfLines={1}>
                          {task.priority < 4 ? priorityMark(task.priority) + ' ' : ''}{task.title}
                        </Txt>
                        {hasMeta ? (
                          <View style={styles.suggestMeta}>
                            {dateLabel ? (
                              <View style={styles.metaChip}>
                                <Icon name="calendar" size={11} color={colors.textFaint} />
                                <Txt variant="caption" tone="muted">{dateLabel}</Txt>
                              </View>
                            ) : null}
                            {durationLabel ? (
                              <View style={styles.metaChip}>
                                <Icon name="clock" size={11} color={colors.textFaint} />
                                <Txt variant="caption" tone="muted" tabular>{durationLabel}</Txt>
                              </View>
                            ) : null}
                            {progressLabel ? (
                              <View style={styles.metaChip}>
                                <Icon name="check-square" size={11} color={colors.textFaint} />
                                <Txt variant="caption" tone="muted" tabular>{progressLabel}</Txt>
                              </View>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                      <Pressable
                        accessibilityRole="button" accessibilityLabel={task.title + ' 오늘로 옮기기'}
                        onPress={() => addSuggestionToToday(task)}
                        style={({ pressed }) => [styles.addPill, { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.6 : 1 }]}>
                        <Icon name="plus" size={14} color={colors.textMuted} />
                        <Txt variant="smallStrong">오늘</Txt>
                      </Pressable>
                    </View>
                  );
                })}
              </>
            ) : autoSlotPlan.length === 0 ? (
              <View style={styles.emptySuggest}>
                <Icon name="check-circle" size={24} color={colors.textFaint} />
                <Txt variant="bodyStrong">추천 할 일 없음</Txt>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      <Button
        label="AI 하루 계획" leading={<AiIcon size={16} color={colors.text} />} kind="secondary" style={{ marginTop: space.sm }}
        onPress={() => {
          onClose();
          router.push(AI_ROUTES.plan);
        }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: radius.md, padding: space.md, gap: space.sm },
  bannerHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bannerActions: { flexDirection: 'row', gap: space.sm },
  slotPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  item: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.xs, paddingTop: space.xs, paddingBottom: space.md, gap: space.sm },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  suggestRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xs, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  emptySuggest: { paddingVertical: space.xl, alignItems: 'center', gap: space.sm },
  addPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 34, borderRadius: radius.pill,
  },
});
