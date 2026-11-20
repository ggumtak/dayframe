import { useState } from 'react';
import { RefreshControl } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { EmptyState, Header, Loading, Screen, SectionTitle } from '@/components/ui';
import { bySchedule, useTaskIndex } from '@/data/tasks';
import { TaskList } from '@/features/tasks/TaskList';
import { useMinute } from '@/lib/clock';
import { dueBucket, dueDate, formatDate, today, weekdayName } from '@/lib/dates';
import type { Task } from '@/lib/shared';
import { useTheme } from '@/theme';

export default function Upcoming() {
  const { colors } = useTheme();
  const { tasks, isLoading, refetch } = useTaskIndex();
  const [refreshing, setRefreshing] = useState(false);
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
  const days = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, group]) => ({ key, ...group }));

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <Screen>
      <Header title="예정" subtitle={days.length ? `앞으로 ${days.reduce((sum, day) => sum + day.tasks.length, 0)}개` : undefined} />
      {isLoading ? <Loading /> : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {days.length ? days.map((day) => (
            <Fragmented key={day.key} title={day.title} tasks={day.tasks} />
          )) : (
            <EmptyState icon="calendar" title="예정된 일이 없습니다" message="‘내일 오후 3시 회의’처럼 날짜를 함께 적으면 여기에 모입니다." />
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
