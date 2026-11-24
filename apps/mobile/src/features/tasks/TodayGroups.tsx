import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName, Txt } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import type { Task } from '@/lib/shared';
import { radius, space, useTheme } from '@/theme';

import { type TaskListModel, TaskListSheets, TaskRows, useTaskListModel } from './TaskList';
import { toggleTodayGroupFold, useTodayFoldedGroups } from './todayFold';
import type { TodayGroup } from './todayList';

/** A neutral outlined pill for the overdue line's actions: no accent next to the red count. */
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

/**
 * One line above the groups when something slipped: the screen's only red (an icon and the count, on a neutral
 * row, never a red fill), in the same place every day, and the two ways to deal with it.
 */
export function OverdueStrip({ count, onSpread, onMoveToday }: { count: number; onSpread?: () => void; onMoveToday: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.strip, { backgroundColor: colors.surfaceMuted }]}>
      <Icon name="alert-circle" size={16} color={colors.danger} />
      <Txt variant="smallStrong" tone="danger" style={styles.stripCount} accessibilityRole="header">지연 {count}개</Txt>
      {onSpread ? <StripAction label="나눠 잡기" a11y="여러 날에 나눠 잡기" onPress={onSpread} /> : null}
      <StripAction label="오늘로" a11y="오늘로 옮기기" onPress={onMoveToday} />
    </View>
  );
}

/**
 * One list's tasks under a quiet heading: no card, no colour band. The heading is smaller and lighter than the task
 * titles (13/600 textMuted, icon textFaint), so the eye reads tasks first; spacing, not a box, groups them.
 */
const GroupSection = memo(function GroupSection({ group, model, folded, selectedIds, onToggleSelect }: {
  group: TodayGroup;
  model: TaskListModel;
  folded: boolean;
  selectedIds: Set<string> | null;
  onToggleSelect: (task: Task) => void;
}) {
  const { colors } = useTheme();
  const meta = group.projectId ? model.projectMeta[group.projectId] : undefined;
  const name = group.projectId ? model.projectNames.get(group.projectId) ?? '목록' : '미분류';
  const icon: IconName = group.projectId ? meta?.icon ?? 'hash' : 'inbox';
  const count = group.overdue.length + group.due.length;

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${name} ${count}개 ${folded ? '펼치기' : '접기'}`}
        accessibilityState={{ expanded: !folded }}
        onPress={() => {
          haptic.tap();
          toggleTodayGroupFold(group.key);
        }}
        style={({ pressed }) => [styles.header, { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' }]}>
        <Icon name={icon} size={14} color={colors.textFaint} />
        <Txt variant="smallStrong" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }} accessibilityRole="header">{name}</Txt>
        <Txt variant="small" tone="faint">{count}</Txt>
        <View style={{ flex: 1 }} />
        <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textFaint} />
      </Pressable>
      {folded ? null : (
        <View style={[styles.rows, { borderTopColor: colors.border }]}>
          {group.overdue.length ? (
            <TaskRows model={model} tasks={group.overdue} hideProject selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
          ) : null}
          {group.due.length ? (
            <TaskRows model={model} tasks={group.due} hideDate hideProject selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
          ) : null}
        </View>
      )}
    </View>
  );
});

/**
 * Today's open tasks as one section per list. All sections share one row model and one pair of sheets, so the
 * cost does not grow with the number of lists. While selecting, every section is open so nothing selected
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
        <GroupSection
          key={group.key} group={group} model={model} folded={!selectedIds && folded.has(group.key)}
          selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, minHeight: 36 },
  rows: { borderTopWidth: StyleSheet.hairlineWidth },
});
