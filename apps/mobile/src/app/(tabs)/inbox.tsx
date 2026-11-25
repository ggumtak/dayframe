import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView as PlainScroll, type ScrollViewInstance, StyleSheet, Text, type TextStyle, TextInput, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Checkbox } from '@/components/Checkbox';
import { EmptyList } from '@/components/art';
import { Button, Chip, EMPTY_ART, EmptyState, Header, Icon, IconButton, type IconName, Loading, Row, Screen, Sheet, Txt } from '@/components/ui';
import {
  byPosition, byPriority, bySchedule, byTitle, useCompletedTasks, useProjectActions, useProjects,
  useSectionActions, useSections, useSubtaskProgress, useTaskActions, useTaskIndex,
} from '@/data/tasks';
import {
  type HardwareKeyEvent, KEY_PRIORITY, matchesCombo, useKeyHandler, useListCursor, useScreenContext, useScreenFocused, useTaskShortcuts,
} from '@/features/keyboard';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { BatchBar } from '@/features/tasks/BatchBar';
import { LIST_COLORS, listColor, listColorEntry } from '@/features/tasks/listColors';
import { deleteProjectMeta, PROJECT_COLORS, PROJECT_ICONS, setProjectMeta, useProjectMetaMap } from '@/features/tasks/projectMeta';
import { positionsFor, TaskListSheets, TaskRows, useTaskListModel } from '@/features/tasks/TaskList';
import { TemplatesSheet } from '@/features/tasks/TemplatesSheet';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, Temporal, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { usePersistentState } from '@/lib/persist';
import type { Section, Task } from '@/lib/shared';
import { bySmartRank } from '@/lib/smart';
import { useTabScrollTop } from '@/lib/tabScroll';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

type Scope = 'all' | 'inbox' | string;
type SortMode = 'manual' | 'smart' | 'schedule' | 'priority' | 'title';
type ListFilter = 'all' | 'due' | 'undated' | 'priority' | 'checklist';

const sortLabels: Record<SortMode, string> = {
  manual: '내 순서',
  smart: '추천순',
  schedule: '일정순',
  priority: '우선순위순',
  title: '이름순',
};

const filterOptions: { value: ListFilter; label: string; icon?: IconName }[] = [
  { value: 'all', label: '전체' },
  { value: 'due', label: '오늘·기한 지남', icon: 'sun' },
  { value: 'undated', label: '날짜 없음', icon: 'slash' },
  { value: 'priority', label: '중요', icon: 'flag' },
  { value: 'checklist', label: '하위 작업', icon: 'check-square' },
];
const FILTER_ORDER: readonly ListFilter[] = ['all', 'due', 'undated', 'priority', 'checklist'];
const taskIdOf = (task: Task) => task.id;

type DoneWindow = 'today' | '3' | '7' | '30' | 'all';
const doneWindows: { value: DoneWindow; label: string; short: string }[] = [
  { value: 'today', label: '오늘만', short: '오늘' },
  { value: '3', label: '최근 3일', short: '최근 3일' },
  { value: '7', label: '최근 7일', short: '최근 7일' },
  { value: '30', label: '최근 30일', short: '최근 30일' },
  { value: 'all', label: '전체 기간', short: '전체' },
];
const isDoneWindow = (value: string): value is DoneWindow => doneWindows.some((item) => item.value === value);
const isScope = (value: string): value is Scope => value.length > 0;
const isSortMode = (value: string): value is SortMode => value in sortLabels;

export default function Inbox() {
  const { colors, isDark } = useTheme();
  const isFocused = useScreenFocused();
  useScreenContext('inbox', isFocused);
  const { roots, isLoading, refetch } = useTaskIndex();
  const { data: projects } = useProjects();
  const projectMeta = useProjectMetaMap();
  const { data: sections } = useSections();
  const { data: completedAll } = useCompletedTasks();
  const { progress: subtaskProgress } = useSubtaskProgress();
  const projectActions = useProjectActions();
  const sectionActions = useSectionActions();
  const taskActions = useTaskActions();
  const quickAdd = useQuickAdd();
  const { model, sheets } = useTaskListModel();

  const [scope, setScope] = usePersistentState<Scope>('dayframe-list-scope', 'inbox', isScope);
  const [sort, setSort] = usePersistentState<SortMode>('dayframe-list-sort', 'manual', isSortMode);
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [pickingSort, setPickingSort] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [doneWindow, setDoneWindow] = usePersistentState<DoneWindow>('dayframe-list-done-window', '7', isDoneWindow);
  const [pickingDoneWindow, setPickingDoneWindow] = useState(false);
  useMinute();
  const todayKey = today(deviceTimeZone()).toString();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<ScrollViewInstance>(null);
  useTabScrollTop('inbox', scrollRef);

  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);

  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'rename'; id: string } | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectColor, setProjectColor] = useState<string>(PROJECT_COLORS[0]);
  const [projectIcon, setProjectIcon] = useState<IconName>('hash');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [sectionEditor, setSectionEditor] = useState<{ mode: 'create' } | { mode: 'rename'; section: Section } | null>(null);
  const [sectionName, setSectionName] = useState('');
  const [managingSection, setManagingSection] = useState<Section | null>(null);

  const selected = scope !== 'all' && scope !== 'inbox' ? projects?.find((project) => project.id === scope) ?? null : null;
  const effectiveScope: Scope = scope === 'all' ? 'all' : selected ? selected.id : 'inbox';
  useScreenDefaults({ projectId: selected?.id ?? null });

  const projectSections = useMemo(
    () => (selected ? (sections ?? []).filter((s) => s.project_id === selected.id).sort((a, b) => a.position - b.position) : []),
    [selected, sections],
  );
  const hasSections = !!selected && projectSections.length > 0;
  const canSortManually = effectiveScope !== 'all' && sort === 'manual' && listFilter === 'all' && !selectedIds;

  const sortTasks = useCallback((list: Task[]) => {
    const copy = [...list];
    if (sort === 'smart') return copy.sort((a, b) => bySmartRank(a, b, { subtaskProgress }));
    if (sort === 'priority') return copy.sort(byPriority);
    if (sort === 'title') return copy.sort(byTitle);
    if (sort === 'schedule' || (effectiveScope === 'all' && sort === 'manual')) return copy.sort(bySchedule);
    return copy.sort(byPosition);
  }, [sort, effectiveScope, subtaskProgress]);

  const scopeRoots = useMemo(
    () => (effectiveScope === 'all' ? roots : roots.filter((task) => task.project_id === (selected?.id ?? null))),
    [roots, effectiveScope, selected?.id],
  );

  const tasks = useMemo(() => {
    const narrowed = listFilter === 'all' ? scopeRoots : scopeRoots.filter((task) => {
      if (listFilter === 'due') {
        const b = dueBucket(task);
        return b === 'overdue' || b === 'today';
      }
      if (listFilter === 'undated') return !task.due_at;
      if (listFilter === 'priority') return task.priority < 4;
      return (subtaskProgress.get(task.id)?.total ?? 0) > 0;
    });
    return sortTasks(narrowed);
  }, [scopeRoots, listFilter, subtaskProgress, sortTasks]);

  // Group All Tasks ('all') by project when sorted manually so every project reads cleanly with its own heading and + button.
  const allProjectGroups = useMemo(() => {
    if (effectiveScope !== 'all' || sort !== 'manual') return null;
    const known = new Set((projects ?? []).map((p) => p.id));
    const byProj = new Map<string | null, Task[]>();
    for (const task of tasks) {
      const key = task.project_id && known.has(task.project_id) ? task.project_id : null;
      const list = byProj.get(key) ?? [];
      list.push(task);
      byProj.set(key, list);
    }
    const ordered: { key: string; projectId: string | null; name: string; icon: IconName; tasks: Task[] }[] = [];
    const inboxTasks = byProj.get(null);
    if (inboxTasks?.length) {
      ordered.push({ key: 'proj-inbox', projectId: null, name: '미분류', icon: 'inbox', tasks: inboxTasks.sort(byPosition) });
    }
    for (const project of projects ?? []) {
      const projTasks = byProj.get(project.id);
      if (projTasks?.length) {
        ordered.push({
          key: 'proj-' + project.id,
          projectId: project.id,
          name: project.name,
          icon: projectMeta[project.id]?.icon ?? 'hash',
          tasks: projTasks.sort(byPosition),
        });
      }
    }
    return ordered;
  }, [effectiveScope, sort, tasks, projects, projectMeta]);

  const completedInScope = useMemo(() => {
    const targetProjectId = selected?.id ?? null;
    const zone = deviceTimeZone();
    const days = doneWindow === 'all' ? null : doneWindow === 'today' ? 1 : Number(doneWindow);
    const since = days === null ? 0
      : Temporal.PlainDate.from(todayKey).subtract({ days: days - 1 }).toZonedDateTime(zone).epochMilliseconds;
    return (completedAll ?? [])
      .filter((task) => !task.parent_task_id
        && (effectiveScope === 'all' || task.project_id === targetProjectId)
        && Date.parse(task.completed_at ?? '') >= since)
      .sort((a, b) => Date.parse(b.completed_at ?? '') - Date.parse(a.completed_at ?? ''))
      .slice(0, 50);
  }, [completedAll, effectiveScope, selected, doneWindow, todayKey]);
  const doneWindowLabel = doneWindows.find((item) => item.value === doneWindow)?.short ?? '';

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

  const selectScope = useCallback((next: Scope) => {
    setSelectedIds(null);
    setListFilter('all');
    setScope(next);
  }, [setScope]);

  const selectFilter = useCallback((next: ListFilter) => {
    setSelectedIds(null);
    setListFilter(next);
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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const openCreate = useCallback(() => {
    setProjectName('');
    setProjectColor(PROJECT_COLORS[(projects?.length ?? 0) % PROJECT_COLORS.length]);
    setProjectIcon('hash');
    setEditor({ mode: 'create' });
  }, [projects?.length]);

  const openRename = () => {
    if (!selected) return;
    setProjectMenu(false);
    setProjectName(selected.name);
    const meta = projectMeta[selected.id];
    setProjectColor(meta?.color ?? PROJECT_COLORS[0]);
    setProjectIcon(meta?.icon ?? 'hash');
    setEditor({ mode: 'rename', id: selected.id });
  };

  const saveProject = () => {
    const trimmed = projectName.trim();
    if (!trimmed || !editor) return;
    const duplicate = (projects ?? []).some((item) => item.name.toLowerCase() === trimmed.toLowerCase()
      && (editor.mode === 'create' || item.id !== editor.id));
    if (duplicate) {
      showToast('같은 이름의 목록이 이미 있습니다.', { tone: 'error' });
      return;
    }
    haptic.success();
    const chosenColor = projectColor;
    const chosenIcon = projectIcon;
    if (editor.mode === 'create') {
      projectActions.create(trimmed, (created) => {
        setProjectMeta(created.id, { color: chosenColor, icon: chosenIcon });
        selectScope(created.id);
      });
      showToast(`#${trimmed} 목록을 만들었습니다.`);
    } else {
      projectActions.rename(editor.id, trimmed);
      setProjectMeta(editor.id, { color: chosenColor, icon: chosenIcon });
      showToast(`#${trimmed} 목록을 수정했습니다.`);
    }
    setEditor(null);
  };

  const deleteSelected = () => {
    if (!selected) return;
    const removedName = selected.name;
    const removedId = selected.id;
    setConfirmDelete(false);
    selectScope('inbox');
    projectActions.remove(removedId);
    deleteProjectMeta(removedId);
    showToast(`#${removedName} 목록을 삭제했습니다.`);
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
      showToast(`섹션 이름을 ‘${trimmed}’${josa(trimmed, '으로/로')} 바꿨습니다.`);
    }
    setSectionEditor(null);
  };

  const title = effectiveScope === 'all' ? '전체 목록' : selected?.name ?? '목록';
  const subtitle = tasks.length
    ? `${tasks.length}개 · ${canSortManually ? '길게 눌러 순서 변경' : effectiveScope === 'all' && sort === 'manual' ? '목록별' : sortLabels[sort]}`
    : undefined;

  const unsectionedTasks = useMemo(
    () => (hasSections ? tasks.filter((t) => !t.section_id || !projectSections.some((s) => s.id === t.section_id)) : tasks),
    [hasSections, tasks, projectSections],
  );

  const visibleTasks = useMemo(() => {
    if (allProjectGroups && allProjectGroups.length > 0) {
      return allProjectGroups.flatMap((group) => (!selectedIds && collapsedSections.has(group.key) ? [] : group.tasks));
    }
    if (hasSections) {
      return [
        ...unsectionedTasks,
        ...projectSections.flatMap((section) => (!selectedIds && collapsedSections.has(section.id) ? [] : tasks.filter((t) => t.section_id === section.id))),
      ];
    }
    return tasks;
  }, [allProjectGroups, collapsedSections, hasSections, projectSections, selectedIds, tasks, unsectionedTasks]);

  const scopeOrder = useMemo<Scope[]>(
    () => ['all', 'inbox', ...(projects ?? []).map((p) => p.id)],
    [projects],
  );

  const anySheetOpen = pickingSort || projectMenu || showTemplates || pickingDoneWindow || !!editor || !!sectionEditor || !!managingSection || confirmDelete || !!sheets.scheduling || !!sheets.menu;

  const cursor = useListCursor(visibleTasks, taskIdOf, {
    enabled: isFocused && !anySheetOpen,
    scrollRef,
    estimatedRowHeight: 64,
    headerOffset: 100,
  });

  const reorderTask = useCallback((task: Task, delta: -1 | 1) => {
    const list = hasSections
      ? (task.section_id && projectSections.some((s) => s.id === task.section_id)
        ? tasks.filter((t) => t.section_id === task.section_id)
        : unsectionedTasks)
      : tasks;
    const idx = list.findIndex((t) => t.id === task.id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const ordered = [...list];
    [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
    model.reorder(positionsFor(ordered, task));
    haptic.tap();
  }, [hasSections, model, projectSections, tasks, unsectionedTasks]);

  const onBeforeTaskKey = useCallback((event: HardwareKeyEvent) => {
    if (event.editing) return false;
    if (matchesCombo(event, '[')) {
      const idx = scopeOrder.indexOf(effectiveScope);
      const nextIdx = idx <= 0 ? scopeOrder.length - 1 : idx - 1;
      selectScope(scopeOrder[nextIdx]);
      haptic.tap();
      return true;
    }
    if (matchesCombo(event, ']')) {
      const idx = scopeOrder.indexOf(effectiveScope);
      const nextIdx = idx < 0 || idx >= scopeOrder.length - 1 ? 0 : idx + 1;
      selectScope(scopeOrder[nextIdx]);
      haptic.tap();
      return true;
    }
    if (matchesCombo(event, 'shift+[') || matchesCombo(event, 'shift+]')) {
      const dir = matchesCombo(event, 'shift+[') ? -1 : 1;
      const idx = FILTER_ORDER.indexOf(listFilter);
      const nextIdx = (idx + dir + FILTER_ORDER.length) % FILTER_ORDER.length;
      selectFilter(FILTER_ORDER[nextIdx]);
      haptic.tap();
      return true;
    }
    if (matchesCombo(event, 'shift+p')) {
      if (!event.repeat) openCreate();
      return true;
    }
    if (matchesCombo(event, 'shift+b')) {
      if (!event.repeat) setShowTemplates(true);
      return true;
    }
    if (matchesCombo(event, 'shift+o')) {
      if (!event.repeat) setPickingSort(true);
      return true;
    }
    if (matchesCombo(event, 'r')) {
      if (!event.repeat) {
        void refresh();
        showToast('새로고침했습니다.');
      }
      return true;
    }
    return false;
  }, [effectiveScope, listFilter, openCreate, refresh, scopeOrder, selectFilter, selectScope]);

  useTaskShortcuts(cursor, {
    enabled: isFocused && !anySheetOpen,
    selecting: !!selectedIds,
    onToggleSelect: toggleSelect,
    onStartSelect: startSelect,
    onSchedule: sheets.setScheduling,
    onOpenMenu: sheets.setMenu,
    onToggleSubtasks: model.toggleSubtasks,
    onAddSubtask: model.addSubtask,
    onReorder: canSortManually ? reorderTask : undefined,
    onBefore: onBeforeTaskKey,
  });

  useKeyHandler(
    (event) => {
      if (matchesCombo(event, 'mod+enter')) {
        if (event.repeat) return true;
        if (editor) {
          saveProject();
          return true;
        }
        if (sectionEditor) {
          saveSection();
          return true;
        }
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: isFocused && (!!editor || !!sectionEditor) },
  );

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
                color={selectedIds ? colors.accentText : colors.textMuted} />
            ) : null}
            <IconButton name="bookmark" label="체크리스트 템플릿" onPress={() => setShowTemplates(true)} color={colors.textMuted} />
            <IconButton
              name="sliders" label="정렬" onPress={() => setPickingSort(true)}
              color={sort !== 'manual' ? colors.accentText : colors.textMuted} />
            <IconButton name="search" label="검색" onPress={() => router.push('/search')} color={colors.textMuted} />
            {selected ? (
              <IconButton name="more-horizontal" label="목록 관리" onPress={() => setProjectMenu(true)} color={colors.textMuted} />
            ) : null}
          </View>
        )} />

      <View style={styles.chipStripRow}>
        <PlainScroll
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingLeft: space.lg, paddingRight: space.sm, gap: space.sm, paddingBottom: space.xs }}
          style={{ flex: 1 }}>
          <Chip
            icon="layers" label={'전체' + (roots.length ? ' ' + roots.length : '')} selected={effectiveScope === 'all'}
            onPress={() => selectScope('all')} />
          <Chip
            icon="inbox" label={'미분류' + (counts.get(null) ? ' ' + counts.get(null) : '')} selected={effectiveScope === 'inbox'}
            onPress={() => selectScope('inbox')} />
          {(projects ?? []).map((project) => {
            const meta = projectMeta[project.id];
            return (
              <Chip
                key={project.id}
                icon={meta?.icon ?? 'hash'}
                color={listColor(meta?.color, isDark)}
                label={project.name + (counts.get(project.id) ? ' ' + counts.get(project.id) : '')}
                selected={selected?.id === project.id}
                onPress={() => selectScope(project.id)} />
            );
          })}
        </PlainScroll>
        <View style={{ paddingRight: space.md, paddingBottom: space.xs }}>
          <IconButton
            name="plus" label="새 목록 만들기" size={18} color={colors.textMuted}
            onPress={openCreate}
            style={{ width: 32, height: 32, backgroundColor: colors.surfaceMuted }} />
        </View>
      </View>

      {scopeRoots.length > 0 || listFilter !== 'all' ? (
        <PlainScroll
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.lg, gap: 6, paddingTop: 2, paddingBottom: space.sm }}>
          {filterOptions.map((option) => (
            <Chip
              key={option.value} icon={option.icon} label={option.label}
              selected={listFilter === option.value}
              onPress={() => selectFilter(option.value)} />
          ))}
        </PlainScroll>
      ) : null}

      {isLoading ? <Loading /> : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingBottom: selectedIds ? 180 : 140, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {tasks.length === 0 && listFilter !== 'all' ? (
            <EmptyState
              icon="filter" title="조건에 맞는 할 일이 없습니다"
              message="다른 필터를 선택하거나 전체 할 일을 확인해 보세요."
              action={<Button label="필터 해제" kind="secondary" onPress={() => selectFilter('all')} />} />
          ) : allProjectGroups && allProjectGroups.length > 0 ? (
            allProjectGroups.map((group) => {
              const collapsed = !selectedIds && collapsedSections.has(group.key);
              return (
                <View key={group.key}>
                  <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
                    <Pressable
                      accessibilityRole="button" accessibilityLabel={`${group.name} ${collapsed ? '펼치기' : '접기'}`}
                      onPress={() => toggleSectionCollapse(group.key)}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={15} color={colors.textFaint} />
                      <Icon name={group.icon} size={14} color={colors.textFaint} />
                      <Txt variant="section">{group.name}</Txt>
                      <Txt variant="small" tone="faint">{group.tasks.length}</Txt>
                    </Pressable>
                    <IconButton
                      name="plus" label={group.name + '에 할 일 추가'} size={16} color={colors.textMuted}
                      onPress={() => quickAdd.open({ projectId: group.projectId })}
                      style={{ width: 32, height: 32 }} />
                  </View>
                  {!collapsed ? (
                    <TaskRows
                      model={model} tasks={group.tasks} hideProject selectedIds={selectedIds}
                      onToggleSelect={toggleSelect} focusedTaskId={cursor.focusedId} />
                  ) : null}
                </View>
              );
            })
          ) : hasSections ? (
            <>
              {unsectionedTasks.length > 0 ? (
                <TaskRows
                  key={effectiveScope} model={model} tasks={unsectionedTasks} sortable={canSortManually}
                  selectedIds={selectedIds} onToggleSelect={toggleSelect} focusedTaskId={cursor.focusedId} />
              ) : null}
              {projectSections.map((section) => {
                const sectionTasks = tasks.filter((t) => t.section_id === section.id);
                const collapsed = !selectedIds && collapsedSections.has(section.id);
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
                        name="plus" label={section.name + '에 할 일 추가'} size={16} color={colors.textMuted}
                        onPress={() => quickAdd.open({ projectId: selected!.id, sectionId: section.id })}
                        style={{ width: 32, height: 32 }} />
                      <IconButton
                        name="more-horizontal" label={section.name + ' 섹션 관리'} size={16} color={colors.textFaint}
                        onPress={() => setManagingSection(section)}
                        style={{ width: 32, height: 32 }} />
                    </View>
                    {!collapsed ? (
                      sectionTasks.length > 0 ? (
                        <TaskRows
                          model={model} tasks={sectionTasks} sortable={canSortManually}
                          selectedIds={selectedIds} onToggleSelect={toggleSelect} focusedTaskId={cursor.focusedId} />
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
                <Icon name="plus" size={15} color={colors.textFaint} />
                <Txt variant="smallStrong" tone="muted">섹션 추가</Txt>
              </Pressable>
            </>
          ) : tasks.length ? (
            <>
              <TaskRows
                key={effectiveScope + '-' + listFilter} model={model} tasks={tasks} sortable={canSortManually}
                selectedIds={selectedIds} onToggleSelect={toggleSelect} focusedTaskId={cursor.focusedId} />
              {selected ? (
                <Pressable
                  accessibilityRole="button" accessibilityLabel="섹션으로 나누기" onPress={openCreateSection}
                  style={({ pressed }) => [styles.addSectionBtn, { opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name="bookmark" size={14} color={colors.textMuted} />
                  <Txt variant="small" tone="muted">섹션으로 나누기</Txt>
                </Pressable>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={selected ? (projectMeta[selected.id]?.icon ?? 'hash') : effectiveScope === 'all' ? 'layers' : 'inbox'}
              art={<EmptyList size={EMPTY_ART} />}
              title={selected ? '아직 등록된 할 일이 없습니다' : effectiveScope === 'all' ? '아직 할 일이 없습니다' : '미분류 할 일이 없습니다'}
              message={selected
                ? '아래 + 버튼으로 할 일을 추가하거나 템플릿으로 시작해 보세요.'
                : effectiveScope === 'all'
                  ? '아래 + 버튼으로 새 할 일을 추가해 보세요.'
                  : '목록을 지정하지 않은 할 일이 이곳에 모입니다. 위 + 버튼으로 새 목록을 만들어 보세요.'}
              action={(
                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                  <Button label="템플릿에서 추가" kind="secondary" icon="bookmark" onPress={() => setShowTemplates(true)} />
                  {selected ? <Button label="섹션 추가" kind="ghost" icon="plus" onPress={openCreateSection} /> : null}
                </View>
              )} />
          )}

          {!selectedIds && completedInScope.length > 0 ? (
            <View style={{ marginTop: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={`완료한 할 일 ${completedInScope.length}개 ${showCompleted ? '접기' : '펼치기'}`}
                  onPress={() => setShowCompleted((open) => !open)}
                  style={({ pressed }) => [styles.completedToggle, { flex: 1, opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name={showCompleted ? 'chevron-down' : 'chevron-right'} size={15} color={colors.textFaint} />
                  <Txt variant="smallStrong" tone="muted">완료한 할 일 {completedInScope.length}</Txt>
                </Pressable>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={`완료한 할 일 표시 기간 ${doneWindowLabel}, 눌러서 변경`} hitSlop={10}
                  onPress={() => {
                    haptic.tap();
                    setPickingDoneWindow(true);
                  }}
                  style={({ pressed }) => ({ paddingHorizontal: space.lg, paddingVertical: space.sm, opacity: pressed ? 0.5 : 1 })}>
                  <Txt variant="caption" tone="faint">{doneWindowLabel}</Txt>
                </Pressable>
              </View>
              {showCompleted ? completedInScope.map((task) => (
                <View key={task.id} style={styles.completedRow}>
                  <Checkbox
                    checked done size={20}
                    onPress={() => {
                      haptic.tap();
                      taskActions.reopen(task);
                      showToast(`‘${task.title}’의 완료를 취소했습니다.`);
                    }}
                    label={task.title + ' 완료 취소'} />
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

      <Sheet visible={pickingDoneWindow} onClose={() => setPickingDoneWindow(false)} title="완료한 할 일 표시 기간">
        {doneWindows.map((item) => (
          <Row
            key={item.value} label={item.label}
            trailing={doneWindow === item.value ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
            onPress={() => {
              haptic.tap();
              setDoneWindow(item.value);
              setPickingDoneWindow(false);
            }} />
        ))}
        <Txt variant="small" tone="muted" style={{ marginTop: space.sm }}>
          기간이 지나도 삭제되지 않으며, 완료한 일 화면에서 언제든 확인할 수 있습니다.
        </Txt>
        <Row
          icon="check-circle" label="완료한 일 전체 보기"
          trailing={<Icon name="chevron-right" size={18} color={colors.textFaint} />}
          onPress={() => {
            setPickingDoneWindow(false);
            router.push('/completed');
          }} />
      </Sheet>

      <Sheet visible={pickingSort} onClose={() => setPickingSort(false)} title="정렬 기준">
        {(['manual', 'smart', 'schedule', 'priority', 'title'] as SortMode[]).map((option) => (
          <Row
            key={option}
            icon={option === 'manual' ? 'menu' : option === 'smart' ? 'zap' : option === 'schedule' ? 'calendar' : option === 'priority' ? 'flag' : 'type'}
            label={sortLabels[option]}
            detail={option === 'manual'
              ? (effectiveScope === 'all' ? '목록별로 묶어 표시' : '길게 눌러 순서 변경')
              : option === 'smart' ? '긴급도 · 우선순위 · 진행률' : undefined}
            trailing={sort === option ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
            onPress={() => {
              haptic.tap();
              setSort(option);
              setPickingSort(false);
            }} />
        ))}
      </Sheet>

      <Sheet visible={projectMenu && !!selected} onClose={() => setProjectMenu(false)} title={selected ? '#' + selected.name : ''}>
        <Row icon="plus" label="새 섹션 추가" detail="단계·주제별로 구분" onPress={openCreateSection} />
        <Row
          icon="bookmark" label="체크리스트 템플릿 추가"
          onPress={() => {
            setProjectMenu(false);
            setShowTemplates(true);
          }} />
        <Row icon="edit-2" label="목록 편집" detail="이름 · 색상 · 아이콘" onPress={openRename} />
        <Row
          icon="trash-2" label="목록 삭제" tone="danger"
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
          icon="edit-2" label="섹션 이름 변경"
          onPress={() => {
            if (!managingSection) return;
            setSectionName(managingSection.name);
            setSectionEditor({ mode: 'rename', section: managingSection });
            setManagingSection(null);
          }} />
        <Row
          icon="trash-2" label="섹션 삭제" detail="할 일은 유지됩니다" tone="danger"
          onPress={() => {
            if (!managingSection) return;
            const removed = managingSection.name;
            sectionActions.remove(managingSection.id);
            setManagingSection(null);
            showToast(`‘${removed}’ 섹션을 삭제했습니다.`);
          }} />
      </Sheet>

      <Sheet visible={!!sectionEditor} onClose={() => setSectionEditor(null)} title={sectionEditor?.mode === 'rename' ? '섹션 이름 변경' : '새 섹션'}>
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

      <Sheet visible={!!editor} onClose={() => setEditor(null)} title={editor?.mode === 'rename' ? '목록 편집' : '새 목록'}>
        <View style={{ gap: space.md }}>
          <TextInput
            value={projectName} onChangeText={setProjectName} autoFocus maxLength={120}
            placeholder="예: 회사, 건강, 장보기" placeholderTextColor={colors.textFaint}
            returnKeyType="done" onSubmitEditing={saveProject} accessibilityLabel="목록 이름"
            style={[type.body, styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]} />
          <View style={{ gap: 6 }}>
            <Txt variant="caption" tone="muted">색상</Txt>
            <View style={styles.swatchRow}>
              {LIST_COLORS.map((swatch) => {
                const active = listColorEntry(projectColor)?.id === swatch.id;
                return (
                  <Pressable
                    key={swatch.id} accessibilityRole="radio" accessibilityLabel={'색상 ' + swatch.label} accessibilityState={{ selected: active }}
                    onPress={() => {
                      haptic.tap();
                      setProjectColor(swatch.stored);
                    }}
                    style={[
                      styles.swatch,
                      { backgroundColor: isDark ? swatch.dark : swatch.light, borderColor: active ? colors.text : 'transparent' },
                    ]}>
                    {active ? <Icon name="check" size={14} color={colors.background} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Txt variant="caption" tone="muted">아이콘</Txt>
            <View style={styles.iconGrid}>
              {PROJECT_ICONS.map((ic) => {
                const active = projectIcon === ic;
                return (
                  <Pressable
                    key={ic} accessibilityRole="button" accessibilityLabel={'아이콘 ' + ic}
                    onPress={() => {
                      haptic.tap();
                      setProjectIcon(ic);
                    }}
                    style={[
                      styles.iconPick,
                      {
                        borderColor: active ? colors.accent : colors.border,
                        backgroundColor: active ? colors.accentSoft : 'transparent',
                      },
                    ]}>
                    <Icon name={ic} size={17} color={active ? listColor(projectColor, isDark) ?? colors.accentText : colors.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="취소" kind="secondary" onPress={() => setEditor(null)} style={{ flex: 1 }} />
            <Button
              label={editor?.mode === 'rename' ? '저장' : '만들기'} loading={projectActions.creating}
              disabled={!projectName.trim()} onPress={saveProject} style={{ flex: 1 }} />
          </View>
        </View>
      </Sheet>

      <Sheet visible={confirmDelete && !!selected} onClose={() => setConfirmDelete(false)} title={`#${selected?.name ?? ''} 목록을 삭제할까요?`}>
        <Txt tone="muted" style={{ marginBottom: space.lg }}>
          {counts.get(selected?.id ?? null)
            ? `이 목록의 할 일 ${counts.get(selected?.id ?? null)}개도 함께 삭제됩니다. 삭제한 내용은 되돌릴 수 없습니다.`
            : '삭제한 목록은 되돌릴 수 없습니다.'}
        </Txt>
        <View style={{ gap: space.sm }}>
          <Button label="삭제" kind="danger" onPress={deleteSelected} />
          <Button label="취소" kind="secondary" onPress={() => setConfirmDelete(false)} />
        </View>
      </Sheet>

      <TaskListSheets sheets={sheets} onStartSelect={startSelect} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipStripRow: { flexDirection: 'row', alignItems: 'center' },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
  swatchRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  swatch: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  iconGrid: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  iconPick: {
    width: 38, height: 38, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
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
