import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Button, EmptyState, Header, IconButton, Loading, ProgressBar, Screen, Txt } from '@/components/ui';
import { periodProgress, useHabitDetails, useHabits } from '@/data/habits';
import { HabitCard } from '@/features/habits/HabitCard';
import { useMinute } from '@/lib/clock';
import { today } from '@/lib/dates';
import { space, useTheme } from '@/theme';

export default function Habits() {
  const { colors } = useTheme();
  const { data, isLoading, refetch } = useHabits();
  const [refreshing, setRefreshing] = useState(false);
  // Re-renders the cards when the date rolls over, so a check-in always lands on the current day.
  useMinute();
  const habits = useMemo(() => (data ?? []).filter((habit) => !habit.archived_at), [data]);
  const details = useHabitDetails(habits);
  const done = habits.filter((habit) =>
    periodProgress(habit, details.get(habit.id)?.logs ?? [], today(habit.timezone).toString()) >= habit.target_count).length;

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
            <IconButton name="star" label="추천 루틴" onPress={() => router.push('/routines')} color={colors.accent} />
            <IconButton name="plus" label="습관 추가" onPress={() => router.push('/habit/new')} color={colors.accent} />
          </View>
        )} />
      {isLoading ? <Loading /> : (
        <ScrollView
          contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {habits.length ? (
            <>
              <View style={{ gap: 6, marginBottom: space.xs }}>
                <ProgressBar value={done / habits.length} color={colors.success} />
                <Txt variant="caption" tone="faint">{done === habits.length ? '모두 달성했습니다' : `${habits.length - done}개 남았습니다`}</Txt>
              </View>
              {habits.map((habit) => (
                <HabitCard key={habit.id} habit={habit} logs={details.get(habit.id)?.logs ?? []} stats={details.get(habit.id)?.stats} />
              ))}
            </>
          ) : (
            <EmptyState
              icon="repeat" title="습관을 만들어 보세요" message="매일 또는 매주 반복할 일을 정하고, 체크할 때마다 연속 기록이 쌓입니다."
              action={(
                <View style={{ gap: space.sm, marginTop: space.md, alignSelf: 'stretch' }}>
                  <Button label="추천 루틴에서 고르기" icon="star" onPress={() => router.push('/routines')} />
                  <Button label="직접 만들기" kind="secondary" icon="plus" onPress={() => router.push('/habit/new')} />
                </View>
              )} />
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
