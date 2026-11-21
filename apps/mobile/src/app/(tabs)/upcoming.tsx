import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { EmptyState, Header, Loading, Screen, SectionTitle, Txt } from '@/components/ui';
import { bySchedule, useTaskIndex } from '@/data/tasks';
import { TaskList } from '@/features/tasks/TaskList';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, dueDate, formatDate, today, weekdayName } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Task } from '@/lib/shared';
import { radius, space, useTheme } from '@/theme';

export default function Upcoming() {
  const { colors } = useTheme();
  const { tasks, isLoading, refetch } = useTaskIndex();
  const [refreshing, setRefreshing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  useMinute();

  // Grouped on every render: `useMinute` re-renders this screen when the date rolls over.
  const groups = new Map<string, { title: string; tasks: Task[] }>();
  for (const task of tasks.filter((item) => dueBucket(item) === 'upcoming').sort(bySchedule)) {
    const date = dueDate(task)!;
    const key = date.toString();
    const label = formatDate(date, today(task.timezone));
    const title = /^\d/.test(label) ? label : `${label} · ${date.month}월 ${date.day}일 ${weekdayName(date)}`;
    groups.set(key, { title, tasks: [...(groups.get(key)?.tasks ?? []), task] });
  }
  const all = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, group]) => ({ key, ...group }));
  // The strip covers the coming week; a picked day that has since passed or emptied shows everything again.
  const first = today(deviceTimeZone()).add({ days: 1 });
  const week = Array.from({ length: 7 }, (_, offset) => first.add({ days: offset }));
  const selected = picked && week.some((date) => date.toString() === picked) ? picked : null;
  const days = selected ? all.filter((day) => day.key === selected) : all;

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <Screen>
      <Header title="예정" subtitle={all.length ? `앞으로 ${all.reduce((sum, day) => sum + day.tasks.length, 0)}개` : undefined} />
      <View style={[styles.week, { borderBottomColor: colors.border }]}>
        {week.map((date) => {
          const key = date.toString();
          const active = key === selected;
          const count = groups.get(key)?.tasks.length ?? 0;
          const weekend = date.dayOfWeek >= 6;
          return (
            <Pressable
              key={key} accessibilityRole="button" accessibilityState={{ selected: active }}
              accessibilityLabel={`${date.month}월 ${date.day}일 ${weekdayName(date)}요일, ${count}개`}
              onPress={() => {
                haptic.tap();
                setPicked(active ? null : key);
              }}
              style={styles.day}>
              <Txt variant="caption" style={{ color: weekend ? colors.danger : colors.textMuted }}>{weekdayName(date)}</Txt>
              <View style={[styles.dayNumber, active && { backgroundColor: colors.accent }]}>
                <Txt variant="bodyStrong" style={{ color: active ? colors.onAccent : colors.text }}>{date.day}</Txt>
              </View>
              <View style={[styles.dot, { backgroundColor: count ? (active ? colors.accent : colors.textFaint) : 'transparent' }]} />
            </Pressable>
          );
        })}
      </View>
      {isLoading ? <Loading /> : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {days.length ? days.map((day) => (
            <Fragmented key={day.key} title={day.title} tasks={day.tasks} />
          )) : (
            <EmptyState
              icon="calendar" title={selected ? '이 날은 예정된 일이 없습니다' : '예정된 일이 없습니다'}
              message={selected ? '날짜를 다시 누르면 전체 일정이 보입니다.' : '‘내일 오후 3시 회의’처럼 날짜를 함께 적으면 여기에 모입니다.'} />
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function Fragmented({ title, tasks }: { title: string; tasks: Task[] }) {
  return (
    <>
      <SectionTitle title={title} count={tasks.length} />
      <TaskList tasks={tasks} hideDate />
    </>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row', paddingHorizontal: space.sm, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  day: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4 },
  dayNumber: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
