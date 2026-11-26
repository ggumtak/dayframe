import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Switch, Text, TextInput,
  type TextInputInstance, type TextStyle, View,
} from 'react-native';

import { Checkbox } from '@/components/Checkbox';
import { EmptySearch } from '@/components/art';
import { Button, Chip, EMPTY_ART, EmptyState, Icon, IconButton, type IconName, Row, Screen, SectionTitle, Sheet, Txt } from '@/components/ui';
import { queryClient } from '@/data/client';
import { keys } from '@/data/keys';
import {
  bySchedule, useCompletedTasks, useProjects, useSubtaskProgress, useTagActions, useTagNames, useTags, useTaskActions, useTaskIndex,
} from '@/data/tasks';
import { KEY_PRIORITY, matchesCombo, useInputCapture, useListCursor, useScreenContext, useScreenFocused, useTaskShortcuts } from '@/features/keyboard';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { listColor } from '@/features/tasks/listColors';
import { priorityOption } from '@/features/tasks/priority';
import { useProjectMetaMap } from '@/features/tasks/projectMeta';
import { saveFilter } from '@/features/tasks/savedFilters';
import { TaskListSheets, TaskRows, useTaskListModel } from '@/features/tasks/TaskList';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, formatDate, formatTime, logicalToday, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { applyQuickFilters, matchesQuickFilter, type QuickFilterKey, searchTasks } from '@/lib/search';
import type { Tag, Task } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { fontFamily, radius, space, type, useTheme } from '@/theme';

const RECENT_KEY = 'dayframe-recent-searches-v1';
const MAX_RECENT = 10;
const taskId = (task: Task) => task.id;

const SMART_VIEW_ICONS: IconName[] = ['filter', 'star', 'flag', 'calendar', 'clock', 'zap', 'bookmark', 'inbox'];

const filterMeta: { key: QuickFilterKey; short: string; label: string; icon?: IconName }[] = [
  { key: 'overdue', short: '기한 지남', label: '기한 지난 할 일', icon: 'alert-circle' },
  { key: 'today', short: '오늘', label: '오늘 할 일', icon: 'sun' },
  { key: 'week', short: '이번 주', label: '이번 주 일정', icon: 'calendar' },
  { key: 'p1', short: '!!! 가장 높음', label: '가장 중요한 할 일' },
  { key: 'repeating', short: '반복', label: '반복 할 일', icon: 'repeat' },
  { key: 'checklist', short: '체크리스트', label: '체크리스트', icon: 'check-square' },
  { key: 'stale', short: '오래 미룬 일', label: '오래 미뤄 둔 할 일', icon: 'clock' },
  { key: 'unscheduled', short: '날짜 없음', label: '날짜 없는 할 일', icon: 'inbox' },
];

const filterLabels: Record<QuickFilterKey, string> = {
  overdue: '기한 지난 할 일',
  today: '오늘 할 일',
  week: '이번 주 일정',
  p1: '가장 중요한 할 일',
  repeating: '반복 할 일',
  checklist: '체크리스트',
  stale: '오래 미뤄 둔 할 일',
  unscheduled: '날짜 없는 할 일',
};

const filterShorts: Record<QuickFilterKey, string> = {
  overdue: '기한 지남',
  today: '오늘',
  week: '이번 주',
  p1: '가장 높음',
  repeating: '반복',
  checklist: '체크리스트',
  stale: '오래 미룬 일',
  unscheduled: '날짜 없음',
};

/**
 * Finds tasks with Korean 초성 (chosung) matching, structured `#project`, `@tag`, `p1`–`p4`, `due:*`, `has:subtasks`,
 * and `-p4`/`-#project`/`-@tag` filters, composable multi-select quick filters, saved smart views,
 * recent searches, and inspectable completed-task results.
 */
export default function Search() {
  const { colors, isDark } = useTheme();
  const isFocused = useScreenFocused();
  useScreenContext('search', isFocused);
  const prefs = usePersonalPrefs();
  const { tasks } = useTaskIndex();
  const { progress: subtaskProgress } = useSubtaskProgress();
  const { data: completedAll } = useCompletedTasks();
  const { data: projects } = useProjects();
  const projectMeta = useProjectMetaMap();
  const { data: tags } = useTags();
  const tagActions = useTagActions();
  const taskActions = useTaskActions();
  const tagNames = useTagNames();
  const { model, sheets } = useTaskListModel();

  const [query, setQuery] = useState('');
  const [quickFilters, setQuickFilters] = useState<Set<QuickFilterKey>>(() => new Set());
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [managingTag, setManagingTag] = useState<Tag | null>(null);
  const [renamingTag, setRenamingTag] = useState<Tag | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [inspectingDone, setInspectingDone] = useState<Task | null>(null);

  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewIcon, setViewIcon] = useState<IconName>('filter');
  const [viewPinned, setViewPinned] = useState(true);

  const searchInput = useRef<TextInputInstance>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) setRecent(parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT));
      })
      .catch(() => {});
  }, []);

  const recordRecent = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setRecent((prev) => {
      const next = [trimmed, ...prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const removeRecent = useCallback((target: string) => {
    haptic.tap();
    setRecent((prev) => {
      const next = prev.filter((item) => item !== target);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearRecent = () => {
    haptic.tap();
    setRecent([]);
    AsyncStorage.removeItem(RECENT_KEY).catch(() => {});
  };

  const toggleQuickFilter = useCallback((key: QuickFilterKey) => {
    setQuickFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setQuery('');
    setQuickFilters(new Set());
  }, []);

  const nowMs = useMinute() * 60_000;
  const nowInstant = useMemo(() => Temporal.Instant.fromEpochMilliseconds(nowMs), [nowMs]);
  const zone = deviceTimeZone();
  const nowDate = useMemo(() => logicalToday(zone, prefs.dayStartHour, nowInstant), [zone, prefs.dayStartHour, nowInstant]);
  const projectNames = useMemo(() => new Map((projects ?? []).map((project) => [project.id, project.name])), [projects]);

  const filterList = useMemo(() => [...quickFilters], [quickFilters]);
  const active = !!query.trim() || quickFilters.size > 0;

  const filterCtx = useMemo(
    () => ({ subtaskProgress, nowMs, dayStartHour: prefs.dayStartHour }),
    [subtaskProgress, nowMs, prefs.dayStartHour],
  );
  const searchCtx = useMemo(
    () => ({ projectNames, tagNames, subtaskProgress, nowMs, dayStartHour: prefs.dayStartHour }),
    [projectNames, tagNames, subtaskProgress, nowMs, prefs.dayStartHour],
  );

  const results = useMemo(() => {
    if (!active) return [];
    const pool = quickFilters.size > 0 ? applyQuickFilters(tasks, quickFilters, filterCtx) : tasks;
    if (query.trim()) return searchTasks(pool, query, searchCtx);
    return [...pool].sort(bySchedule);
  }, [active, query, quickFilters, tasks, filterCtx, searchCtx]);

  const completedResults = useMemo(() => {
    if (!includeCompleted || !active) return [];
    const pool = quickFilters.size > 0 ? applyQuickFilters(completedAll ?? [], quickFilters, filterCtx) : (completedAll ?? []);
    if (query.trim()) return searchTasks(pool, query, searchCtx).slice(0, 30);
    return [...pool]
      .sort((a, b) => Date.parse(b.completed_at ?? '') - Date.parse(a.completed_at ?? ''))
      .slice(0, 30);
  }, [includeCompleted, active, quickFilters, completedAll, filterCtx, query, searchCtx]);

  const counts = useMemo(() => {
    const map: Record<QuickFilterKey, number> = {
      overdue: 0, today: 0, week: 0, p1: 0, repeating: 0, checklist: 0, stale: 0, unscheduled: 0,
    };
    for (const task of tasks) {
      for (const item of filterMeta) {
        if (matchesQuickFilter(task, item.key, filterCtx)) map[item.key]++;
      }
    }
    return map;
  }, [tasks, filterCtx]);

  // Wrap row open so tapping any result records the typed query in recent searches.
  const searchModel = useMemo(() => ({
    ...model,
    open: (task: Task) => {
      if (query.trim()) recordRecent(query);
      model.open(task);
    },
  }), [model, query, recordRecent]);

  const activeTitle = useMemo(() => {
    if (filterList.length === 0) return '할 일';
    if (filterList.length === 1) return filterLabels[filterList[0]];
    return filterList.map((k) => filterShorts[k]).join(' · ');
  }, [filterList]);

  const openSaveSmartView = () => {
    const suggested = query.trim()
      ? (filterList.length ? `${filterList.map((k) => filterShorts[k]).join(' · ')} (${query.trim()})` : query.trim())
      : filterList.map((k) => filterShorts[k]).join(' · ');
    const defaultIcon: IconName = filterList.length === 1
      ? (filterMeta.find((item) => item.key === filterList[0])?.icon ?? 'flag')
      : 'filter';
    setViewName(suggested.slice(0, 40));
    setViewIcon(SMART_VIEW_ICONS.includes(defaultIcon) ? defaultIcon : 'filter');
    setViewPinned(true);
    setSavingView(true);
  };

  const confirmSaveSmartView = () => {
    const trimmed = viewName.trim();
    if (!trimmed) return;
    haptic.success();
    saveFilter({
      name: trimmed,
      icon: viewIcon,
      query: query.trim(),
      quickFilters: filterList,
      includeCompleted,
      pinned: viewPinned,
    });
    setSavingView(false);
    showToast(viewPinned ? `‘${trimmed}’ 스마트 뷰를 목록 탭에 고정했습니다.` : `‘${trimmed}’ 스마트 뷰를 저장했습니다.`);
  };

  const saveTagRename = () => {
    const trimmed = tagInput.trim().replace(/^@/, '');
    if (!trimmed || !renamingTag) return;
    const duplicate = (tags ?? []).some((item) => item.id !== renamingTag.id && item.name.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
      showToast('같은 이름의 태그가 이미 있습니다.', { tone: 'error' });
      return;
    }
    haptic.success();
    tagActions.rename(renamingTag.id, trimmed);
    showToast(`태그 이름을 @${trimmed}${josa(trimmed, '으로/로')} 바꿨습니다.`);
    setRenamingTag(null);
  };

  const anySheetOpen = !!managingTag || !!renamingTag || !!sheets.scheduling || !!sheets.menu || savingView || !!inspectingDone;
  const shortcutsEnabled = isFocused && !anySheetOpen;
  useInputCapture({ arrows: true, enabled: shortcutsEnabled && results.length > 0 });
  const cursor = useListCursor(results, taskId, {
    enabled: shortcutsEnabled,
    scrollRef,
    estimatedRowHeight: 64,
  });

  useTaskShortcuts(cursor, {
    enabled: shortcutsEnabled,
    priority: KEY_PRIORITY.screen,
    onSchedule: sheets.setScheduling,
    onOpenMenu: sheets.setMenu,
    onToggleSubtasks: model.toggleSubtasks,
    onAddSubtask: model.addSubtask,
    onBefore: (event) => {
      if (matchesCombo(event, 'arrowdown') || matchesCombo(event, 'ctrl+j')) {
        if (results.length > 0) {
          cursor.move(1);
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'arrowup')) {
        if (results.length > 0) {
          if (cursor.focusedIndex <= 0) {
            cursor.clear();
            searchInput.current?.focus();
          } else {
            cursor.move(-1);
          }
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'enter') || matchesCombo(event, 'mod+enter')) {
        if (cursor.focusedItem) {
          if (!event.repeat) {
            recordRecent(query);
            router.push({ pathname: '/task/[id]', params: { id: cursor.focusedItem.id } });
          }
          return true;
        }
        if (!event.editing && results.length > 0) {
          if (!event.repeat) {
            recordRecent(query);
            router.push({ pathname: '/task/[id]', params: { id: results[0].id } });
          }
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'alt+c')) {
        if (active) {
          if (!event.repeat) setIncludeCompleted((prev) => !prev);
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'escape')) {
        if (event.repeat) return true;
        if (cursor.focusedId) {
          cursor.clear();
          searchInput.current?.focus();
          return true;
        }
        if (active) {
          clearAllFilters();
          return true;
        }
        router.back();
        return true;
      }
      if (!event.editing && matchesCombo(event, '/')) {
        searchInput.current?.focus();
        return true;
      }
      return false;
    },
  });

  const inspectedAt = inspectingDone?.completed_at
    ? Temporal.Instant.from(inspectingDone.completed_at).toZonedDateTimeISO(zone)
    : null;
  const inspectedProject = inspectingDone?.project_id ? projects?.find((p) => p.id === inspectingDone.project_id) ?? null : null;
  const inspectedMeta = inspectedProject ? projectMeta[inspectedProject.id] : undefined;
  const inspectedTags = inspectingDone ? (tagNames.get(inspectingDone.id) ?? []) : [];

  return (
    <Screen>
      <View style={styles.bar}>
        <IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />
        <View style={[styles.field, { backgroundColor: colors.surfaceMuted }]}>
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput
            ref={searchInput}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => {
              recordRecent(query);
              if (cursor.focusedItem) {
                router.push({ pathname: '/task/[id]', params: { id: cursor.focusedItem.id } });
              }
            }}
            autoFocus
            placeholder={filterList.length > 0 ? `${activeTitle}에서 검색` : '제목, 초성(ㅈㅂㄱ), #목록, @태그, due:today, -p4'}
            accessibilityLabel="검색어"
            placeholderTextColor={colors.textFaint} returnKeyType="search" autoCorrect={false}
            style={[{ fontFamily, flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 }, Platform.select({ web: { outlineStyle: 'none' } as object, default: {} })]} />
          {active ? (
            <IconButton
              name="x" label="지우기" size={18} color={colors.textMuted}
              onPress={clearAllFilters} />
          ) : null}
        </View>
      </View>

      {active ? (
        <View style={{ gap: 6, paddingBottom: space.sm }}>
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: space.lg, gap: 6 }}>
            {filterMeta.map((item) => {
              const selected = quickFilters.has(item.key);
              if (item.key === 'stale' && !selected && counts.stale === 0) return null;
              return (
                <Chip
                  key={item.key}
                  icon={item.icon}
                  label={selected ? `${item.short} ×` : item.short}
                  selected={selected}
                  tone={!selected && item.key === 'overdue' && counts.overdue > 0 ? 'danger' : undefined}
                  onPress={() => toggleQuickFilter(item.key)} />
              );
            })}
          </ScrollView>
          <View style={{ paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            <Chip
              icon="check-circle" label="완료한 일 포함" selected={includeCompleted}
              onPress={() => setIncludeCompleted((prev) => !prev)} />
            <Chip
              icon="bookmark" label="스마트 뷰 저장"
              onPress={openSaveSmartView} />
          </View>
        </View>
      ) : null}

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.xxl * 2, flexGrow: 1 }}>
          {!active ? (
            <View style={{ padding: space.lg, gap: space.lg }}>
              {recent.length > 0 ? (
                <View style={{ gap: space.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Txt variant="section" tone="muted">최근 검색</Txt>
                    <Pressable hitSlop={8} onPress={clearRecent}>
                      <Txt variant="caption" tone="faint">모두 지우기</Txt>
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {recent.map((item) => (
                      <View key={item} style={[styles.recentChip, { borderColor: colors.border }]}>
                        <Pressable
                          accessibilityRole="button" accessibilityLabel={`최근 검색 ${item}`}
                          onPress={() => {
                            haptic.tap();
                            setQuery(item);
                          }}
                          style={({ pressed }) => [styles.recentMain, { opacity: pressed ? 0.6 : 1 }]}>
                          <Icon name="clock" size={13} color={colors.textFaint} />
                          <Txt variant="smallStrong" tone="muted" numberOfLines={1}>{item}</Txt>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button" accessibilityLabel={`${item} 최근 검색 삭제`} hitSlop={6}
                          onPress={() => removeRecent(item)}
                          style={({ pressed }) => [styles.recentRemove, { opacity: pressed ? 0.5 : 1 }]}>
                          <Icon name="x" size={13} color={colors.textFaint} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={{ gap: space.sm }}>
                <Txt variant="section" tone="muted">빠른 필터</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {filterMeta.map((item) => {
                    const count = counts[item.key];
                    if (item.key === 'stale' && count === 0) return null;
                    return (
                      <Chip
                        key={item.key}
                        icon={item.icon}
                        label={`${item.short}${count ? ' ' + count : ''}`}
                        tone={item.key === 'overdue' && count > 0 ? 'danger' : undefined}
                        onPress={() => toggleQuickFilter(item.key)} />
                    );
                  })}
                </View>
              </View>

              {projects?.length ? (
                <View style={{ gap: space.sm }}>
                  <Txt variant="section" tone="muted">목록별 보기</Txt>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {projects.map((project) => {
                      const meta = projectMeta[project.id];
                      return (
                        <Chip
                          key={project.id}
                          icon={meta?.icon ?? 'hash'}
                          color={listColor(meta?.color, isDark)}
                          label={project.name}
                          onPress={() => {
                            const q = '#' + project.name + ' ';
                            setQuery(q);
                            recordRecent('#' + project.name);
                          }} />
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {tags?.length ? (
                <View style={{ gap: space.sm }}>
                  <Txt variant="section" tone="muted">태그별 보기</Txt>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {tags.map((tag) => (
                      <Pressable
                        key={tag.id} accessibilityRole="button" accessibilityLabel={`@${tag.name} 태그 검색`}
                        onPress={() => {
                          haptic.tap();
                          setQuery('@' + tag.name);
                          recordRecent('@' + tag.name);
                        }}
                        onLongPress={() => {
                          haptic.medium();
                          setManagingTag(tag);
                        }}
                        style={({ pressed }) => [styles.tagChip, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
                        <Icon name="tag" size={13} color={colors.textFaint} />
                        <Txt variant="smallStrong">{tag.name}</Txt>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button" accessibilityLabel="완료한 일 보기" onPress={() => router.push('/completed')}
                style={({ pressed }) => [styles.link, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
                <Icon name="check-circle" size={18} color={colors.textMuted} />
                <Txt style={{ flex: 1 }}>완료한 일 전체 보기</Txt>
                <Icon name="chevron-right" size={18} color={colors.textFaint} />
              </Pressable>
            </View>
          ) : results.length > 0 || completedResults.length > 0 ? (
            <>
              {results.length > 0 ? (
                <>
                  <SectionTitle title={activeTitle} count={results.length} />
                  <TaskRows model={searchModel} tasks={results} focusedTaskId={cursor.focusedId} />
                </>
              ) : null}
              {completedResults.length > 0 ? (
                <>
                  <SectionTitle title="완료한 일" count={completedResults.length} />
                  {completedResults.map((task) => {
                    const doneDay = task.completed_at
                      ? formatDate(Temporal.Instant.from(task.completed_at).toZonedDateTimeISO(zone).toPlainDate(), nowDate)
                      : '';
                    return (
                      <View key={task.id} style={styles.completedRow}>
                        <Checkbox
                          checked done size={20}
                          onPress={() => {
                            haptic.tap();
                            taskActions.reopen(task);
                            showToast(`‘${task.title}’${josa(task.title, '을/를')} 할 일로 되돌렸습니다.`);
                          }}
                          label={task.title + ' 완료 취소'} />
                        <Pressable
                          accessibilityRole="button" accessibilityLabel={`${task.title} 완료 상세 보기`}
                          onPress={() => {
                            haptic.tap();
                            if (query.trim()) recordRecent(query);
                            setInspectingDone(task);
                          }}
                          style={({ pressed }) => [styles.completedBody, { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
                          <Text numberOfLines={1} style={[type.body as TextStyle, { color: colors.textFaint, textDecorationLine: 'line-through', flex: 1 }]}>
                            {task.title}
                          </Text>
                          <Txt variant="caption" tone="faint" tabular>{doneDay}</Txt>
                        </Pressable>
                      </View>
                    );
                  })}
                </>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon="search" art={<EmptySearch size={EMPTY_ART} />}
              title={filterList.length > 0 && !query.trim() ? `${activeTitle}${josa(activeTitle, '이/가')} 없습니다` : '검색 결과가 없습니다'}
              message={includeCompleted ? '다른 검색어나 필터로 다시 찾아보세요.' : '이미 완료한 일에 있을 수도 있습니다.'}
              action={filterList.length > 0 && !query.trim() && includeCompleted ? (
                <Button label="필터 해제" kind="secondary" onPress={() => setQuickFilters(new Set())} />
              ) : !includeCompleted ? (
                <Button label="완료한 일에서도 찾기" kind="secondary" onPress={() => setIncludeCompleted(true)} />
              ) : undefined} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet visible={savingView} onClose={() => setSavingView(false)} title="스마트 뷰로 저장">
        <View style={{ gap: space.md }}>
          <TextInput
            value={viewName} onChangeText={setViewName} autoFocus maxLength={60}
            placeholder="예: 급한 회사 일, 이번 주 체크리스트" placeholderTextColor={colors.textFaint}
            returnKeyType="done" onSubmitEditing={confirmSaveSmartView} accessibilityLabel="스마트 뷰 이름"
            style={[type.body, styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]} />
          <View style={{ gap: 6 }}>
            <Txt variant="caption" tone="muted">아이콘</Txt>
            <View style={styles.iconGrid}>
              {SMART_VIEW_ICONS.map((ic) => {
                const selected = viewIcon === ic;
                return (
                  <Pressable
                    key={ic} accessibilityRole="button" accessibilityLabel={'아이콘 ' + ic}
                    onPress={() => {
                      haptic.tap();
                      setViewIcon(ic);
                    }}
                    style={[
                      styles.iconPick,
                      {
                        borderColor: selected ? colors.accent : colors.border,
                        backgroundColor: selected ? colors.accentSoft : 'transparent',
                      },
                    ]}>
                    <Icon name={ic} size={17} color={selected ? colors.accentText : colors.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Row
            icon="bookmark" label="목록 탭에 고정" detail="목록 상단에서 바로 열기"
            trailing={(
              <Switch
                value={viewPinned} onValueChange={setViewPinned}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.surface} />
            )} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="취소" kind="secondary" onPress={() => setSavingView(false)} style={{ flex: 1 }} />
            <Button label="저장" disabled={!viewName.trim()} onPress={confirmSaveSmartView} style={{ flex: 1 }} />
          </View>
        </View>
      </Sheet>

      <Sheet visible={!!inspectingDone} onClose={() => setInspectingDone(null)} title="완료한 할 일">
        {inspectingDone ? (
          <View style={{ gap: space.md }}>
            <Txt variant="bodyStrong">{inspectingDone.title}</Txt>
            <View style={{ gap: 6 }}>
              {inspectedAt ? (
                <View style={styles.detailMetaRow}>
                  <Icon name="check-circle" size={15} color={colors.textFaint} />
                  <Txt variant="small" tone="muted" tabular>
                    {formatDate(inspectedAt.toPlainDate(), nowDate)} {formatTime(inspectedAt.hour * 60 + inspectedAt.minute, prefs.timeFormat)} 완료
                  </Txt>
                </View>
              ) : null}
              <View style={styles.detailMetaRow}>
                <Icon
                  name={inspectedProject ? (inspectedMeta?.icon ?? 'hash') : 'inbox'} size={15}
                  color={inspectedProject ? (listColor(inspectedMeta?.color, isDark) ?? colors.textFaint) : colors.textFaint} />
                <Txt variant="small" tone="muted">{inspectedProject ? inspectedProject.name : '미분류'}</Txt>
              </View>
              {inspectingDone.priority < 4 ? (
                <View style={styles.detailMetaRow}>
                  <Icon name="flag" size={15} color={colors.textFaint} />
                  <Txt variant="small" tone="muted">{priorityOption(inspectingDone.priority)}</Txt>
                </View>
              ) : null}
              {inspectedTags.length > 0 ? (
                <View style={styles.detailMetaRow}>
                  <Icon name="tag" size={15} color={colors.textFaint} />
                  <Txt variant="small" tone="muted">{inspectedTags.map((t) => '@' + t).join('  ')}</Txt>
                </View>
              ) : null}
            </View>
            {inspectingDone.notes?.trim() ? (
              <View style={[styles.notesBox, { backgroundColor: colors.surfaceMuted }]}>
                <Txt variant="small" tone="muted">{inspectingDone.notes.trim()}</Txt>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
              <Button
                label="다시 열기" kind="secondary" icon="rotate-ccw" style={{ flex: 1 }}
                onPress={() => {
                  const target = inspectingDone;
                  setInspectingDone(null);
                  taskActions.reopen(target);
                  showToast(`‘${target.title}’${josa(target.title, '을/를')} 할 일로 되돌렸습니다.`);
                }} />
              <Button
                label="삭제" kind="danger" icon="trash-2" style={{ flex: 1 }}
                onPress={() => {
                  const target = inspectingDone;
                  setInspectingDone(null);
                  queryClient.setQueryData<Task[]>(keys.completedTasks, (list) => list?.filter((item) => item.id !== target.id));
                  taskActions.remove(target.id);
                  showToast('완료 기록을 삭제했습니다.');
                }} />
            </View>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={!!managingTag} onClose={() => setManagingTag(null)} title={managingTag ? '@' + managingTag.name : ''}>
        <Row
          icon="edit-2" label="태그 이름 바꾸기"
          onPress={() => {
            if (!managingTag) return;
            setTagInput(managingTag.name);
            setRenamingTag(managingTag);
            setManagingTag(null);
          }} />
        <Row
          icon="trash-2" label="태그 삭제" tone="danger" detail="할 일은 그대로 남습니다"
          onPress={() => {
            if (!managingTag) return;
            const removed = managingTag.name;
            tagActions.remove(managingTag.id);
            setManagingTag(null);
            showToast(`@${removed} 태그를 삭제했습니다.`);
          }} />
      </Sheet>

      <Sheet visible={!!renamingTag} onClose={() => setRenamingTag(null)} title="태그 이름 바꾸기">
        <View style={{ gap: space.md }}>
          <TextInput
            value={tagInput} onChangeText={setTagInput} autoFocus maxLength={120}
            placeholder="새 태그 이름" placeholderTextColor={colors.textFaint}
            returnKeyType="done" onSubmitEditing={saveTagRename} accessibilityLabel="새 태그 이름"
            style={[type.body, styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="취소" kind="secondary" onPress={() => setRenamingTag(null)} style={{ flex: 1 }} />
            <Button label="저장" disabled={!tagInput.trim()} onPress={saveTagRename} style={{ flex: 1 }} />
          </View>
        </View>
      </Sheet>

      <TaskListSheets sheets={sheets} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.sm },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingLeft: space.md },
  recentChip: {
    flexDirection: 'row', alignItems: 'center', borderRadius: radius.sm, borderWidth: 1, minHeight: 34, paddingLeft: 10, paddingRight: 4,
  },
  recentMain: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingRight: 4, maxWidth: 200 },
  recentRemove: { padding: 5, alignItems: 'center', justifyContent: 'center' },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 32, borderRadius: radius.sm, borderWidth: 1,
  },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderWidth: 1, borderRadius: radius.lg },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
  iconGrid: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  iconPick: {
    width: 38, height: 38, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  notesBox: { borderRadius: radius.md, padding: space.md },
  completedRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg },
  completedBody: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 11, paddingRight: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
