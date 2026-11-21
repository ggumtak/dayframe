import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Checkbox } from '@/components/Checkbox';
import { Button, EmptyState, Header, IconButton, Loading, Screen, SectionTitle, Txt } from '@/components/ui';
import { queryClient } from '@/data/client';
import { keys } from '@/data/keys';
import { useProjects, useTaskActions } from '@/data/tasks';
import { api } from '@/lib/api';
import { deviceTimeZone, formatDate, formatTime, Temporal, today } from '@/lib/dates';
import type { Task } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { space, useTheme } from '@/theme';

const PAGE = 60;

/** Finished tasks, newest first, each one a tap away from being reopened. */
export default function Completed() {
  const { colors } = useTheme();
  const zone = deviceTimeZone();
  const query = useQuery({ queryKey: keys.completedTasks, queryFn: api.completedTasks, meta: { persist: false } });
  const { data: projects } = useProjects();
  const actions = useTaskActions();
  const [shown, setShown] = useState(PAGE);
  const [reopened, setReopened] = useState<Set<string>>(new Set());

  const days = useMemo(() => {
    const done = (query.data ?? []).filter((task) => task.completed_at && !reopened.has(task.id))
      .sort((a, b) => Date.parse(b.completed_at!) - Date.parse(a.completed_at!)).slice(0, shown);
    const groups = new Map<string, Task[]>();
    for (const task of done) {
      const day = Temporal.Instant.from(task.completed_at!).toZonedDateTimeISO(zone).toPlainDate().toString();
      groups.set(day, [...(groups.get(day) ?? []), task]);
    }
    return [...groups];
  }, [query.data, reopened, shown, zone]);
  const total = (query.data ?? []).length - reopened.size;
  const names = new Map((projects ?? []).map((project) => [project.id, project.name]));
  const now = today(zone);

  const reopen = (task: Task) => {
    setReopened((current) => new Set(current).add(task.id));
    actions.reopen(task);
    showToast(`‘${task.title}’을 다시 할 일로 되돌렸습니다.`);
    void queryClient.invalidateQueries({ queryKey: keys.completedTasks });
  };

  return (
    <Screen>
      <Header title="완료한 일" subtitle={total > 0 ? `${total}개` : undefined} left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      {query.isPending ? <Loading /> : query.isError ? (
        <EmptyState
          icon="cloud-off" title="불러오지 못했습니다" message="완료한 일은 서버에서 불러옵니다. 네트워크를 확인해 주세요."
          action={<Button label="다시 시도" kind="secondary" onPress={() => void query.refetch()} />} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xxl * 2, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}>
          {days.length === 0 ? <EmptyState icon="check-circle" title="아직 완료한 일이 없습니다" /> : days.map(([day, tasks]) => (
            <View key={day}>
              <SectionTitle title={formatDate(Temporal.PlainDate.from(day), now)} count={tasks.length} />
              {tasks.map((task) => {
                const at = Temporal.Instant.from(task.completed_at!).toZonedDateTimeISO(zone);
                const project = task.project_id ? names.get(task.project_id) : undefined;
                return (
                  <View key={task.id} style={styles.row}>
                    <Checkbox checked color={colors.success} onPress={() => reopen(task)} label={task.title + ' 다시 할 일로 되돌리기'} />
                    <View style={[styles.body, { borderBottomColor: colors.border }]}>
                      <Txt tone="muted" numberOfLines={2}>{task.title}</Txt>
                      <Txt variant="small" tone="faint">{formatTime(at.hour * 60 + at.minute) + ' 완료' + (project ? ' · #' + project : '')}</Txt>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
          {total > shown ? (
            <Pressable accessibilityRole="button" onPress={() => setShown((count) => count + PAGE)} style={{ padding: space.lg, alignItems: 'center' }}>
              <Txt variant="smallStrong" tone="accent">더 보기</Txt>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingLeft: space.lg, paddingTop: 12 },
  body: { flex: 1, gap: 2, paddingBottom: 12, paddingRight: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
});
