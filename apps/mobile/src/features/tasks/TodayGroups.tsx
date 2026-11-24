import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName, Txt } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import type { Task } from '@/lib/shared';
import { radius, space, useTheme } from '@/theme';

import { type TaskListModel, TaskListSheets, TaskRows, useTaskListModel } from './TaskList';
import { toggleTodayGroupFold, useTodayFoldedGroups } from './todayFold';
import type { TodayGroup } from './todayList';

/** One line above the groups when something slipped: how many, and the two ways to deal with them. */
export function OverdueStrip({ count, onSpread, onMoveToday }: { count: number; onSpread?: () => void; onMoveToday: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.strip, { backgroundColor: colors.dangerSoft }]}>
      <Icon name="alert-circle" size={16} color={colors.danger} />
      <Txt variant="smallStrong" tone="danger" style={{ flex: 1 }} accessibilityRole="header">지연 {count}개</Txt>
      {onSpread ? (
        <Pressable
          accessibilityRole="button" accessibilityLabel="여러 날에 나눠 잡기" hitSlop={8}
          onPress={() => {
            haptic.tap();
            onSpread();
          }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Txt variant="smallStrong" tone="accent">나눠 잡기</Txt>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button" accessibilityLabel="오늘로 옮기기" hitSlop={8} onPress={onMoveToday}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
        <Txt variant="smallStrong" tone="muted">오늘로</Txt>
      </Pressable>
    </View>
  );
}

const GroupCard = memo(function GroupCard({ group, model, folded, selectedIds, onToggleSelect }: {
  group: TodayGroup;
  model: TaskListModel;
  folded: boolean;
  selectedIds: Set<string> | null;
  onToggleSelect: (task: Task) => void;
}) {
  const { colors } = useTheme();
  const meta = group.projectId ? model.projectMeta[group.projectId] : undefined;
  const name = group.projectId ? model.projectNames.get(group.projectId) ?? '목록' : '미분류';
  const color = group.projectId ? meta?.color ?? colors.accent : colors.textFaint;
  const icon: IconName = group.projectId ? meta?.icon ?? 'hash' : 'inbox';
  const count = group.overdue.length + group.due.length;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${name} ${count}개 ${folded ? '펼치기' : '접기'}`}
        accessibilityState={{ expanded: !folded }}
        onPress={() => {
          haptic.tap();
          toggleTodayGroupFold(group.key);
        }}
        style={({ pressed }) => [styles.header, { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' }]}>
        <Icon name={icon} size={16} color={color} />
        <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</Txt>
        <Txt variant="small" tone="faint">{count}</Txt>
        <View style={{ flex: 1 }} />
        {group.overdue.length ? <Txt variant="caption" tone="danger">지연 {group.overdue.length}개</Txt> : null}
        <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={18} color={colors.textMuted} />
      </Pressable>
      {folded ? null : (
        <View style={[styles.rows, { borderTopColor: colors.border }]}>
          {group.overdue.length ? (
            <TaskRows
              model={model} tasks={group.overdue} hideProject onSurface selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
          ) : null}
          {group.due.length ? (
            <TaskRows
              model={model} tasks={group.due} hideDate hideProject onSurface selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
          ) : null}
        </View>
      )}
      {/* Drawn last so the rows' own backgrounds do not cover it. */}
      <View pointerEvents="none" style={[styles.band, { backgroundColor: color }]} />
    </View>
  );
});

/**
 * Today's open tasks as one card per list. All cards share one row model and one pair of sheets, so the
 * cost does not grow with the number of lists. While selecting, every card is open so nothing selected
 * is out of sight.
 */
export const TodayGroups = memo(function TodayGroups({ groups, selectedIds, onToggleSelect, onStartSelect }: {
  groups: TodayGroup[];
  selectedIds: Set<string> | null;
  onToggleSelect: (task: Task) => void;
  onStartSelect: (task: Task) => void;
}) {
  const { model, sheets } = useTaskListModel();
  const folded = useTodayFoldedGroups();
  return (
    <View style={styles.list}>
      {groups.map((group) => (
        <GroupCard
          key={group.key} group={group} model={model} folded={!selectedIds && folded.has(group.key)}
          selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
      ))}
      <TaskListSheets sheets={sheets} onStartSelect={onStartSelect} />
    </View>
  );
});

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md },
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: space.lg, marginTop: space.sm,
    paddingHorizontal: space.md, paddingVertical: 10, borderRadius: radius.md,
  },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  band: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.md, minHeight: 46 },
  rows: { borderTopWidth: StyleSheet.hairlineWidth },
});
