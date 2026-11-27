import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Button, Card, Divider, Icon, IconButton, Row, Sheet, Txt } from '@/components/ui';
import { useHabitActions } from '@/data/habits';
import { KEY_PRIORITY, matchesCombo, useKeyHandler } from '@/features/keyboard';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { logicalToday, Temporal, weekdayName, weekStart } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Habit, HabitLog, HabitLogStatus, HabitStats } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

import { nextCheckIn } from './checkIn';
import { habitLook } from './display';
import { dayState, logsByDate, outsideHabit, periodProgress, weekDates } from './goal';
import { HabitAvatar } from './HabitAvatar';
import type { HabitMeta } from './habitMeta';
import { computeHabitStrength } from './strength';

const SIZE = 52;
const STROKE = 4;

/** Shows a check-in toast with 1-tap Undo that restores the previous `{ status, count }`. */
export function showHabitUndoToast(
  message: string,
  restore: () => void,
) {
  showToast(message, {
    actionLabel: '실행 취소',
    onAction: () => {
      haptic.light();
      restore();
    },
  });
}

/**
 * Compact action & count adjustment sheet shared by HabitCard, TodayHabits, and keyboard menus.
 * Prevents accidental wipes on completed multi-count habits while keeping skip/freeze/focus discoverable.
 */
export function HabitAdjustSheet({
  visible,
  onClose,
  habit,
  date,
  todayLog,
  showNavigation = true,
}: {
  visible: boolean;
  onClose: () => void;
  habit: Habit | null;
  date: string;
  todayLog?: HabitLog;
  showNavigation?: boolean;
}) {
  const { colors } = useTheme();
  const actions = useHabitActions();
  const isMultiDaily = !!habit && habit.cadence === 'daily' && habit.target_count > 1;
  const todayCount = todayLog?.status === 'completed' ? todayLog.count : 0;

  const commit = (
    nextStatus: HabitLogStatus | null,
    nextCount: number,
    message: string,
    closeAfter = true,
  ) => {
    if (!habit) return;
    const prevStatus = todayLog?.status ?? null;
    const prevCount = todayLog?.count ?? 0;
    if (closeAfter) onClose();
    actions.setLog({ habitId: habit.id, date, status: nextStatus, count: nextCount });
    showHabitUndoToast(message, () => {
      actions.setLog({ habitId: habit.id, date, status: prevStatus, count: prevCount });
    });
  };

  const bump = (delta: -1 | 1) => {
    if (!habit) return;
    const maxCount = Math.max(habit.target_count * 2, 99);
    const nextCount = Math.max(0, Math.min(maxCount, todayCount + delta));
    if (nextCount === todayCount && (nextCount > 0 || !todayLog)) return;
    if (nextCount === 0) {
      haptic.light();
      commit(null, 0, `‘${habit.name}’ 오늘 기록을 초기화했습니다.`, false);
      return;
    }
    if (nextCount >= habit.target_count && todayCount < habit.target_count) haptic.success();
    else haptic.light();
    commit(
      'completed',
      nextCount,
      nextCount >= habit.target_count
        ? `‘${habit.name}’ ${nextCount}/${habit.target_count}회 기록했습니다.`
        : `‘${habit.name}’ ${nextCount}/${habit.target_count}회로 조절했습니다.`,
      false,
    );
  };

  const mark = (status: 'skipped' | 'frozen' | null) => {
    if (!habit) return;
    if (status === 'skipped') {
      haptic.tap();
      commit('skipped', 0, `‘${habit.name}’ 오늘 건너뛰었습니다.`);
    } else if (status === 'frozen') {
      haptic.tap();
      commit('frozen', 0, `‘${habit.name}’ 오늘 쉬어가기로 표시했습니다.`);
    } else {
      haptic.light();
      commit(null, 0, `‘${habit.name}’ 오늘 기록을 초기화했습니다.`);
    }
  };

  useKeyHandler(
    (event) => {
      if (event.editing || !habit) return false;
      if (matchesCombo(event, 'escape')) {
        if (!event.repeat) onClose();
        return true;
      }
      if (matchesCombo(event, '1') || matchesCombo(event, 's')) {
        if (!event.repeat) mark('skipped');
        return true;
      }
      if (matchesCombo(event, '2') || matchesCombo(event, 'f')) {
        if (!event.repeat) mark('frozen');
        return true;
      }
      if (matchesCombo(event, '0') || matchesCombo(event, 'delete') || matchesCombo(event, 'backspace')) {
        if (todayLog && !event.repeat) mark(null);
        return true;
      }
      if (isMultiDaily && (matchesCombo(event, '+') || matchesCombo(event, '='))) {
        if (!event.repeat) bump(1);
        return true;
      }
      if (isMultiDaily && matchesCombo(event, '-')) {
        if (!event.repeat) bump(-1);
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: visible && !!habit },
  );

  return (
    <Sheet visible={visible && !!habit} onClose={onClose} title={habit ? (isMultiDaily ? `${habit.name} · 기록 조절` : habit.name) : undefined}>
      {habit ? (
        <View>
          {isMultiDaily ? (
            <View style={{ gap: space.sm, paddingBottom: space.sm }}>
              <View style={[styles.stepperBox, { backgroundColor: colors.surfaceMuted }]}>
                <IconButton
                  name="minus"
                  label="기록 1회 줄이기"
                  onPress={() => bump(-1)}
                  color={colors.text}
                  style={{ backgroundColor: colors.surface }}
                />
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Txt variant="heading" tabular>{todayCount} / {habit.target_count}회</Txt>
                  <Txt variant="caption" tone="muted">
                    {todayCount >= habit.target_count ? '목표 달성' : `${habit.target_count - todayCount}회 남음`}
                  </Txt>
                </View>
                <IconButton
                  name="plus"
                  label="기록 1회 늘리기"
                  onPress={() => bump(1)}
                  color={colors.text}
                  style={{ backgroundColor: colors.surface }}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button
                  label="목표 채우기"
                  kind="secondary"
                  icon="check"
                  disabled={todayCount >= habit.target_count}
                  onPress={() => {
                    haptic.success();
                    commit('completed', habit.target_count, `‘${habit.name}’ 오늘 목표(${habit.target_count}회)를 채웠습니다.`);
                  }}
                  style={{ flex: 1, minHeight: 42 }}
                />
                <Button
                  label="초기화(0)"
                  kind="secondary"
                  icon="rotate-ccw"
                  disabled={!todayLog}
                  onPress={() => mark(null)}
                  style={{ flex: 1, minHeight: 42 }}
                />
              </View>
              <Divider style={{ marginTop: space.xs }} />
            </View>
          ) : null}

          {showNavigation ? (
            <>
              <Row
                icon="clock"
                label="집중 시작"
                onPress={() => {
                  haptic.tap();
                  onClose();
                  router.navigate({
                    pathname: '/focus',
                    params: { habitId: habit.id, title: habit.name, autostart: '1', at: String(Date.now()) },
                  });
                }}
              />
              <Row
                icon="maximize-2"
                label="자세히 보기"
                onPress={() => {
                  haptic.tap();
                  onClose();
                  router.push({ pathname: '/habit/[id]', params: { id: habit.id } });
                }}
              />
              <Divider />
            </>
          ) : null}

          <Row icon="skip-forward" label="건너뛰기" detail="달성률 제외" onPress={() => mark('skipped')} />
          <Row icon="pause-circle" label="쉬어가기" detail="연속 유지" onPress={() => mark('frozen')} />
          {!isMultiDaily && todayLog ? <Row icon="rotate-ccw" label="기록 지우기" onPress={() => mark(null)} /> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

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
      accessibilityRole="button" accessibilityLabel={label} accessibilityHint="길게 눌러 기록 조절이나 건너뛰기를 선택할 수 있습니다" hitSlop={6}
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
          : target > 1 ? <Txt variant="smallStrong" tone="muted" tabular>{progress}/{target}</Txt>
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
export const HabitCard = memo(function HabitCard({ habit, logs, stats, meta, date, focused }: {
  habit: Habit; logs: HabitLog[]; stats?: HabitStats; meta?: HabitMeta; date?: string; focused?: boolean;
}) {
  const { colors } = useTheme();
  const prefs = usePersonalPrefs();
  const actions = useHabitActions();
  const [menu, setMenu] = useState(false);
  const activeDate = date ?? logicalToday(habit.timezone, prefs.dayStartHour).toString();
  const day = useMemo(() => Temporal.PlainDate.from(activeDate), [activeDate]);
  const byDate = useMemo(() => logsByDate(logs), [logs]);
  const todayLog = byDate.get(activeDate);
  const todayCount = todayLog?.count ?? 0;
  const progress = useMemo(() => periodProgress(habit, logs, activeDate), [habit, logs, activeDate]);
  const done = progress >= habit.target_count;
  const weekly = habit.cadence === 'weekly';
  const isMultiDaily = !weekly && habit.target_count > 1;
  // Respect the user's preferred week start on the 7-day strip; future days stay dimmed.
  const week = useMemo(() => weekDates(weekStart(day, prefs.startOfWeek)), [day, prefs.startOfWeek]);
  const streak = stats?.current_streak ?? 0;
  const strength = useMemo(() => computeHabitStrength(habit, logs, day), [habit, logs, day]);
  const look = habitLook(habit.name, meta);
  const statusText = strength.missedYesterday
    ? ''
    : weekly || habit.target_count > 1
      ? (weekly ? `주 ${progress}/${habit.target_count}` : `${progress}/${habit.target_count}회`)
        + (todayLog?.status === 'skipped' ? ' · 건너뜀' : todayLog?.status === 'frozen' ? ' · 쉬어감' : '')
      : !done && todayLog?.status === 'skipped'
        ? '건너뜀'
        : !done && todayLog?.status === 'frozen'
          ? '쉬어감'
          : '';
  const hasFooter = strength.missedYesterday || !!statusText || streak > 0 || strength.score > 0;

  const checkIn = () => {
    // Protect completed multi-count habits from accidental wipe to 0: open the adjust sheet instead.
    if (isMultiDaily && done) {
      haptic.tap();
      setMenu(true);
      return;
    }
    const prevStatus = todayLog?.status ?? null;
    const prevCount = todayLog?.count ?? 0;
    const next = nextCheckIn(habit, todayCount, progress);
    if (next.reaches) haptic.success();
    else haptic.light();
    actions.setLog({ habitId: habit.id, date: activeDate, status: next.status, count: next.count });
    const message = next.status === null
      ? `‘${habit.name}’ 오늘 기록을 취소했습니다.`
      : isMultiDaily
        ? (next.reaches
          ? `‘${habit.name}’ 오늘 목표(${habit.target_count}회)를 달성했습니다!`
          : `‘${habit.name}’ ${next.count}/${habit.target_count}회 기록했습니다.`)
        : `‘${habit.name}’ 오늘 기록을 남겼습니다.`;
    showHabitUndoToast(message, () => {
      actions.setLog({ habitId: habit.id, date: activeDate, status: prevStatus, count: prevCount });
    });
  };

  return (
    <>
      <Pressable
        accessibilityRole="button" accessibilityLabel={habit.name + ' 자세히 보기'}
        onPress={() => router.push({ pathname: '/habit/[id]', params: { id: habit.id } })}>
        <Card style={[styles.card, focused && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
          <View style={{ flex: 1, gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <HabitAvatar name={habit.name} emoji={look.emoji} size={24} />
              <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{habit.name}</Txt>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${habit.name} 메뉴`}
                hitSlop={8}
                onPress={() => {
                  haptic.tap();
                  setMenu(true);
                }}
                style={({ pressed }) => [
                  styles.moreBtn,
                  pressed && { backgroundColor: colors.surfaceMuted },
                ]}>
                <Icon name="more-horizontal" size={16} color={colors.textFaint} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {week.map((item) => {
                const log = byDate.get(item.toString());
                const outside = outsideHabit(habit, item, day);
                const isToday = item.equals(day);
                // A day short of a daily goal (2 of 4) is lighter than a day that met it.
                const state = dayState(habit, log);
                const met = state === 'met';
                // One accent ramp: met is full accent, partial lighter; frozen soft accent border, skipped dashed muted outline.
                const fill = met
                  ? colors.accent
                  : state === 'partial'
                    ? colors.accentRamp[1]
                    : state === 'frozen'
                      ? colors.accentSoft
                      : state === 'skipped'
                        ? 'transparent'
                        : colors.surfaceMuted;
                const dotBorder = isToday
                  ? { borderWidth: 1.5, borderColor: colors.text }
                  : state === 'skipped'
                    ? { borderWidth: 1.5, borderStyle: 'dashed' as const, borderColor: colors.control }
                    : state === 'frozen'
                      ? { borderWidth: 1, borderColor: colors.accentRamp[1] }
                      : null;
                // Tapping a day sets or clears its record, so a forgotten yesterday is fixed right here.
                return (
                  <Pressable
                    key={item.toString()} disabled={outside} hitSlop={6}
                    accessibilityRole="button" accessibilityLabel={`${item.month}월 ${item.day}일 ${met ? '기록 지우기' : '기록하기'}`}
                    onPress={() => {
                      haptic.light();
                      const prevStatus = log?.status ?? null;
                      const prevCount = log?.count ?? 0;
                      const targetDate = item.toString();
                      actions.setLog({
                        habitId: habit.id, date: targetDate, status: met ? null : 'completed', count: met ? 0 : weekly ? 1 : habit.target_count,
                      });
                      const dateText = isToday ? '오늘' : `${item.month}월 ${item.day}일`;
                      showHabitUndoToast(`${dateText} 기록을 ${met ? '지웠습니다.' : '남겼습니다.'}`, () => {
                        actions.setLog({ habitId: habit.id, date: targetDate, status: prevStatus, count: prevCount });
                      });
                    }}
                    style={({ pressed }) => ({ alignItems: 'center', gap: 3, opacity: outside ? 0.35 : pressed ? 0.6 : 1 })}>
                    <View style={[styles.dot, { backgroundColor: fill }, dotBorder]}>
                      {log?.status === 'frozen' ? <Icon name="pause" size={10} color={colors.accentText} /> : null}
                      {log?.status === 'skipped' ? <Icon name="minus" size={10} color={colors.textMuted} /> : null}
                    </View>
                    <Txt variant="caption" tone={isToday ? 'default' : 'faint'} style={isToday ? styles.todayLabel : undefined}>
                      {weekdayName(item)}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
            {hasFooter ? (
              // One quiet line: missed/status signal, then compact icon-led streak and consistency.
              <View style={styles.footer}>
                {strength.missedYesterday ? (
                  <View style={styles.missedBadge}>
                    <View style={[styles.missedDot, { backgroundColor: colors.danger }]} />
                    <Txt variant="metaStrong" tone="danger" numberOfLines={1}>어제 놓침</Txt>
                  </View>
                ) : statusText ? (
                  <Txt variant="meta" tone="muted" tabular numberOfLines={1}>
                    {statusText}
                  </Txt>
                ) : null}
                {streak > 0 ? (
                  <View style={styles.statItem} accessible accessibilityLabel={`${streak}${weekly ? '주' : '일'} 연속`}>
                    <Icon name="zap" size={11} color={colors.textFaint} />
                    <Txt variant="meta" tone="muted" tabular>{streak}{weekly ? '주' : '일'}</Txt>
                  </View>
                ) : null}
                {strength.score > 0 ? (
                  <View style={styles.statItem} accessible accessibilityLabel={`꾸준함 ${strength.score}%`}>
                    <Icon name="activity" size={11} color={colors.textFaint} />
                    <Txt variant="meta" tone="muted" tabular>{strength.score}%</Txt>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          <CheckIn
            progress={progress} target={habit.target_count} done={done} onPress={checkIn} onLongPress={() => setMenu(true)}
            label={habit.name + (done ? ' 기록 취소' : ' 기록')} />
        </Card>
      </Pressable>
      <HabitAdjustSheet
        visible={menu}
        onClose={() => setMenu(false)}
        habit={habit}
        date={activeDate}
        todayLog={todayLog}
      />
    </>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  missedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  missedDot: { width: 5, height: 5, borderRadius: 2.5 },
  moreBtn: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  todayLabel: { fontWeight: '700' },
  dot: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  stepperBox: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderRadius: radius.md, padding: space.sm,
  },
});
