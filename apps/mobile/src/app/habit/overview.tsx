import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card, EmptyState, Header, Icon, IconButton, Loading, Screen, Segmented, Txt } from '@/components/ui';
import { useHabitDetails, useHabits } from '@/data/habits';
import { type DayState, dayState, earliestStart, logsByDate, monthCells, outsideHabit, weekDates } from '@/features/habits/goal';
import { HabitAvatar } from '@/features/habits/HabitAvatar';
import { type HabitMeta, useHabitMetaMap } from '@/features/habits/habitMeta';
import { softTint } from '@/features/habits/palette';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, type PlainDate, Temporal, today, weekdayName, weekStart } from '@/lib/dates';
import type { Habit, HabitLog } from '@/lib/shared';
import { radius, space, useTheme } from '@/theme';

type Mode = 'week' | 'month';
const NO_LOGS: HabitLog[] = [];
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const stateLabel: Record<DayState, string> = { met: '달성', partial: '일부', skipped: '건너뜀', frozen: '쉬어감', empty: '기록 없음' };

/** The colours of one day cell, from the habit's own colour (or the app's success green without one). */
function useCellColors(meta: HabitMeta | undefined) {
  const { colors, isDark } = useTheme();
  const base = meta?.color ?? colors.success;
  return useMemo(() => ({
    met: base,
    partial: softTint(base, isDark, 'medium'),
    skipped: colors.border,
    frozen: colors.border,
    empty: colors.surfaceMuted,
  } satisfies Record<DayState, string>), [base, isDark, colors]);
}

function Mark({ state, size }: { state: DayState; size: number }) {
  const { colors } = useTheme();
  if (state === 'frozen') return <Icon name="pause" size={size} color={colors.textMuted} />;
  if (state === 'skipped') return <Icon name="minus" size={size} color={colors.textMuted} />;
  return null;
}

/** One habit's week: seven cells, Monday first. */
const WeekRow = memo(function WeekRow({ habit, logs, meta, days, todayKey }: {
  habit: Habit; logs: HabitLog[]; meta?: HabitMeta; days: PlainDate[]; todayKey: string;
}) {
  const byDate = useMemo(() => logsByDate(logs), [logs]);
  const fills = useCellColors(meta);
  const now = useMemo(() => Temporal.PlainDate.from(todayKey), [todayKey]);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={habit.name + ' 자세히 보기'}
      onPress={() => router.push({ pathname: '/habit/[id]', params: { id: habit.id } })}
      style={({ pressed }) => [styles.weekRow, pressed && { opacity: 0.7 }]}>
      <View style={styles.weekName}>
        <HabitAvatar name={habit.name} emoji={meta?.emoji} color={meta?.color} size={26} />
        <Txt variant="smallStrong" numberOfLines={1} style={{ flex: 1 }}>{habit.name}</Txt>
      </View>
      <View style={styles.weekCells}>
        {days.map((date) => {
          const state = dayState(habit, byDate.get(date.toString()));
          const outside = outsideHabit(habit, date, now);
          return (
            <View
              key={date.toString()} accessibilityLabel={`${date.month}월 ${date.day}일 ${outside ? '' : stateLabel[state]}`}
              style={[styles.weekCell, { backgroundColor: outside ? fills.empty : fills[state], opacity: outside ? 0.35 : 1 }]}>
              {outside ? null : <Mark state={state} size={10} />}
            </View>
          );
        })}
      </View>
    </Pressable>
  );
});

/** One habit's month as a small grid, for the two-column monthly view. */
const MiniMonth = memo(function MiniMonth({ habit, logs, meta, cells, todayKey }: {
  habit: Habit; logs: HabitLog[]; meta?: HabitMeta; cells: (PlainDate | null)[]; todayKey: string;
}) {
  const { colors } = useTheme();
  const byDate = useMemo(() => logsByDate(logs), [logs]);
  const fills = useCellColors(meta);
  const now = useMemo(() => Temporal.PlainDate.from(todayKey), [todayKey]);
  const { days, met } = useMemo(() => {
    const list = cells.map((date) => (date ? {
      key: date.toString(), outside: outsideHabit(habit, date, now), state: dayState(habit, byDate.get(date.toString())),
    } : null));
    return { days: list, met: list.filter((day) => day && !day.outside && day.state === 'met').length };
  }, [cells, habit, now, byDate]);
  const rendered = days.map((day, index) => {
    if (!day) return <View key={'blank' + index} style={styles.miniCell} />;
    return (
      <View
        key={day.key}
        style={[styles.miniCell, {
          backgroundColor: day.outside ? fills.empty : fills[day.state], opacity: day.outside ? 0.35 : 1,
          borderWidth: day.key === todayKey ? 1 : 0, borderColor: colors.text,
        }]}>
        {day.outside ? null : <Mark state={day.state} size={7} />}
      </View>
    );
  });
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${habit.name}, 이 달 ${met}일 달성, 자세히 보기`}
      onPress={() => router.push({ pathname: '/habit/[id]', params: { id: habit.id } })}
      style={({ pressed }) => [styles.miniWrap, pressed && { opacity: 0.7 }]}>
      <Card style={styles.miniCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <HabitAvatar name={habit.name} emoji={meta?.emoji} color={meta?.color} size={22} />
          <Txt variant="smallStrong" numberOfLines={1} style={{ flex: 1 }}>{habit.name}</Txt>
          <Txt variant="caption" tone="faint">{met}일</Txt>
        </View>
        <View importantForAccessibility="no-hide-descendants">
          <View style={styles.miniHead}>
            {WEEKDAYS.map((name) => <Txt key={name} variant="caption" tone="faint" style={styles.miniDay}>{name}</Txt>)}
          </View>
          <View style={styles.miniGrid}>{rendered}</View>
        </View>
      </Card>
    </Pressable>
  );
});

function Stepper({ label, onPrev, onNext, canPrev, canNext, prevLabel, nextLabel }: {
  label: string; onPrev: () => void; onNext: () => void; canPrev: boolean; canNext: boolean; prevLabel: string; nextLabel: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.stepper}>
      <View style={{ opacity: canPrev ? 1 : 0.3 }} pointerEvents={canPrev ? 'auto' : 'none'}>
        <IconButton name="chevron-left" label={prevLabel} onPress={onPrev} color={colors.textMuted} />
      </View>
      <Txt variant="bodyStrong" style={{ flex: 1, textAlign: 'center' }} accessibilityLiveRegion="polite">{label}</Txt>
      <View style={{ opacity: canNext ? 1 : 0.3 }} pointerEvents={canNext ? 'auto' : 'none'}>
        <IconButton name="chevron-right" label={nextLabel} onPress={onNext} color={colors.textMuted} />
      </View>
    </View>
  );
}

/** 기록 한눈에 보기: every active habit's record side by side, by week or by month. Read-only. */
export default function HabitOverview() {
  const { data, isLoading } = useHabits();
  const habitMeta = useHabitMetaMap();
  useMinute();
  const habits = useMemo(() => (data ?? []).filter((habit) => !habit.archived_at), [data]);
  const details = useHabitDetails(habits);
  const [mode, setMode] = useState<Mode>('week');

  const todayKey = today(deviceTimeZone()).toString();
  const now = useMemo(() => Temporal.PlainDate.from(todayKey), [todayKey]);
  // Logs come back in full from a habit's start (the API pages through all of them), so the oldest start
  // date is as far back as there is anything to show.
  const first = useMemo(() => earliestStart(habits, now), [habits, now]);

  // Offsets from the current week and month, so the view follows the date when it rolls over.
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const monday = useMemo(() => weekStart(now).subtract({ weeks: weekOffset }), [now, weekOffset]);
  const days = useMemo(() => weekDates(monday), [monday]);
  const month = useMemo(() => now.toPlainYearMonth().subtract({ months: monthOffset }), [now, monthOffset]);
  const cells = useMemo(() => monthCells(month), [month]);
  const canPrevWeek = Temporal.PlainDate.compare(monday, weekStart(first)) > 0;
  const canPrevMonth = Temporal.PlainYearMonth.compare(month, first.toPlainYearMonth()) > 0;

  const sunday = days[6];
  const weekLabel = weekOffset === 0 ? '이번 주'
    : `${monday.month}월 ${monday.day}일 – ${sunday.month === monday.month ? '' : sunday.month + '월 '}${sunday.day}일`;
  const monthLabel = month.year === now.year ? `${month.month}월` : `${month.year}년 ${month.month}월`;

  return (
    <Screen>
      <Header title="기록 한눈에 보기" left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'week', label: '주간' }, { value: 'month', label: '월간' }]} />
      </View>
      {isLoading ? <Loading /> : !habits.length ? (
        <EmptyState icon="grid" title="아직 습관이 없습니다" message="습관을 만들면 여기서 기록을 한눈에 볼 수 있습니다." />
      ) : mode === 'week' ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}>
          <Stepper
            label={weekLabel} canPrev={canPrevWeek} canNext={weekOffset > 0}
            onPrev={() => setWeekOffset((value) => value + 1)} onNext={() => setWeekOffset((value) => Math.max(0, value - 1))}
            prevLabel="지난주" nextLabel="다음 주" />
          <Card style={{ paddingVertical: space.sm, paddingHorizontal: space.md }}>
            <View style={styles.weekRow}>
              <View style={styles.weekName} />
              <View style={styles.weekCells}>
                {days.map((date) => (
                  <Txt
                    key={date.toString()} variant="caption" tone={date.toString() === todayKey ? 'accent' : 'faint'}
                    style={[styles.weekHead, date.toString() === todayKey && { fontWeight: '700' }]}>
                    {weekdayName(date)}{'\n'}{date.day}
                  </Txt>
                ))}
              </View>
            </View>
            {habits.map((habit) => (
              <WeekRow
                key={habit.id} habit={habit} logs={details.get(habit.id)?.logs ?? NO_LOGS} meta={habitMeta[habit.id]}
                days={days} todayKey={todayKey} />
            ))}
          </Card>
          <Legend />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}>
          <Stepper
            label={monthLabel} canPrev={canPrevMonth} canNext={monthOffset > 0}
            onPrev={() => setMonthOffset((value) => value + 1)} onNext={() => setMonthOffset((value) => Math.max(0, value - 1))}
            prevLabel="지난달" nextLabel="다음 달" />
          <View style={styles.grid}>
            {habits.map((habit) => (
              <MiniMonth
                key={habit.id} habit={habit} logs={details.get(habit.id)?.logs ?? NO_LOGS} meta={habitMeta[habit.id]}
                cells={cells} todayKey={todayKey} />
            ))}
          </View>
          <Legend />
        </ScrollView>
      )}
    </Screen>
  );
}

function Legend() {
  const { colors, isDark } = useTheme();
  const items = [
    { label: '달성', color: colors.success },
    { label: '일부', color: softTint(colors.success, isDark, 'medium') },
    { label: '건너뜀·쉬어감', color: colors.border },
    { label: '기록 없음', color: colors.surfaceMuted },
  ];
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: item.color }} />
          <Txt variant="caption" tone="faint">{item.label}</Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center' },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
  weekName: { width: 104, flexDirection: 'row', alignItems: 'center', gap: 6 },
  weekCells: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  weekCell: { flex: 1, aspectRatio: 1, maxWidth: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  weekHead: { flex: 1, maxWidth: 30, textAlign: 'center', fontSize: 10, lineHeight: 13 },
  miniHead: { flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm },
  miniWrap: { width: '48.5%' },
  miniCard: { padding: space.sm, gap: 6, borderRadius: radius.md },
  miniDay: { width: '14.28%', textAlign: 'center', fontSize: 9, lineHeight: 12 },
  miniGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  miniCell: { width: '12.28%', aspectRatio: 1, margin: '1%', borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md, marginTop: space.xs },
});
