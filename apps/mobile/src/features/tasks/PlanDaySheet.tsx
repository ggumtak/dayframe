import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';

import { Button, Chip, Icon, Segmented, Sheet, Txt } from '@/components/ui';
import { AI_ROUTES } from '@/features/ai/routes';
import { KEY_PRIORITY, matchesCombo, useKeyHandler, useListCursor } from '@/features/keyboard';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, formatDate, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { nextOccurrence, type Task } from '@/lib/shared';
import { planBalancedReschedule, type SubtaskProgress, suggestForToday } from '@/lib/smart';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

import { priorityMark } from './priority';

import { useTaskFlow } from './useTaskFlow';

const itemTaskId = (item: { task: Task }) => item.task.id;

/**
 * Daily planning ritual combining Todoist Smart Schedule (load-balanced overdue redistribution),
 * Any.do Plan My Day (1-tap overdue triage), and Microsoft To Do "My Day" suggestions.
 */
export function PlanDaySheet({
  visible, onClose, overdue, allOpen, openRoots, subtaskProgress,
}: {
  visible: boolean;
  onClose: () => void;
  overdue: Task[];
  allOpen: Task[];
  openRoots: Task[];
  subtaskProgress: Map<string, SubtaskProgress>;
}) {
  const { colors } = useTheme();
  const flow = useTaskFlow();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const nowMs = useMinute() * 60_000;
  const zone = deviceTimeZone();
  const now = today(zone);
  const [tab, setTab] = useState<'overdue' | 'suggest'>(overdue.length > 0 ? 'overdue' : 'suggest');

  const proposals = useMemo(
    () => planBalancedReschedule(overdue, allOpen, now, nextOccurrence, { horizonDays: 7, dailyCap: 5 }),
    [overdue, allOpen, now],
  );

  const suggestions = useMemo(
    () => suggestForToday(openRoots, subtaskProgress, nowMs, 8),
    [openRoots, subtaskProgress, nowMs],
  );

  const applyBalanced = () => {
    if (!proposals.length) return;
    haptic.success();
    for (const item of proposals) {
      flow.reschedule(item.task, item.targetDate);
    }
    showToast(`기한이 지난 할 일 ${proposals.length}개를 여러 날에 나누어 옮겼습니다.`);
    onClose();
  };

  const applyAllToday = () => {
    if (!overdue.length) return;
    haptic.success();
    flow.rescheduleOverdue();
    showToast(`기한이 지난 할 일 ${overdue.length}개를 모두 오늘로 옮겼습니다.`);
    onClose();
  };

  const addSuggestionToToday = (task: Task) => {
    haptic.success();
    flow.reschedule(task, now);
    showToast(`‘${task.title}’${josa(task.title, '을/를')} 오늘로 옮겼습니다.`);
  };

  const nextMonday = now.add({ days: 8 - now.dayOfWeek });
  const activeTab = overdue.length === 0 ? 'suggest' : tab;
  const activeItems: readonly { task: Task }[] = activeTab === 'overdue' ? proposals : suggestions;
  const cursor = useListCursor(activeItems, itemTaskId, {
    enabled: visible,
    scrollRef,
    estimatedRowHeight: activeTab === 'overdue' ? 116 : 64,
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
            haptic.tap();
            flow.reschedule(item.task, now);
            return true;
          }
          if (matchesCombo(event, 'w')) {
            haptic.tap();
            flow.reschedule(item.task, now.add({ days: 1 }));
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
    <Sheet visible={visible} onClose={onClose} title="하루 계획 · 일정 정리">
      {overdue.length > 0 ? (
        <View style={{ marginBottom: space.md }}>
          <Segmented<'overdue' | 'suggest'>
            value={activeTab} onChange={setTab}
            options={[
              { value: 'overdue', label: `기한 지남 (${overdue.length})`, icon: 'alert-circle' },
              { value: 'suggest', label: `오늘 추천 (${suggestions.length})`, icon: 'star' },
            ]} />
        </View>
      ) : null}

      <ScrollView ref={scrollRef} style={{ maxHeight: 460 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
        {activeTab === 'overdue' ? (
          <>
            <View style={[styles.banner, { backgroundColor: colors.surfaceMuted }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="zap" size={15} color={colors.textMuted} />
                <Txt variant="smallStrong">여러 날에 나누어 배정</Txt>
              </View>
              <Txt variant="caption" tone="muted">
                앞으로 7일간의 일정과 우선순위를 바탕으로, 하루에 몰리지 않게 나누어 보았습니다.
              </Txt>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: 4 }}>
                <Button label="이대로 적용" icon="zap" onPress={applyBalanced} style={{ flex: 1, minHeight: 40 }} />
                <Button label="모두 오늘로" kind="secondary" onPress={applyAllToday} style={{ minHeight: 40 }} />
              </View>
            </View>

            {proposals.map(({ task, targetDate, reason }) => (
              <View
                key={task.id}
                style={[
                  styles.item,
                  { borderBottomColor: colors.border },
                  cursor.focusedId === task.id && { backgroundColor: colors.accentSoft, borderRadius: radius.sm },
                ]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                    {task.priority < 4 ? priorityMark(task.priority) + ' ' : ''}{task.title}
                  </Txt>
                  <Txt variant="caption" style={{ fontWeight: '700' }}>
                    → {formatDate(targetDate, now)}
                  </Txt>
                </View>
                <Txt variant="caption" tone="muted">{reason}</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <Chip
                    icon="sun" label="오늘"
                    onPress={() => {
                      haptic.tap();
                      flow.reschedule(task, now);
                    }} />
                  <Chip
                    icon="sunrise" label="내일"
                    onPress={() => {
                      haptic.tap();
                      flow.reschedule(task, now.add({ days: 1 }));
                    }} />
                  <Chip
                    icon="arrow-right" label="다음 주"
                    onPress={() => {
                      haptic.tap();
                      flow.reschedule(task, nextMonday);
                    }} />
                  <Chip
                    icon="check" label="완료"
                    onPress={() => {
                      haptic.success();
                      flow.complete(task);
                    }} />
                </View>
              </View>
            ))}
          </>
        ) : suggestions.length > 0 ? (
          <>
            <Txt variant="small" tone="muted">
              진행 중인 체크리스트와 우선순위가 높은 일, 오래 미뤄 둔 할 일 중에서 오늘 챙기기 좋은 항목을 골랐습니다.
            </Txt>
            {suggestions.map(({ task, reason }) => (
              <View
                key={task.id}
                style={[
                  styles.suggestRow,
                  { borderColor: colors.border },
                  cursor.focusedId === task.id && { backgroundColor: colors.accentSoft, borderRadius: radius.sm },
                ]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>{task.title}</Txt>
                  <Txt variant="caption" tone="muted">{reason}</Txt>
                </View>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={task.title + ' 오늘로 옮기기'}
                  onPress={() => addSuggestionToToday(task)}
                  style={({ pressed }) => [styles.addPill, { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name="plus" size={14} color={colors.textMuted} />
                  <Txt variant="smallStrong">오늘</Txt>
                </Pressable>
              </View>
            ))}
          </>
        ) : (
          <View style={{ paddingVertical: space.xl, alignItems: 'center', gap: space.sm }}>
            <Icon name="check-circle" size={28} color={colors.textMuted} />
            <Txt variant="bodyStrong">오늘로 가져올 할 일이 없습니다</Txt>
            <Txt variant="small" tone="muted">지금 예정된 일정에 집중해 보세요.</Txt>
          </View>
        )}
      </ScrollView>
      <Button
        label="AI로 하루 계획 세우기" icon="zap" kind="secondary" style={{ marginTop: space.sm }}
        onPress={() => {
          onClose();
          router.push(AI_ROUTES.plan);
        }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: radius.md, padding: space.md, gap: 6 },
  item: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.xs, paddingTop: space.xs, paddingBottom: space.md, gap: 4 },
  suggestRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xs, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 34, borderRadius: radius.pill,
  },
});
