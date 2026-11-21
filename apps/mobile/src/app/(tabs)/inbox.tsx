import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView as PlainScroll, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Chip, EmptyState, Header, IconButton, Loading, Screen, Txt } from '@/components/ui';
import { byPosition, useProjects, useTaskIndex } from '@/data/tasks';
import { TaskList } from '@/features/tasks/TaskList';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { space, useTheme } from '@/theme';

export default function Inbox() {
  const { colors } = useTheme();
  const { roots, isLoading, refetch } = useTaskIndex();
  const { data: projects } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // A project deleted on another device falls back to the inbox.
  const selected = projects?.find((project) => project.id === projectId) ?? null;
  useScreenDefaults({ projectId: selected?.id ?? null });

  const tasks = useMemo(
    () => roots.filter((task) => task.project_id === (selected?.id ?? null)).sort(byPosition),
    [roots, selected?.id]);
  const counts = useMemo(() => {
    const map = new Map<string | null, number>();
    for (const task of roots) map.set(task.project_id, (map.get(task.project_id) ?? 0) + 1);
    return map;
  }, [roots]);

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <Screen>
      <Header
        title={selected?.name ?? '목록'} subtitle={tasks.length ? `${tasks.length}개 · 길게 눌러 순서 변경` : undefined}
        right={(
          <View style={{ flexDirection: 'row' }}>
            <IconButton name="search" label="검색" onPress={() => router.push('/search')} color={colors.textMuted} />
            <IconButton name="check-circle" label="완료한 일" onPress={() => router.push('/completed')} color={colors.textMuted} />
          </View>
        )} />
      {projects?.length ? (
        <View>
          <PlainScroll horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
            <Chip icon="inbox" label={'미분류' + (counts.get(null) ? ' ' + counts.get(null) : '')} selected={!selected} onPress={() => setProjectId(null)} />
            {projects.map((project) => (
              <Chip
                key={project.id} icon="hash" label={project.name + (counts.get(project.id) ? ' ' + counts.get(project.id) : '')}
                selected={selected?.id === project.id} onPress={() => setProjectId(project.id)} />
            ))}
          </PlainScroll>
        </View>
      ) : null}
      {isLoading ? <Loading /> : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {tasks.length ? <TaskList tasks={tasks} sortable /> : (
            <EmptyState
              icon={selected ? 'hash' : 'inbox'} title={selected ? '이 프로젝트는 비어 있습니다' : '미분류 할 일이 없습니다'}
              message={selected ? '+ 버튼으로 이 프로젝트에 할 일을 추가하세요.' : '#프로젝트 없이 적은 할 일이 여기에 모입니다. 할 일에 #이름을 붙이면 프로젝트별로 나눠 볼 수 있습니다.'} />
          )}
          {tasks.length && !projects?.length ? (
            <Txt variant="small" tone="faint" style={{ textAlign: 'center', padding: space.lg }}>
              할 일에 #이름을 붙이면 프로젝트가 만들어집니다.
            </Txt>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}
