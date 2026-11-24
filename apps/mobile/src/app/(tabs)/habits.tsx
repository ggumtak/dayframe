import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, Header, Icon, IconButton, Loading, ProgressBar, Row, Screen, Txt } from '@/components/ui';
import { periodProgress, useHabitDetails, useHabits } from '@/data/habits';
import { dayMet, logsByDate } from '@/features/habits/goal';
import { HabitCard } from '@/features/habits/HabitCard';
import { HABIT_TIME_GROUPS, type HabitTimeOfDay, useHabitMetaMap } from '@/features/habits/habitMeta';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, Temporal, today, weekdayName, weekStart } from '@/lib/dates';
import { useTabScrollTop } from '@/lib/tabScroll';
import type { HabitLog } from '@/lib/shared';
import { space, useTheme } from '@/theme';

const NO_LOGS: HabitLog[] = [];

export default function Habits() {
  const { colors } = useTheme();
  const { data, isLoading, refetch } = useHabits();
  const habitMeta = useHabitMetaMap();
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
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

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <Screen>
      <Header
        title="습관" subtitle={habits.length ? `${habits.length}개 중 ${done}개 달성` : undefined}
        right={(
          <View style={{ flexDirection: 'row' }}>
            <IconButton name="grid" label="기록 한눈에 보기" onPress={() => router.push('/habit/overview')} color={colors.textMuted} />
            <IconButton name="plus" label="습관 추가" onPress={() => router.push('/routines')} color={colors.accent} />
          </View>
        )} />
      {isLoading ? <Loading /> : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {habits.length ? (
            <>
              <View style={{ gap: 6 }}>
                <ProgressBar value={done / habits.length} color={colors.success} />
                <Txt variant="caption" tone="faint">{done === habits.length ? '오늘 습관을 모두 달성했습니다!' : `${habits.length - done}개 남았습니다`}</Txt>
              </View>

              <Card style={{ gap: space.sm, paddingVertical: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Txt variant="caption" tone="muted" style={{ fontWeight: '700' }}>이번 주 습관 달성</Txt>
                  <Txt variant="caption" tone="faint">요일 점을 눌러 기록 수정</Txt>
                </View>
                <View style={styles.weekBars}>
                  {weeklySummary.map((bar) => {
                    const isToday = bar.date.equals(nowDay);
                    const full = bar.eligible > 0 && bar.met === bar.eligible;
                    const height = bar.future ? 4 : bar.met > 0 ? Math.max(10, Math.round(bar.ratio * 38)) : 4;
                    return (
                      <View key={bar.key} style={styles.barCol}>
                        <Txt variant="caption" tone={full ? 'success' : 'faint'} style={{ fontSize: 10 }}>
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
                                  : full ? colors.success : bar.met > 0 ? colors.successSoft : colors.surfaceMuted,
                                borderColor: !bar.future && bar.met > 0 && !full ? colors.success : 'transparent',
                                borderWidth: !bar.future && bar.met > 0 && !full ? 1 : 0,
                              },
                            ]} />
                        </View>
                        <Txt variant="caption" tone={isToday ? 'accent' : 'faint'} style={{ fontWeight: isToday ? '700' : '500' }}>
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
                      <Icon name={group.icon} size={14} color={colors.accent} />
                      <Txt variant="section" tone="muted">{group.label}</Txt>
                      <Txt variant="caption" tone="faint">{group.items.length}</Txt>
                    </View>
                  ) : null}
                  {group.items.map((habit) => (
                    <HabitCard
                      key={habit.id} habit={habit} logs={details.get(habit.id)?.logs ?? NO_LOGS} stats={details.get(habit.id)?.stats}
                      meta={habitMeta[habit.id]} date={today(habit.timezone).toString()} />
                  ))}
                </View>
              ))}
            </>
          ) : (
            <EmptyState
              icon="repeat" title="습관을 만들어 보세요" message="매일 또는 매주 반복할 일을 정하고, 체크할 때마다 연속 기록이 쌓입니다."
              action={(
                <View style={{ gap: space.sm, marginTop: space.md, alignSelf: 'stretch' }}>
                  <Button label="갤러리에서 고르기" icon="star" onPress={() => router.push('/routines')} />
                  <Button label="직접 만들기" kind="secondary" icon="plus" onPress={() => router.push('/habit/new')} />
                </View>
              )} />
          )}
          {archived.length ? (
            <View style={{ gap: space.sm, marginTop: space.md }}>
              <Pressable
                accessibilityRole="button" accessibilityLabel={`보관한 습관 ${archived.length}개 ${showArchived ? '접기' : '보기'}`}
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
