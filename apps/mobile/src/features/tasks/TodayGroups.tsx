import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName, Txt } from '@/components/ui';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { haptic } from '@/lib/haptics';
import type { Task } from '@/lib/shared';
import { space, useTheme } from '@/theme';

import { listColor } from './listColors';
import { type TaskListModel, TaskListSheets, TaskRows, useTaskListModel } from './TaskList';
import { toggleTodayGroupFold, useTodayFoldedGroups } from './todayFold';
import type { TodayGroup } from './todayList';

const GroupSection = memo(function GroupSection({ group, model, folded, selectedIds, onToggleSelect, focusedTaskId, todayIso }: {
  group: TodayGroup;
  model: TaskListModel;
  folded: boolean;
  selectedIds: Set<string> | null;
  onToggleSelect: (task: Task) => void;
  focusedTaskId?: string | null;
  todayIso?: string;
}) {
  const { colors, isDark } = useTheme();
  const quickAdd = useQuickAdd();
  const meta = group.projectId ? model.projectMeta[group.projectId] : undefined;
  const name = group.title ?? (group.projectId ? model.projectNames.get(group.projectId) ?? '목록' : '미분류');
  const icon: IconName = group.icon ?? (group.projectId ? meta?.icon ?? 'hash' : 'inbox');
  const projectTint = !group.danger && group.projectId ? listColor(meta?.color, isDark) : undefined;
  const iconColor = group.danger ? colors.danger : projectTint ?? colors.textFaint;
  const count = group.overdue.length + group.due.length;
  const hiddenOverdue = folded && !group.danger ? group.overdue.length : 0;
  const canQuickAdd = !group.danger && !selectedIds;

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            `${name} ${count}개` + (hiddenOverdue > 0 ? `, 기한 지남 ${hiddenOverdue}개` : '') + ` ${folded ? '펼치기' : '접기'}`
          }
          accessibilityState={{ expanded: !folded }}
          onPress={() => {
            haptic.tap();
            toggleTodayGroupFold(group.key, todayIso);
          }}
          style={({ pressed }) => [styles.header, { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' }]}>
          <Icon name={icon} size={14} color={iconColor} />
          <Txt
            variant="smallStrong" tone={group.danger ? 'danger' : 'muted'}
            numberOfLines={1} style={{ flexShrink: 1 }} accessibilityRole="header">
            {name}
          </Txt>
          <Txt variant="small" tone="faint" tabular>{count}</Txt>
          {hiddenOverdue > 0 ? (
            <View style={styles.foldedOverdue}>
              <View style={[styles.overdueDot, { backgroundColor: colors.danger }]} />
              <Txt variant="caption" tone="danger" tabular>{hiddenOverdue}</Txt>
            </View>
          ) : null}
          <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={15} color={colors.textFaint} />
        </Pressable>
        {canQuickAdd ? (
          <Pressable
            accessibilityRole="button" accessibilityLabel={`${name}에 할 일 추가`} hitSlop={10}
            onPress={() => {
              haptic.tap();
              quickAdd.open({
                dueToday: true,
                ...(group.hideProject ? { projectId: group.projectId } : {}),
                ...(group.quickAddText ? { initialText: group.quickAddText } : {}),
              });
            }}
            style={({ pressed }) => [
              styles.addBtn,
              pressed && { backgroundColor: colors.surfaceMuted, opacity: 0.85 },
            ]}>
            <Icon name="plus" size={16} color={colors.textFaint} />
          </Pressable>
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

interface TodayGroupsProps {
  groups: TodayGroup[];
  selectedIds: Set<string> | null;
  onToggleSelect: (task: Task) => void;
  onStartSelect: (task: Task) => void;
  focusedTaskId?: string | null;
  todayIso?: string;
  /** Optional hoisted model from the parent screen so only one sheet tree is mounted. */
  model?: TaskListModel;
}

function TodayGroupsContent({
  groups, model, selectedIds, onToggleSelect, focusedTaskId, todayIso,
}: Omit<TodayGroupsProps, 'onStartSelect' | 'model'> & { model: TaskListModel }) {
  const folded = useTodayFoldedGroups(todayIso);
  return (
    <View style={styles.list}>
      {groups.map((group) => (
        <GroupSection
          key={group.key} group={group} model={model} folded={!selectedIds && folded.has(group.key)}
          selectedIds={selectedIds} onToggleSelect={onToggleSelect} focusedTaskId={focusedTaskId} todayIso={todayIso} />
      ))}
    </View>
  );
}

function TodayGroupsWithOwnModel(props: Omit<TodayGroupsProps, 'model'>) {
  const { model, sheets } = useTaskListModel();
  return (
    <>
      <TodayGroupsContent {...props} model={model} />
      <TaskListSheets sheets={sheets} onStartSelect={props.onStartSelect} />
    </>
  );
}

export const TodayGroups = memo(function TodayGroups(props: TodayGroupsProps) {
  if (props.model) {
    return (
      <TodayGroupsContent
        groups={props.groups} model={props.model} selectedIds={props.selectedIds}
        onToggleSelect={props.onToggleSelect} focusedTaskId={props.focusedTaskId} todayIso={props.todayIso} />
    );
  }
  return <TodayGroupsWithOwnModel {...props} />;
});

const styles = StyleSheet.create({
  list: { paddingTop: space.xs },
  section: { marginTop: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  header: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, minHeight: 42 },
  foldedOverdue: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 2 },
  overdueDot: { width: 6, height: 6, borderRadius: 3 },
  addBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: space.sm },
  rows: { borderTopWidth: StyleSheet.hairlineWidth },
});
