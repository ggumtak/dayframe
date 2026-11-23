import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView as PlainScroll, StyleSheet, Text, type TextStyle, TextInput, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Checkbox } from '@/components/Checkbox';
import { Button, Chip, EmptyState, Header, Icon, IconButton, Loading, Row, Screen, Sheet, Txt } from '@/components/ui';
import {
  byPosition, byPriority, bySchedule, byTitle, useCompletedTasks, useProjectActions, useProjects,
  useSectionActions, useSections, useSubtaskProgress, useTaskActions, useTaskIndex,
} from '@/data/tasks';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { BatchBar } from '@/features/tasks/BatchBar';
import { TaskList } from '@/features/tasks/TaskList';
import { TemplatesSheet } from '@/features/tasks/TemplatesSheet';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { haptic } from '@/lib/haptics';
import { usePersistentState } from '@/lib/persist';
import type { Section, Task } from '@/lib/shared';
import { bySmartRank } from '@/lib/smart';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

type Scope = 'all' | 'inbox' | string;
type SortMode = 'manual' | 'smart' | 'schedule' | 'priority' | 'title';

const sortLabels: Record<SortMode, string> = {
  manual: '내 순서',
  smart: '스마트 추천순',
  schedule: '일정순',
  priority: '우선순위순',
  title: '이름순',
};
const isScope = (value: string): value is Scope => value.length > 0;
const isSortMode = (value: string): value is SortMode => value in sortLabels;

export default function Inbox() {
  const { colors } = useTheme();
  const { roots, isLoading, refetch } = useTaskIndex();
  const { data: projects } = useProjects();
  const { data: sections } = useSections();
  const { data: completedAll } = useCompletedTasks();
  const { progress: subtaskProgress } = useSubtaskProgress();
  const projectActions = useProjectActions();
  const sectionActions = useSectionActions();
  const taskActions = useTaskActions();
  const quickAdd = useQuickAdd();
  // The last list and sort the person chose come back after a restart.
  const [scope, setScope] = usePersistentState<Scope>('dayframe-list-scope', 'inbox', isScope);
  const [sort, setSort] = usePersistentState<SortMode>('dayframe-list-sort', 'manual', isSortMode);
  const [refreshing, setRefreshing] = useState(false);
  const [pickingSort, setPickingSort] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());

  // Multi-select batch editing state
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);

  // Project create/rename/delete modals
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'rename'; id: string } | null>(null);
  const [projectName, setProjectName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Section create/rename/delete modals
  const [sectionEditor, setSectionEditor] = useState<{ mode: 'create' } | { mode: 'rename'; section: Section } | null>(null);
  const [sectionName, setSectionName] = useState('');
  const [managingSection, setManagingSection] = useState<Section | null>(null);

  // A project deleted on another device falls back to uncategorized.
  const selected = scope !== 'all' && scope !== 'inbox' ? projects?.find((project) => project.id === scope) ?? null : null;
  const effectiveScope: Scope = scope === 'all' ? 'all' : selected ? selected.id : 'inbox';
  useScreenDefaults({ projectId: selected?.id ?? null });

  const projectSections = useMemo(
    () => (selected ? (sections ?? []).filter((s) => s.project_id === selected.id).sort((a, b) => a.position - b.position) : []),
    [selected, sections],
  );
  const hasSections = !!selected && projectSections.length > 0;
  const canSortManually = effectiveScope !== 'all' && sort === 'manual' && !selectedIds;

  const sortTasks = useCallback((list: Task[]) => {
    const copy = [...list];
    if (sort === 'smart') return copy.sort((a, b) => bySmartRank(a, b, { subtaskProgress }));
    if (sort === 'priority') return copy.sort(byPriority);
    if (sort === 'title') return copy.sort(byTitle);
    if (sort === 'schedule' || (effectiveScope === 'all' && sort === 'manual')) return copy.sort(bySchedule);
    return copy.sort(byPosition);
  }, [sort, effectiveScope, subtaskProgress]);

  const tasks = useMemo(() => {
    const filtered = effectiveScope === 'all' ? roots : roots.filter((task) => task.project_id === (selected?.id ?? null));
    return sortTasks(filtered);
  }, [roots, effectiveScope, selected?.id, sortTasks]);

  const completedInScope = useMemo(() => {
    if (!selected) return [];
    return (completedAll ?? [])
      .filter((task) => !task.parent_task_id && task.project_id === selected.id)
      .sort((a, b) => Date.parse(b.completed_at ?? '') - Date.parse(a.completed_at ?? ''))
      .slice(0, 30);
  }, [completedAll, selected]);

  const counts = useMemo(() => {
    const map = new Map<string | null, number>();
    for (const task of roots) map.set(task.project_id, (map.get(task.project_id) ?? 0) + 1);
    return map;
  }, [roots]);

  const selectedTasks = useMemo(
    () => (selectedIds ? tasks.filter((t) => selectedIds.has(t.id)) : []),
    [selectedIds, tasks],
  );

  const toggleSelect = useCallback((task: Task) => {
    setSelectedIds((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  }, []);

  const startSelect = useCallback((task: Task) => {
    setSelectedIds(new Set([task.id]));
  }, []);

  const toggleSectionCollapse = (id: string) => {
    haptic.tap();
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const openCreateSection = () => {
    if (!selected) return;
    setProjectMenu(false);
    setSectionName('');
    setSectionEditor({ mode: 'create' });
  };

  const saveSection = () => {
    const trimmed = sectionName.trim();
    if (!trimmed || !sectionEditor || !selected) return;
    const duplicate = projectSections.some((s) => s.name.toLowerCase() === trimmed.toLowerCase()
      && (sectionEditor.mode === 'create' || s.id !== sectionEditor.section.id));
    if (duplicate) {
      showToast('같은 이름의 섹션이 이미 있습니다.', { tone: 'error' });
      return;
    }
    haptic.success();
    if (sectionEditor.mode === 'create') {
      const nextPos = projectSections.reduce((max, s) => Math.max(max, s.position), 0) + 1024;
      sectionActions.create(selected.id, trimmed, nextPos);
      showToast(`‘${trimmed}’ 섹션을 만들었습니다.`);
    } else {
      sectionActions.rename(sectionEditor.section.id, trimmed);
      showToast(`섹션 이름을 ‘${trimmed}’(으)로 바꿨습니다.`);
    }
    setSectionEditor(null);
  };

  const title = effectiveScope === 'all' ? '전체 목록' : selected?.name ?? '목록';
  const subtitle = tasks.length
    ? `${tasks.length}개 · ${canSortManually ? '길게 눌러 순서 변경' : sort === 'manual' ? '일정순' : sortLabels[sort]}`
    : undefined;

  const unsectionedTasks = hasSections ? tasks.filter((t) => !t.section_id || !projectSections.some((s) => s.id === t.section_id)) : tasks;

  return (
    <Screen>
      <Header
        title={title} subtitle={subtitle}
        right={(
          <View style={{ flexDirection: 'row' }}>
            {tasks.length > 0 ? (
              <IconButton
                name="check-square" label="여러 개 선택"
                onPress={() => {
                  haptic.tap();
                  setSelectedIds((prev) => (prev ? null : new Set()));
                }}
                color={selectedIds ? colors.accent : colors.textMuted} />
            ) : null}
            <IconButton name="bookmark" label="체크리스트 템플릿" onPress={() => setShowTemplates(true)} color={colors.textMuted} />
            <IconButton
              name="sliders" label="정렬" onPress={() => setPickingSort(true)}
              color={sort !== 'manual' ? colors.accent : colors.textMuted} />
            {selected ? (
              <IconButton name="more-horizontal" label="프로젝트 관리" onPress={() => setProjectMenu(true)} color={colors.textMuted} />
            ) : (
              <IconButton name="search" label="검색" onPress={() => router.push('/search')} color={colors.textMuted} />
            )}
          </View>
        )} />

      <View>
        <PlainScroll horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
          <Chip
            icon="layers" label={'전체' + (roots.length ? ' ' + roots.length : '')} selected={effectiveScope === 'all'}
            onPress={() => {
              setSelectedIds(null);
              setScope('all');
            }} />
          <Chip
            icon="inbox" label={'미분류' + (counts.get(null) ? ' ' + counts.get(null) : '')} selected={effectiveScope === 'inbox'}
            onPress={() => {
              setSelectedIds(null);
              setScope('inbox');
            }} />
          {(projects ?? []).map((project) => (
            <Chip
              key={project.id} icon="hash" label={project.name + (counts.get(project.id) ? ' ' + counts.get(project.id) : '')}
              selected={selected?.id === project.id}
              onPress={() => {
                setSelectedIds(null);
                setScope(project.id);
              }} />
          ))}
          <Chip icon="plus" label="새 프로젝트" onPress={openCreate} />
        </PlainScroll>
      </View>

      {isLoading ? <Loading /> : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: selectedIds ? 180 : 140, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {hasSections ? (
            <>
              {unsectionedTasks.length > 0 ? (
                <TaskList
                  tasks={unsectionedTasks} sortable={canSortManually}
                  selectedIds={selectedIds} onToggleSelect={toggleSelect} onStartSelect={startSelect} />
              ) : null}
              {projectSections.map((section) => {
                const sectionTasks = tasks.filter((t) => t.section_id === section.id);
                const collapsed = collapsedSections.has(section.id);
                return (
                  <View key={section.id}>
                    <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
                      <Pressable
                        accessibilityRole="button" accessibilityLabel={`${section.name} 섹션 ${collapsed ? '펼치기' : '접기'}`}
                        onPress={() => toggleSectionCollapse(section.id)}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={15} color={colors.textFaint} />
                        <Txt variant="section">{section.name}</Txt>
                        <Txt variant="small" tone="faint">{sectionTasks.length}</Txt>
                      </Pressable>
                      <IconButton
                        name="plus" label={section.name + '에 할 일 추가'} size={16} color={colors.accent}
                        onPress={() => quickAdd.open({ projectId: selected!.id, sectionId: section.id })}
                        style={{ width: 32, height: 32 }} />
                      <IconButton
                        name="more-horizontal" label={section.name + ' 섹션 관리'} size={16} color={colors.textFaint}
                        onPress={() => setManagingSection(section)}
                        style={{ width: 32, height: 32 }} />
                    </View>
                    {!collapsed ? (
                      sectionTasks.length > 0 ? (
                        <TaskList
                          tasks={sectionTasks} sortable={canSortManually}
                          selectedIds={selectedIds} onToggleSelect={toggleSelect} onStartSelect={startSelect} />
                      ) : (
                        <Pressable
                          onPress={() => quickAdd.open({ projectId: selected!.id, sectionId: section.id })}
                          style={styles.emptySection}>
                          <Icon name="plus" size={14} color={colors.textFaint} />
                          <Txt variant="small" tone="faint">이 섹션에 할 일 추가</Txt>
                        </Pressable>
                      )
                    ) : null}
                  </View>
                );
              })}
              <Pressable
                accessibilityRole="button" accessibilityLabel="새 섹션 추가" onPress={openCreateSection}
                style={({ pressed }) => [styles.addSectionBtn, { opacity: pressed ? 0.6 : 1 }]}>
                <Icon name="plus" size={15} color={colors.accent} />
                <Txt variant="smallStrong" tone="accent">섹션 추가</Txt>
              </Pressable>
            </>
          ) : tasks.length ? (
            <>
              <TaskList
                tasks={tasks} sortable={canSortManually}
                selectedIds={selectedIds} onToggleSelect={toggleSelect} onStartSelect={startSelect} />
              {selected ? (
                <Pressable
                  accessibilityRole="button" accessibilityLabel="섹션으로 나누기" onPress={openCreateSection}
                  style={({ pressed }) => [styles.addSectionBtn, { opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name="bookmark" size={14} color={colors.textMuted} />
                  <Txt variant="small" tone="muted">섹션으로 그룹 나누기</Txt>
                </Pressable>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={selected ? 'hash' : effectiveScope === 'all' ? 'layers' : 'inbox'}
              title={selected ? '이 프로젝트는 비어 있습니다' : effectiveScope === 'all' ? '열려 있는 할 일이 없습니다' : '미분류 할 일이 없습니다'}
              message={selected
                ? '+ 버튼으로 할 일을 추가하거나 템플릿으로 체크리스트를 시작해 보세요.'
                : effectiveScope === 'all'
                  ? '아래 + 버튼으로 새 할 일을 추가해 보세요.'
                  : '#프로젝트 없이 적은 할 일이 여기에 모입니다. 위의 + 새 프로젝트나 템플릿을 활용해 보세요.'}
              action={(
                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                  <Button label="템플릿에서 추가" kind="secondary" icon="bookmark" onPress={() => setShowTemplates(true)} />
                  {selected ? <Button label="섹션 추가" kind="ghost" icon="plus" onPress={openCreateSection} /> : null}
                </View>
              )} />
          )}

          {selected && completedInScope.length > 0 ? (
            <View style={{ marginTop: space.md }}>
              <Pressable
                accessibilityRole="button" onPress={() => setShowCompleted((open) => !open)}
                style={({ pressed }) => [styles.completedToggle, { opacity: pressed ? 0.6 : 1 }]}>
                <Icon name={showCompleted ? 'chevron-down' : 'chevron-right'} size={15} color={colors.textFaint} />
                <Txt variant="smallStrong" tone="muted">완료한 항목 {completedInScope.length}</Txt>
              </Pressable>
              {showCompleted ? completedInScope.map((task) => (
                <View key={task.id} style={styles.completedRow}>
                  <Checkbox
                    checked size={20} color={colors.success}
                    onPress={() => {
                      haptic.tap();
                      taskActions.reopen(task);
                      showToast(`‘${task.title}’을 다시 열었습니다.`);
                    }}
                    label={task.title + ' 다시 열기'} />
                  <View style={[styles.completedBody, { borderBottomColor: colors.border }]}>
                    <Text numberOfLines={1} style={[type.body as TextStyle, { color: colors.textFaint, textDecorationLine: 'line-through', flex: 1 }]}>
                      {task.title}
                    </Text>
                  </View>
                </View>
              )) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      {selectedIds ? (
        <BatchBar
          selected={selectedTasks}
          totalCount={tasks.length}
          onSelectAll={() => {
            haptic.tap();
            setSelectedIds((prev) => (prev && prev.size === tasks.length ? new Set() : new Set(tasks.map((t) => t.id))));
          }}
          onCancel={() => setSelectedIds(null)} />
      ) : null}

      <TemplatesSheet
        visible={showTemplates} onClose={() => setShowTemplates(false)}
        projectId={selected?.id ?? null} />

      <Sheet visible={pickingSort} onClose={() => setPickingSort(false)} title="정렬 기준">
        {(['manual', 'smart', 'schedule', 'priority', 'title'] as SortMode[]).map((option) => (
          <Row
            key={option}
            icon={option === 'manual' ? 'menu' : option === 'smart' ? 'zap' : option === 'schedule' ? 'calendar' : option === 'priority' ? 'flag' : 'type'}
            label={sortLabels[option]}
            detail={option === 'manual'
              ? (effectiveScope === 'all' ? '프로젝트별로 사용' : '길게 눌러 순서 변경')
              : option === 'smart' ? '긴급도 · 중요도 · 진행률' : undefined}
            trailing={sort === option ? <Icon name="check" size={18} color={colors.accent} /> : undefined}
            onPress={() => {
              haptic.tap();
              setSort(option);
              setPickingSort(false);
            }} />
        ))}
      </Sheet>

      <Sheet visible={projectMenu && !!selected} onClose={() => setProjectMenu(false)} title={selected ? '#' + selected.name : ''}>
        <Row icon="plus" label="새 섹션 추가" detail="목록을 단계·카테고리로 분류" onPress={openCreateSection} />
        <Row
          icon="bookmark" label="체크리스트 템플릿 추가"
          onPress={() => {
            setProjectMenu(false);
            setShowTemplates(true);
          }} />
        <Row icon="edit-2" label="프로젝트 이름 바꾸기" onPress={openRename} />
        <Row
          icon="search" label="검색"
          onPress={() => {
            setProjectMenu(false);
            router.push('/search');
          }} />
        <Row
          icon="trash-2" label="프로젝트 삭제" tone="danger"
          onPress={() => {
            setProjectMenu(false);
            setConfirmDelete(true);
          }} />
      </Sheet>

      <Sheet visible={!!managingSection} onClose={() => setManagingSection(null)} title={managingSection?.name ?? ''}>
        <Row
          icon="plus" label="이 섹션에 할 일 추가"
          onPress={() => {
            const target = managingSection;
            setManagingSection(null);
            if (target && selected) quickAdd.open({ projectId: selected.id, sectionId: target.id });
          }} />
        <Row
          icon="edit-2" label="섹션 이름 바꾸기"
          onPress={() => {
            if (!managingSection) return;
            setSectionName(managingSection.name);
            setSectionEditor({ mode: 'rename', section: managingSection });
            setManagingSection(null);
          }} />
        <Row
          icon="trash-2" label="섹션 삭제" detail="안의 할 일은 유지됩니다" tone="danger"
          onPress={() => {
            if (!managingSection) return;
            const removed = managingSection.name;
            sectionActions.remove(managingSection.id);
            setManagingSection(null);
            showToast(`‘${removed}’ 섹션을 삭제했습니다.`);
          }} />
      </Sheet>

      <Sheet visible={!!sectionEditor} onClose={() => setSectionEditor(null)} title={sectionEditor?.mode === 'rename' ? '섹션 이름 바꾸기' : '새 섹션'}>
        <View style={{ gap: space.md }}>
          <TextInput
            value={sectionName} onChangeText={setSectionName} autoFocus maxLength={120}
            placeholder="예: 준비물, 진행 중, 확인 필요" placeholderTextColor={colors.textFaint}
            returnKeyType="done" onSubmitEditing={saveSection} accessibilityLabel="섹션 이름"
            style={[type.body, styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="취소" kind="secondary" onPress={() => setSectionEditor(null)} style={{ flex: 1 }} />
            <Button
              label={sectionEditor?.mode === 'rename' ? '저장' : '만들기'} loading={sectionActions.creating}
              disabled={!sectionName.trim()} onPress={saveSection} style={{ flex: 1 }} />
          </View>
        </View>
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
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: space.sm,
    paddingTop: space.lg, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emptySection: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.xl, paddingVertical: 12,
  },
  addSectionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingVertical: space.md,
  },
  completedToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingVertical: space.sm,
  },
  completedRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg,
  },
  completedBody: {
    flex: 1, paddingVertical: 11, paddingRight: space.lg, borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
