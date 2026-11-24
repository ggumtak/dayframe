import Feather from '@expo/vector-icons/Feather';
import { type ComponentProps, memo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { describeRecurrence, dueBucket, dueMinutes, formatDue, formatDurationMinutes, formatTime, isPastDue } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Task } from '@/lib/shared';
import type { SubtaskProgress } from '@/lib/smart';
import { priorityMark, taskA11yLabel } from '@/features/tasks/priority';
import { fontFamily, space, type, useTheme } from '@/theme';

import { Checkbox } from './Checkbox';

export interface TaskRowProps {
  task: Task;
  projectName?: string;
  projectIcon?: ComponentProps<typeof Feather>['name'];
  tagNames?: string[];
  /** Open and completed direct subtasks, shown as a compact counter (`3` or `2/5`). */
  subtaskProgress?: SubtaskProgress;
  /** Whether inline subtasks beneath this row are currently expanded. */
  subtasksExpanded?: boolean;
  /** Toggles inline subtasks when tapping the subtask counter. */
  onToggleSubtasks?: (task: Task) => void;
  /** Hides the date when the surrounding section already states it. */
  hideDate?: boolean;
  /** Selection mode for batch operations. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (task: Task) => void;
  onPress: (task: Task) => void;
  onComplete: (task: Task) => void;
  onSchedule?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  /** Long press: the quick menu. */
  onLongPress?: (task: Task) => void;
  /** The list handles long presses itself (drag or menu), so releasing one must not count as a tap. */
  holdHandled?: boolean;
  swipeEnabled?: boolean;
  /** The row sits on a card, so its resting background is `colors.surface` instead of the page's. */
  onSurface?: boolean;
}

function SwipeAction({ icon, label, color, foreground, onPress }: {
  icon: 'clock' | 'trash-2'; label: string; color: string; foreground: string; onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.action, { backgroundColor: color }]}>
      <Feather name={icon} size={20} color={foreground} />
      <Text style={[styles.actionLabel, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export const TaskRow = memo(function TaskRow({
  task, projectName, projectIcon, tagNames, subtaskProgress, subtasksExpanded, onToggleSubtasks, hideDate,
  selectable, selected, onToggleSelect,
  onPress, onComplete, onSchedule, onDelete, onLongPress, holdHandled, swipeEnabled = true, onSurface,
}: TaskRowProps) {
  const { colors } = useTheme();
  const swipe = useRef<SwipeableMethods>(null);
  const [checked, setChecked] = useState(false);
  const due = formatDue(task);
  const repeat = describeRecurrence(task.recurrence_rule, task.recurrence_mode);
  const late = isPastDue(task);
  const bucket = dueBucket(task);

  const subtaskCount = subtaskProgress?.total ?? 0;
  const subtaskLabel = subtaskProgress
    ? (subtaskProgress.completed > 0 ? `${subtaskProgress.completed}/${subtaskProgress.total}` : String(subtaskProgress.open))
    : '';
  const hasProgress = (subtaskProgress?.completed ?? 0) > 0;

  const finish = () => {
    if (checked) return;
    setChecked(true);
    // Let the check land before the row leaves the list.
    setTimeout(() => {
      onComplete(task);
      // A repeating task stays in the list with its next date, so show it unchecked again.
      if (task.recurrence_rule) setChecked(false);
    }, 240);
  };

  // The meta line is neutral: textMuted text with icons a step lighter, tags and the notes glyph in textFaint.
  // The one colour is an overdue date (danger, weight 600), the only red in the row. On Today (hideDate) a time
  // stands alone without an icon; elsewhere "오늘" is told apart by weight, not hue.
  const meta: {
    key: string; icon?: 'calendar' | 'clock' | 'repeat' | 'git-merge' | 'align-left'; text: string; color: string; iconColor?: string;
    weight?: '500' | '600';
  }[] = [];
  const minutes = dueMinutes(task);
  if (due && !(hideDate && minutes === null)) {
    const timeOnly = hideDate && minutes !== null;
    meta.push({
      key: 'due', icon: timeOnly && !late ? undefined : 'calendar', text: timeOnly ? formatTime(minutes) : due,
      color: late ? colors.danger : colors.textMuted, iconColor: late ? colors.danger : colors.textFaint,
      weight: late || (!timeOnly && bucket === 'today') ? '600' : timeOnly ? '500' : undefined,
    });
  }
  if (task.duration_minutes) {
    meta.push({ key: 'duration', icon: 'clock', text: formatDurationMinutes(task.duration_minutes), color: colors.textMuted });
  }
  if (repeat) meta.push({ key: 'repeat', icon: 'repeat', text: repeat, color: colors.textMuted });
  for (const name of tagNames ?? []) meta.push({ key: 'tag-' + name, text: '#' + name, color: colors.textFaint });
  if (subtaskCount && !onToggleSubtasks) {
    meta.push({ key: 'subtasks', icon: 'git-merge', text: subtaskLabel, color: colors.textMuted });
  }
  if (task.notes?.trim()) meta.push({ key: 'notes', icon: 'align-left', text: '', color: colors.textFaint });
  const mark = priorityMark(task.priority);
  const subtaskTone = subtasksExpanded ? colors.accentText : colors.textMuted;

  const row = (
    <Pressable
      accessibilityRole={selectable ? 'checkbox' : 'button'}
      accessibilityState={selectable ? { checked: !!selected } : undefined}
      accessibilityLabel={taskA11yLabel(task.title, task.priority)}
      accessibilityHint={selectable ? '눌러서 선택 또는 해제' : '눌러서 자세히 보기'}
      onPress={() => {
        if (selectable && onToggleSelect) {
          haptic.tap();
          onToggleSelect(task);
          return;
        }
        onPress(task);
      }}
      onLongPress={!selectable && onLongPress ? () => {
        haptic.medium();
        onLongPress(task);
      } : !selectable && holdHandled ? () => {} : undefined}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfaceMuted : onSurface ? colors.surface : colors.background },
      ]}>
      <View style={styles.check}>
        {selectable ? (
          <View
            style={[
              styles.selectBox,
              {
                borderColor: selected ? colors.accent : colors.control,
                backgroundColor: selected ? colors.accent : 'transparent',
              },
            ]}>
            {selected ? <Feather name="check" size={14} color={colors.onAccent} /> : null}
          </View>
        ) : (
          <Checkbox checked={checked} onPress={finish} label={task.title + ' 완료'} />
        )}
      </View>
      <View style={[styles.body, { borderBottomColor: colors.border }]}>
        <Text
          numberOfLines={2}
          style={[type.body as TextStyle, { color: checked ? colors.textFaint : colors.text },
            checked && { textDecorationLine: 'line-through' }]}>
          {mark ? <Text style={styles.mark}>{mark + ' '}</Text> : null}
          {task.title}
        </Text>
        {meta.length || projectName || (subtaskCount && onToggleSubtasks) ? (
          <View style={styles.metaRow}>
            <View style={styles.meta}>
              {meta.map((item) => (
                <View key={item.key} style={styles.metaItem}>
                  {item.icon ? <Feather name={item.icon} size={11} color={item.iconColor ?? colors.textFaint} /> : null}
                  {item.text ? (
                    <Text style={[styles.metaText, { color: item.color }, item.weight && { fontWeight: item.weight }]} numberOfLines={1}>
                      {item.text}
                    </Text>
                  ) : null}
                </View>
              ))}
              {subtaskCount && onToggleSubtasks ? (
                <Pressable
                  accessibilityRole="button" accessibilityLabel={`하위 작업 ${subtaskLabel} ${subtasksExpanded ? '접기' : '펼치기'}`}
                  hitSlop={8}
                  onPress={(event) => {
                    event.stopPropagation();
                    haptic.tap();
                    onToggleSubtasks(task);
                  }}
                  style={[
                    styles.subtaskPill,
                    { backgroundColor: subtasksExpanded ? colors.accentSoft : colors.surfaceMuted },
                  ]}>
                  <Feather name={hasProgress ? 'check-square' : 'git-merge'} size={11} color={subtaskTone} />
                  <Text style={[styles.metaText, { color: subtaskTone, fontWeight: '600' }]}>{subtaskLabel}</Text>
                  <Feather name={subtasksExpanded ? 'chevron-up' : 'chevron-down'} size={12} color={subtaskTone} />
                </Pressable>
              ) : null}
            </View>
            {projectName ? (
              <View style={styles.metaItem}>
                <Feather name={projectIcon ?? 'hash'} size={11} color={colors.textFaint} />
                <Text style={[styles.metaText, { color: colors.textFaint }]} numberOfLines={1}>{projectName}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );

  if (!swipeEnabled || selectable) return row;
  return (
    <Swipeable
      ref={swipe} friction={1.6} overshootFriction={8} leftThreshold={72} rightThreshold={40}
      renderLeftActions={() => (
        <View style={[styles.complete, { backgroundColor: colors.accent }]}>
          <Feather name="check" size={22} color={colors.onAccent} />
          <Text style={[styles.actionLabel, { color: colors.onAccent }]}>완료</Text>
        </View>
      )}
      renderRightActions={() => (
        <View style={styles.actions}>
          {onSchedule ? (
            <SwipeAction
              icon="clock" label="일정" color={colors.textMuted} foreground={colors.background}
              onPress={() => {
                swipe.current?.close();
                onSchedule(task);
              }} />
          ) : null}
          {onDelete ? (
            <SwipeAction
              icon="trash-2" label="삭제" color={colors.danger} foreground={colors.onDanger}
              onPress={() => {
                swipe.current?.close();
                haptic.warning();
                onDelete(task);
              }} />
          ) : null}
        </View>
      )}
      onSwipeableOpen={(direction) => {
        if (direction !== 'right') return;
        swipe.current?.close();
        haptic.success();
        finish();
      }}>
      {row}
    </Swipeable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: space.lg },
  check: { paddingTop: 12, paddingRight: space.md },
  selectBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.8, alignItems: 'center', justifyContent: 'center',
  },
  // The divider starts at the text, as in a ruled list, so the checkboxes read as one column.
  body: { flex: 1, gap: 3, paddingVertical: 11, paddingRight: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 46 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  meta: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: 190 },
  subtaskPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  metaText: { fontFamily, fontSize: 12, lineHeight: 16 },
  complete: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.xl },
  actions: { flexDirection: 'row' },
  action: { width: 76, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionLabel: { fontFamily, fontSize: 12, fontWeight: '600' },
  // The priority mark: the title's size and colour, bold, so its length is the cue.
  mark: { fontWeight: '700' },
});
