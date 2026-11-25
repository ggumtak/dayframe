import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';

import { EmptyHabits } from '@/components/art';
import { Button, Card, EMPTY_ART, EmptyState, Header, Icon, IconButton, Loading, Row, Screen, Sheet, Txt } from '@/components/ui';
import { useHabitActions, useHabitDetails, useHabits } from '@/data/habits';
import { nextCheckIn } from '@/features/habits/checkIn';
import { dayMet, logsByDate, periodProgress } from '@/features/habits/goal';
import { HabitCard } from '@/features/habits/HabitCard';
import { HABIT_TIME_GROUPS, type HabitTimeOfDay, useHabitMetaMap } from '@/features/habits/habitMeta';
import { KEY_PRIORITY, matchesCombo, useKeyHandler, useListCursor, useScreenContext, useScreenFocused } from '@/features/keyboard';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, Temporal, today, weekdayName, weekStart } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Habit, HabitLog } from '@/lib/shared';
import { useTabScrollTop } from '@/lib/tabScroll';
import { showToast } from '@/lib/toast';
import { space, useTheme } from '@/theme';

const NO_LOGS: HabitLog[] = [];
const habitId = (habit: Habit) => habit.id;

export default function Habits() {
  const { colors } = useTheme();
  const isFocused = useScreenFocused();
  useScreenContext('habits', isFocused);
  const { data, isLoading, refetch } = useHabits();
  const habitActions = useHabitActions();
  const habitMeta = useHabitMetaMap();
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [kbdMenuHabit, setKbdMenuHabit] = useState<Habit | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  useTabScrollTop('habits', scrollRef);
  // Re-renders the cards when the date rolls over, so a check-in always lands on the current day.
  useMinute();
  const habits = useMemo(() => (data ?? []).filter((habit) => !habit.archived_at), [data]);
  const archived = useMemo(() => (data ?? []).filter((habit) => !!habit.archived_at), [data]);
  const details = useHabitDetails(habits);
  const done = habits.filter((habit) =>
    periodProgress(habit, details.get(habit.id)?.logs ?? [], today(habit.timezone).toString()) >= habit.target_count).length;

  // Weekly completion summary across all active habits (Mon–Sun) so the Habits tab acts as a true routine dashboard.
  const nowKey = today(deviceTimeZone()).toString();
  const nowDay = useMemo(() => Temporal.PlainDate.from(nowKey), [nowKey]);
  const weeklySummary = useMemo(() => {
    if (!habits.length) return [];
    const monday = weekStart(nowDay);
    // One date lookup per habit, built once, instead of searching every habit's logs for every day.
    const indexes = habits.map((habit) => logsByDate(details.get(habit.id)?.logs ?? NO_LOGS));
    return Array.from({ length: 7 }, (_, index) => {
      const date = monday.add({ days: index });
      const key = date.toString();
      const future = date.until(nowDay).days < 0;
      let met = 0;
      let eligible = 0;
      habits.forEach((habit, order) => {
        if (key < habit.start_date) return;
        eligible += 1;
        if (dayMet(habit, indexes[order].get(key))) met += 1;
      });
      return { date, key, future, met, eligible, ratio: eligible > 0 ? met / eligible : 0 };
    });
  }, [habits, details, nowDay]);

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

  const kbdMenuDate = kbdMenuHabit ? today(kbdMenuHabit.timezone).toString() : '';
  const kbdMenuLogs = kbdMenuHabit ? (details.get(kbdMenuHabit.id)?.logs ?? NO_LOGS) : NO_LOGS;
  const kbdMenuTodayLog = kbdMenuHabit ? logsByDate(kbdMenuLogs).get(kbdMenuDate) : undefined;

  const markKbdMenuHabit = (status: 'skipped' | 'frozen' | null) => {
    if (!kbdMenuHabit) return;
    habitActions.setLog({ habitId: kbdMenuHabit.id, date: kbdMenuDate, status, count: 0 });
    setKbdMenuHabit(null);
  };

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
            const date = today(habit.timezone).toString();
            const logs = details.get(habit.id)?.logs ?? NO_LOGS;
            const todayCount = logsByDate(logs).get(date)?.count ?? 0;
            const progress = periodProgress(habit, logs, date);
            const next = nextCheckIn(habit, todayCount, progress);
            if (next.reaches) haptic.success();
            else haptic.light();
            habitActions.setLog({ habitId: habit.id, date, status: next.status, count: next.count });
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
            router.navigate({ pathname: '/focus', params: { habitId: habit.id, at: String(Date.now()) } });
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
    { priority: KEY_PRIORITY.screen, enabled: isFocused && !kbdMenuHabit },
  );

  useKeyHandler(
    (event) => {
      if (event.editing) return false;
      if (matchesCombo(event, 'escape')) {
        if (!event.repeat) setKbdMenuHabit(null);
        return true;
      }
      if (matchesCombo(event, '1') || matchesCombo(event, 's')) {
        if (!event.repeat) {
          haptic.tap();
          markKbdMenuHabit('skipped');
        }
        return true;
      }
      if (matchesCombo(event, '2') || matchesCombo(event, 'f')) {
        if (!event.repeat) {
          haptic.tap();
          markKbdMenuHabit('frozen');
        }
        return true;
      }
      if (matchesCombo(event, '0') || matchesCombo(event, 'delete') || matchesCombo(event, 'backspace')) {
        if (kbdMenuTodayLog && !event.repeat) {
          haptic.light();
          markKbdMenuHabit(null);
        }
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: isFocused && !!kbdMenuHabit },
  );

  return (
    <Screen>
      <Header
        title="습관" subtitle={habits.length ? `${habits.length}개 중 ${done}개 달성` : undefined}
        right={(
          <View style={{ flexDirection: 'row' }}>
            <IconButton name="grid" label="기록 한눈에 보기" onPress={() => router.push('/habit/overview')} color={colors.textMuted} />
            <IconButton name="plus" label="습관 추가" onPress={() => router.push('/routines')} color={colors.textMuted} />
          </View>
        )} />
      {isLoading ? <Loading /> : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {habits.length ? (
            <>
              <Card style={{ gap: space.sm, paddingVertical: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Txt variant="caption" tone="muted" style={{ fontWeight: '700' }}>이번 주 달성 현황</Txt>
                  <Txt variant="caption" tone="faint">요일을 눌러 기록 수정</Txt>
                </View>
                <View style={styles.weekBars}>
                  {weeklySummary.map((bar) => {
                    const isToday = bar.date.equals(nowDay);
                    const full = bar.eligible > 0 && bar.met === bar.eligible;
                    const height = bar.future ? 4 : bar.met > 0 ? Math.max(10, Math.round(bar.ratio * 38)) : 4;
                    return (
                      <View key={bar.key} style={styles.barCol}>
                        <Txt variant="caption" tone="faint" style={{ fontSize: 10 }}>
                          {!bar.future && bar.met > 0 ? `${bar.met}/${bar.eligible}` : ''}
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
                        <Txt variant="caption" tone={isToday ? 'default' : 'faint'} style={{ fontWeight: isToday ? '700' : '500' }}>
                          {weekdayName(bar.date)}
                        </Txt>
                      </View>
                    );
                  })}
                </View>
              </Card>

              {groupedHabits.map((group) => (
                <View key={group.key} style={{ gap: space.md }}>
                  {hasTimeGroups ? (
                    <View style={styles.groupHead}>
                      <Icon name={group.icon} size={14} color={colors.textFaint} />
                      <Txt variant="section" tone="muted">{group.label}</Txt>
                      <Txt variant="caption" tone="faint">{group.items.length}</Txt>
                    </View>
                  ) : null}
                  {group.items.map((habit) => (
                    <HabitCard
                      key={habit.id} habit={habit} logs={details.get(habit.id)?.logs ?? NO_LOGS} stats={details.get(habit.id)?.stats}
                      meta={habitMeta[habit.id]} date={today(habit.timezone).toString()} focused={cursor.focusedId === habit.id} />
                  ))}
                </View>
              ))}
            </>
          ) : (
            <EmptyState
              icon="repeat" art={<EmptyHabits size={EMPTY_ART} />} title="습관을 만들어 보세요" message="매일이나 매주 반복할 습관을 정해 보세요. 체크할 때마다 연속 기록이 쌓입니다."
              action={(
                <View style={{ gap: space.sm, marginTop: space.md, alignSelf: 'stretch' }}>
                  <Button label="습관 갤러리에서 고르기" icon="star" onPress={() => router.push('/routines')} />
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
                <Txt variant="smallStrong" tone="muted">보관한 습관 {archived.length}</Txt>
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
      <Sheet visible={!!kbdMenuHabit} onClose={() => setKbdMenuHabit(null)} title={kbdMenuHabit?.name}>
        <Row icon="skip-forward" label="오늘 건너뛰기" detail="달성률에서 제외" onPress={() => markKbdMenuHabit('skipped')} />
        <Row icon="pause-circle" label="오늘 쉬어가기" detail="연속 기록 유지" onPress={() => markKbdMenuHabit('frozen')} />
        {kbdMenuTodayLog ? <Row icon="rotate-ccw" label="오늘 기록 지우기" onPress={() => markKbdMenuHabit(null)} /> : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  weekBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  barCol: { flex: 1, alignItems: 'center', gap: 3 },
  barTrack: { height: 38, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  barFill: { width: 18, borderRadius: 5 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: space.xs },
});
