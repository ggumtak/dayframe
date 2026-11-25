import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, IconButton, type IconName, Txt } from '@/components/ui';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { haptic } from '@/lib/haptics';
import type { Task } from '@/lib/shared';
import { radius, space, useTheme } from '@/theme';

import { type TaskListModel, TaskListSheets, TaskRows, useTaskListModel } from './TaskList';
import { toggleTodayGroupFold, useTodayFoldedGroups } from './todayFold';
import type { TodayGroup } from './todayList';

function StripAction({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={a11y} hitSlop={6}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.pill, { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.6 : 1 }]}>
      <Txt variant="smallStrong">{label}</Txt>
    </Pressable>
  );
}

export function OverdueStrip({ count, onSpread, onMoveToday }: { count: number; onSpread?: () => void; onMoveToday: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.strip, { backgroundColor: colors.surfaceMuted }]}>
      <Icon name="alert-circle" size={16} color={colors.danger} />
      <Txt variant="smallStrong" tone="danger" style={styles.stripCount} accessibilityRole="header">기한 지남 {count}개</Txt>
      {onSpread ? <StripAction label="일정 분산" a11y="여러 날에 나누어 배정하기" onPress={onSpread} /> : null}
      <StripAction label="오늘로" a11y="모두 오늘로 옮기기" onPress={onMoveToday} />
    </View>
  );
}

const GroupSection = memo(function GroupSection({ group, model, folded, selectedIds, onToggleSelect, focusedTaskId }: {
  group: TodayGroup;
  model: TaskListModel;
  folded: boolean;
  selectedIds: Set<string> | null;
  onToggleSelect: (task: Task) => void;
  focusedTaskId?: string | null;
}) {
  const { colors } = useTheme();
  const quickAdd = useQuickAdd();
  const meta = group.projectId ? model.projectMeta[group.projectId] : undefined;
  const name = group.title ?? (group.projectId ? model.projectNames.get(group.projectId) ?? '목록' : '미분류');
  const icon: IconName = group.icon ?? (group.projectId ? meta?.icon ?? 'hash' : 'inbox');
  const count = group.overdue.length + group.due.length;
  const canQuickAdd = !group.danger && !selectedIds;

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button" accessibilityLabel={`${name} ${count}개 ${folded ? '펼치기' : '접기'}`}
          accessibilityState={{ expanded: !folded }}
          onPress={() => {
            haptic.tap();
            toggleTodayGroupFold(group.key);
          }}
          style={({ pressed }) => [styles.header, { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' }]}>
          <Icon name={icon} size={14} color={group.danger ? colors.danger : colors.textFaint} />
          <Txt
            variant="smallStrong" tone={group.danger ? 'danger' : 'muted'}
            numberOfLines={1} style={{ flexShrink: 1 }} accessibilityRole="header">
            {name}
          </Txt>
          <Txt variant="small" tone="faint">{count}</Txt>
          <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={15} color={colors.textFaint} />
        </Pressable>
        {canQuickAdd ? (
          <IconButton
            name="plus" label={`${name}에 할 일 추가`} size={16} color={colors.textFaint}
            onPress={() => {
              haptic.tap();
              quickAdd.open({
                dueToday: true,
                ...(group.hideProject ? { projectId: group.projectId } : {}),
                ...(group.quickAddText ? { initialText: group.quickAddText } : {}),
              });
            }}
            style={{ width: 32, height: 32, marginRight: space.sm }} />
        ) : null}
      </View>
      {folded ? null : (
        <View style={[styles.rows, { borderTopColor: colors.border }]}>
          {group.overdue.length ? (
            <TaskRows
              model={model} tasks={group.overdue} hideProject={!!group.hideProject}
              selectedIds={selectedIds} onToggleSelect={onToggleSelect} focusedTaskId={focusedTaskId} />
          ) : null}
          {group.due.length ? (
            <TaskRows
              model={model} tasks={group.due} hideDate hideProject={!!group.hideProject}
              selectedIds={selectedIds} onToggleSelect={onToggleSelect} focusedTaskId={focusedTaskId} />
          ) : null}
        </View>
      )}
    </View>
  );
});

export const TodayGroups = memo(function TodayGroups({ groups, selectedIds, onToggleSelect, onStartSelect, focusedTaskId }: {
  groups: TodayGroup[];
  selectedIds: Set<string> | null;
  onToggleSelect: (task: Task) => void;
  onStartSelect: (task: Task) => void;
  focusedTaskId?: string | null;
}) {
  const { model, sheets } = useTaskListModel();
  const folded = useTodayFoldedGroups();
  return (
    <View style={styles.list}>
      {groups.map((group) => (
        <GroupSection
          key={group.key} group={group} model={model} folded={!selectedIds && folded.has(group.key)}
          selectedIds={selectedIds} onToggleSelect={onToggleSelect} focusedTaskId={focusedTaskId} />
      ))}
      <TaskListSheets sheets={sheets} onStartSelect={onStartSelect} />
    </View>
  );
});

const styles = StyleSheet.create({
  list: { paddingTop: space.xs },
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.lg, marginTop: space.sm,
    paddingLeft: space.md, paddingRight: space.sm, paddingVertical: 6, borderRadius: radius.md,
  },
  stripCount: { flex: 1, fontSize: 14, fontWeight: '700' },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 30, justifyContent: 'center' },
  section: { marginTop: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  header: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, minHeight: 36 },
  rows: { borderTopWidth: StyleSheet.hairlineWidth },
});
