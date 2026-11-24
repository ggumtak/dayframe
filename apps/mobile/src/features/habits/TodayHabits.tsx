import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { FoldHeader } from '@/components/ui';
import { periodProgress, useHabitActions, useHabitDetails, useHabits } from '@/data/habits';
import { today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { usePersistentState } from '@/lib/persist';
import { fontFamily, space, type, useTheme } from '@/theme';

import { nextCheckIn } from './checkIn';
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
  const { data } = useHabits();
  const habits = useMemo(() => (data ?? []).filter((habit) => !habit.archived_at), [data]);
  const details = useHabitDetails(habits);
  const actions = useHabitActions();
  const [fold, setFold] = usePersistentState<Fold>('dayframe-today-habits', 'open', isFold);

  const rows = habits.map((habit, order) => {
    const day = today(habit.timezone);
    const date = day.toString();
    const logs = details.get(habit.id)?.logs ?? [];
    const todayCount = logs.find((log) => log.log_date === date)?.count ?? 0;
    const progress = periodProgress(habit, logs, date);
    const weekly = habit.cadence === 'weekly';
    // A weekly habit ticked today has nothing more to do today, even while the week's goal is open.
    const settled = progress >= habit.target_count || (weekly && todayCount > 0);
    const missedYesterday = !settled && computeHabitStrength(habit, logs, day).missedYesterday;
    return { habit, order, date, todayCount, progress, weekly, settled, missedYesterday };
  }).sort((a, b) => Number(a.settled) - Number(b.settled) || Number(b.missedYesterday) - Number(a.missedYesterday) || a.order - b.order);
  if (!rows.length) return null;
  const settledCount = rows.filter((row) => row.settled).length;
  const open = fold === 'open';

  return (
    <View>
      <FoldHeader
        title="습관" detail={`${settledCount}/${rows.length}`}
        open={open} onToggle={() => setFold(open ? 'closed' : 'open')} label="오늘의 습관" />
      {/* Fades in when unfolded, not when the screen mounts already unfolded. */}
      <LayoutAnimationConfig skipEntering>
        {open ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(100)}>
          {rows.map(({ habit, date, todayCount, progress, weekly, settled, missedYesterday }) => (
        <Pressable
          key={habit.id} accessibilityRole="button" accessibilityLabel={habit.name + ' 자세히 보기'}
          onPress={() => router.push({ pathname: '/habit/[id]', params: { id: habit.id } })}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : colors.background }]}>
          <Pressable
            accessibilityRole="checkbox" accessibilityState={{ checked: settled }} accessibilityLabel={habit.name + (settled ? ' 기록 취소' : ' 기록')}
            hitSlop={10} style={styles.check}
            onPress={() => {
              const next = nextCheckIn(habit, todayCount, progress);
              if (next.reaches) haptic.success();
              else haptic.light();
              actions.setLog({ habitId: habit.id, date, status: next.status, count: next.count });
            }}>
            <Mark ratio={progress / habit.target_count} settled={settled} />
          </Pressable>
          <View style={[styles.body, { borderBottomColor: colors.border }]}>
            <Text numberOfLines={1} style={[type.body as TextStyle, { flex: 1, color: settled ? colors.textFaint : colors.text }]}>{habit.name}</Text>
            {missedYesterday ? (
              <Text style={[styles.count, { color: colors.text, fontWeight: '600' }]}>어제 놓침</Text>
            ) : null}
            <Text style={[styles.count, { color: settled ? colors.textFaint : colors.textMuted }]}>
              {weekly ? `이번 주 ${progress}/${habit.target_count}` : habit.target_count > 1 ? `${progress}/${habit.target_count}회` : settled ? '완료' : ''}
            </Text>
          </View>
        </Pressable>
          ))}
        </Animated.View>
        ) : null}
      </LayoutAnimationConfig>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg },
  check: { paddingRight: space.md },
  body: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 46, paddingRight: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  count: { fontFamily, fontSize: 12, lineHeight: 16 },
});
