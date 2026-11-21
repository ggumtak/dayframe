import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { EmptyState, Icon, IconButton, Screen, SectionTitle, Txt } from '@/components/ui';
import { bySchedule, useProjects, useTagNames, useTaskIndex } from '@/data/tasks';
import { TaskList } from '@/features/tasks/TaskList';
import { radius, space, useTheme } from '@/theme';

/** Lower-cased and with spaces removed, so "보고 서" still finds "보고서". */
const fold = (text: string) => text.toLowerCase().replace(/\s+/g, '');

/** Finds open tasks by title, notes, project or tag. */
export default function Search() {
  const { colors } = useTheme();
  const { tasks } = useTaskIndex();
  const { data: projects } = useProjects();
  const tagNames = useTagNames();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const words = query.trim().split(/\s+/).filter(Boolean).map(fold);
    if (!words.length) return [];
    const projectNames = new Map((projects ?? []).map((project) => [project.id, project.name]));
    return tasks.filter((task) => {
      const haystack = fold([task.title, task.notes ?? '', task.project_id ? projectNames.get(task.project_id) ?? '' : '',
        ...(tagNames.get(task.id) ?? [])].join(' '));
      return words.every((word) => haystack.includes(word.replace(/^[#@]/, '')));
    }).sort(bySchedule);
  }, [query, tasks, projects, tagNames]);

  return (
    <Screen>
      <View style={styles.bar}>
        <IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />
        <View style={[styles.field, { backgroundColor: colors.surfaceMuted }]}>
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query} onChangeText={setQuery} autoFocus placeholder="할 일, 메모, #프로젝트, @태그" accessibilityLabel="검색어"
            placeholderTextColor={colors.textFaint} returnKeyType="search" autoCorrect={false}
            style={[{ flex: 1, color: colors.text, fontSize: 16, paddingVertical: 10 }, Platform.select({ web: { outlineStyle: 'none' } as object, default: {} })]} />
          {query ? <IconButton name="x" label="지우기" size={18} color={colors.textMuted} onPress={() => setQuery('')} /> : null}
        </View>
      </View>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.xxl * 2, flexGrow: 1 }}>
          {!query.trim() ? (
            <Pressable
              accessibilityRole="button" accessibilityLabel="완료한 일 보기" onPress={() => router.push('/completed')}
              style={({ pressed }) => [styles.link, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
              <Icon name="check-circle" size={18} color={colors.success} />
              <Txt style={{ flex: 1 }}>완료한 일 보기</Txt>
              <Icon name="chevron-right" size={18} color={colors.textFaint} />
            </Pressable>
          ) : results.length ? (
            <>
              <SectionTitle title="검색 결과" count={results.length} />
              <TaskList tasks={results} />
            </>
          ) : (
            <EmptyState icon="search" title="찾는 할 일이 없습니다" message="완료한 일은 ‘완료한 일 보기’에서 찾을 수 있습니다." />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.sm },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingLeft: space.md },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.md, margin: space.lg, padding: space.lg, borderWidth: 1, borderRadius: radius.lg },
});
