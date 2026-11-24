import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, Icon, Segmented, Sheet, Txt } from '@/components/ui';
import { AI_ROUTES } from '@/features/ai/routes';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, formatDate, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { nextOccurrence, type Task } from '@/lib/shared';
import { planBalancedReschedule, type SubtaskProgress, suggestForToday } from '@/lib/smart';
import { showToast } from '@/lib/toast';
import { priorityColor, radius, space, useTheme } from '@/theme';

import { useTaskFlow } from './useTaskFlow';

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
    showToast(`지연된 할 일 ${proposals.length}개를 여러 날에 나눠 옮겼습니다.`);
    onClose();
  };

  const applyAllToday = () => {
    if (!overdue.length) return;
    haptic.success();
    flow.rescheduleOverdue();
    showToast(`지연된 할 일 ${overdue.length}개를 모두 오늘로 옮겼습니다.`);
    onClose();
  };

  const nextMonday = now.add({ days: 8 - now.dayOfWeek });
  const activeTab = overdue.length === 0 ? 'suggest' : tab;

  return (
    <Sheet visible={visible} onClose={onClose} title="하루 계획 · 일정 정리">
      {overdue.length > 0 ? (
        <View style={{ marginBottom: space.md }}>
          <Segmented<'overdue' | 'suggest'>
            value={activeTab} onChange={setTab}
            options={[
              { value: 'overdue', label: `지연 정리 (${overdue.length})`, icon: 'alert-circle' },
              { value: 'suggest', label: `오늘 추천 (${suggestions.length})`, icon: 'star' },
            ]} />
        </View>
      ) : null}

      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
        {activeTab === 'overdue' ? (
          <>
            <View style={[styles.banner, { backgroundColor: colors.accentSoft }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="zap" size={15} color={colors.accent} />
                <Txt variant="smallStrong" tone="accent">여러 날에 나눠 잡기</Txt>
              </View>
              <Txt variant="caption" tone="muted">
                앞으로 7일 동안의 일정과 우선순위를 보고, 하루에 몰리지 않게 나눠 보았습니다.
              </Txt>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: 4 }}>
                <Button label="이대로 옮기기" icon="zap" onPress={applyBalanced} style={{ flex: 1, minHeight: 40 }} />
                <Button label="전부 오늘로" kind="secondary" onPress={applyAllToday} style={{ minHeight: 40 }} />
              </View>
            </View>

            {proposals.map(({ task, targetDate, reason }) => (
              <View key={task.id} style={[styles.itemCard, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <View style={[styles.pDot, { backgroundColor: priorityColor(colors, task.priority) }]} />
                  <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{task.title}</Txt>
                  <Txt variant="caption" tone="accent" style={{ fontWeight: '700' }}>
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
                    icon="check" label="완료" color={colors.success}
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
              진행 중인 체크리스트, 우선순위가 높은 일, 오래 미뤄 둔 할 일 가운데 오늘 끝내기 좋은 일을 골랐습니다.
            </Txt>
            {suggestions.map(({ task, reason }) => (
              <View key={task.id} style={[styles.suggestRow, { borderColor: colors.border }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>{task.title}</Txt>
                  <Txt variant="caption" tone="accent">{reason}</Txt>
                </View>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={task.title + ' 오늘로 옮기기'}
                  onPress={() => {
                    haptic.success();
                    flow.reschedule(task, now);
                    showToast(`‘${task.title}’${josa(task.title, '을/를')} 오늘로 옮겼습니다.`);
                  }}
                  style={({ pressed }) => [styles.addPill, { backgroundColor: colors.accentSoft, opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name="plus" size={14} color={colors.accent} />
                  <Txt variant="smallStrong" tone="accent">오늘</Txt>
                </Pressable>
              </View>
            ))}
          </>
        ) : (
          <View style={{ paddingVertical: space.xl, alignItems: 'center', gap: space.sm }}>
            <Icon name="check-circle" size={28} color={colors.success} />
            <Txt variant="bodyStrong">오늘로 가져올 만한 할 일이 없습니다</Txt>
            <Txt variant="small" tone="muted">지금 잡혀 있는 일정에 집중해 보세요.</Txt>
          </View>
        )}
      </ScrollView>
      <Button
        label="AI로 계획" icon="zap" kind="secondary" style={{ marginTop: space.sm }}
        onPress={() => {
          onClose();
          router.push(AI_ROUTES.plan);
        }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: radius.md, padding: space.md, gap: 6 },
  itemCard: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: 4 },
  pDot: { width: 8, height: 8, borderRadius: 4 },
  suggestRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 34, borderRadius: radius.pill,
  },
});
