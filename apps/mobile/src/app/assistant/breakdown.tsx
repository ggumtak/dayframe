import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EmptyState, Icon, Loading, Txt } from '@/components/ui';
import { useTaskIndex } from '@/data/tasks';
import { BreakdownPanel } from '@/features/ai/Breakdown';
import { AiScreen, KeyGate } from '@/features/ai/components';
import { formatDue } from '@/lib/dates';
import type { Task } from '@/lib/shared';
import { priorityColor, radius, space, useTheme } from '@/theme';

function Picker({ tasks, subtasks }: { tasks: Task[]; subtasks: Map<string, Task[]> }) {
  const { colors } = useTheme();
  const sorted = useMemo(() => tasks.slice().sort((a, b) => a.priority - b.priority
    || (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999')).slice(0, 60), [tasks]);
  if (!sorted.length) return <EmptyState icon="inbox" title="쪼갤 할 일이 없습니다" message="할 일을 먼저 추가해 주세요." />;
  return (
    <>
      <Txt variant="small" tone="muted">어떤 할 일을 나눌까요? 막막하거나 오래 미뤄 둔 일을 골라 보세요.</Txt>
      {sorted.map((task) => {
        const due = formatDue(task);
        const subs = subtasks.get(task.id)?.length ?? 0;
        return (
          <Pressable
            key={task.id} accessibilityRole="button" accessibilityLabel={`${task.title} 쪼개기`}
            onPress={() => router.setParams({ taskId: task.id })}
            style={({ pressed }) => [styles.pick, { borderColor: colors.border, backgroundColor: colors.surface }, pressed && { opacity: 0.6 }]}>
            <View style={[styles.dot, { backgroundColor: priorityColor(colors, task.priority) }]} />
            <View style={{ flex: 1 }}>
              <Txt variant="body" numberOfLines={2}>{task.title}</Txt>
              {due || subs ? (
                <Txt variant="caption" tone="muted">{[due, subs ? `하위 작업 ${subs}개` : null].filter(Boolean).join(' · ')}</Txt>
              ) : null}
            </View>
            <Icon name="chevron-right" size={16} color={colors.textFaint} />
          </Pressable>
        );
      })}
    </>
  );
}

/** 큰 일 쪼개기 as a screen: /assistant/breakdown?taskId=… for one task, or a picker without one. */
export default function Breakdown() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const { byId, roots, children, isLoading } = useTaskIndex();
  const task = taskId ? byId.get(taskId) : undefined;

  let body;
  if (isLoading) body = <Loading />;
  else if (taskId && !task) body = <EmptyState icon="search" title="할 일을 찾지 못했습니다" message="완료했거나 삭제한 할 일일 수 있습니다." />;
  else if (task) body = <BreakdownPanel key={task.id} task={task} onDone={() => router.back()} />;
  else body = <Picker tasks={roots} subtasks={children} />;

  return (
    <AiScreen title="큰 일 쪼개기" subtitle={task?.title}>
      <KeyGate>{body}</KeyGate>
    </AiScreen>
  );
}

const styles = StyleSheet.create({
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
