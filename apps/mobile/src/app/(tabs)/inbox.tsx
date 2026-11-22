import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView as PlainScroll, StyleSheet, TextInput, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Button, Chip, EmptyState, Header, Icon, IconButton, Loading, Row, Screen, Sheet, Txt } from '@/components/ui';
import { byPosition, byPriority, bySchedule, useProjectActions, useProjects, useTaskIndex } from '@/data/tasks';
import { TaskList } from '@/features/tasks/TaskList';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { haptic } from '@/lib/haptics';
import { usePersistentState } from '@/lib/persist';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

type Scope = 'all' | 'inbox' | string;
type SortMode = 'manual' | 'schedule' | 'priority';

const sortLabels: Record<SortMode, string> = { manual: '내 순서', schedule: '일정순', priority: '우선순위순' };
const isScope = (value: string): value is Scope => value.length > 0;
const isSortMode = (value: string): value is SortMode => value in sortLabels;

export default function Inbox() {
  const { colors } = useTheme();
  const { roots, isLoading, refetch } = useTaskIndex();
  const { data: projects } = useProjects();
  const projectActions = useProjectActions();
  // The last list and sort the person chose come back after a restart.
  const [scope, setScope] = usePersistentState<Scope>('dayframe-list-scope', 'inbox', isScope);
  const [sort, setSort] = usePersistentState<SortMode>('dayframe-list-sort', 'manual', isSortMode);
  const [refreshing, setRefreshing] = useState(false);
  const [pickingSort, setPickingSort] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'rename'; id: string } | null>(null);
  const [projectName, setProjectName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A project deleted on another device falls back to uncategorized.
  const selected = scope !== 'all' && scope !== 'inbox' ? projects?.find((project) => project.id === scope) ?? null : null;
  const effectiveScope: Scope = scope === 'all' ? 'all' : selected ? selected.id : 'inbox';
  useScreenDefaults({ projectId: selected?.id ?? null });

  const canSortManually = effectiveScope !== 'all' && sort === 'manual';
  const tasks = useMemo(() => {
    const filtered = effectiveScope === 'all' ? roots : roots.filter((task) => task.project_id === (selected?.id ?? null));
    const comparator = sort === 'priority' ? byPriority : sort === 'schedule' || effectiveScope === 'all' ? bySchedule : byPosition;
    return [...filtered].sort(comparator);
  }, [roots, effectiveScope, selected?.id, sort]);

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

  const openCreate = () => {
    setProjectName('');
    setEditor({ mode: 'create' });
  };

  const openRename = () => {
    if (!selected) return;
    setProjectMenu(false);
    setProjectName(selected.name);
    setEditor({ mode: 'rename', id: selected.id });
  };

  const saveProject = () => {
    const trimmed = projectName.trim();
    if (!trimmed || !editor) return;
    const duplicate = (projects ?? []).some((item) => item.name.toLowerCase() === trimmed.toLowerCase()
      && (editor.mode === 'create' || item.id !== editor.id));
    if (duplicate) {
      showToast('같은 이름의 프로젝트가 이미 있습니다.', { tone: 'error' });
      return;
    }
    haptic.success();
    if (editor.mode === 'create') {
      projectActions.create(trimmed, (created) => setScope(created.id));
      showToast(`#${trimmed} 프로젝트를 만들었습니다.`);
    } else {
      projectActions.rename(editor.id, trimmed);
      showToast(`프로젝트 이름을 #${trimmed}(으)로 바꿨습니다.`);
    }
    setEditor(null);
  };

  const deleteSelected = () => {
    if (!selected) return;
    const removedName = selected.name;
    setConfirmDelete(false);
    setScope('inbox');
    projectActions.remove(selected.id);
    showToast(`#${removedName} 프로젝트를 삭제했습니다.`);
  };

  const title = effectiveScope === 'all' ? '전체 목록' : selected?.name ?? '목록';
  const subtitle = tasks.length
    ? `${tasks.length}개 · ${canSortManually ? '길게 눌러 순서 변경' : sort === 'manual' ? '일정순' : sortLabels[sort]}`
    : undefined;

  return (
    <Screen>
      <Header
        title={title} subtitle={subtitle}
        right={(
          <View style={{ flexDirection: 'row' }}>
            <IconButton
              name="sliders" label="정렬" onPress={() => setPickingSort(true)}
              color={sort !== 'manual' ? colors.accent : colors.textMuted} />
            {selected ? (
              <IconButton name="more-horizontal" label="프로젝트 관리" onPress={() => setProjectMenu(true)} color={colors.textMuted} />
            ) : null}
            <IconButton name="search" label="검색" onPress={() => router.push('/search')} color={colors.textMuted} />
            <IconButton name="check-circle" label="완료한 일" onPress={() => router.push('/completed')} color={colors.textMuted} />
          </View>
        )} />

      <View>
        <PlainScroll horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
          <Chip icon="layers" label={'전체' + (roots.length ? ' ' + roots.length : '')} selected={effectiveScope === 'all'} onPress={() => setScope('all')} />
          <Chip icon="inbox" label={'미분류' + (counts.get(null) ? ' ' + counts.get(null) : '')} selected={effectiveScope === 'inbox'} onPress={() => setScope('inbox')} />
          {(projects ?? []).map((project) => (
            <Chip
              key={project.id} icon="hash" label={project.name + (counts.get(project.id) ? ' ' + counts.get(project.id) : '')}
              selected={selected?.id === project.id} onPress={() => setScope(project.id)} />
          ))}
          <Chip icon="plus" label="새 프로젝트" onPress={openCreate} />
        </PlainScroll>
      </View>

      {isLoading ? <Loading /> : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {tasks.length ? <TaskList tasks={tasks} sortable={canSortManually} /> : (
            <EmptyState
              icon={selected ? 'hash' : effectiveScope === 'all' ? 'layers' : 'inbox'}
              title={selected ? '이 프로젝트는 비어 있습니다' : effectiveScope === 'all' ? '열려 있는 할 일이 없습니다' : '미분류 할 일이 없습니다'}
              message={selected
                ? '+ 버튼으로 이 프로젝트에 할 일을 추가하세요.'
                : effectiveScope === 'all'
                  ? '아래 + 버튼으로 새 할 일을 추가해 보세요.'
                  : '#프로젝트 없이 적은 할 일이 여기에 모입니다. 위의 + 새 프로젝트나 #이름으로 프로젝트별로 나눠 볼 수 있습니다.'} />
          )}
        </ScrollView>
      )}

      <Sheet visible={pickingSort} onClose={() => setPickingSort(false)} title="정렬 기준">
        {(['manual', 'schedule', 'priority'] as SortMode[]).map((option) => (
          <Row
            key={option}
            icon={option === 'manual' ? 'menu' : option === 'schedule' ? 'calendar' : 'flag'}
            label={sortLabels[option]}
            detail={option === 'manual' ? (effectiveScope === 'all' ? '프로젝트별로 사용' : '길게 눌러 순서 변경') : undefined}
            trailing={sort === option ? <Icon name="check" size={18} color={colors.accent} /> : undefined}
            onPress={() => {
              haptic.tap();
              setSort(option);
              setPickingSort(false);
            }} />
        ))}
      </Sheet>

      <Sheet visible={projectMenu && !!selected} onClose={() => setProjectMenu(false)} title={selected ? '#' + selected.name : ''}>
        <Row icon="edit-2" label="이름 바꾸기" onPress={openRename} />
        <Row
          icon="trash-2" label="프로젝트 삭제" tone="danger"
          onPress={() => {
            setProjectMenu(false);
            setConfirmDelete(true);
          }} />
      </Sheet>

      <Sheet visible={!!editor} onClose={() => setEditor(null)} title={editor?.mode === 'rename' ? '프로젝트 이름 바꾸기' : '새 프로젝트'}>
        <View style={{ gap: space.md }}>
          <TextInput
            value={projectName} onChangeText={setProjectName} autoFocus maxLength={120}
            placeholder="예: 회사, 건강, 사이드 프로젝트" placeholderTextColor={colors.textFaint}
            returnKeyType="done" onSubmitEditing={saveProject} accessibilityLabel="프로젝트 이름"
            style={[type.body, styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="취소" kind="secondary" onPress={() => setEditor(null)} style={{ flex: 1 }} />
            <Button
              label={editor?.mode === 'rename' ? '저장' : '만들기'} loading={projectActions.creating}
              disabled={!projectName.trim()} onPress={saveProject} style={{ flex: 1 }} />
          </View>
        </View>
      </Sheet>

      <Sheet visible={confirmDelete && !!selected} onClose={() => setConfirmDelete(false)} title={`#${selected?.name ?? ''} 프로젝트를 삭제할까요?`}>
        <Txt tone="muted" style={{ marginBottom: space.lg }}>
          {counts.get(selected?.id ?? null)
            ? `이 프로젝트 안에 있는 할 일 ${counts.get(selected?.id ?? null)}개가 함께 삭제되며 되돌릴 수 없습니다.`
            : '이 프로젝트가 삭제되며 되돌릴 수 없습니다.'}
        </Txt>
        <View style={{ gap: space.sm }}>
          <Button label="삭제" kind="danger" onPress={deleteSelected} />
          <Button label="취소" kind="secondary" onPress={() => setConfirmDelete(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
});
