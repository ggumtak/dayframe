import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName, Row, Sheet, Txt } from '@/components/ui';
import { useTaskActions } from '@/data/tasks';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { describeRecurrence, formatDue, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Priority, Task } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { priorityColor, radius, space, useTheme } from '@/theme';

import { useTaskFlow } from './useTaskFlow';

function Action({ icon, label, onPress, color }: { icon: IconName; label: string; onPress: () => void; color?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={20} color={color ?? colors.text} />
      <Txt variant="caption" style={{ color: color ?? colors.text }}>{label}</Txt>
    </Pressable>
  );
}

/**
 * What a long press on a task offers: the common changes in one sheet, without opening the task.
 * `onSchedule` opens the full date picker the list already has.
 */
export function TaskMenu({ task, onClose, onSchedule }: { task: Task | null; onClose: () => void; onSchedule: (task: Task) => void }) {
  const { colors } = useTheme();
  const flow = useTaskFlow();
  const actions = useTaskActions();
  const quickAdd = useQuickAdd();
  if (!task) return null;
  const now = today(task.timezone);
  const due = formatDue(task);
  const repeat = describeRecurrence(task.recurrence_rule);
  const run = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <Sheet visible onClose={onClose}>
      <View style={{ gap: 2, marginBottom: space.md }}>
        <Txt variant="heading" numberOfLines={2}>{task.title}</Txt>
        <Txt variant="small" tone="muted">{[due ?? '날짜 없음', repeat].filter(Boolean).join(' · ')}</Txt>
      </View>

      <View style={styles.actions}>
        <Action icon="check" label="완료" color={colors.success} onPress={() => run(() => flow.complete(task))} />
        <Action icon="sun" label="오늘" onPress={() => run(() => flow.reschedule(task, now))} />
        <Action icon="sunrise" label="내일" onPress={() => run(() => flow.reschedule(task, now.add({ days: 1 })))} />
        <Action icon="calendar" label="날짜" onPress={() => run(() => onSchedule(task))} />
      </View>

      <View style={styles.priorities}>
        {([1, 2, 3, 4] as Priority[]).map((priority) => {
          const active = task.priority === priority;
          const tint = priorityColor(colors, priority);
          return (
            <Pressable
              key={priority} accessibilityRole="button" accessibilityLabel={'우선순위 ' + priority} accessibilityState={{ selected: active }}
              onPress={() => {
                haptic.tap();
                run(() => actions.update(task.id, { priority }));
              }}
              style={[styles.priority, { borderColor: active ? tint : colors.border }]}>
              <Icon name="flag" size={14} color={tint} />
              <Txt variant="smallStrong" style={{ color: active ? colors.text : colors.textMuted }}>P{priority}</Txt>
            </Pressable>
          );
        })}
      </View>

      <View style={{ marginTop: space.sm }}>
        {task.parent_task_id ? null : (
          <Row icon="corner-down-right" label="하위 작업 추가" onPress={() => run(() => quickAdd.open({ parentTaskId: task.id }))} />
        )}
        <Row
          icon="clock" label="이 할 일로 집중 시작"
          onPress={() => run(() => router.navigate({ pathname: '/focus', params: { taskId: task.id, at: String(Date.now()) } }))} />
        <Row
          icon="copy" label="제목 복사"
          onPress={() => run(() => void Clipboard.setStringAsync(task.title).then(() => showToast('제목을 복사했습니다.')).catch(() => {}))} />
        <Row icon="maximize-2" label="자세히 보기" onPress={() => run(() => router.push({ pathname: '/task/[id]', params: { id: task.id } }))} />
        <Row icon="trash-2" label="삭제" tone="danger" onPress={() => run(() => flow.remove(task))} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, height: 64, borderRadius: radius.md },
  priorities: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  priority: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 38, borderRadius: radius.md, borderWidth: 1 },
});
