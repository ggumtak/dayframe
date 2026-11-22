import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, Chip, EmptyState, Icon, IconButton, Row, Screen, SectionTitle, Sheet, Txt } from '@/components/ui';
import { bySchedule, useProjects, useTagActions, useTagNames, useTags, useTaskIndex } from '@/data/tasks';
import { TaskList } from '@/features/tasks/TaskList';
import { dueBucket } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Priority, Tag } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { fontFamily, radius, space, type, useTheme } from '@/theme';

/** Lower-cased and with spaces removed, so "보고 서" still finds "보고서". */
const fold = (text: string) => text.toLowerCase().replace(/\s+/g, '');

type QuickFilter = null | 'overdue' | 'p1' | 'unscheduled';

const filterLabels: Record<Exclude<QuickFilter, null>, string> = {
  overdue: '지연된 할 일',
  p1: '우선순위 P1',
  unscheduled: '날짜 없는 할 일',
};

/** Finds open tasks by title, notes, project, tag, or priority (`p1`–`p4`), with quick 1-tap filters. */
export default function Search() {
  const { colors } = useTheme();
  const { tasks } = useTaskIndex();
  const { data: projects } = useProjects();
  const { data: tags } = useTags();
  const tagActions = useTagActions();
  const tagNames = useTagNames();
  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [managingTag, setManagingTag] = useState<Tag | null>(null);
  const [renamingTag, setRenamingTag] = useState<Tag | null>(null);
  const [tagInput, setTagInput] = useState('');

  const results = useMemo(() => {
    if (quickFilter) {
      return tasks.filter((task) => {
        if (quickFilter === 'overdue') return dueBucket(task) === 'overdue';
        if (quickFilter === 'p1') return task.priority === 1;
        return !task.due_at;
      }).sort(bySchedule);
    }
    const rawWords = query.trim().split(/\s+/).filter(Boolean);
    if (!rawWords.length) return [];
    const priorityFilter = rawWords
      .map((word) => /^p([1-4])$/i.exec(word)?.[1])
      .find((value): value is string => value !== undefined);
    const words = rawWords.filter((word) => !/^p[1-4]$/i.test(word)).map(fold);
    const projectNames = new Map((projects ?? []).map((project) => [project.id, project.name]));
    return tasks.filter((task) => {
      if (priorityFilter && task.priority !== (Number(priorityFilter) as Priority)) return false;
      if (!words.length) return true;
      const haystack = fold([task.title, task.notes ?? '', task.project_id ? projectNames.get(task.project_id) ?? '' : '',
        ...(tagNames.get(task.id) ?? [])].join(' '));
      return words.every((word) => haystack.includes(word.replace(/^[#@]/, '')));
    }).sort(bySchedule);
  }, [query, quickFilter, tasks, projects, tagNames]);

  const active = !!query.trim() || quickFilter !== null;
  const overdueCount = useMemo(() => tasks.filter((task) => dueBucket(task) === 'overdue').length, [tasks]);
  const p1Count = useMemo(() => tasks.filter((task) => task.priority === 1).length, [tasks]);
  const unscheduledCount = useMemo(() => tasks.filter((task) => !task.due_at).length, [tasks]);

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
    showToast(`태그 이름을 @${trimmed}(으)로 바꿨습니다.`);
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
            onChangeText={(next) => {
              setQuery(next);
              if (next) setQuickFilter(null);
            }}
            autoFocus placeholder="할 일, 메모, #프로젝트, @태그, p1" accessibilityLabel="검색어"
            placeholderTextColor={colors.textFaint} returnKeyType="search" autoCorrect={false}
            style={[{ fontFamily, flex: 1, color: colors.text, fontSize: 16, paddingVertical: 10 }, Platform.select({ web: { outlineStyle: 'none' } as object, default: {} })]} />
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
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.xxl * 2, flexGrow: 1 }}>
          {!active ? (
            <View style={{ padding: space.lg, gap: space.lg }}>
              <View style={{ gap: space.sm }}>
                <Txt variant="section" tone="muted">빠른 보기</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  <Chip
                    icon="alert-circle" label={`지연됨${overdueCount ? ' ' + overdueCount : ''}`}
                    color={overdueCount ? colors.danger : undefined} onPress={() => setQuickFilter('overdue')} />
                  <Chip
                    icon="flag" label={`P1 긴급${p1Count ? ' ' + p1Count : ''}`}
                    color={p1Count ? colors.danger : undefined} onPress={() => setQuickFilter('p1')} />
                  <Chip
                    icon="inbox" label={`날짜 없음${unscheduledCount ? ' ' + unscheduledCount : ''}`}
                    onPress={() => setQuickFilter('unscheduled')} />
                </View>
              </View>

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
                        }}
                        onLongPress={() => {
                          haptic.medium();
                          setManagingTag(tag);
                        }}
                        style={({ pressed }) => [styles.tagChip, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
                        <Icon name="tag" size={13} color={colors.accent} />
                        <Txt variant="smallStrong">{tag.name}</Txt>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button" accessibilityLabel="완료한 일 보기" onPress={() => router.push('/completed')}
                style={({ pressed }) => [styles.link, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
                <Icon name="check-circle" size={18} color={colors.success} />
                <Txt style={{ flex: 1 }}>완료한 일 보기</Txt>
                <Icon name="chevron-right" size={18} color={colors.textFaint} />
              </Pressable>
            </View>
          ) : results.length ? (
            <>
              <SectionTitle
                title={quickFilter ? filterLabels[quickFilter] : '검색 결과'} count={results.length}
                action={quickFilter ? (
                  <Pressable onPress={() => setQuickFilter(null)} hitSlop={8}>
                    <Txt variant="smallStrong" tone="accent">필터 해제</Txt>
                  </Pressable>
                ) : undefined} />
              <TaskList tasks={results} />
            </>
          ) : (
            <EmptyState
              icon="search" title={quickFilter ? `${filterLabels[quickFilter]}이 없습니다` : '찾는 할 일이 없습니다'}
              message={quickFilter ? undefined : '완료한 일은 ‘완료한 일 보기’에서 찾을 수 있습니다.'}
              action={quickFilter ? <Button label="필터 해제" kind="secondary" onPress={() => setQuickFilter(null)} /> : undefined} />
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
          icon="trash-2" label="태그 삭제" tone="danger" detail="할 일은 유지됩니다"
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
});
