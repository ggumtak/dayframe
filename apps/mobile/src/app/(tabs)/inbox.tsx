import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable, RefreshControl, ScrollView as PlainScroll, type ScrollViewInstance, StyleSheet, Switch, Text, type TextStyle, TextInput, View,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Checkbox } from '@/components/Checkbox';
import { EmptyList } from '@/components/art';
import {
  Button, Chip, Divider, EMPTY_ART, EmptyState, Header, Icon, IconButton, type IconName, Loading, ProgressBar, Row, Screen, Sheet, Txt,
} from '@/components/ui';
import { queryClient } from '@/data/client';
import { keys } from '@/data/keys';
import {
  byPosition, byPriority, bySchedule, byTitle, useCompletedTasks, useProjectActions, useProjects,
  useSectionActions, useSections, useSubtaskProgress, useTagNames, useTaskActions, useTaskIndex,
} from '@/data/tasks';
import {
  type HardwareKeyEvent, KEY_PRIORITY, matchesCombo, useKeyHandler, useListCursor, useScreenContext, useScreenFocused, useTaskShortcuts,
} from '@/features/keyboard';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { BatchBar } from '@/features/tasks/BatchBar';
import { LIST_COLORS, listColor, listColorEntry } from '@/features/tasks/listColors';
import { priorityMark } from '@/features/tasks/priority';
import { deleteProjectMeta, patchProjectMeta, PROJECT_COLORS, PROJECT_ICONS, setProjectMeta, useProjectMetaMap } from '@/features/tasks/projectMeta';
import { deleteSavedFilter, pinnedSavedFilters, type SavedFilter, toggleSavedFilterPin, useSavedFilters } from '@/features/tasks/savedFilters';
import { positionsFor, TaskListSheets, TaskRows, useTaskListModel } from '@/features/tasks/TaskList';
import { TemplatesSheet } from '@/features/tasks/TemplatesSheet';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { api } from '@/lib/api';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueDate, formatDate, logicalToday, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { usePersistentState } from '@/lib/persist';
import { applyQuickFilters, searchTasks } from '@/lib/search';
import type { Priority, Project, Section, Task } from '@/lib/shared';
import { bySmartRank } from '@/lib/smart';
import { useTabScrollTop } from '@/lib/tabScroll';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

type Scope = 'all' | 'inbox' | string;
type SortMode = 'manual' | 'smart' | 'schedule' | 'priority' | 'title';
type ListFilter = 'all' | 'due' | 'undated' | 'priority' | 'checklist';

const VIEW_PREFIX = 'view:';

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
const PRIORITIES: readonly Priority[] = [1, 2, 3, 4];
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
const savedFilterIcon = (icon: string): IconName => (icon.trim() ? (icon.trim() as IconName) : 'filter');

export default function Inbox() {
  const { colors, isDark } = useTheme();
  const isFocused = useScreenFocused();
  useScreenContext('inbox', isFocused);
  const prefs = usePersonalPrefs();
  const { tasks: allOpenTasks, roots, byId, isLoading, refetch } = useTaskIndex();
  const { data: projects } = useProjects();
  const projectMeta = useProjectMetaMap();
  const savedFilters = useSavedFilters();
  const { data: sections } = useSections();
  const { data: completedAll } = useCompletedTasks();
  const { progress: subtaskProgress } = useSubtaskProgress();
  const tagNames = useTagNames();
  const projectActions = useProjectActions();
  const sectionActions = useSectionActions();
  const taskActions = useTaskActions();
  const flow = useTaskFlow();
  const quickAdd = useQuickAdd();
  const { model, sheets } = useTaskListModel();

  const [scope, setScope] = usePersistentState<Scope>('dayframe-list-scope', 'inbox', isScope);
  const [sort, setSort] = usePersistentState<SortMode>('dayframe-list-sort', 'manual', isSortMode);
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [pickingSort, setPickingSort] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [savedViewMenu, setSavedViewMenu] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [checklistDoneCollapsed, setChecklistDoneCollapsed] = useState(false);
  const [doneWindow, setDoneWindow] = usePersistentState<DoneWindow>('dayframe-list-done-window', '7', isDoneWindow);
  const [pickingDoneWindow, setPickingDoneWindow] = useState(false);

  // Inbox rapid-triage sheet state.
  const [triageIds, setTriageIds] = useState<string[] | null>(null);
  const [triageIndex, setTriageIndex] = useState(0);

  const nowMs = useMinute() * 60_000;
  const nowInstant = useMemo(() => Temporal.Instant.fromEpochMilliseconds(nowMs), [nowMs]);
  const zone = deviceTimeZone();
  const nowDate = useMemo(() => logicalToday(zone, prefs.dayStartHour, nowInstant), [zone, prefs.dayStartHour, nowInstant]);
  const todayKey = nowDate.toString();

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

  // Pinned projects sort first in the chip strip and "All" grouping; within each group, follow server position.
  const orderedProjects = useMemo(() => {
    const list = [...(projects ?? [])];
    return list.sort((a, b) => {
      const aPinned = projectMeta[a.id]?.pinned ? 1 : 0;
      const bPinned = projectMeta[b.id]?.pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return a.position - b.position || a.name.localeCompare(b.name, 'ko');
    });
  }, [projects, projectMeta]);

  const pinnedViews = useMemo(() => pinnedSavedFilters(savedFilters), [savedFilters]);
  const projectNames = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects]);

  const activeSavedFilter: SavedFilter | null = useMemo(() => {
    if (!scope.startsWith(VIEW_PREFIX)) return null;
    const id = scope.slice(VIEW_PREFIX.length);
    return savedFilters.find((f) => f.id === id) ?? null;
  }, [scope, savedFilters]);

  const selected = scope !== 'all' && scope !== 'inbox' && !activeSavedFilter
    ? orderedProjects.find((project) => project.id === scope) ?? null
    : null;
  const effectiveScope: Scope = scope === 'all'
    ? 'all'
    : activeSavedFilter
      ? VIEW_PREFIX + activeSavedFilter.id
      : selected
        ? selected.id
        : 'inbox';
  const selectedMeta = selected ? projectMeta[selected.id] : undefined;
  const isChecklistProject = !!selected && !!selectedMeta?.checklistMode;

  useScreenDefaults({ projectId: selected?.id ?? null });

  const projectSections = useMemo(
    () => (selected ? (sections ?? []).filter((s) => s.project_id === selected.id).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'ko')) : []),
    [selected, sections],
  );
  const hasSections = !!selected && projectSections.length > 0;
  const canSortManually = effectiveScope !== 'all' && !activeSavedFilter && sort === 'manual' && listFilter === 'all' && !selectedIds;

  const sortTasks = useCallback((list: Task[]) => {
    const copy = [...list];
    if (sort === 'smart') return copy.sort((a, b) => bySmartRank(a, b, { nowMs, subtaskProgress }));
    if (sort === 'priority') return copy.sort(byPriority);
    if (sort === 'title') return copy.sort(byTitle);
    if (sort === 'schedule' || ((effectiveScope === 'all' || !!activeSavedFilter) && sort === 'manual')) return copy.sort(bySchedule);
    return copy.sort(byPosition);
  }, [sort, effectiveScope, activeSavedFilter, nowMs, subtaskProgress]);

  const scopeRoots = useMemo(() => {
    if (activeSavedFilter) {
      const filterCtx = { subtaskProgress, nowMs, dayStartHour: prefs.dayStartHour };
      const pool = activeSavedFilter.quickFilters.length > 0
        ? applyQuickFilters(allOpenTasks, activeSavedFilter.quickFilters, filterCtx)
        : allOpenTasks;
      if (activeSavedFilter.query.trim()) {
        return searchTasks(pool, activeSavedFilter.query, {
          projectNames, tagNames, subtaskProgress, nowMs, dayStartHour: prefs.dayStartHour,
        });
      }
      return pool;
    }
    if (effectiveScope === 'all') return roots;
    return roots.filter((task) => task.project_id === (selected?.id ?? null));
  }, [
    activeSavedFilter, allOpenTasks, roots, effectiveScope, selected?.id,
    subtaskProgress, nowMs, prefs.dayStartHour, projectNames, tagNames,
  ]);

  const tasks = useMemo(() => {
    const narrowed = listFilter === 'all' ? scopeRoots : scopeRoots.filter((task) => {
      if (listFilter === 'due') {
        const d = dueDate(task);
        if (!d) return false;
        return Temporal.PlainDate.compare(d, logicalToday(task.timezone, prefs.dayStartHour, nowInstant)) <= 0;
      }
      if (listFilter === 'undated') return !task.due_at;
      if (listFilter === 'priority') return task.priority < 4;
      return (subtaskProgress.get(task.id)?.total ?? 0) > 0;
    });
    return sortTasks(narrowed);
  }, [scopeRoots, listFilter, prefs.dayStartHour, nowInstant, subtaskProgress, sortTasks]);

  // Group All Tasks ('all') by project when sorted manually so every project reads cleanly with its own heading and + button.
  const allProjectGroups = useMemo(() => {
    if (effectiveScope !== 'all' || sort !== 'manual') return null;
    const known = new Set(orderedProjects.map((p) => p.id));
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
    for (const project of orderedProjects) {
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
  }, [effectiveScope, sort, tasks, orderedProjects, projectMeta]);

  // All completed root tasks in the currently selected project (used for progress bar & checklist reset).
  const projectCompletedRoots = useMemo(() => {
    if (!selected) return [];
    return (completedAll ?? [])
      .filter((task) => !task.parent_task_id && task.project_id === selected.id)
      .sort((a, b) => Date.parse(b.completed_at ?? '') - Date.parse(a.completed_at ?? ''));
  }, [completedAll, selected]);

  const completedInScope = useMemo(() => {
    if (activeSavedFilter) {
      if (!activeSavedFilter.includeCompleted) return [];
      const filterCtx = { subtaskProgress, nowMs, dayStartHour: prefs.dayStartHour };
      const pool = activeSavedFilter.quickFilters.length > 0
        ? applyQuickFilters(completedAll ?? [], activeSavedFilter.quickFilters, filterCtx)
        : (completedAll ?? []);
      if (activeSavedFilter.query.trim()) {
        return searchTasks(pool, activeSavedFilter.query, {
          projectNames, tagNames, subtaskProgress, nowMs, dayStartHour: prefs.dayStartHour,
        }).slice(0, 50);
      }
      return [...pool]
        .sort((a, b) => Date.parse(b.completed_at ?? '') - Date.parse(a.completed_at ?? ''))
        .slice(0, 50);
    }
    if (isChecklistProject) {
      return projectCompletedRoots;
    }
    const targetProjectId = selected?.id ?? null;
    const days = doneWindow === 'all' ? null : doneWindow === 'today' ? 1 : Number(doneWindow);
    const since = days === null ? 0
      : Temporal.PlainDate.from(todayKey).subtract({ days: days - 1 }).toZonedDateTime(zone).epochMilliseconds;
    return (completedAll ?? [])
      .filter((task) => !task.parent_task_id
        && (effectiveScope === 'all' || task.project_id === targetProjectId)
        && Date.parse(task.completed_at ?? '') >= since)
      .sort((a, b) => Date.parse(b.completed_at ?? '') - Date.parse(a.completed_at ?? ''))
      .slice(0, 50);
  }, [
    activeSavedFilter, isChecklistProject, projectCompletedRoots, completedAll, effectiveScope, selected,
    doneWindow, todayKey, zone, subtaskProgress, nowMs, prefs.dayStartHour, projectNames, tagNames,
  ]);
  const doneWindowLabel = isChecklistProject ? '전체' : (doneWindows.find((item) => item.value === doneWindow)?.short ?? '');
  const completedExpanded = isChecklistProject ? !checklistDoneCollapsed : showCompleted;

  const projectProgress = useMemo(() => {
    if (!selected || selectedMeta?.showProgress === false) return null;
    const done = projectCompletedRoots.length;
    if (done === 0) return null;
    const total = scopeRoots.length + done;
    if (total === 0) return null;
    return { done, total, pct: Math.round((done / total) * 100) };
  }, [selected, selectedMeta?.showProgress, projectCompletedRoots.length, scopeRoots.length]);

  const counts = useMemo(() => {
    const map = new Map<string | null, number>();
    for (const task of roots) map.set(task.project_id, (map.get(task.project_id) ?? 0) + 1);
    return map;
  }, [roots]);

  const selectedTasks = useMemo(
    () => (selectedIds ? tasks.filter((t) => selectedIds.has(t.id)) : []),
    [selectedIds, tasks],
  );

  // Memoize per-section task arrays so TaskRows never receives freshly filtered arrays on unrelated renders.
  const tasksBySection = useMemo(() => {
    const map = new Map<string, Task[]>();
    if (!hasSections) return map;
    for (const section of projectSections) map.set(section.id, []);
    for (const task of tasks) {
      if (task.section_id && map.has(task.section_id)) {
        map.get(task.section_id)!.push(task);
      }
    }
    return map;
  }, [hasSections, projectSections, tasks]);

  const unsectionedTasks = useMemo(() => {
    if (!hasSections) return tasks;
    const validIds = new Set(projectSections.map((s) => s.id));
    return tasks.filter((t) => !t.section_id || !validIds.has(t.section_id));
  }, [hasSections, tasks, projectSections]);

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
    setChecklistDoneCollapsed(false);
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
      patchProjectMeta(editor.id, { color: chosenColor, icon: chosenIcon });
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

  const samePinProjects = useMemo(() => {
    if (!selected) return [];
    const pinnedFlag = Boolean(projectMeta[selected.id]?.pinned);
    return orderedProjects.filter((p) => Boolean(projectMeta[p.id]?.pinned) === pinnedFlag);
  }, [selected, orderedProjects, projectMeta]);

  const selectedProjectGroupIndex = selected ? samePinProjects.findIndex((p) => p.id === selected.id) : -1;
  const canMoveProjectUp = selectedProjectGroupIndex > 0;
  const canMoveProjectDown = selectedProjectGroupIndex >= 0 && selectedProjectGroupIndex < samePinProjects.length - 1;

  const moveSelectedProject = async (delta: -1 | 1) => {
    if (!selected) return;
    const idx = samePinProjects.findIndex((p) => p.id === selected.id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= samePinProjects.length) return;
    const nextGroup = [...samePinProjects];
    [nextGroup[idx], nextGroup[target]] = [nextGroup[target], nextGroup[idx]];
    const updates = nextGroup
      .map((p, i) => ({ id: p.id, position: (i + 1) * 1024, prev: p.position }))
      .filter((u) => u.position !== u.prev);
    const posMap = new Map(updates.map((u) => [u.id, u.position]));
    queryClient.setQueryData<Project[]>(keys.projects, (list) =>
      list?.map((p) => (posMap.has(p.id) ? { ...p, position: posMap.get(p.id)! } : p)),
    );
    haptic.tap();
    try {
      for (const u of updates) await api.updateProject(u.id, { position: u.position });
      await queryClient.invalidateQueries({ queryKey: keys.projects });
    } catch {
      await queryClient.invalidateQueries({ queryKey: keys.projects });
      showToast('목록 순서를 변경하지 못했습니다.', { tone: 'error' });
    }
  };

  const resetProjectChecklist = () => {
    if (!selected || projectCompletedRoots.length === 0) return;
    const toReset = [...projectCompletedRoots];
    haptic.success();
    for (const task of toReset) taskActions.reopen(task);
    showToast(`체크 ${toReset.length}개를 초기화했습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => {
        for (const task of toReset) taskActions.complete(task);
      },
    });
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

  const managingSectionIndex = managingSection ? projectSections.findIndex((s) => s.id === managingSection.id) : -1;
  const canMoveSectionUp = managingSectionIndex > 0;
  const canMoveSectionDown = managingSectionIndex >= 0 && managingSectionIndex < projectSections.length - 1;

  const moveSection = async (section: Section, delta: -1 | 1) => {
    const idx = projectSections.findIndex((s) => s.id === section.id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= projectSections.length) return;
    const reordered = [...projectSections];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
    const updates = reordered
      .map((s, i) => ({ id: s.id, position: (i + 1) * 1024, prev: s.position }))
      .filter((u) => u.position !== u.prev);
    const posMap = new Map(updates.map((u) => [u.id, u.position]));
    queryClient.setQueryData<Section[]>(keys.sections, (list) =>
      list?.map((s) => (posMap.has(s.id) ? { ...s, position: posMap.get(s.id)! } : s)),
    );
    haptic.tap();
    try {
      for (const u of updates) await api.updateSection(u.id, { position: u.position });
      await queryClient.invalidateQueries({ queryKey: keys.sections });
    } catch {
      await queryClient.invalidateQueries({ queryKey: keys.sections });
      showToast('섹션 순서를 변경하지 못했습니다.', { tone: 'error' });
    }
  };

  // Inbox rapid-triage helpers.
  const openTriage = () => {
    if (scopeRoots.length === 0) return;
    haptic.tap();
    setTriageIds(scopeRoots.map((t) => t.id));
    setTriageIndex(0);
  };

  const closeTriage = () => {
    setTriageIds(null);
    setTriageIndex(0);
  };

  const triageTask = triageIds && triageIndex < triageIds.length ? byId.get(triageIds[triageIndex]) ?? null : null;
  const triageTotal = triageIds?.length ?? 0;
  const triageSaturday = useMemo(() => nowDate.add({ days: (6 - nowDate.dayOfWeek + 7) % 7 || 7 }), [nowDate]);

  const advanceTriage = useCallback(() => {
    if (!triageIds) return;
    let next = triageIndex + 1;
    while (next < triageIds.length && !byId.has(triageIds[next])) next += 1;
    if (next >= triageIds.length) {
      setTriageIds(null);
      setTriageIndex(0);
      showToast('미분류 정리를 마쳤습니다.');
    } else {
      setTriageIndex(next);
    }
  }, [triageIds, triageIndex, byId]);

  const title = effectiveScope === 'all'
    ? '전체 목록'
    : activeSavedFilter
      ? activeSavedFilter.name
      : selected?.name ?? '목록';
  const subtitle = tasks.length
    ? `${tasks.length}개 · ${canSortManually ? '길게 눌러 순서 변경' : effectiveScope === 'all' && sort === 'manual' ? '목록별' : activeSavedFilter ? '스마트 뷰' : sortLabels[sort]}`
    : activeSavedFilter
      ? '스마트 뷰'
      : undefined;

  const visibleTasks = useMemo(() => {
    if (allProjectGroups && allProjectGroups.length > 0) {
      return allProjectGroups.flatMap((group) => (!selectedIds && collapsedSections.has(group.key) ? [] : group.tasks));
    }
    if (hasSections) {
      return [
        ...unsectionedTasks,
        ...projectSections.flatMap((section) => (!selectedIds && collapsedSections.has(section.id) ? [] : (tasksBySection.get(section.id) ?? []))),
      ];
    }
    return tasks;
  }, [allProjectGroups, collapsedSections, hasSections, projectSections, selectedIds, tasks, tasksBySection, unsectionedTasks]);

  const scopeOrder = useMemo<Scope[]>(
    () => ['all', 'inbox', ...orderedProjects.map((p) => p.id), ...pinnedViews.map((v) => VIEW_PREFIX + v.id)],
    [orderedProjects, pinnedViews],
  );

  const anySheetOpen = pickingSort || projectMenu || savedViewMenu || showTemplates || pickingDoneWindow
    || !!editor || !!sectionEditor || !!managingSection || confirmDelete || !!triageIds
    || !!sheets.scheduling || !!sheets.menu;

  const cursor = useListCursor(visibleTasks, taskIdOf, {
    enabled: isFocused && !anySheetOpen,
    scrollRef,
    estimatedRowHeight: 64,
    headerOffset: 100,
  });

  const reorderTask = useCallback((task: Task, delta: -1 | 1) => {
    const list = hasSections
      ? (task.section_id && tasksBySection.has(task.section_id)
        ? (tasksBySection.get(task.section_id) ?? [])
        : unsectionedTasks)
      : tasks;
    const idx = list.findIndex((t) => t.id === task.id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const ordered = [...list];
    [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
    model.reorder(positionsFor(ordered, task));
    haptic.tap();
  }, [hasSections, model, tasks, tasksBySection, unsectionedTasks]);

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

  const triageDueDate = triageTask ? dueDate(triageTask) : null;

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
            ) : activeSavedFilter ? (
              <IconButton name="more-horizontal" label="스마트 뷰 관리" onPress={() => setSavedViewMenu(true)} color={colors.textMuted} />
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
          {orderedProjects.map((project) => {
            const meta = projectMeta[project.id];
            const isSelected = selected?.id === project.id;
            const label = project.name + (counts.get(project.id) ? ' ' + counts.get(project.id) : '');
            return (
              <View key={project.id} style={styles.projectChipWrap}>
                <Chip
                  icon={meta?.icon ?? 'hash'}
                  color={listColor(meta?.color, isDark)}
                  label={meta?.pinned ? '· ' + label : label}
                  selected={isSelected}
                  onPress={() => selectScope(project.id)} />
              </View>
            );
          })}
          {pinnedViews.map((view) => {
            const viewScope = VIEW_PREFIX + view.id;
            return (
              <Chip
                key={view.id}
                icon={savedFilterIcon(view.icon)}
                label={view.name}
                selected={effectiveScope === viewScope}
                onPress={() => selectScope(viewScope)} />
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

      {projectProgress ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressHeader}>
            <Txt variant="caption" tone="muted" tabular>
              완료 {projectProgress.done} / 전체 {projectProgress.total} · {projectProgress.pct}%
            </Txt>
            {isChecklistProject ? (
              <Txt variant="caption" tone="faint">체크리스트</Txt>
            ) : null}
          </View>
          <ProgressBar value={projectProgress.done / projectProgress.total} height={4} />
        </View>
      ) : null}

      {!selectedIds && effectiveScope === 'inbox' && scopeRoots.length >= 2 ? (
        <Pressable
          accessibilityRole="button" accessibilityLabel={`미분류 ${scopeRoots.length}개 빠르게 정리`}
          onPress={openTriage}
          style={({ pressed }) => [
            styles.triageBanner,
            { backgroundColor: colors.surfaceMuted, borderColor: colors.border, opacity: pressed ? 0.72 : 1 },
          ]}>
          <Icon name="zap" size={15} color={colors.accentText} />
          <Txt variant="smallStrong" tabular style={{ flex: 1 }}>미분류 {scopeRoots.length}개 빠르게 정리</Txt>
          <Txt variant="smallStrong" tone="accent">시작</Txt>
          <Icon name="chevron-right" size={15} color={colors.accentText} />
        </Pressable>
      ) : null}

      {scopeRoots.length > 0 || listFilter !== 'all' ? (
        <PlainScroll
          horizontal showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{ paddingHorizontal: space.lg, gap: 6, paddingTop: 2, paddingBottom: space.sm, alignItems: 'center' }}>
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
                      <Txt variant="small" tone="faint" tabular>{group.tasks.length}</Txt>
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
                const sectionTasks = tasksBySection.get(section.id) ?? [];
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
                        <Txt variant="small" tone="faint" tabular>{sectionTasks.length}</Txt>
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
          ) : isChecklistProject && projectCompletedRoots.length > 0 ? (
            <View style={styles.checklistAllDone}>
              <Icon name="check-circle" size={24} color={colors.accentText} />
              <Txt variant="bodyStrong">모든 항목을 체크했습니다</Txt>
              <Txt variant="small" tone="muted">다시 사용할 때 아래 버튼으로 한 번에 초기화할 수 있습니다.</Txt>
            </View>
          ) : (
            <EmptyState
              icon={activeSavedFilter
                ? savedFilterIcon(activeSavedFilter.icon)
                : selected
                  ? (projectMeta[selected.id]?.icon ?? 'hash')
                  : effectiveScope === 'all' ? 'layers' : 'inbox'}
              art={<EmptyList size={EMPTY_ART} />}
              title={activeSavedFilter
                ? `‘${activeSavedFilter.name}’에 해당하는 할 일이 없습니다`
                : selected
                  ? '아직 등록된 할 일이 없습니다'
                  : effectiveScope === 'all' ? '아직 할 일이 없습니다' : '미분류 할 일이 없습니다'}
              message={activeSavedFilter
                ? '조건에 맞는 할 일이 생기면 이곳에 자동으로 모입니다.'
                : selected
                  ? '아래 + 버튼으로 할 일을 추가하거나 템플릿으로 시작해 보세요.'
                  : effectiveScope === 'all'
                    ? '아래 + 버튼으로 새 할 일을 추가해 보세요.'
                    : '목록을 지정하지 않은 할 일이 이곳에 모입니다. 위 + 버튼으로 새 목록을 만들어 보세요.'}
              action={!activeSavedFilter ? (
                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                  <Button label="템플릿에서 추가" kind="secondary" icon="bookmark" onPress={() => setShowTemplates(true)} />
                  {selected ? <Button label="섹션 추가" kind="ghost" icon="plus" onPress={openCreateSection} /> : null}
                </View>
              ) : undefined} />
          )}

          {!selectedIds && isChecklistProject && projectCompletedRoots.length > 0 ? (
            <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
              <Button
                label={`체크 초기화 (${projectCompletedRoots.length}개)`}
                kind="secondary" icon="rotate-ccw"
                onPress={resetProjectChecklist} />
            </View>
          ) : null}

          {!selectedIds && completedInScope.length > 0 ? (
            <View style={{ marginTop: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={`완료한 할 일 ${completedInScope.length}개 ${completedExpanded ? '접기' : '펼치기'}`}
                  onPress={() => {
                    if (isChecklistProject) setChecklistDoneCollapsed((c) => !c);
                    else setShowCompleted((open) => !open);
                  }}
                  style={({ pressed }) => [styles.completedToggle, { flex: 1, opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name={completedExpanded ? 'chevron-down' : 'chevron-right'} size={15} color={colors.textFaint} />
                  <Txt variant="smallStrong" tone="muted" tabular>완료한 할 일 {completedInScope.length}</Txt>
                </Pressable>
                {!isChecklistProject && !activeSavedFilter ? (
                  <Pressable
                    accessibilityRole="button" accessibilityLabel={`완료한 할 일 표시 기간 ${doneWindowLabel}, 눌러서 변경`} hitSlop={10}
                    onPress={() => {
                      haptic.tap();
                      setPickingDoneWindow(true);
                    }}
                    style={({ pressed }) => ({ paddingHorizontal: space.lg, paddingVertical: space.sm, opacity: pressed ? 0.5 : 1 })}>
                    <Txt variant="caption" tone="faint">{doneWindowLabel}</Txt>
                  </Pressable>
                ) : null}
              </View>
              {completedExpanded ? completedInScope.map((task) => (
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

      <Sheet visible={!!triageIds} onClose={closeTriage} title="미분류 빠르게 정리">
        {triageTask ? (
          <View style={{ gap: space.md }}>
            <View style={{ gap: 6 }}>
              <View style={styles.progressHeader}>
                <Txt variant="caption" tone="muted" tabular>
                  {Math.min(triageIndex + 1, triageTotal)} / {triageTotal}
                </Txt>
                <Pressable hitSlop={8} onPress={advanceTriage}>
                  <Txt variant="caption" tone="muted">건너뛰기</Txt>
                </Pressable>
              </View>
              <ProgressBar value={triageTotal > 0 ? (triageIndex + 1) / triageTotal : 1} height={4} />
            </View>

            <View style={[styles.triageCard, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
              <Txt variant="bodyStrong" numberOfLines={2}>
                {triageTask.priority < 4 ? priorityMark(triageTask.priority) + ' ' : ''}{triageTask.title}
              </Txt>
              {triageTask.notes?.trim() ? (
                <Txt variant="small" tone="muted" numberOfLines={2}>{triageTask.notes.trim()}</Txt>
              ) : null}
              <Txt variant="caption" tone="faint">
                {(triageTask.project_id ? '#' + (projectNames.get(triageTask.project_id) ?? '') : '미분류')
                  + (triageDueDate ? ' · ' + formatDate(triageDueDate, nowDate) : ' · 날짜 없음')}
              </Txt>
            </View>

            <View style={{ gap: 6 }}>
              <Txt variant="caption" tone="muted">목록</Txt>
              <PlainScroll horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <Chip
                  icon="inbox" label="미분류" selected={triageTask.project_id === null}
                  onPress={() => taskActions.update(triageTask.id, { project_id: null, section_id: null })} />
                {orderedProjects.map((project) => {
                  const meta = projectMeta[project.id];
                  return (
                    <Chip
                      key={project.id}
                      icon={meta?.icon ?? 'hash'}
                      color={listColor(meta?.color, isDark)}
                      label={project.name}
                      selected={triageTask.project_id === project.id}
                      onPress={() => taskActions.update(triageTask.id, { project_id: project.id, section_id: null })} />
                  );
                })}
              </PlainScroll>
            </View>

            <View style={{ gap: 6 }}>
              <Txt variant="caption" tone="muted">언제</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Chip
                  icon="sun" label="오늘"
                  selected={!!triageDueDate && triageDueDate.equals(nowDate)}
                  onPress={() => flow.reschedule(triageTask, nowDate)} />
                <Chip
                  icon="sunrise" label="내일"
                  selected={!!triageDueDate && triageDueDate.equals(nowDate.add({ days: 1 }))}
                  onPress={() => flow.reschedule(triageTask, nowDate.add({ days: 1 }))} />
                <Chip
                  icon="coffee" label="이번 주말"
                  selected={!!triageDueDate && triageDueDate.equals(triageSaturday)}
                  onPress={() => flow.reschedule(triageTask, triageSaturday)} />
                <Chip
                  icon="slash" label="날짜 없음"
                  selected={!triageDueDate}
                  onPress={() => flow.reschedule(triageTask, null)} />
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Txt variant="caption" tone="muted">우선순위</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {PRIORITIES.map((p) => (
                  <Chip
                    key={p}
                    label={p < 4 ? `P${p} ${priorityMark(p)}` : 'P4 없음'}
                    selected={triageTask.priority === p}
                    onPress={() => taskActions.update(triageTask.id, { priority: p })} />
                ))}
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
              <Button
                label="완료" kind="secondary" icon="check" style={{ flex: 1 }}
                onPress={() => {
                  flow.complete(triageTask);
                  advanceTriage();
                }} />
              <Button
                label="삭제" kind="danger" icon="trash-2" style={{ flex: 1 }}
                onPress={() => {
                  flow.remove(triageTask);
                  advanceTriage();
                }} />
              <Button
                label={triageIndex + 1 >= triageTotal ? '마치기' : '다음'}
                icon={triageIndex + 1 >= triageTotal ? 'check-circle' : 'arrow-right'}
                style={{ flex: 1.2 }}
                onPress={advanceTriage} />
            </View>
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.lg }}>
            <Icon name="check-circle" size={28} color={colors.accentText} />
            <Txt variant="bodyStrong">미분류 정리를 마쳤습니다</Txt>
            <Button label="닫기" kind="secondary" onPress={closeTriage} style={{ alignSelf: 'stretch' }} />
          </View>
        )}
      </Sheet>

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
        <PlainScroll style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
          <Row icon="plus" label="새 섹션 추가" detail="단계·주제별로 구분" onPress={openCreateSection} />
          <Row
            icon="bookmark" label="체크리스트 템플릿 추가"
            onPress={() => {
              setProjectMenu(false);
              setShowTemplates(true);
            }} />
          <Row icon="edit-2" label="목록 편집" detail="이름 · 색상 · 아이콘" onPress={openRename} />
          <Divider style={{ marginVertical: space.xs }} />
          <Row
            icon="check-square" label="체크리스트 목록 (초기화 가능)"
            trailing={(
              <Switch
                value={!!selectedMeta?.checklistMode}
                onValueChange={(val) => {
                  if (!selected) return;
                  haptic.tap();
                  patchProjectMeta(selected.id, { checklistMode: val });
                }}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.surface} />
            )} />
          <Row
            icon="bookmark" label="상단 고정"
            trailing={(
              <Switch
                value={!!selectedMeta?.pinned}
                onValueChange={(val) => {
                  if (!selected) return;
                  haptic.tap();
                  patchProjectMeta(selected.id, { pinned: val });
                }}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.surface} />
            )} />
          <Row
            icon="bar-chart-2" label="진행률 표시"
            trailing={(
              <Switch
                value={selectedMeta?.showProgress !== false}
                onValueChange={(val) => {
                  if (!selected) return;
                  haptic.tap();
                  patchProjectMeta(selected.id, { showProgress: val });
                }}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.surface} />
            )} />
          {canMoveProjectUp || canMoveProjectDown ? <Divider style={{ marginVertical: space.xs }} /> : null}
          {canMoveProjectUp ? (
            <Row
              icon="arrow-up" label="목록 위로 이동"
              onPress={() => {
                void moveSelectedProject(-1);
              }} />
          ) : null}
          {canMoveProjectDown ? (
            <Row
              icon="arrow-down" label="목록 아래로 이동"
              onPress={() => {
                void moveSelectedProject(1);
              }} />
          ) : null}
          <Divider style={{ marginVertical: space.xs }} />
          <Row
            icon="trash-2" label="목록 삭제" tone="danger"
            onPress={() => {
              setProjectMenu(false);
              setConfirmDelete(true);
            }} />
        </PlainScroll>
      </Sheet>

      <Sheet visible={savedViewMenu && !!activeSavedFilter} onClose={() => setSavedViewMenu(false)} title={activeSavedFilter?.name ?? ''}>
        {activeSavedFilter ? (
          <>
            <Row
              icon="bookmark" label="목록 탭에서 고정 해제"
              onPress={() => {
                const target = activeSavedFilter;
                setSavedViewMenu(false);
                selectScope('inbox');
                toggleSavedFilterPin(target.id);
                showToast(`‘${target.name}’ 고정을 해제했습니다.`);
              }} />
            <Row
              icon="trash-2" label="스마트 뷰 삭제" tone="danger"
              onPress={() => {
                const target = activeSavedFilter;
                setSavedViewMenu(false);
                selectScope('inbox');
                deleteSavedFilter(target.id);
                showToast(`‘${target.name}’ 스마트 뷰를 삭제했습니다.`);
              }} />
          </>
        ) : null}
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
        {canMoveSectionUp ? (
          <Row
            icon="arrow-up" label="위로 이동"
            onPress={() => {
              if (!managingSection) return;
              void moveSection(managingSection, -1);
            }} />
        ) : null}
        {canMoveSectionDown ? (
          <Row
            icon="arrow-down" label="아래로 이동"
            onPress={() => {
              if (!managingSection) return;
              void moveSection(managingSection, 1);
            }} />
        ) : null}
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
  projectChipWrap: { flexDirection: 'row', alignItems: 'center' },
  progressWrap: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.sm, gap: 6 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  triageBanner: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginTop: space.xs, marginBottom: space.sm,
    paddingHorizontal: space.md, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
  },
  triageCard: {
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: 4,
  },
  checklistAllDone: {
    alignItems: 'center', gap: 6, paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.md,
  },
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
