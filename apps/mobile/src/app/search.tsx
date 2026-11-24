import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, type TextStyle, TextInput, View } from 'react-native';

import { Checkbox } from '@/components/Checkbox';
import { EmptySearch } from '@/components/art';
import { Button, Chip, EMPTY_ART, EmptyState, Icon, IconButton, Row, Screen, SectionTitle, Sheet, Txt } from '@/components/ui';
import {
  bySchedule, useCompletedTasks, useProjects, useSubtaskProgress, useTagActions, useTagNames, useTags, useTaskActions, useTaskIndex,
} from '@/data/tasks';
import { TaskList } from '@/features/tasks/TaskList';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, dueDate, formatDate, Temporal, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { searchTasks } from '@/lib/search';
import type { Tag } from '@/lib/shared';
import { isStaleTask } from '@/lib/smart';
import { showToast } from '@/lib/toast';
import { fontFamily, radius, space, type, useTheme } from '@/theme';

type QuickFilter = null | 'overdue' | 'today' | 'week' | 'p1' | 'repeating' | 'checklist' | 'stale' | 'unscheduled';

const RECENT_KEY = 'dayframe-recent-searches-v1';

const filterLabels: Record<Exclude<QuickFilter, null>, string> = {
  overdue: '지연된 할 일',
  today: '오늘 할 일',
  week: '이번 주 예정',
  p1: '우선순위가 가장 높은 할 일',
  repeating: '반복 할 일',
  checklist: '하위 작업이 있는 체크리스트',
  stale: '14일 이상 오래된 할 일',
  unscheduled: '날짜 없는 할 일',
};

/**
 * Finds tasks with Korean 초성 (chosung) matching, structured `#project`, `@tag`, `p1`–`p4` filters,
 * combinable smart 1-tap filters, recent searches, and optional unified completed-task search.
 */
export default function Search() {
  const { colors } = useTheme();
  const { tasks } = useTaskIndex();
  const { progress: subtaskProgress } = useSubtaskProgress();
  const { data: completedAll } = useCompletedTasks();
  const { data: projects } = useProjects();
  const { data: tags } = useTags();
  const tagActions = useTagActions();
  const taskActions = useTaskActions();
  const tagNames = useTagNames();

  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [managingTag, setManagingTag] = useState<Tag | null>(null);
  const [renamingTag, setRenamingTag] = useState<Tag | null>(null);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) setRecent(parsed.filter((item): item is string => typeof item === 'string').slice(0, 6));
      })
      .catch(() => {});
  }, []);

  const recordRecent = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setRecent((prev) => {
      const next = [trimmed, ...prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, 6);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const clearRecent = () => {
    haptic.tap();
    setRecent([]);
    AsyncStorage.removeItem(RECENT_KEY).catch(() => {});
  };

  const nowMs = useMinute() * 60_000;
  const zone = deviceTimeZone();
  const nowDate = today(zone);
  const projectNames = useMemo(() => new Map((projects ?? []).map((project) => [project.id, project.name])), [projects]);

  const results = useMemo(() => {
    let pool = tasks;
    if (quickFilter) {
      const tz = deviceTimeZone();
      const todayRef = Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO(tz).toPlainDate();
      pool = tasks.filter((task) => {
        if (quickFilter === 'overdue') return dueBucket(task) === 'overdue';
        if (quickFilter === 'today') return dueBucket(task) === 'today';
        if (quickFilter === 'week') {
          const d = dueDate(task);
          if (!d) return false;
          const delta = todayRef.until(d).days;
          return delta >= 0 && delta <= 7;
        }
        if (quickFilter === 'p1') return task.priority === 1;
        if (quickFilter === 'repeating') return !!task.recurrence_rule;
        if (quickFilter === 'checklist') return (subtaskProgress.get(task.id)?.total ?? 0) > 0;
        if (quickFilter === 'stale') return isStaleTask(task, nowMs, 14);
        return !task.due_at;
      });
    }
    if (query.trim()) return searchTasks(pool, query, { projectNames, tagNames });
    if (quickFilter) return [...pool].sort(bySchedule);
    return [];
  }, [query, quickFilter, tasks, projectNames, tagNames, subtaskProgress, nowMs]);

  const completedResults = useMemo(() => {
    if (!includeCompleted || !query.trim()) return [];
    return searchTasks(completedAll ?? [], query, { projectNames, tagNames }).slice(0, 30);
  }, [includeCompleted, query, completedAll, projectNames, tagNames]);

  const active = !!query.trim() || quickFilter !== null;
  const counts = useMemo(() => {
    const tz = deviceTimeZone();
    const todayRef = Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO(tz).toPlainDate();
    let overdue = 0;
    let todayCount = 0;
    let week = 0;
    let p1 = 0;
    let repeating = 0;
    let checklist = 0;
    let stale = 0;
    let unscheduled = 0;
    for (const task of tasks) {
      const bucket = dueBucket(task);
      if (bucket === 'overdue') overdue++;
      if (bucket === 'today') todayCount++;
      const d = dueDate(task);
      if (d) {
        const delta = todayRef.until(d).days;
        if (delta >= 0 && delta <= 7) week++;
      }
      if (task.priority === 1) p1++;
      if (task.recurrence_rule) repeating++;
      if ((subtaskProgress.get(task.id)?.total ?? 0) > 0) checklist++;
      if (isStaleTask(task, nowMs, 14)) stale++;
      if (!task.due_at) unscheduled++;
    }
    return { overdue, todayCount, week, p1, repeating, checklist, stale, unscheduled };
  }, [tasks, subtaskProgress, nowMs]);

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

  return (
    <Screen>
      <View style={styles.bar}>
        <IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />
        <View style={[styles.field, { backgroundColor: colors.surfaceMuted }]}>
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => recordRecent(query)}
            autoFocus placeholder={quickFilter ? `${filterLabels[quickFilter]} 안에서 검색...` : '제목, 초성(ㅈㅂㄱ), #목록, @태그, p1'}
            accessibilityLabel="검색어"
            placeholderTextColor={colors.textFaint} returnKeyType="search" autoCorrect={false}
            style={[{ fontFamily, flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 }, Platform.select({ web: { outlineStyle: 'none' } as object, default: {} })]} />
          {active ? (
            <IconButton
              name="x" label="지우기" size={18} color={colors.textMuted}
              onPress={() => {
                setQuery('');
                setQuickFilter(null);
              }} />
          ) : null}
        </View>
      </View>

      {active ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          {quickFilter ? (
            <Chip
              icon="filter" label={filterLabels[quickFilter] + ' ×'} selected
              onPress={() => setQuickFilter(null)} />
          ) : null}
          {query.trim() ? (
            <Chip
              icon="check-circle" label="완료한 일 포함" selected={includeCompleted}
              onPress={() => setIncludeCompleted((prev) => !prev)} />
          ) : null}
          {quickFilter && !query.trim() ? (
            <Txt variant="caption" tone="faint">검색어나 #목록을 더 입력해 좁힐 수 있습니다</Txt>
          ) : null}
        </View>
      ) : null}

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.xxl * 2, flexGrow: 1 }}>
          {!active ? (
            <View style={{ padding: space.lg, gap: space.lg }}>
              {recent.length > 0 ? (
                <View style={{ gap: space.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Txt variant="section" tone="muted">최근 검색</Txt>
                    <Pressable hitSlop={8} onPress={clearRecent}>
                      <Txt variant="caption" tone="faint">지우기</Txt>
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {recent.map((item) => (
                      <Chip key={item} icon="clock" label={item} onPress={() => setQuery(item)} />
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={{ gap: space.sm }}>
                <Txt variant="section" tone="muted">빠른 필터</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  <Chip
                    icon="alert-circle" label={`지연됨${counts.overdue ? ' ' + counts.overdue : ''}`}
                    tone={counts.overdue ? 'danger' : undefined} onPress={() => setQuickFilter('overdue')} />
                  <Chip
                    icon="sun" label={`오늘${counts.todayCount ? ' ' + counts.todayCount : ''}`}
                    onPress={() => setQuickFilter('today')} />
                  <Chip
                    icon="calendar" label={`이번 주${counts.week ? ' ' + counts.week : ''}`}
                    onPress={() => setQuickFilter('week')} />
                  <Chip
                    label={`!!! 가장 높음${counts.p1 ? ' ' + counts.p1 : ''}`}
                    onPress={() => setQuickFilter('p1')} />
                  <Chip
                    icon="repeat" label={`반복${counts.repeating ? ' ' + counts.repeating : ''}`}
                    onPress={() => setQuickFilter('repeating')} />
                  <Chip
                    icon="check-square" label={`체크리스트${counts.checklist ? ' ' + counts.checklist : ''}`}
                    onPress={() => setQuickFilter('checklist')} />
                  {counts.stale > 0 ? (
                    <Chip
                      icon="clock" label={`오래됨 ${counts.stale}`}
                      onPress={() => setQuickFilter('stale')} />
                  ) : null}
                  <Chip
                    icon="inbox" label={`날짜 없음${counts.unscheduled ? ' ' + counts.unscheduled : ''}`}
                    onPress={() => setQuickFilter('unscheduled')} />
                </View>
              </View>

              {projects?.length ? (
                <View style={{ gap: space.sm }}>
                  <Txt variant="section" tone="muted">목록별 보기</Txt>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {projects.map((project) => (
                      <Chip
                        key={project.id} icon="hash" label={project.name}
                        onPress={() => {
                          const q = '#' + project.name + ' ';
                          setQuery(q);
                          recordRecent('#' + project.name);
                        }} />
                    ))}
                  </View>
                </View>
              ) : null}

              {tags?.length ? (
                <View style={{ gap: space.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Txt variant="section" tone="muted">태그별 보기</Txt>
                    <Txt variant="caption" tone="faint">길게 눌러 이름 변경·삭제</Txt>
                  </View>
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
                  <SectionTitle
                    title={quickFilter ? filterLabels[quickFilter] : '할 일'} count={results.length} />
                  <TaskList tasks={results} />
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
                            showToast(`‘${task.title}’${josa(task.title, '을/를')} 다시 열었습니다.`);
                          }}
                          label={task.title + ' 다시 열기'} />
                        <View style={[styles.completedBody, { borderBottomColor: colors.border }]}>
                          <Text numberOfLines={1} style={[type.body as TextStyle, { color: colors.textFaint, textDecorationLine: 'line-through', flex: 1 }]}>
                            {task.title}
                          </Text>
                          <Txt variant="caption" tone="faint">{doneDay}</Txt>
                        </View>
                      </View>
                    );
                  })}
                </>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon="search" art={<EmptySearch size={EMPTY_ART} />} title={quickFilter && !query.trim() ? `${filterLabels[quickFilter]}${josa(filterLabels[quickFilter], '이/가')} 없습니다` : '찾는 할 일이 없습니다'}
              message={query.trim()
                ? (includeCompleted ? '다른 검색어나 초성으로 찾아보세요.' : '위의 ‘완료한 일 포함’을 켜면 완료 기록까지 함께 찾습니다.')
                : undefined}
              action={quickFilter && !query.trim() ? (
                <Button label="필터 해제" kind="secondary" onPress={() => setQuickFilter(null)} />
              ) : query.trim() && !includeCompleted ? (
                <Button label="완료한 일에서도 찾기" kind="secondary" onPress={() => setIncludeCompleted(true)} />
              ) : undefined} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

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
          icon="trash-2" label="태그 삭제" tone="danger" detail="할 일은 남습니다"
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.sm },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingLeft: space.md },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 32, borderRadius: radius.sm, borderWidth: 1,
  },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderWidth: 1, borderRadius: radius.lg },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
  completedRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg },
  completedBody: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 11, paddingRight: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
