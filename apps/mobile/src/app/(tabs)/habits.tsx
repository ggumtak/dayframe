import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';

import { EmptyHabits } from '@/components/art';
import { Button, Card, Chip, Divider, EMPTY_ART, EmptyState, Header, Icon, IconButton, Loading, Row, Screen, Txt } from '@/components/ui';
import { useHabitActions, useHabitDetails, useHabits } from '@/data/habits';
import { nextCheckIn } from '@/features/habits/checkIn';
import { dayMet, logsByDate, periodProgress } from '@/features/habits/goal';
import { HabitAdjustSheet, HabitCard, showHabitUndoToast } from '@/features/habits/HabitCard';
import { HABIT_TIME_GROUPS, type HabitTimeOfDay, useHabitMetaMap } from '@/features/habits/habitMeta';
import { RoutineRunner, type RoutineRunnerItem } from '@/features/habits/RoutineRunner';
import { KEY_PRIORITY, matchesCombo, useKeyHandler, useListCursor, useScreenContext, useScreenFocused } from '@/features/keyboard';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, logicalToday, Temporal, weekdayName, weekStart } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Habit, HabitLog } from '@/lib/shared';
import { useTabScrollTop } from '@/lib/tabScroll';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

const NO_LOGS: HabitLog[] = [];
const habitId = (habit: Habit) => habit.id;

const ROUTINE_TITLES: Record<HabitTimeOfDay, string> = {
  morning: '아침 루틴',
  afternoon: '오후 루틴',
  evening: '저녁 루틴',
  anytime: '오늘의 루틴',
};

export default function Habits() {
  const { colors } = useTheme();
  const prefs = usePersonalPrefs();
  const isFocused = useScreenFocused();
  useScreenContext('habits', isFocused);
  const { data, isLoading, refetch } = useHabits();
  const habitActions = useHabitActions();
  const habitMeta = useHabitMetaMap();
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [kbdMenuHabit, setKbdMenuHabit] = useState<Habit | null>(null);
  const [runnerGroup, setRunnerGroup] = useState<HabitTimeOfDay | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  useTabScrollTop('habits', scrollRef);
  // Re-renders the cards when the date rolls over, so a check-in always lands on the current day.
  useMinute();
  const habits = useMemo(() => (data ?? []).filter((habit) => !habit.archived_at), [data]);
  const archived = useMemo(() => (data ?? []).filter((habit) => !!habit.archived_at), [data]);
  const details = useHabitDetails(habits);

  const habitDateFor = (habit: Habit) => logicalToday(habit.timezone, prefs.dayStartHour).toString();

  const isSettledToday = (habit: Habit) => {
    const date = habitDateFor(habit);
    const logs = details.get(habit.id)?.logs ?? NO_LOGS;
    const progress = periodProgress(habit, logs, date);
    const todayCount = logsByDate(logs).get(date)?.count ?? 0;
    return progress >= habit.target_count || (habit.cadence === 'weekly' && todayCount > 0);
  };

  const done = habits.filter((habit) =>
    periodProgress(habit, details.get(habit.id)?.logs ?? NO_LOGS, habitDateFor(habit)) >= habit.target_count).length;

  // Weekly completion summary across all active habits respecting user startOfWeek and dayStartHour.
  const nowKey = logicalToday(deviceTimeZone(), prefs.dayStartHour).toString();
  const nowDay = useMemo(() => Temporal.PlainDate.from(nowKey), [nowKey]);
  const weeklySummary = useMemo(() => {
    if (!habits.length) return [];
    const firstDay = weekStart(nowDay, prefs.startOfWeek);
    // One date lookup per habit, built once, instead of searching every habit's logs for every day.
    const indexes = habits.map((habit) => logsByDate(details.get(habit.id)?.logs ?? NO_LOGS));
    return Array.from({ length: 7 }, (_, index) => {
      const date = firstDay.add({ days: index });
      const key = date.toString();
      const future = date.until(nowDay).days < 0;
      let met = 0;
      let eligible = 0;
      const eligibleHabits: { habit: Habit; met: boolean; log: HabitLog | undefined }[] = [];
      habits.forEach((habit, order) => {
        if (key < habit.start_date) return;
        const log = indexes[order].get(key);
        const isMet = dayMet(habit, log);
        eligible += 1;
        if (isMet) met += 1;
        eligibleHabits.push({ habit, met: isMet, log });
      });
      return { date, key, future, met, eligible, ratio: eligible > 0 ? met / eligible : 0, eligibleHabits };
    });
  }, [habits, details, nowDay, prefs.startOfWeek]);

  const weeklyPct = useMemo(() => {
    let metTotal = 0;
    let eligibleTotal = 0;
    for (const bar of weeklySummary) {
      if (bar.future) continue;
      metTotal += bar.met;
      eligibleTotal += bar.eligible;
    }
    return eligibleTotal > 0 ? Math.round((metTotal / eligibleTotal) * 100) : 0;
  }, [weeklySummary]);

  const selectedBar = useMemo(
    () => (selectedDayKey ? weeklySummary.find((bar) => bar.key === selectedDayKey && !bar.future) ?? null : null),
    [selectedDayKey, weeklySummary],
  );

  const hasTimeGroups = habits.some((h) => (habitMeta[h.id]?.timeOfDay ?? 'anytime') !== 'anytime');
  const groupedHabits = useMemo(() => {
    if (!hasTimeGroups) return [{ key: 'anytime' as HabitTimeOfDay, label: '', icon: 'clock' as const, items: habits }];
    return HABIT_TIME_GROUPS
      .map((group) => ({
        ...group,
        items: habits.filter((h) => (habitMeta[h.id]?.timeOfDay ?? 'anytime') === group.key),
      }))
      .filter((group) => group.items.length > 0);
  }, [habits, habitMeta, hasTimeGroups]);

  const runnerItems = useMemo<RoutineRunnerItem[]>(() => {
    if (!runnerGroup) return [];
    const targetGroup = groupedHabits.find((group) => group.key === runnerGroup);
    const list = targetGroup ? targetGroup.items : habits;
    return list.map((habit) => ({
      habit,
      logs: details.get(habit.id)?.logs ?? NO_LOGS,
      meta: habitMeta[habit.id],
      date: logicalToday(habit.timezone, prefs.dayStartHour).toString(),
    }));
  }, [runnerGroup, groupedHabits, habits, details, habitMeta, prefs.dayStartHour]);

  const orderedHabits = useMemo(() => groupedHabits.flatMap((group) => group.items), [groupedHabits]);
  const cursor = useListCursor(orderedHabits, habitId, {
    enabled: isFocused,
    scrollRef,
    estimatedRowHeight: 132,
    headerOffset: 150,
  });

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const kbdMenuDate = kbdMenuHabit ? habitDateFor(kbdMenuHabit) : '';
  const kbdMenuLogs = kbdMenuHabit ? (details.get(kbdMenuHabit.id)?.logs ?? NO_LOGS) : NO_LOGS;
  const kbdMenuTodayLog = kbdMenuHabit ? logsByDate(kbdMenuLogs).get(kbdMenuDate) : undefined;

  useKeyHandler(
    (event) => {
      if (event.editing || event.modal) return false;
      if (matchesCombo(event, 'j') || matchesCombo(event, 'arrowdown')) {
        cursor.move(1);
        return true;
      }
      if (matchesCombo(event, 'k') || matchesCombo(event, 'arrowup')) {
        cursor.move(-1);
        return true;
      }
      if (matchesCombo(event, 'home')) {
        cursor.moveFirst();
        return true;
      }
      if (matchesCombo(event, 'shift+g') || matchesCombo(event, 'end')) {
        cursor.moveLast();
        return true;
      }
      if (matchesCombo(event, 'o')) {
        if (!event.repeat) router.push('/habit/overview');
        return true;
      }
      if (matchesCombo(event, 'g')) {
        if (!event.repeat) router.push('/routines');
        return true;
      }
      if (matchesCombo(event, 'n')) {
        if (!event.repeat) router.push('/habit/new');
        return true;
      }
      if (matchesCombo(event, 'r')) {
        if (!event.repeat) {
          void refresh();
          showToast('새로고침했습니다.');
        }
        return true;
      }

      const habit = cursor.focusedItem;
      if (habit) {
        if (matchesCombo(event, 'space') || matchesCombo(event, 'x')) {
          if (!event.repeat) {
            const date = habitDateFor(habit);
            const logs = details.get(habit.id)?.logs ?? NO_LOGS;
            const todayLog = logsByDate(logs).get(date);
            const todayCount = todayLog?.count ?? 0;
            const progress = periodProgress(habit, logs, date);
            const isMultiDaily = habit.cadence === 'daily' && habit.target_count > 1;
            if (isMultiDaily && progress >= habit.target_count) {
              haptic.tap();
              setKbdMenuHabit(habit);
              return true;
            }
            const prevStatus = todayLog?.status ?? null;
            const prevCount = todayLog?.count ?? 0;
            const next = nextCheckIn(habit, todayCount, progress);
            if (next.reaches) haptic.success();
            else haptic.light();
            habitActions.setLog({ habitId: habit.id, date, status: next.status, count: next.count });
            const msg = next.status === null
              ? `‘${habit.name}’ 오늘 기록을 취소했습니다.`
              : isMultiDaily
                ? `‘${habit.name}’ ${next.count}/${habit.target_count}회 기록했습니다.`
                : `‘${habit.name}’ 오늘 기록을 남겼습니다.`;
            showHabitUndoToast(msg, () => {
              habitActions.setLog({ habitId: habit.id, date, status: prevStatus, count: prevCount });
            });
          }
          return true;
        }
        if (matchesCombo(event, 'enter')) {
          if (!event.repeat) router.push({ pathname: '/habit/[id]', params: { id: habit.id } });
          return true;
        }
        if (matchesCombo(event, 'f')) {
          if (!event.repeat) {
            haptic.tap();
            router.navigate({
              pathname: '/focus',
              params: { habitId: habit.id, title: habit.name, autostart: '1', at: String(Date.now()) },
            });
          }
          return true;
        }
        if (matchesCombo(event, 'm')) {
          if (!event.repeat) {
            haptic.tap();
            setKbdMenuHabit(habit);
          }
          return true;
        }
        if (matchesCombo(event, 'escape')) {
          if (!event.repeat) cursor.clear();
          return true;
        }
      }

      return false;
    },
    { priority: KEY_PRIORITY.screen, enabled: isFocused && !kbdMenuHabit && !runnerGroup },
  );

  return (
    <Screen>
      <Header
        title="습관" subtitle={habits.length ? `${done}/${habits.length}` : undefined}
        right={(
          <View style={{ flexDirection: 'row' }}>
            <IconButton name="star" label="습관 갤러리" onPress={() => router.push('/routines')} color={colors.textMuted} />
            <IconButton name="grid" label="기록 한눈에 보기" onPress={() => router.push('/habit/overview')} color={colors.textMuted} />
            <IconButton name="plus" label="습관 추가" onPress={() => router.push('/habit/new')} color={colors.textMuted} />
          </View>
        )} />
      {isLoading ? <Loading /> : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {habits.length ? (
            <>
              <View style={[styles.weekStrip, { borderBottomColor: colors.border }]}>
                <View style={styles.weekHead}>
                  <Txt variant="section" tone="muted">이번 주</Txt>
                  <Txt variant="smallStrong" tone="default" tabular style={{ fontWeight: '700' }}>
                    {weeklyPct}%
                  </Txt>
                </View>
                <View style={styles.weekBars}>
                  {weeklySummary.map((bar) => {
                    const isToday = bar.date.equals(nowDay);
                    const isSelected = selectedBar?.key === bar.key;
                    const full = bar.eligible > 0 && bar.met === bar.eligible;
                    const height = bar.future ? 4 : bar.met > 0 ? Math.max(10, Math.round(bar.ratio * 38)) : 4;
                    return (
                      <Pressable
                        key={bar.key}
                        disabled={bar.future}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected, disabled: bar.future }}
                        accessibilityLabel={`${bar.date.month}월 ${bar.date.day}일 (${weekdayName(bar.date)}) ${bar.met}/${bar.eligible}개 달성`}
                        hitSlop={4}
                        onPress={() => {
                          haptic.tap();
                          setSelectedDayKey((current) => (current === bar.key ? null : bar.key));
                        }}
                        style={({ pressed }) => [
                          styles.barCol,
                          isSelected && { backgroundColor: colors.accentSoft, borderRadius: radius.sm },
                          pressed && !bar.future && { opacity: 0.7 },
                        ]}>
                        <Txt variant="caption" tone={isSelected ? 'accent' : 'faint'} tabular style={{ fontSize: 10 }}>
                          {!bar.future && bar.met > 0 ? `${bar.met}/${bar.eligible}` : ' '}
                        </Txt>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.barFill,
                              {
                                height,
                                backgroundColor: bar.future
                                  ? colors.surfaceMuted
                                  : full ? colors.accent : bar.met > 0 ? colors.accentRamp[1] : colors.surfaceMuted,
                              },
                            ]} />
                        </View>
                        <Txt
                          variant="caption"
                          tone={isSelected ? 'accent' : isToday ? 'default' : 'faint'}
                          style={{ fontWeight: isToday || isSelected ? '700' : '500' }}>
                          {weekdayName(bar.date)}
                        </Txt>
                      </Pressable>
                    );
                  })}
                </View>

                {selectedBar ? (
                  <View style={{ gap: space.sm, paddingTop: space.xs }}>
                    <Divider />
                    <View style={styles.selectedDayHead}>
                      <Txt variant="smallStrong" tabular style={{ flex: 1 }}>
                        {selectedBar.date.month}월 {selectedBar.date.day}일 ({weekdayName(selectedBar.date)}) · {selectedBar.met}/{selectedBar.eligible}
                      </Txt>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="선택한 요일 닫기"
                        hitSlop={8}
                        onPress={() => setSelectedDayKey(null)}>
                        <Icon name="x" size={14} color={colors.textFaint} />
                      </Pressable>
                    </View>
                    {selectedBar.eligibleHabits.length ? (
                      <View style={styles.dayChips}>
                        {selectedBar.eligibleHabits.map(({ habit, met, log }) => (
                          <Chip
                            key={habit.id}
                            icon={met ? 'check' : undefined}
                            label={habit.name}
                            selected={met}
                            onPress={() => {
                              const prevStatus = log?.status ?? null;
                              const prevCount = log?.count ?? 0;
                              const weekly = habit.cadence === 'weekly';
                              habitActions.setLog({
                                habitId: habit.id,
                                date: selectedBar.key,
                                status: met ? null : 'completed',
                                count: met ? 0 : weekly ? 1 : habit.target_count,
                              });
                              showHabitUndoToast(
                                `${selectedBar.date.month}월 ${selectedBar.date.day}일 ‘${habit.name}’ 기록을 ${met ? '지웠습니다.' : '남겼습니다.'}`,
                                () => {
                                  habitActions.setLog({ habitId: habit.id, date: selectedBar.key, status: prevStatus, count: prevCount });
                                },
                              );
                            }}
                          />
                        ))}
                      </View>
                    ) : (
                      <Txt variant="small" tone="faint">기록 없음</Txt>
                    )}
                  </View>
                ) : null}
              </View>

              {groupedHabits.map((group) => {
                const remainingInGroup = group.items.filter((habit) => !isSettledToday(habit)).length;
                const showRoutineStart = remainingInGroup >= 2;
                const showHeader = hasTimeGroups || showRoutineStart;
                return (
                  <View key={group.key} style={{ gap: space.md }}>
                    {showHeader ? (
                      <View style={styles.groupHead}>
                        {hasTimeGroups ? (
                          <>
                            <Icon name={group.icon} size={14} color={colors.textFaint} />
                            <Txt variant="section" tone="muted">{group.label}</Txt>
                            <Txt variant="caption" tone="faint" tabular>{group.items.length}</Txt>
                          </>
                        ) : (
                          <Txt variant="section" tone="muted">오늘</Txt>
                        )}
                        <View style={{ flex: 1 }} />
                        {showRoutineStart ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${ROUTINE_TITLES[group.key]} 시작`}
                            hitSlop={6}
                            onPress={() => {
                              haptic.tap();
                              setRunnerGroup(group.key);
                            }}
                            style={({ pressed }) => [
                              styles.routineChip,
                              {
                                backgroundColor: colors.accentSoft,
                                borderColor: colors.border,
                                opacity: pressed ? 0.75 : 1,
                              },
                            ]}>
                            <Icon name="play" size={11} color={colors.accentText} />
                            <Txt variant="metaStrong" tone="accent">루틴</Txt>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                    {group.items.map((habit) => (
                      <HabitCard
                        key={habit.id} habit={habit} logs={details.get(habit.id)?.logs ?? NO_LOGS} stats={details.get(habit.id)?.stats}
                        meta={habitMeta[habit.id]} date={habitDateFor(habit)} focused={cursor.focusedId === habit.id} />
                    ))}
                  </View>
                );
              })}
            </>
          ) : (
            <EmptyState
              icon="repeat" art={<EmptyHabits size={EMPTY_ART} />} title="습관 없음"
              action={(
                <View style={{ gap: space.sm, marginTop: space.md, alignSelf: 'stretch' }}>
                  <Button label="습관 갤러리" icon="star" onPress={() => router.push('/routines')} />
                  <Button label="직접 만들기" kind="secondary" icon="plus" onPress={() => router.push('/habit/new')} />
                </View>
              )} />
          )}
          {archived.length ? (
            <View style={{ gap: space.sm, marginTop: space.md }}>
              <Pressable
                accessibilityRole="button" accessibilityLabel={`보관한 습관 ${archived.length}개 ${showArchived ? '접기' : '펼치기'}`}
                onPress={() => setShowArchived((open) => !open)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space.xs, opacity: pressed ? 0.6 : 1 })}>
                <Icon name="archive" size={14} color={colors.textMuted} />
                <Txt variant="smallStrong" tone="muted" tabular>보관 {archived.length}</Txt>
                <Icon name={showArchived ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textFaint} />
              </Pressable>
              {showArchived ? (
                <Card style={{ paddingVertical: space.xs }}>
                  {archived.map((habit) => (
                    <Row
                      key={habit.id} icon="archive" label={habit.name}
                      detail={(habit.cadence === 'daily' ? '매일 ' : '매주 ') + habit.target_count + (habit.cadence === 'daily' ? '회' : '일')}
                      trailing={<Icon name="chevron-right" size={16} color={colors.textFaint} />}
                      onPress={() => router.push({ pathname: '/habit/[id]', params: { id: habit.id } })} />
                  ))}
                </Card>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      <HabitAdjustSheet
        visible={!!kbdMenuHabit}
        onClose={() => setKbdMenuHabit(null)}
        habit={kbdMenuHabit}
        date={kbdMenuDate}
        todayLog={kbdMenuTodayLog}
      />

      <RoutineRunner
        visible={runnerGroup !== null}
        title={runnerGroup ? ROUTINE_TITLES[runnerGroup] : '오늘의 루틴'}
        items={runnerItems}
        onClose={() => setRunnerGroup(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  weekStrip: {
    gap: space.sm,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  weekHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  barCol: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 },
  barTrack: { height: 38, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  barFill: { width: 18, borderRadius: 5 },
  selectedDayHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dayChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: space.xs },
  routineChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, minHeight: 28, borderRadius: radius.pill, borderWidth: 1,
  },
});
