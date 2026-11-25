import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { FoldHeader, Icon, Txt } from '@/components/ui';
import { periodProgress, useHabitActions, useHabitDetails, useHabits } from '@/data/habits';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { logicalToday } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { usePersistentState } from '@/lib/persist';
import type { Habit, HabitLog } from '@/lib/shared';
import { radius, space, type, useTheme } from '@/theme';

import { nextCheckIn } from './checkIn';
import { HabitAdjustSheet, showHabitUndoToast } from './HabitCard';
import { useHabitMetaMap } from './habitMeta';
import { RoutineRunner, type RoutineRunnerItem } from './RoutineRunner';
import { computeHabitStrength } from './strength';

type Fold = 'open' | 'closed';
const isFold = (value: string): value is Fold => value === 'open' || value === 'closed';
const SIZE = 22;

/** The check-in mark of a row: a ring that fills toward the goal, and a filled check once today is settled. */
function Mark({ ratio, settled }: { ratio: number; settled: boolean }) {
  const { colors } = useTheme();
  const r = 9;
  const length = 2 * Math.PI * r;
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24">
      {settled ? (
        <>
          <Circle cx={12} cy={12} r={10} fill={colors.accent} />
          <Path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke={colors.onAccent} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <Circle cx={12} cy={12} r={r} fill="none" stroke={colors.control} strokeWidth={1.5} />
          {ratio > 0 ? (
            <Circle
              cx={12} cy={12} r={r} fill="none" stroke={colors.accent} strokeWidth={2.4} strokeLinecap="round"
              strokeDasharray={`${length * Math.min(1, ratio)} ${length}`} transform="rotate(-90 12 12)" />
          ) : null}
        </>
      )}
    </Svg>
  );
}

/**
 * Today's habits inside the 오늘 tab, so the day is checked off in one place (as TickTick lists habits in
 * Today). One tap checks in exactly as the habit card does; habits already settled for today sink below.
 * Name only: the emoji and colour a habit wears belong to the 습관 tab, so Today stays one quiet list.
 */
export function TodayHabits() {
  const { colors } = useTheme();
  const prefs = usePersonalPrefs();
  const { data } = useHabits();
  const habits = useMemo(() => (data ?? []).filter((habit) => !habit.archived_at), [data]);
  const details = useHabitDetails(habits);
  const habitMeta = useHabitMetaMap();
  const actions = useHabitActions();
  const [fold, setFold] = usePersistentState<Fold>('dayframe-today-habits', 'open', isFold);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<{ habit: Habit; date: string; todayLog?: HabitLog } | null>(null);

  const rows = habits.map((habit, order) => {
    const day = logicalToday(habit.timezone, prefs.dayStartHour);
    const date = day.toString();
    const detail = details.get(habit.id);
    const logs = detail?.logs ?? [];
    const todayLog = logs.find((log) => log.log_date === date);
    const todayCount = todayLog?.count ?? 0;
    const progress = periodProgress(habit, logs, date);
    const weekly = habit.cadence === 'weekly';
    // A weekly habit ticked today has nothing more to do today, even while the week's goal is open.
    const settled = progress >= habit.target_count || (weekly && todayCount > 0);
    const missedYesterday = !settled && computeHabitStrength(habit, logs, day).missedYesterday;
    const streak = detail?.stats?.current_streak ?? 0;
    return { habit, order, date, logs, todayLog, todayCount, progress, weekly, settled, missedYesterday, streak };
  }).sort((a, b) => Number(a.settled) - Number(b.settled) || Number(b.missedYesterday) - Number(a.missedYesterday) || a.order - b.order);

  const runnerItems = useMemo<RoutineRunnerItem[]>(
    () => rows.map((row) => ({ habit: row.habit, logs: row.logs, meta: habitMeta[row.habit.id], date: row.date })),
    [rows, habitMeta],
  );

  if (!rows.length) return null;
  const settledCount = rows.filter((row) => row.settled).length;
  const remainingCount = rows.length - settledCount;
  const open = fold === 'open';

  const adjustingLog = adjusting
    ? (details.get(adjusting.habit.id)?.logs ?? []).find((log) => log.log_date === adjusting.date)
    : undefined;

  return (
    <View>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <FoldHeader
            title="습관" detail={`${settledCount}/${rows.length}`}
            open={open} onToggle={() => setFold(open ? 'closed' : 'open')} label="오늘의 습관" />
        </View>
        {remainingCount >= 2 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="오늘의 루틴 시작"
            hitSlop={6}
            onPress={() => {
              haptic.tap();
              setRunnerOpen(true);
            }}
            style={({ pressed }) => [
              styles.startPill,
              {
                backgroundColor: colors.accentSoft,
                borderColor: colors.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}>
            <Icon name="play" size={11} color={colors.accentText} />
            <Txt variant="metaStrong" tone="accent">루틴 시작</Txt>
          </Pressable>
        ) : null}
      </View>

      {/* Fades in when unfolded, not when the screen mounts already unfolded. */}
      <LayoutAnimationConfig skipEntering>
        {open ? (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(100)}>
            {rows.map(({ habit, date, todayLog, todayCount, progress, weekly, settled, missedYesterday, streak }) => {
              const isMultiDaily = !weekly && habit.target_count > 1;
              return (
                <Pressable
                  key={habit.id} accessibilityRole="button" accessibilityLabel={habit.name + ' 자세히 보기'}
                  onPress={() => router.push({ pathname: '/habit/[id]', params: { id: habit.id } })}
                  style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : colors.background }]}>
                  <Pressable
                    accessibilityRole="checkbox" accessibilityState={{ checked: settled }} accessibilityLabel={habit.name + (settled ? ' 기록 취소' : ' 기록')}
                    hitSlop={10} style={styles.check}
                    onLongPress={() => {
                      haptic.tap();
                      setAdjusting({ habit, date, todayLog });
                    }}
                    onPress={() => {
                      if (isMultiDaily && settled) {
                        haptic.tap();
                        setAdjusting({ habit, date, todayLog });
                        return;
                      }
                      const prevStatus = todayLog?.status ?? null;
                      const prevCount = todayLog?.count ?? 0;
                      const next = nextCheckIn(habit, todayCount, progress);
                      if (next.reaches) haptic.success();
                      else haptic.light();
                      actions.setLog({ habitId: habit.id, date, status: next.status, count: next.count });
                      const message = next.status === null
                        ? `‘${habit.name}’ 오늘 기록을 취소했습니다.`
                        : isMultiDaily
                          ? (next.reaches
                            ? `‘${habit.name}’ 오늘 목표(${habit.target_count}회)를 달성했습니다!`
                            : `‘${habit.name}’ ${next.count}/${habit.target_count}회 기록했습니다.`)
                          : `‘${habit.name}’ 오늘 기록을 남겼습니다.`;
                      showHabitUndoToast(message, () => {
                        actions.setLog({ habitId: habit.id, date, status: prevStatus, count: prevCount });
                      });
                    }}>
                    <Mark ratio={progress / habit.target_count} settled={settled} />
                  </Pressable>
                  <View style={[styles.body, { borderBottomColor: colors.border }]}>
                    <Text numberOfLines={1} style={[type.body as TextStyle, { flex: 1, color: settled ? colors.textFaint : colors.text }]}>{habit.name}</Text>
                    {streak >= 2 ? (
                      <View style={styles.streakBadge} accessible accessibilityLabel={`${streak}${weekly ? '주' : '일'} 연속`}>
                        <Icon name="zap" size={11} color={colors.textFaint} />
                        <Txt variant="meta" tone="muted" tabular>{streak}{weekly ? '주' : '일'} 연속</Txt>
                      </View>
                    ) : null}
                    {missedYesterday ? (
                      <Txt variant="metaStrong" tone="danger">어제 놓침</Txt>
                    ) : null}
                    <Txt variant="meta" tone={settled ? 'faint' : 'muted'} tabular>
                      {weekly ? `이번 주 ${progress}/${habit.target_count}` : habit.target_count > 1 ? `${progress}/${habit.target_count}회` : settled ? '완료' : ''}
                    </Txt>
                  </View>
                </Pressable>
              );
            })}
          </Animated.View>
        ) : null}
      </LayoutAnimationConfig>

      <RoutineRunner
        visible={runnerOpen}
        title="오늘의 루틴"
        items={runnerItems}
        onClose={() => setRunnerOpen(false)}
      />

      <HabitAdjustSheet
        visible={!!adjusting}
        onClose={() => setAdjusting(null)}
        habit={adjusting?.habit ?? null}
        date={adjusting?.date ?? ''}
        todayLog={adjustingLog}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  startPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: space.md, marginRight: space.lg, marginLeft: -space.sm,
    paddingHorizontal: 10, minHeight: 30, borderRadius: radius.pill, borderWidth: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg },
  check: { paddingRight: space.md },
  body: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 46, paddingRight: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  streakBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
