import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { EmptyHabits } from '@/components/art';
import { Card, EMPTY_ART, EmptyState, Header, Icon, IconButton, Loading, Screen, Segmented, Txt } from '@/components/ui';
import { useHabitActions, useHabitDetails, useHabits } from '@/data/habits';
import { type DayState, dayState, earliestStart, logsByDate, outsideHabit, weekDates } from '@/features/habits/goal';
import { showHabitUndoToast } from '@/features/habits/HabitCard';
import type { StartOfWeek } from '@/features/settings/prefs';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, logicalToday, type PlainDate, Temporal, weekdayLabels, weekdayName, weekStart } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { gridColumns } from '@/lib/layout';
import { useLayout } from '@/lib/layoutContext';
import type { Habit, HabitLog } from '@/lib/shared';
import { type Colors, radius, space, useTheme } from '@/theme';

type Mode = 'week' | 'month';
const NO_LOGS: HabitLog[] = [];
const stateLabel: Record<DayState, string> = { met: '달성', partial: '일부 달성', skipped: '건너뜀', frozen: '쉬어감', empty: '기록 없음' };

/** Builds a month grid padded to whole weeks respecting `startOfWeek`. */
function overviewMonthCells(month: Temporal.PlainYearMonth, startOfWeek: StartOfWeek): (PlainDate | null)[] {
  const first = month.toPlainDate({ day: 1 });
  const lead = startOfWeek === 'sunday' ? first.dayOfWeek % 7 : first.dayOfWeek - 1;
  const cells: (PlainDate | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= month.daysInMonth; day += 1) cells.push(month.toPlainDate({ day }));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/**
 * The colours of a day cell: one accent ramp for every habit, built once per theme. Habits are told apart by name,
 * so the cells' colour means only how the day went.
 */
const cellCache = new WeakMap<Colors, Record<DayState, string>>();
function cellColors(colors: Colors): Record<DayState, string> {
  let fills = cellCache.get(colors);
  if (!fills) {
    fills = {
      met: colors.accent,
      partial: colors.accentRamp[1],
      skipped: 'transparent',
      frozen: colors.accentSoft,
      empty: colors.surfaceMuted,
    };
    cellCache.set(colors, fills);
  }
  return fills;
}

function cellBorderStyle(colors: Colors, state: DayState, outside: boolean, isToday: boolean): ViewStyle | null {
  if (isToday) return { borderWidth: 1.5, borderColor: colors.text };
  if (outside) return null;
  if (state === 'skipped') return { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.control };
  if (state === 'frozen') return { borderWidth: 1, borderColor: colors.accentRamp[1] };
  return null;
}

function Mark({ state, size }: { state: DayState; size: number }) {
  const { colors } = useTheme();
  if (state === 'frozen') return <Icon name="pause" size={size} color={colors.accentText} />;
  if (state === 'skipped') return <Icon name="minus" size={size} color={colors.textMuted} />;
  return null;
}

/** One habit's week: seven interactive cells respecting `startOfWeek`. */
const WeekRow = memo(function WeekRow({ habit, logs, days, todayKey, onToggle }: {
  habit: Habit;
  logs: HabitLog[];
  days: PlainDate[];
  todayKey: string;
  onToggle: (habit: Habit, date: PlainDate, log: HabitLog | undefined, state: DayState) => void;
}) {
  const { colors } = useTheme();
  const byDate = useMemo(() => logsByDate(logs), [logs]);
  const fills = cellColors(colors);
  const now = useMemo(() => Temporal.PlainDate.from(todayKey), [todayKey]);
  return (
    <View style={styles.weekRow}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={habit.name + ' 자세히 보기'}
        onPress={() => router.push({ pathname: '/habit/[id]', params: { id: habit.id } })}
        style={({ pressed }) => [styles.weekName, pressed && { opacity: 0.65 }]}>
        <Txt variant="smallStrong" numberOfLines={1} style={{ flex: 1 }}>{habit.name}</Txt>
      </Pressable>
      <View style={styles.weekCells}>
        {days.map((date) => {
          const key = date.toString();
          const log = byDate.get(key);
          const state = dayState(habit, log);
          const outside = outsideHabit(habit, date, now);
          const isToday = key === todayKey;
          return (
            <Pressable
              key={key}
              disabled={outside}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityState={{ selected: state === 'met', disabled: outside }}
              accessibilityLabel={outside
                ? `${date.month}월 ${date.day}일`
                : `${habit.name} ${date.month}월 ${date.day}일 ${stateLabel[state]}, ${state === 'met' ? '기록 지우기' : '기록하기'}`}
              onPress={() => onToggle(habit, date, log, state)}
              style={({ pressed }) => [
                styles.weekCell,
                {
                  backgroundColor: outside ? fills.empty : fills[state],
                  opacity: outside ? 0.35 : pressed ? 0.65 : 1,
                },
                cellBorderStyle(colors, state, outside, isToday),
              ]}>
              {outside ? null : <Mark state={state} size={10} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

/** One habit's month as a small grid, for the monthly view (two columns on a phone, three or four on a tablet). */
const MiniMonth = memo(function MiniMonth({ habit, logs, cells, weekdays, todayKey, width }: {
  habit: Habit; logs: HabitLog[]; cells: (PlainDate | null)[]; weekdays: readonly string[]; todayKey: string; width: ViewStyle;
}) {
  const { colors } = useTheme();
  const byDate = useMemo(() => logsByDate(logs), [logs]);
  const fills = cellColors(colors);
  const now = useMemo(() => Temporal.PlainDate.from(todayKey), [todayKey]);
  const { days, met } = useMemo(() => {
    const list = cells.map((date) => (date ? {
      key: date.toString(), outside: outsideHabit(habit, date, now), state: dayState(habit, byDate.get(date.toString())),
    } : null));
    return { days: list, met: list.filter((day) => day && !day.outside && day.state === 'met').length };
  }, [cells, habit, now, byDate]);
  const rendered = days.map((day, index) => {
    if (!day) return <View key={'blank' + index} style={styles.miniCell} />;
    const isToday = day.key === todayKey;
    return (
      <View
        key={day.key}
        style={[
          styles.miniCell,
          { backgroundColor: day.outside ? fills.empty : fills[day.state], opacity: day.outside ? 0.35 : 1 },
          cellBorderStyle(colors, day.state, day.outside, isToday),
        ]}>
        {day.outside ? null : <Mark state={day.state} size={7} />}
      </View>
    );
  });
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${habit.name}, ${met}일 달성, 자세히 보기`}
      onPress={() => router.push({ pathname: '/habit/[id]', params: { id: habit.id } })}
      style={({ pressed }) => [width, pressed && { opacity: 0.7 }]}>
      <Card style={styles.miniCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt variant="smallStrong" numberOfLines={1} style={{ flex: 1 }}>{habit.name}</Txt>
          <Txt variant="caption" tone="faint" tabular>{met}일</Txt>
        </View>
        <View importantForAccessibility="no-hide-descendants">
          <View style={styles.miniHead}>
            {weekdays.map((name) => <Txt key={name} variant="caption" tone="faint" style={styles.miniDay}>{name}</Txt>)}
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
      <Txt variant="bodyStrong" tabular style={{ flex: 1, textAlign: 'center' }} accessibilityLiveRegion="polite">{label}</Txt>
      <View style={{ opacity: canNext ? 1 : 0.3 }} pointerEvents={canNext ? 'auto' : 'none'}>
        <IconButton name="chevron-right" label={nextLabel} onPress={onNext} color={colors.textMuted} />
      </View>
    </View>
  );
}

/** 기록 한눈에 보기: every active habit's record side by side, by week (interactive) or by month. */
export default function HabitOverview() {
  const prefs = usePersonalPrefs();
  const { data, isLoading } = useHabits();
  const actions = useHabitActions();
  useMinute();
  const habits = useMemo(() => (data ?? []).filter((habit) => !habit.archived_at), [data]);
  const details = useHabitDetails(habits);
  const [mode, setMode] = useState<Mode>('week');
  const { column, landscape } = useLayout();
  // Two months a row on a phone (48.5 % each, as before); three in a tablet's column, four in landscape, where the
  // screen is short and a denser grid keeps more habits in view.
  const columns = column.maxWidth === undefined ? 2 : gridColumns(column.width - 2 * space.lg, landscape ? 150 : 200, 3, 4, space.sm);
  const miniWidth = useMemo(() => ({ width: `${(100 - (columns - 1) * 3) / columns}%` } as const), [columns]);

  const todayKey = logicalToday(deviceTimeZone(), prefs.dayStartHour).toString();
  const now = useMemo(() => Temporal.PlainDate.from(todayKey), [todayKey]);
  // Logs come back in full from a habit's start (the API pages through all of them), so the oldest start
  // date is as far back as there is anything to show.
  const first = useMemo(() => earliestStart(habits, now), [habits, now]);

  // Offsets from the current week and month, so the view follows the date when it rolls over.
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const firstDay = useMemo(() => weekStart(now, prefs.startOfWeek).subtract({ weeks: weekOffset }), [now, weekOffset, prefs.startOfWeek]);
  const days = useMemo(() => weekDates(firstDay), [firstDay]);
  const month = useMemo(() => now.toPlainYearMonth().subtract({ months: monthOffset }), [now, monthOffset]);
  const cells = useMemo(() => overviewMonthCells(month, prefs.startOfWeek), [month, prefs.startOfWeek]);
  const weekdays = useMemo(() => weekdayLabels(prefs.startOfWeek), [prefs.startOfWeek]);
  const canPrevWeek = Temporal.PlainDate.compare(firstDay, weekStart(first, prefs.startOfWeek)) > 0;
  const canPrevMonth = Temporal.PlainYearMonth.compare(month, first.toPlainYearMonth()) > 0;

  const lastDay = days[6];
  const weekLabel = weekOffset === 0 ? '이번 주'
    : `${firstDay.month}월 ${firstDay.day}일 ~ ${lastDay.month === firstDay.month ? '' : lastDay.month + '월 '}${lastDay.day}일`;
  const monthLabel = month.year === now.year ? `${month.month}월` : `${month.year}년 ${month.month}월`;

  const toggleWeekCell = (habit: Habit, date: PlainDate, log: HabitLog | undefined, state: DayState) => {
    const key = date.toString();
    const prevStatus = log?.status ?? null;
    const prevCount = log?.count ?? 0;
    const met = state === 'met';
    const weekly = habit.cadence === 'weekly';
    if (met) haptic.light();
    else haptic.success();
    actions.setLog({
      habitId: habit.id,
      date: key,
      status: met ? null : 'completed',
      count: met ? 0 : weekly ? 1 : habit.target_count,
    });
    const dateText = key === todayKey ? '오늘' : `${date.month}월 ${date.day}일`;
    showHabitUndoToast(`‘${habit.name}’ ${dateText} 기록을 ${met ? '지웠습니다.' : '남겼습니다.'}`, () => {
      actions.setLog({ habitId: habit.id, date: key, status: prevStatus, count: prevCount });
    });
  };

  return (
    <Screen>
      <Header title="기록 한눈에 보기" left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'week', label: '주간' }, { value: 'month', label: '월간' }]} />
      </View>
      {isLoading ? <Loading /> : !habits.length ? (
        <EmptyState icon="grid" art={<EmptyHabits size={EMPTY_ART} />} title="아직 등록된 습관이 없습니다" message="습관을 만들면 이곳에서 기록을 한눈에 볼 수 있습니다." />
      ) : mode === 'week' ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}>
          <Stepper
            label={weekLabel} canPrev={canPrevWeek} canNext={weekOffset > 0}
            onPrev={() => setWeekOffset((value) => value + 1)} onNext={() => setWeekOffset((value) => Math.max(0, value - 1))}
            prevLabel="이전 주" nextLabel="다음 주" />
          <Card style={{ paddingVertical: space.sm, paddingHorizontal: space.md }}>
            <View style={styles.weekRow}>
              <View style={styles.weekName} />
              <View style={styles.weekCells}>
                {days.map((date) => (
                  <Txt
                    key={date.toString()} variant="caption" tabular tone={date.toString() === todayKey ? 'default' : 'faint'}
                    style={[styles.weekHead, date.toString() === todayKey && { fontWeight: '700' }]}>
                    {weekdayName(date)}{'\n'}{date.day}
                  </Txt>
                ))}
              </View>
            </View>
            {habits.map((habit) => (
              <WeekRow
                key={habit.id}
                habit={habit}
                logs={details.get(habit.id)?.logs ?? NO_LOGS}
                days={days}
                todayKey={todayKey}
                onToggle={toggleWeekCell}
              />
            ))}
          </Card>
          <Txt variant="caption" tone="faint" style={{ textAlign: 'center' }}>
            날짜 칸을 눌러 바로 기록을 켜고 끌 수 있습니다
          </Txt>
          <Legend />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm }}>
          <Stepper
            label={monthLabel} canPrev={canPrevMonth} canNext={monthOffset > 0}
            onPrev={() => setMonthOffset((value) => value + 1)} onNext={() => setMonthOffset((value) => Math.max(0, value - 1))}
            prevLabel="이전 달" nextLabel="다음 달" />
          <View style={styles.grid}>
            {habits.map((habit) => (
              <MiniMonth
                key={habit.id}
                habit={habit}
                logs={details.get(habit.id)?.logs ?? NO_LOGS}
                cells={cells}
                weekdays={weekdays}
                todayKey={todayKey}
                width={miniWidth}
              />
            ))}
            {/* Fills the last row, so its cards keep their columns instead of spreading apart. */}
            {Array.from({ length: (columns - (habits.length % columns)) % columns }, (_, index) => (
              <View key={'spacer' + index} style={miniWidth} />
            ))}
          </View>
          <Legend />
        </ScrollView>
      )}
    </Screen>
  );
}

function Legend() {
  const { colors } = useTheme();
  const fills = cellColors(colors);
  const items: { state: DayState; label: string }[] = [
    { state: 'met', label: '달성' },
    { state: 'partial', label: '일부 달성' },
    { state: 'frozen', label: '쉬어감' },
    { state: 'skipped', label: '건너뜀' },
    { state: 'empty', label: '기록 없음' },
  ];
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.state} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View
            style={[
              { width: 10, height: 10, borderRadius: 3, backgroundColor: fills[item.state] },
              cellBorderStyle(colors, item.state, false, false),
            ]}
          />
          <Txt variant="caption" tone="faint">{item.label}</Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center' },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
  weekName: { width: 96, flexDirection: 'row', alignItems: 'center', minHeight: 30 },
  weekCells: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  weekCell: { flex: 1, aspectRatio: 1, maxWidth: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  weekHead: { flex: 1, maxWidth: 30, textAlign: 'center', fontSize: 10, lineHeight: 13 },
  miniHead: { flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm },
  miniCard: { padding: space.sm, gap: 6, borderRadius: radius.md },
  miniDay: { width: '14.28%', textAlign: 'center', fontSize: 9, lineHeight: 12 },
  miniGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  miniCell: { width: '12.28%', aspectRatio: 1, margin: '1%', borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md, marginTop: space.xs },
});
