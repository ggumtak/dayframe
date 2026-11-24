import { router, useLocalSearchParams } from 'expo-router';
import { type RefObject, useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';

import { MonthCalendar } from '@/components/MonthCalendar';
import { YearCalendar } from '@/components/YearCalendar';
import { FoldHeader, Header, Icon, IconButton, Loading, Screen, SectionTitle, Segmented, Txt } from '@/components/ui';
import { bySchedule, useTaskIndex } from '@/data/tasks';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { TaskList } from '@/features/tasks/TaskList';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, dueDate, formatDate, Temporal, today, weekdayName } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { datePhrase, occurrenceDates } from '@/lib/occurrences';
import { usePersistentState } from '@/lib/persist';
import { nextOccurrence, type Task } from '@/lib/shared';
import { useTabScrollTop } from '@/lib/tabScroll';
import { yearCounts } from '@/lib/yearView';
import { radius, space, useTheme } from '@/theme';

type UpcomingView = 'week' | 'month' | 'year';
const isUpcomingView = (value: string): value is UpcomingView => value === 'week' || value === 'month' || value === 'year';

export default function Upcoming() {
  const { colors } = useTheme();
  const { tasks, isLoading, refetch } = useTaskIndex();
  const [refreshing, setRefreshing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [view, setView] = usePersistentState<UpcomingView>('dayframe-upcoming-view', 'week', isUpcomingView);
  const [monthDay, setMonthDay] = useState<string | null>(null);
  // The calendar's shown month ("YYYY-MM") once the person moves it or picks one in the year view; until then it
  // follows the selected day, or this month.
  const [calendarMonth, setCalendarMonth] = useState<string | null>(null);
  const [yearShown, setYearShown] = useState<number | null>(null);
  const quickAdd = useQuickAdd();
  const listScroll = useRef<ScrollViewInstance>(null);
  const monthScroll = useRef<ScrollViewInstance>(null);
  const yearScroll = useRef<ScrollViewInstance>(null);
  useTabScrollTop('upcoming', view === 'week' ? listScroll : view === 'month' ? monthScroll : yearScroll);

  // The floating + adds to the day in view: the picked day of the week strip or of the calendar.
  const focusDay = view === 'month' ? monthDay : view === 'week' ? picked : null;
  useScreenDefaults({ initialText: focusDay ? datePhrase(Temporal.PlainDate.from(focusDay), today(deviceTimeZone())) + ' ' : undefined });
  const addOn = (date: Temporal.PlainDate) => quickAdd.open({ initialText: datePhrase(date, today(deviceTimeZone())) + ' ' });

  // The calendar widget opens a day here; `at` differs on every tap, so the same day can be opened twice.
  const params = useLocalSearchParams<{ view?: string; date?: string; at?: string }>();
  const link = (params.view ?? '') + '|' + (params.date ?? '') + '|' + (params.at ?? '');
  const [appliedLink, setAppliedLink] = useState('||');
  if (link !== appliedLink) {
    setAppliedLink(link);
    if (params.view === 'month') setView('month');
    if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
      setMonthDay(params.date);
      setCalendarMonth(null);
    }
  }
  const minute = useMinute();
  const now = today(deviceTimeZone());
  const shownMonth = calendarMonth ?? (monthDay ? monthDay.slice(0, 7) : now.toPlainYearMonth().toString());
  const showMonth = useCallback((next: Temporal.PlainYearMonth) => {
    setCalendarMonth(next.toString());
    setMonthDay(null);
  }, []);
  // A month tapped in the year view opens in the calendar, with no day picked.
  const openMonth = useCallback((year: number, month: number) => {
    setCalendarMonth(Temporal.PlainYearMonth.from({ year, month }).toString());
    setMonthDay(null);
    setView('month');
  }, [setView]);

  const overdue = useMemo(
    () => tasks.filter((item) => dueBucket(item) === 'overdue').sort(bySchedule),
    [tasks],
  );

  // Week strip starts from today + weekOffset * 7 days, navigable forward & backward like Todoist/Fantastical.
  const weekStartDay = now.add({ days: weekOffset * 7 });
  const week = Array.from({ length: 7 }, (_, offset) => weekStartDay.add({ days: offset }));
  const weekLastDay = week[6];

  // Expand both real tasks AND future repeat previews across the visible week window.
  const weekMap = useMemo(() => {
    const base = Temporal.Instant.fromEpochMilliseconds(minute * 60_000).toZonedDateTimeISO(deviceTimeZone()).toPlainDate();
    const start = base.add({ days: weekOffset * 7 });
    const end = start.add({ days: 6 });
    const map = new Map<string, { real: Task[]; previews: Task[] }>();
    for (const task of tasks) {
      const due = dueDate(task)?.toString();
      for (const date of occurrenceDates(task, start, end, nextOccurrence)) {
        const key = date.toString();
        const entry = map.get(key) ?? { real: [], previews: [] };
        (key === due ? entry.real : entry.previews).push(task);
        map.set(key, entry);
      }
    }
    map.forEach((entry) => {
      entry.real.sort(bySchedule);
      entry.previews.sort(bySchedule);
    });
    return map;
  }, [tasks, weekOffset, minute]);

  // Also collect further-out dated tasks after the current week when viewing weekOffset === 0.
  const beyondWeek = useMemo(() => {
    if (weekOffset !== 0) return [];
    const base = Temporal.Instant.fromEpochMilliseconds(minute * 60_000).toZonedDateTimeISO(deviceTimeZone()).toPlainDate();
    const end = base.add({ days: 6 });
    const groups = new Map<string, { real: Task[]; previews: Task[] }>();
    for (const task of tasks.filter((item) => dueBucket(item) === 'upcoming').sort(bySchedule)) {
      const d = dueDate(task)!;
      if (Temporal.PlainDate.compare(d, end) <= 0) continue;
      const key = d.toString();
      const entry = groups.get(key) ?? { real: [], previews: [] };
      entry.real.push(task);
      groups.set(key, entry);
    }
    return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, entry]) => ({ key, ...entry }));
  }, [tasks, weekOffset, minute]);

  const selected = picked && week.some((date) => date.toString() === picked) ? picked : null;
  // dueBucket reads the clock for every task, so count once per task list and minute rather than on every render;
  // `minute` is a dependency only so the count follows the day turning over.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const upcomingCount = useMemo(() => tasks.filter((item) => dueBucket(item) === 'upcoming').length, [tasks, minute]);

  const plannerDays = selected
    ? [{ key: selected, ...(weekMap.get(selected) ?? { real: [], previews: [] }) }]
    : [
      ...week.map((date) => {
        const key = date.toString();
        const entry = weekMap.get(key) ?? { real: [], previews: [] };
        return { key, ...entry };
      }),
      ...beyondWeek,
    ];

  const swipeWeek = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-18, 18])
    .runOnJS(true)
    .onEnd((event) => {
      if (event.translationX < -44) {
        haptic.tap();
        setPicked(null);
        setWeekOffset((w) => w + 1);
      } else if (event.translationX > 44 && weekOffset > 0) {
        haptic.tap();
        setPicked(null);
        setWeekOffset((w) => Math.max(0, w - 1));
      }
    });

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <Screen>
      <Header
        title="예정"
        subtitle={upcomingCount ? `앞으로 ${upcomingCount}개` : '날짜별 일정을 계획해 보세요'}
        right={(
          <View style={{ flexDirection: 'row' }}>
            <IconButton name="search" label="검색" onPress={() => router.push('/search')} color={colors.textMuted} />
            <IconButton name="settings" label="설정" onPress={() => router.push('/settings')} color={colors.textMuted} />
          </View>
        )} />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <Segmented<UpcomingView>
          value={view} onChange={setView}
          options={[
            { value: 'week', label: '주', icon: 'list' },
            { value: 'month', label: '월', icon: 'calendar' },
            { value: 'year', label: '연', icon: 'grid' },
          ]} />
      </View>
      {view === 'year' ? (
        <YearView
          scrollRef={yearScroll} tasks={tasks} year={yearShown ?? now.year} today={now} onYearChange={setYearShown}
          onPickMonth={openMonth} refreshing={refreshing} onRefresh={refresh} />
      ) : view === 'month' ? (
        <MonthView
          key={appliedLink} scrollRef={monthScroll} tasks={tasks} month={shownMonth} onMonthChange={showMonth} selected={monthDay}
          onSelect={setMonthDay} onAdd={addOn} refreshing={refreshing} onRefresh={refresh} />
      ) : (
        <>
          <View style={styles.weekNav}>
            <IconButton
              name="chevron-left" label="이전 주" size={18}
              color={weekOffset > 0 ? colors.textMuted : colors.border}
              onPress={() => {
                if (weekOffset <= 0) return;
                haptic.tap();
                setPicked(null);
                setWeekOffset((w) => Math.max(0, w - 1));
              }}
              style={{ width: 32, height: 32 }} />
            <Txt variant="smallStrong" tone="muted" style={{ flex: 1, textAlign: 'center' }}>
              {weekStartDay.year !== now.year ? `${weekStartDay.year}년 ` : ''}{weekStartDay.month}월 {weekStartDay.day}일 ~ {weekLastDay.month}월 {weekLastDay.day}일
            </Txt>
            {weekOffset !== 0 ? (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  haptic.tap();
                  setPicked(null);
                  setWeekOffset(0);
                }}
                style={{ paddingHorizontal: 6 }}>
                <Txt variant="smallStrong" tone="accent">오늘</Txt>
              </Pressable>
            ) : null}
            <IconButton
              name="chevron-right" label="다음 주" size={18} color={colors.textMuted}
              onPress={() => {
                haptic.tap();
                setPicked(null);
                setWeekOffset((w) => w + 1);
              }}
              style={{ width: 32, height: 32 }} />
          </View>

          <GestureDetector gesture={swipeWeek}>
            <View style={[styles.week, { borderBottomColor: colors.border }]}>
              {week.map((date) => {
                const key = date.toString();
                const active = key === selected;
                const isToday = date.equals(now);
                const entry = weekMap.get(key);
                const count = (entry?.real.length ?? 0) + (entry?.previews.length ?? 0);
                const dotNum = count >= 5 ? 3 : count >= 3 ? 2 : count >= 1 ? 1 : 0;
                const dotColor = active ? colors.accent : count >= 5 ? colors.danger : count >= 3 ? colors.warning : colors.textFaint;
                return (
                  <Pressable
                    key={key} accessibilityRole="button" accessibilityState={{ selected: active }}
                    accessibilityLabel={`${date.month}월 ${date.day}일 ${weekdayName(date)}요일, ${count}개`}
                    onPress={() => {
                      haptic.tap();
                      setPicked(active ? null : key);
                    }}
                    style={styles.day}>
                    <Txt variant="caption" style={{ color: date.dayOfWeek === 7 ? colors.danger : date.dayOfWeek === 6 ? colors.accent : colors.textMuted }}>{weekdayName(date)}</Txt>
                    <View
                      style={[
                        styles.dayNumber,
                        active && { backgroundColor: colors.accent },
                        isToday && !active && { borderWidth: 1.5, borderColor: colors.accent },
                      ]}>
                      <Txt variant="bodyStrong" style={{ color: active ? colors.onAccent : isToday ? colors.accent : colors.text }}>{date.day}</Txt>
                    </View>
                    <View style={styles.dotRow}>
                      {dotNum > 0 ? Array.from({ length: dotNum }, (_, i) => (
                        <View key={i} style={[styles.dot, { backgroundColor: dotColor }]} />
                      )) : <View style={[styles.dot, { backgroundColor: 'transparent' }]} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </GestureDetector>

          {isLoading ? <Loading /> : (
            <ScrollView
              ref={listScroll}
              contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
              {weekOffset === 0 && !selected && overdue.length > 0 ? (
                <View>
                  <FoldHeader
                    title="지연됨" count={overdue.length} detail={overdueOpen ? '접기' : '펼치기'} detailTone="danger"
                    open={overdueOpen} onToggle={() => setOverdueOpen((open) => !open)} label="지연된 할 일" />
                  {overdueOpen ? <TaskList tasks={overdue} /> : null}
                </View>
              ) : null}

              {plannerDays.map((day) => {
                const date = Temporal.PlainDate.from(day.key);
                const title = dayTitle(date, now);
                const total = day.real.length + day.previews.length;
                if (total === 0) {
                  return (
                    <View key={day.key} style={[styles.freeDay, { borderBottomColor: colors.border }]}>
                      <Txt variant="small" tone={date.equals(now) ? 'accent' : 'faint'} style={{ flex: 1 }}>{title}</Txt>
                      <AddButton label={title} onPress={() => addOn(date)} />
                    </View>
                  );
                }
                return (
                  <View key={day.key}>
                    <SectionTitle
                      title={title} count={total} tone={date.equals(now) ? 'accent' : undefined}
                      action={<AddButton label={title} onPress={() => addOn(date)} />} />
                    {day.real.length ? <TaskList tasks={day.real} hideDate /> : null}
                    {day.previews.map((task) => <Preview key={task.id + '-' + day.key} task={task} date={date} />)}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </>
      )}
    </Screen>
  );
}

/** "오늘 · 11월 23일 (월)", "내일 · 11월 24일 (화)", "수요일 · 11월 25일", or the plain date when further away. */
function dayTitle(date: Temporal.PlainDate, now: Temporal.PlainDate): string {
  const label = formatDate(date, now);
  if (/^\d/.test(label)) return label;
  const day = `${date.month}월 ${date.day}일`;
  return label.endsWith('요일') ? `${label} · ${day}` : `${label} · ${day} (${weekdayName(date)})`;
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label + '에 추가'} hitSlop={10} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 2, opacity: pressed ? 0.6 : 1 })}>
      <Icon name="plus" size={16} color={colors.accent} />
      <Txt variant="smallStrong" tone="accent">추가</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  weekNav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingBottom: 2 },
  week: { flexDirection: 'row', paddingHorizontal: space.sm, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  monthBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.md, marginTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  preview: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: space.lg },
  previewIcon: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginTop: 12, marginRight: space.md },
  previewBody: { flex: 1, gap: 3, paddingVertical: 11, paddingRight: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  freeDay: {
    flexDirection: 'row', alignItems: 'center', minHeight: 44, marginLeft: space.lg, paddingRight: space.lg, marginTop: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  day: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4 },
  dayNumber: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dotRow: { flexDirection: 'row', gap: 2, height: 4, alignItems: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2 },
});

/** One task as it will fall on a later date of its repeat: shown for planning, opened to edit the task. */
function Preview({ task, date }: { task: Task; date: Temporal.PlainDate }) {
  const { colors } = useTheme();
  const at = task.due_at && !task.all_day ? Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone) : null;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={task.title + ' 반복 예정'}
      onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
      style={({ pressed }) => [styles.preview, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={[styles.previewIcon, { borderColor: colors.border }]}>
        <Icon name="repeat" size={11} color={colors.textFaint} />
      </View>
      <View style={[styles.previewBody, { borderBottomColor: colors.border }]}>
        <Txt tone="muted" numberOfLines={1}>{task.title}</Txt>
        <Txt variant="small" tone="faint">
          {(at ? (at.hour < 12 ? '오전 ' : '오후 ') + (at.hour % 12 || 12) + ':' + String(at.minute).padStart(2, '0') + ' · ' : '')
            + (task.recurrence_mode === 'completion' ? '완료 후 반복 예상 · ' : '반복 예정 · ') + date.month + '월 ' + date.day + '일'}
        </Txt>
      </View>
    </Pressable>
  );
}

/**
 * A month at a glance. Density dots mark workload per day (repeats included); swipe left/right to change months.
 */
function MonthView({ scrollRef, tasks, month: monthKey, onMonthChange, selected, onSelect, onAdd, refreshing, onRefresh }: {
  scrollRef: RefObject<ScrollViewInstance | null>;
  tasks: Task[];
  /** The shown month, "YYYY-MM"; held by the screen so the year view can open a month here. */
  month: string; onMonthChange: (month: Temporal.PlainYearMonth) => void;
  selected: string | null; onSelect: (day: string | null) => void; onAdd: (date: Temporal.PlainDate) => void;
  refreshing: boolean; onRefresh: () => void;
}) {
  const { colors } = useTheme();
  const now = today(deviceTimeZone());
  const picked = selected ? Temporal.PlainDate.from(selected) : null;
  const month = useMemo(() => Temporal.PlainYearMonth.from(monthKey), [monthKey]);
  const days = useMemo(() => {
    const shown = Temporal.PlainYearMonth.from(monthKey);
    const first = shown.toPlainDate({ day: 1 });
    const last = shown.toPlainDate({ day: shown.daysInMonth });
    const map = new Map<string, { real: Task[]; previews: Task[] }>();
    for (const task of tasks) {
      const due = dueDate(task)?.toString();
      for (const date of occurrenceDates(task, first, last, nextOccurrence)) {
        const key = date.toString();
        const entry = map.get(key) ?? { real: [], previews: [] };
        (key === due ? entry.real : entry.previews).push(task);
        map.set(key, entry);
      }
    }
    // Sorted once here, not on every render of every day section.
    map.forEach((entry) => entry.real.sort(bySchedule));
    return map;
  }, [tasks, monthKey]);

  const [dotCounts, total] = useMemo(() => {
    const counts = new Map<string, number>();
    let sum = 0;
    days.forEach((entry, key) => {
      counts.set(key, entry.real.length + entry.previews.length);
      sum += entry.real.length + entry.previews.length;
    });
    return [counts, sum] as const;
  }, [days]);

  const listed = [...days.keys()].filter((key) => !selected || key === selected).sort();
  if (selected && !days.has(selected)) listed.push(selected);
  const title = (date: Temporal.PlainDate) => dayTitle(date, now);

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}>
      <View style={{ paddingHorizontal: space.md }}>
        <MonthCalendar
          initial={picked ?? now} month={month} selected={picked} today={now} dotCounts={dotCounts}
          onMonthChange={onMonthChange}
          onSelect={(date) => onSelect(date.toString() === selected ? null : date.toString())}
          onLongPress={(date) => {
            onSelect(date.toString());
            onAdd(date);
          }} />
      </View>
      <View style={[styles.monthBar, { borderTopColor: colors.border }]}>
        <Txt variant="small" tone="muted" style={{ flex: 1 }}>
          {selected ? '날짜를 다시 누르면 이번 달 전체 · +로 이날에 추가' : `${month.month}월 일정 ${total}개 · 옆으로 밀어 달 이동`}
        </Txt>
        {selected ? <AddButton label={title(picked!)} onPress={() => onAdd(picked!)} /> : null}
      </View>
      {listed.length === 0 ? (
        <Txt variant="small" tone="muted" style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>이번 달에는 일정이 없습니다.</Txt>
      ) : listed.map((key) => {
        const date = Temporal.PlainDate.from(key);
        const entry = days.get(key) ?? { real: [], previews: [] };
        return (
          <View key={key}>
            <SectionTitle
              title={title(date)} count={entry.real.length + entry.previews.length} tone={Temporal.PlainDate.compare(date, now) < 0 ? 'danger' : undefined}
              action={<AddButton label={title(date)} onPress={() => onAdd(date)} />} />
            {entry.real.length ? <TaskList tasks={entry.real} hideDate /> : null}
            {entry.previews.map((task) => <Preview key={task.id} task={task} date={date} />)}
            {entry.real.length + entry.previews.length === 0 ? (
              <Txt variant="small" tone="muted" style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }}>이날은 할 일이 없습니다.</Txt>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * The year at a glance. Per-day counts are built once per task list and year (repeats included, as in the month
 * view); the twelve months are memoized blocks, so only months whose days changed re-render.
 */
function YearView({ scrollRef, tasks, year, today: now, onYearChange, onPickMonth, refreshing, onRefresh }: {
  scrollRef: RefObject<ScrollViewInstance | null>;
  tasks: Task[]; year: number; today: Temporal.PlainDate;
  onYearChange: (year: number) => void; onPickMonth: (year: number, month: number) => void;
  refreshing: boolean; onRefresh: () => void;
}) {
  const { colors } = useTheme();
  const counts = useMemo(() => yearCounts(tasks, year, nextOccurrence), [tasks, year]);
  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 140, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}>
      <YearCalendar year={year} today={now} counts={counts} onYearChange={onYearChange} onPickMonth={onPickMonth} />
    </ScrollView>
  );
}
