import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Platform, Pressable, RefreshControl, ScrollView, type ScrollViewInstance, StyleSheet, TextInput, type TextInputInstance, View,
} from 'react-native';

import { Checkbox } from '@/components/Checkbox';
import { EmptyDone, EmptySearch, OfflineArt } from '@/components/art';
import { Button, Chip, EMPTY_ART, EmptyState, Header, Icon, IconButton, Loading, Row, Screen, SectionTitle, Sheet, Txt } from '@/components/ui';
import { queryClient } from '@/data/client';
import { keys } from '@/data/keys';
import { useProjects, useTagNames, useTaskActions, useTaskIndex } from '@/data/tasks';
import { KEY_PRIORITY, matchesCombo, useKeyboard, useKeyHandler, useListCursor, useScreenContext, useScreenFocused } from '@/features/keyboard';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { listColor } from '@/features/tasks/listColors';
import { priorityOption } from '@/features/tasks/priority';
import { useProjectMetaMap } from '@/features/tasks/projectMeta';
import { api } from '@/lib/api';
import {
  describeRecurrence, deviceTimeZone, formatDate, formatTime, logicalToday, sameInstant, Temporal, weekStart,
} from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { searchTasks } from '@/lib/search';
import type { Task } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { fontFamily, radius, space, useTheme } from '@/theme';

const PAGE = 60;
const RECURRING_LOOKBACK_DAYS = 90;

type PeriodFilter = 'all' | 'week' | 'month';
type ProjectFilter = 'all' | 'inbox' | string;

interface LogbookEntry {
  entryId: string;
  task: Task;
  completedAt: string;
  isRecurring: boolean;
}

const entryIdOf = (entry: LogbookEntry) => entry.entryId;

/** Finished tasks (including recent recurring completions), newest first, with logbook filters and detail inspection. */
export default function Completed() {
  const { colors, isDark } = useTheme();
  const isFocused = useScreenFocused();
  useScreenContext('completed', isFocused);
  const { blurActiveInput } = useKeyboard();
  const prefs = usePersonalPrefs();
  const zone = deviceTimeZone();
  const now = logicalToday(zone, prefs.dayStartHour);
  const sinceDateKey = now.subtract({ days: RECURRING_LOOKBACK_DAYS }).toString();
  const sinceIso = useMemo(
    () => Temporal.PlainDate.from(sinceDateKey).toZonedDateTime(zone).toInstant().toString(),
    [sinceDateKey, zone],
  );

  const query = useQuery({ queryKey: keys.completedTasks, queryFn: api.completedTasks, meta: { persist: false } });
  const completionsQuery = useQuery({
    queryKey: [...keys.done, 'logbook', sinceDateKey],
    queryFn: () => api.completionsSince(sinceIso),
    meta: { persist: false },
  });
  const { data: projects } = useProjects();
  const projectMeta = useProjectMetaMap();
  const tagNames = useTagNames();
  const actions = useTaskActions();
  const [shown, setShown] = useState(PAGE);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  const [pickingProject, setPickingProject] = useState(false);
  const [hideSubtasks, setHideSubtasks] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [inspecting, setInspecting] = useState<LogbookEntry | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const searchInput = useRef<TextInputInstance>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);

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

  // Merge one-off completed tasks with recurring task completion history chronologically.
  const allEntries = useMemo<LogbookEntry[]>(() => {
    const entries: LogbookEntry[] = [];
    for (const task of query.data ?? []) {
      if (!task.completed_at || removed.has(task.id)) continue;
      entries.push({ entryId: task.id, task, completedAt: task.completed_at, isRecurring: false });
    }
    const seenRecurring = new Set<string>();
    for (const completion of completionsQuery.data ?? []) {
      if (!completion.task.recurrence_rule) continue;
      const current = openById.get(completion.task.id);
      // Skip a recurring occurrence whose completion was undone (the task moved back to that slot).
      if (current && sameInstant(current.due_at, completion.occurrence_due_at)) continue;
      const dedupeKey = `${completion.task.id}|${completion.completed_at}`;
      if (seenRecurring.has(dedupeKey)) continue;
      seenRecurring.add(dedupeKey);
      entries.push({
        entryId: `rec-${dedupeKey}`,
        task: completion.task,
        completedAt: completion.completed_at,
        isRecurring: true,
      });
    }
    return entries.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  }, [query.data, completionsQuery.data, removed, openById]);

  const weekStartDate = useMemo(() => weekStart(now, prefs.startOfWeek), [now, prefs.startOfWeek]);
  const monthStartDate = useMemo(() => now.with({ day: 1 }), [now]);

  const weekDoneCount = useMemo(() => {
    const weekStartMs = weekStartDate.toZonedDateTime(zone).toInstant().epochMilliseconds;
    let count = 0;
    for (const entry of allEntries) {
      if (Date.parse(entry.completedAt) >= weekStartMs) count++;
    }
    return count;
  }, [allEntries, weekStartDate, zone]);

  const filtered = useMemo<LogbookEntry[]>(() => {
    const periodStartMs = period === 'week'
      ? weekStartDate.toZonedDateTime(zone).toInstant().epochMilliseconds
      : period === 'month'
        ? monthStartDate.toZonedDateTime(zone).toInstant().epochMilliseconds
        : 0;

    let pool = allEntries.filter((entry) => {
      if (periodStartMs > 0 && Date.parse(entry.completedAt) < periodStartMs) return false;
      if (hideSubtasks && entry.task.parent_task_id) return false;
      if (projectFilter === 'inbox' && entry.task.project_id !== null) return false;
      if (projectFilter !== 'all' && projectFilter !== 'inbox' && entry.task.project_id !== projectFilter) return false;
      return true;
    });

    if (search.trim()) {
      // Evaluate search query against each entry's task while preserving recurring entries.
      const matchedTaskIds = new Set(
        searchTasks(
          pool.map((entry) => entry.task),
          search,
          { projectNames: names, tagNames, dayStartHour: prefs.dayStartHour },
        ).map((task) => task.id),
      );
      pool = pool.filter((entry) => matchedTaskIds.has(entry.task.id));
    }
    return pool;
  }, [allEntries, period, weekStartDate, monthStartDate, zone, hideSubtasks, projectFilter, search, names, tagNames, prefs.dayStartHour]);

  const days = useMemo(() => {
    const groups = new Map<string, LogbookEntry[]>();
    for (const entry of filtered.slice(0, shown)) {
      const day = Temporal.Instant.from(entry.completedAt).toZonedDateTimeISO(zone).toPlainDate().toString();
      groups.set(day, [...(groups.get(day) ?? []), entry]);
    }
    return [...groups];
  }, [filtered, shown, zone]);

  const shownEntries = useMemo(() => days.flatMap(([, entries]) => entries), [days]);

  const anySheetOpen = !!deleting || !!inspecting || pickingProject;
  const cursor = useListCursor(shownEntries, entryIdOf, {
    enabled: isFocused && !anySheetOpen,
    scrollRef,
    estimatedRowHeight: 62,
  });

  const total = filtered.length;
  const hasAnyFilters = period !== 'all' || projectFilter !== 'all' || hideSubtasks || !!search.trim();

  const reopen = (task: Task) => {
    setRemoved((current) => new Set(current).add(task.id));
    actions.reopen(task);
    showToast(`‘${task.title}’${josa(task.title, '을/를')} 할 일로 되돌렸습니다.`);
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

  const refreshAll = async () => {
    await Promise.all([query.refetch(), completionsQuery.refetch()]);
  };

  const selectedProjectLabel = projectFilter === 'all'
    ? '목록'
    : projectFilter === 'inbox'
      ? '미분류'
      : names.get(projectFilter) ?? '목록';

  useKeyHandler(
    (event) => {
      if (matchesCombo(event, 'escape')) {
        if (event.repeat) return true;
        if (event.editing) {
          blurActiveInput();
        } else if (search) {
          setSearch('');
        } else {
          router.back();
        }
        return true;
      }
      if (event.editing) return false;

      if (matchesCombo(event, '/')) {
        searchInput.current?.focus();
        return true;
      }
      if (matchesCombo(event, 'j') || matchesCombo(event, 'arrowdown')) {
        cursor.move(1);
        return true;
      }
      if (matchesCombo(event, 'k') || matchesCombo(event, 'arrowup')) {
        cursor.move(-1);
        return true;
      }
      if (matchesCombo(event, 'enter')) {
        if (cursor.focusedItem) {
          if (!event.repeat) setInspecting(cursor.focusedItem);
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'space') || matchesCombo(event, 'x')) {
        if (cursor.focusedItem && !cursor.focusedItem.isRecurring) {
          if (!event.repeat) reopen(cursor.focusedItem.task);
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'delete')) {
        if (cursor.focusedItem && !cursor.focusedItem.isRecurring) {
          if (!event.repeat) setDeleting(cursor.focusedItem.task);
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'backspace')) {
        if (!event.repeat) router.back();
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.screen, enabled: isFocused && !anySheetOpen },
  );

  useKeyHandler(
    (event) => {
      if (event.editing) return false;
      if (matchesCombo(event, 'enter')) {
        if (!event.repeat) confirmDelete();
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: isFocused && !!deleting },
  );

  const inspectedAt = inspecting
    ? Temporal.Instant.from(inspecting.completedAt).toZonedDateTimeISO(zone)
    : null;
  const inspectedProject = inspecting?.task.project_id
    ? projects?.find((p) => p.id === inspecting.task.project_id) ?? null
    : null;
  const inspectedMeta = inspectedProject ? projectMeta[inspectedProject.id] : undefined;
  const inspectedTags = inspecting ? (tagNames.get(inspecting.task.id) ?? []) : [];
  const inspectedParent = inspecting ? parentTitles.get(inspecting.task.id) : undefined;
  const inspectedRepeat = inspecting?.isRecurring
    ? describeRecurrence(inspecting.task.recurrence_rule, inspecting.task.recurrence_mode)
    : null;

  return (
    <Screen>
      <Header
        title="완료한 일"
        left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />}
        right={allEntries.length > 0 ? (
          <View style={styles.weekStat}>
            <Icon name="check-circle" size={14} color={colors.accentText} />
            <Txt variant="smallStrong" tone="muted" tabular>이번 주 {weekDoneCount}</Txt>
          </View>
        ) : undefined} />
      {query.isPending ? <Loading /> : query.isError ? (
        <EmptyState
          icon="cloud-off" art={<OfflineArt size={EMPTY_ART} />} title="불러오지 못함"
          action={<Button label="다시 시도" kind="secondary" onPress={() => void refreshAll()} />} />
      ) : (
        <>
          {allEntries.length > 0 ? (
            <View style={{ gap: space.sm, paddingBottom: space.sm }}>
              <View style={{ paddingHorizontal: space.lg }}>
                <View style={[styles.searchField, { backgroundColor: colors.surfaceMuted }]}>
                  <Icon name="search" size={16} color={colors.textMuted} />
                  <TextInput
                    ref={searchInput}
                    value={search} onChangeText={setSearch} placeholder="검색" placeholderTextColor={colors.textFaint}
                    autoCorrect={false} returnKeyType="search" accessibilityLabel="완료한 일 검색"
                    style={[{ fontFamily, flex: 1, color: colors.text, fontSize: 15, paddingVertical: 8 }, Platform.select({ web: { outlineStyle: 'none' } as object, default: {} })]} />
                  {search ? <IconButton name="x" label="지우기" size={16} color={colors.textMuted} onPress={() => setSearch('')} style={{ width: 32, height: 32 }} /> : null}
                </View>
              </View>
              <ScrollView
                horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: space.lg, gap: 6 }}>
                <Chip label="전체" selected={period === 'all'} onPress={() => setPeriod('all')} />
                <Chip label="이번 주" selected={period === 'week'} onPress={() => setPeriod('week')} />
                <Chip label="이번 달" selected={period === 'month'} onPress={() => setPeriod('month')} />
                <Chip
                  icon={projectFilter !== 'all' && projectFilter !== 'inbox' ? (projectMeta[projectFilter]?.icon ?? 'hash') : 'folder'}
                  color={projectFilter !== 'all' && projectFilter !== 'inbox' ? listColor(projectMeta[projectFilter]?.color, isDark) : undefined}
                  label={selectedProjectLabel}
                  selected={projectFilter !== 'all'}
                  onPress={() => setPickingProject(true)} />
                <Chip
                  icon="layers" label="하위 제외" selected={hideSubtasks}
                  onPress={() => setHideSubtasks((prev) => !prev)} />
              </ScrollView>
            </View>
          ) : null}

          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: space.xxl * 2, flexGrow: 1 }}
            refreshControl={<RefreshControl refreshing={query.isRefetching || completionsQuery.isRefetching} onRefresh={() => void refreshAll()} tintColor={colors.accent} colors={[colors.accent]} />}>
            {days.length === 0 ? (
              <EmptyState
                icon={hasAnyFilters ? 'search' : 'check-circle'}
                art={hasAnyFilters ? <EmptySearch size={EMPTY_ART} /> : <EmptyDone size={EMPTY_ART} />}
                title={hasAnyFilters ? '일치하는 기록 없음' : '완료한 일 없음'}
                action={hasAnyFilters ? (
                  <Button
                    label="필터 해제" kind="secondary"
                    onPress={() => {
                      setSearch('');
                      setPeriod('all');
                      setProjectFilter('all');
                      setHideSubtasks(false);
                    }} />
                ) : undefined} />
            ) : days.map(([day, entries]) => (
              <View key={day}>
                <SectionTitle title={formatDate(Temporal.PlainDate.from(day), now)} count={entries.length} />
                {entries.map((entry) => {
                  const { task } = entry;
                  const at = Temporal.Instant.from(entry.completedAt).toZonedDateTimeISO(zone);
                  const project = task.project_id ? names.get(task.project_id) : undefined;
                  const parentTitle = parentTitles.get(task.id);
                  const focused = cursor.isFocused(entry.entryId);
                  return (
                    <View key={entry.entryId} style={[styles.row, focused && { backgroundColor: colors.accentSoft }]}>
                      {entry.isRecurring ? (
                        <View
                          accessibilityLabel={task.title + ' 반복 완료 기록'}
                          style={[styles.recurringMark, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
                          <Icon name="repeat" size={12} color={colors.textMuted} />
                        </View>
                      ) : (
                        <Checkbox checked done onPress={() => reopen(task)} label={task.title + ' 완료 취소'} />
                      )}
                      <View style={[styles.body, { borderBottomColor: colors.border }]}>
                        <Pressable
                          accessibilityRole="button" accessibilityLabel={task.title + ' 완료 상세 보기'}
                          onPress={() => {
                            haptic.tap();
                            setInspecting(entry);
                          }}
                          style={({ pressed }) => ({ flex: 1, gap: 2, opacity: pressed ? 0.6 : 1 })}>
                          <Txt tone="muted" numberOfLines={2}>{task.title}</Txt>
                          <View style={styles.metaRow}>
                            {entry.isRecurring ? <Icon name="repeat" size={11} color={colors.textFaint} /> : null}
                            <Txt variant="small" tone="faint" tabular>
                              {formatTime(at.hour * 60 + at.minute, prefs.timeFormat)
                                + (project ? ' · #' + project : '')}
                            </Txt>
                          </View>
                          {parentTitle ? (
                            <View style={styles.metaRow}>
                              <Icon name="corner-down-right" size={11} color={colors.textFaint} />
                              <Txt variant="caption" tone="faint" numberOfLines={1}>{parentTitle}</Txt>
                            </View>
                          ) : null}
                        </Pressable>
                        {!entry.isRecurring ? (
                          <IconButton
                            name="trash-2" label={task.title + ' 삭제'} size={16} color={colors.textFaint}
                            onPress={() => setDeleting(task)} style={{ width: 34, height: 34 }} />
                        ) : null}
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

      <Sheet visible={pickingProject} onClose={() => setPickingProject(false)} title="목록">
        <ScrollView style={{ maxHeight: 360 }}>
          <Row
            icon="layers" label="전체"
            trailing={projectFilter === 'all' ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
            onPress={() => {
              haptic.tap();
              setProjectFilter('all');
              setPickingProject(false);
            }} />
          <Row
            icon="inbox" label="미분류"
            trailing={projectFilter === 'inbox' ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
            onPress={() => {
              haptic.tap();
              setProjectFilter('inbox');
              setPickingProject(false);
            }} />
          {(projects ?? []).map((project) => {
            const meta = projectMeta[project.id];
            return (
              <Row
                key={project.id}
                icon={meta?.icon ?? 'hash'}
                label={project.name}
                trailing={projectFilter === project.id ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
                onPress={() => {
                  haptic.tap();
                  setProjectFilter(project.id);
                  setPickingProject(false);
                }} />
            );
          })}
        </ScrollView>
      </Sheet>

      <Sheet visible={!!inspecting} onClose={() => setInspecting(null)} title={inspecting?.isRecurring ? '반복 기록' : '완료 기록'}>
        {inspecting ? (
          <View style={{ gap: space.md }}>
            <Txt variant="bodyStrong">{inspecting.task.title}</Txt>
            <View style={{ gap: 6 }}>
              {inspectedAt ? (
                <View style={styles.detailMetaRow}>
                  <Icon name={inspecting.isRecurring ? 'repeat' : 'check-circle'} size={15} color={colors.textFaint} />
                  <Txt variant="small" tone="muted" tabular>
                    {formatDate(inspectedAt.toPlainDate(), now)} {formatTime(inspectedAt.hour * 60 + inspectedAt.minute, prefs.timeFormat)}
                  </Txt>
                </View>
              ) : null}
              <View style={styles.detailMetaRow}>
                <Icon
                  name={inspectedProject ? (inspectedMeta?.icon ?? 'hash') : 'inbox'} size={15}
                  color={inspectedProject ? (listColor(inspectedMeta?.color, isDark) ?? colors.textFaint) : colors.textFaint} />
                <Txt variant="small" tone="muted">{inspectedProject ? inspectedProject.name : '미분류'}</Txt>
              </View>
              {inspectedRepeat ? (
                <View style={styles.detailMetaRow}>
                  <Icon name="repeat" size={15} color={colors.textFaint} />
                  <Txt variant="small" tone="muted">{inspectedRepeat}</Txt>
                </View>
              ) : null}
              {inspecting.task.priority < 4 ? (
                <View style={styles.detailMetaRow}>
                  <Icon name="flag" size={15} color={colors.textFaint} />
                  <Txt variant="small" tone="muted">{priorityOption(inspecting.task.priority)}</Txt>
                </View>
              ) : null}
              {inspectedParent ? (
                <View style={styles.detailMetaRow}>
                  <Icon name="corner-down-right" size={15} color={colors.textFaint} />
                  <Txt variant="small" tone="muted" numberOfLines={1}>{inspectedParent}</Txt>
                </View>
              ) : null}
              {inspectedTags.length > 0 ? (
                <View style={styles.detailMetaRow}>
                  <Icon name="tag" size={15} color={colors.textFaint} />
                  <Txt variant="small" tone="muted">{inspectedTags.map((t) => '@' + t).join('  ')}</Txt>
                </View>
              ) : null}
            </View>
            {inspecting.task.notes?.trim() ? (
              <View style={[styles.notesBox, { backgroundColor: colors.surfaceMuted }]}>
                <Txt variant="small" tone="muted">{inspecting.task.notes.trim()}</Txt>
              </View>
            ) : null}
            {!inspecting.isRecurring ? (
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
                <Button
                  label="다시 열기" kind="secondary" icon="rotate-ccw" style={{ flex: 1 }}
                  onPress={() => {
                    const target = inspecting.task;
                    setInspecting(null);
                    reopen(target);
                  }} />
                <Button
                  label="삭제" kind="danger" icon="trash-2" style={{ flex: 1 }}
                  onPress={() => {
                    const target = inspecting.task;
                    setInspecting(null);
                    setDeleting(target);
                  }} />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
                {openById.has(inspecting.task.id) ? (
                  <Button
                    label="할 일 열기" kind="secondary" icon="external-link" style={{ flex: 1 }}
                    onPress={() => {
                      const id = inspecting.task.id;
                      setInspecting(null);
                      router.push({ pathname: '/task/[id]', params: { id } });
                    }} />
                ) : null}
                <Button label="닫기" kind="secondary" onPress={() => setInspecting(null)} style={{ flex: 1 }} />
              </View>
            )}
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={!!deleting} onClose={() => setDeleting(null)} title="기록 삭제">
        <Txt tone="muted" style={{ marginBottom: space.lg }}>
          ‘{deleting?.title}’ 기록을 삭제할까요?
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
  weekStat: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingRight: space.xs },
  searchField: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingLeft: space.md, paddingRight: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingLeft: space.lg, paddingTop: 12 },
  recurringMark: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  body: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: 12, paddingRight: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  notesBox: { borderRadius: radius.md, padding: space.md },
});
