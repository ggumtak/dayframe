import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Card, Icon, Row, Sheet, Txt } from '@/components/ui';
import { useHabitActions } from '@/data/habits';
import { Temporal, weekdayName, weekStart } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Habit, HabitLog, HabitStats } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { space, useTheme } from '@/theme';

import { nextCheckIn } from './checkIn';
import { dayState, logsByDate, outsideHabit, periodProgress, weekDates } from './goal';
import { habitLook } from './display';
import { HabitAvatar } from './HabitAvatar';
import type { HabitMeta } from './habitMeta';
import { computeHabitStrength } from './strength';

const SIZE = 52;
const STROKE = 4;

/** The check-in button: a ring that fills toward the goal and pops when it is reached. */
function CheckIn({ progress, target, done, onPress, onLongPress, label }: {
  progress: number; target: number; done: boolean; onPress: () => void; onLongPress: () => void; label: string;
}) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const r = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const ratio = Math.min(1, progress / target);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityHint="길게 눌러 건너뛰기나 쉬어가기를 선택할 수 있습니다" hitSlop={6}
      onLongPress={onLongPress}
      onPress={() => {
        scale.set(withSequence(withTiming(0.86, { duration: 80 }), withSpring(1, { damping: 8, stiffness: 300 })));
        onPress();
      }}>
      <Animated.View style={[{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }, style]}>
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={done ? colors.accent : colors.border} strokeWidth={STROKE} fill={done ? colors.accent : 'none'} />
          {done || ratio === 0 ? null : (
            <Circle
              cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={colors.accent} strokeWidth={STROKE} fill="none" strokeLinecap="round"
              strokeDasharray={`${circumference * ratio} ${circumference}`} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
          )}
        </Svg>
        {done ? <Icon name="check" size={24} color={colors.onAccent} />
          : target > 1 ? <Txt variant="smallStrong" tone="muted">{progress}/{target}</Txt>
            : <Icon name="plus" size={20} color={colors.textMuted} />}
      </Animated.View>
    </Pressable>
  );
}

/**
 * One habit on the habits tab. Memoised: it re-renders when its habit, logs, stats or look change, or when
 * `date` (today in the habit's time zone, passed by the screen) rolls over, so a check-in always lands on
 * the current day.
 */
export const HabitCard = memo(function HabitCard({ habit, logs, stats, meta, date }: {
  habit: Habit; logs: HabitLog[]; stats?: HabitStats; meta?: HabitMeta; date: string;
}) {
  const { colors } = useTheme();
  const actions = useHabitActions();
  const [menu, setMenu] = useState(false);
  const day = useMemo(() => Temporal.PlainDate.from(date), [date]);
  const byDate = useMemo(() => logsByDate(logs), [logs]);
  const todayLog = byDate.get(date);
  const todayCount = todayLog?.count ?? 0;
  const progress = useMemo(() => periodProgress(habit, logs, date), [habit, logs, date]);
  const done = progress >= habit.target_count;
  const weekly = habit.cadence === 'weekly';
  // This week, Monday first, the same week the weekly goal counts; days still to come are dimmed.
  const week = useMemo(() => weekDates(weekStart(day)), [day]);
  const streak = stats?.current_streak ?? 0;
  const strength = useMemo(() => computeHabitStrength(habit, logs, day), [habit, logs, day]);
  const look = habitLook(habit.name, meta);

  const checkIn = () => {
    const next = nextCheckIn(habit, todayCount, progress);
    if (next.reaches) haptic.success();
    else haptic.light();
    actions.setLog({ habitId: habit.id, date, status: next.status, count: next.count });
  };

  const mark = (status: 'skipped' | 'frozen' | null) => {
    setMenu(false);
    actions.setLog({ habitId: habit.id, date, status, count: 0 });
  };

  return (
    <>
      <Pressable
        accessibilityRole="button" accessibilityLabel={habit.name + ' 자세히 보기'}
        onPress={() => router.push({ pathname: '/habit/[id]', params: { id: habit.id } })}>
        <Card style={styles.card}>
          <View style={{ flex: 1, gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <HabitAvatar name={habit.name} emoji={look.emoji} size={24} />
              <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{habit.name}</Txt>
              {/* Streak and strength as one quiet line of text, not two coloured badges. */}
              {streak > 0 || strength.score > 0 ? (
                <View
                  style={styles.stats} accessible
                  accessibilityLabel={[streak > 0 ? `${streak}${weekly ? '주' : '일'} 연속` : '', strength.score > 0 ? `꾸준함 ${strength.score}%` : '']
                    .filter(Boolean).join(', ')}>
                  {streak > 0 ? <Icon name="zap" size={11} color={colors.textFaint} /> : null}
                  <Txt variant="caption" tone="muted">
                    {[streak > 0 ? `${streak}${weekly ? '주' : '일'}` : '', strength.score > 0 ? `꾸준함 ${strength.score}%` : ''].filter(Boolean).join(' · ')}
                  </Txt>
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {week.map((item) => {
                const log = byDate.get(item.toString());
                const outside = outsideHabit(habit, item, day);
                // A day short of a daily goal (2 of 4) is lighter than a day that met it.
                const state = dayState(habit, log);
                const met = state === 'met';
                // One accent ramp: met is the full accent, partial a lighter step; skipped and resting days stay grey.
                const fill = met ? colors.accent : state === 'partial' ? colors.accentRamp[1] : log ? colors.border : colors.surfaceMuted;
                // Tapping a day sets or clears its record, so a forgotten yesterday is fixed right here.
                return (
                  <Pressable
                    key={item.toString()} disabled={outside} hitSlop={3}
                    accessibilityRole="button" accessibilityLabel={`${item.month}월 ${item.day}일 ${met ? '기록 지우기' : '기록하기'}`}
                    onPress={() => {
                      haptic.light();
                      const prevStatus = log?.status ?? null;
                      const prevCount = log?.count ?? 0;
                      const targetDate = item.toString();
                      actions.setLog({
                        habitId: habit.id, date: targetDate, status: met ? null : 'completed', count: met ? 0 : weekly ? 1 : habit.target_count,
                      });
                      if (!item.equals(day)) {
                        showToast(`${item.month}월 ${item.day}일 기록을 ${met ? '지웠습니다.' : '남겼습니다.'}`, {
                          actionLabel: '실행 취소',
                          onAction: () => actions.setLog({ habitId: habit.id, date: targetDate, status: prevStatus, count: prevCount }),
                        });
                      }
                    }}
                    style={({ pressed }) => ({ alignItems: 'center', gap: 3, opacity: outside ? 0.35 : pressed ? 0.6 : 1 })}>
                    <View style={[styles.dot, { backgroundColor: fill }]}>
                      {log?.status === 'frozen' ? <Icon name="pause" size={10} color={colors.textMuted} /> : null}
                      {log?.status === 'skipped' ? <Icon name="minus" size={10} color={colors.textMuted} /> : null}
                    </View>
                    <Txt variant="caption" tone={item.equals(day) ? 'default' : 'faint'} style={item.equals(day) ? styles.todayLabel : undefined}>
                      {weekdayName(item)}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
            <Txt variant={strength.missedYesterday ? 'smallStrong' : 'small'} tone={strength.missedYesterday ? 'default' : 'muted'}>
              {strength.missedYesterday
                ? '어제 놓쳤습니다 · 오늘은 이어가 보세요'
                : weekly || habit.target_count > 1
                  ? (weekly ? `이번 주 ${progress}/${habit.target_count}회` : `오늘 ${progress}/${habit.target_count}회`)
                    + (todayLog?.status === 'skipped' ? ' · 건너뜀' : todayLog?.status === 'frozen' ? ' · 쉬어감' : '')
                  : done
                    ? '오늘 완료'
                    : todayLog?.status === 'skipped'
                      ? '오늘 건너뜀'
                      : todayLog?.status === 'frozen'
                        ? '오늘 쉬어감'
                        : '오늘 기록 전'}
            </Txt>
          </View>
          <CheckIn
            progress={progress} target={habit.target_count} done={done} onPress={checkIn} onLongPress={() => setMenu(true)}
            label={habit.name + (done ? ' 기록 취소' : ' 기록')} />
        </Card>
      </Pressable>
      <Sheet visible={menu} onClose={() => setMenu(false)} title={habit.name}>
        <Row icon="skip-forward" label="오늘 건너뛰기" detail="달성률에서 제외" onPress={() => mark('skipped')} />
        <Row icon="pause-circle" label="오늘 쉬어가기" detail="연속 기록 유지" onPress={() => mark('frozen')} />
        {todayLog ? <Row icon="rotate-ccw" label="오늘 기록 지우기" onPress={() => mark(null)} /> : null}
      </Sheet>
    </>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto', paddingLeft: space.xs },
  todayLabel: { fontWeight: '700' },
  dot: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
