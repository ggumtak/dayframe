import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Checkbox } from '@/components/Checkbox';
import { EmptyDone, EmptySearch, OfflineArt } from '@/components/art';
import { Button, EMPTY_ART, EmptyState, Header, Icon, IconButton, Loading, Screen, SectionTitle, Sheet, Txt } from '@/components/ui';
import { queryClient } from '@/data/client';
import { keys } from '@/data/keys';
import { useProjects, useTagNames, useTaskActions, useTaskIndex } from '@/data/tasks';
import { api } from '@/lib/api';
import { deviceTimeZone, formatDate, formatTime, Temporal, today } from '@/lib/dates';
import { josa } from '@/lib/josa';
import { searchTasks } from '@/lib/search';
import type { Task } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { fontFamily, radius, space, useTheme } from '@/theme';

const PAGE = 60;

/** Finished tasks, newest first, searchable with Korean chosung and #project/@tag/p1 filters. */
export default function Completed() {
  const { colors } = useTheme();
  const zone = deviceTimeZone();
  const query = useQuery({ queryKey: keys.completedTasks, queryFn: api.completedTasks, meta: { persist: false } });
  const { data: projects } = useProjects();
  const tagNames = useTagNames();
  const actions = useTaskActions();
  const [shown, setShown] = useState(PAGE);
  const [search, setSearch] = useState('');
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Task | null>(null);

  const names = useMemo(() => new Map((projects ?? []).map((project) => [project.id, project.name])), [projects]);
  // A finished subtask names its parent, which is already loaded: an open task, or one in this completed list.
  const { byId: openById } = useTaskIndex();
  const parentTitles = useMemo(() => {
    const titles = new Map<string, string>();
    const list = query.data ?? [];
    if (!list.some((task) => task.parent_task_id)) return titles;
    const doneById = new Map(list.map((task) => [task.id, task]));
    for (const task of list) {
      if (!task.parent_task_id) continue;
      const parent = openById.get(task.parent_task_id) ?? doneById.get(task.parent_task_id);
      if (parent) titles.set(task.id, parent.title);
    }
    return titles;
  }, [query.data, openById]);

  const filtered = useMemo(() => {
    const visible = (query.data ?? []).filter((task) => !!task.completed_at && !removed.has(task.id));
    if (!search.trim()) return visible.sort((a, b) => Date.parse(b.completed_at!) - Date.parse(a.completed_at!));
    return searchTasks(visible, search, { projectNames: names, tagNames });
  }, [query.data, removed, search, names, tagNames]);

  const days = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const task of filtered.slice(0, shown)) {
      const day = Temporal.Instant.from(task.completed_at!).toZonedDateTimeISO(zone).toPlainDate().toString();
      groups.set(day, [...(groups.get(day) ?? []), task]);
    }
    return [...groups];
  }, [filtered, shown, zone]);

  const total = filtered.length;
  const now = today(zone);

  const reopen = (task: Task) => {
    setRemoved((current) => new Set(current).add(task.id));
    actions.reopen(task);
    showToast(`‘${task.title}’${josa(task.title, '을/를')} 다시 열었습니다.`);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    setRemoved((current) => new Set(current).add(target.id));
    queryClient.setQueryData<Task[]>(keys.completedTasks, (list) => list?.filter((item) => item.id !== target.id));
    actions.remove(target.id);
    showToast('완료 기록을 삭제했습니다.');
  };

  return (
    <Screen>
      <Header title="완료한 일" subtitle={total > 0 ? `${total}개` : undefined} left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      {query.isPending ? <Loading /> : query.isError ? (
        <EmptyState
          icon="cloud-off" art={<OfflineArt size={EMPTY_ART} />} title="불러오지 못했습니다" message="인터넷 연결을 확인한 뒤 다시 시도해 주세요."
          action={<Button label="다시 시도" kind="secondary" onPress={() => void query.refetch()} />} />
      ) : (
        <>
          {(query.data?.length ?? 0) > 0 ? (
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
              <View style={[styles.searchField, { backgroundColor: colors.surfaceMuted }]}>
                <Icon name="search" size={16} color={colors.textMuted} />
                <TextInput
                  value={search} onChangeText={setSearch} placeholder="완료한 일 검색" placeholderTextColor={colors.textFaint}
                  autoCorrect={false} returnKeyType="search" accessibilityLabel="완료한 일 검색"
                  style={[{ fontFamily, flex: 1, color: colors.text, fontSize: 15, paddingVertical: 8 }, Platform.select({ web: { outlineStyle: 'none' } as object, default: {} })]} />
                {search ? <IconButton name="x" label="지우기" size={16} color={colors.textMuted} onPress={() => setSearch('')} style={{ width: 32, height: 32 }} /> : null}
              </View>
            </View>
          ) : null}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: space.xxl * 2, flexGrow: 1 }}
            refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}>
            {days.length === 0 ? (
              <EmptyState
                icon={search.trim() ? 'search' : 'check-circle'}
                art={search.trim() ? <EmptySearch size={EMPTY_ART} /> : <EmptyDone size={EMPTY_ART} />}
                title={search.trim() ? '일치하는 완료 기록이 없습니다' : '아직 완료한 일이 없습니다'} />
            ) : days.map(([day, tasks]) => (
              <View key={day}>
                <SectionTitle title={formatDate(Temporal.PlainDate.from(day), now)} count={tasks.length} />
                {tasks.map((task) => {
                  const at = Temporal.Instant.from(task.completed_at!).toZonedDateTimeISO(zone);
                  const project = task.project_id ? names.get(task.project_id) : undefined;
                  const parentTitle = parentTitles.get(task.id);
                  return (
                    <View key={task.id} style={styles.row}>
                      <Checkbox checked color={colors.success} onPress={() => reopen(task)} label={task.title + ' 다시 열기'} />
                      <View style={[styles.body, { borderBottomColor: colors.border }]}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Txt tone="muted" numberOfLines={2}>{task.title}</Txt>
                          <Txt variant="small" tone="faint">{formatTime(at.hour * 60 + at.minute) + ' 완료' + (project ? ' · #' + project : '')}</Txt>
                          {parentTitle ? <Txt variant="caption" tone="faint" numberOfLines={1}>상위 할 일: {parentTitle}</Txt> : null}
                        </View>
                        <IconButton
                          name="trash-2" label={task.title + ' 삭제'} size={16} color={colors.textFaint}
                          onPress={() => setDeleting(task)} style={{ width: 34, height: 34 }} />
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
        </>
      )}

      <Sheet visible={!!deleting} onClose={() => setDeleting(null)} title="완료 기록을 삭제할까요?">
        <Txt tone="muted" style={{ marginBottom: space.lg }}>
          ‘{deleting?.title}’ 기록을 완전히 지웁니다. 되돌릴 수 없습니다.
        </Txt>
        <View style={{ gap: space.sm }}>
          <Button label="삭제" kind="danger" onPress={confirmDelete} />
          <Button label="취소" kind="secondary" onPress={() => setDeleting(null)} />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchField: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingLeft: space.md, paddingRight: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingLeft: space.lg, paddingTop: 12 },
  body: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: 12, paddingRight: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
