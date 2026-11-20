import Feather from '@expo/vector-icons/Feather';
import { memo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { describeRecurrence, dueBucket, dueMinutes, formatDue, formatTime, isPastDue } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { Task } from '@/lib/shared';
import { priorityColor, space, type, useTheme } from '@/theme';

import { Checkbox } from './Checkbox';

export interface TaskRowProps {
  task: Task;
  projectName?: string;
  tagNames?: string[];
  /** Open and total direct subtasks, shown as a small counter. */
  subtaskCount?: number;
  /** Hides the date when the surrounding section already states it. */
  hideDate?: boolean;
  onPress: (task: Task) => void;
  onComplete: (task: Task) => void;
  onSchedule?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  swipeEnabled?: boolean;
}

function SwipeAction({ icon, label, color, onPress }: { icon: 'clock' | 'trash-2'; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.action, { backgroundColor: color }]}>
      <Feather name={icon} size={20} color="#FFFFFF" />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

export const TaskRow = memo(function TaskRow({
  task, projectName, tagNames, subtaskCount, hideDate, onPress, onComplete, onSchedule, onDelete, swipeEnabled = true,
}: TaskRowProps) {
  const { colors } = useTheme();
  const swipe = useRef<SwipeableMethods>(null);
  const [checked, setChecked] = useState(false);
  const due = formatDue(task);
  const repeat = describeRecurrence(task.recurrence_rule);
  const late = isPastDue(task);
  const bucket = dueBucket(task);

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

  const meta: { key: string; icon?: 'calendar' | 'repeat' | 'hash' | 'tag' | 'git-merge'; text: string; color: string }[] = [];
  const minutes = dueMinutes(task);
  if (due && !(hideDate && minutes === null)) {
    meta.push({
      key: 'due', icon: 'calendar', text: hideDate && minutes !== null ? formatTime(minutes) : due,
      color: late ? colors.danger : bucket === 'today' ? colors.success : colors.textMuted,
    });
  }
  if (repeat) meta.push({ key: 'repeat', icon: 'repeat', text: repeat, color: colors.textMuted });
  if (projectName) meta.push({ key: 'project', icon: 'hash', text: projectName, color: colors.textMuted });
  for (const name of tagNames ?? []) meta.push({ key: 'tag-' + name, icon: 'tag', text: name, color: colors.accent });
  if (subtaskCount) meta.push({ key: 'subtasks', icon: 'git-merge', text: String(subtaskCount), color: colors.textMuted });

  const row = (
    <Pressable
      accessibilityRole="button" accessibilityLabel={task.title} accessibilityHint="눌러서 자세히 보기"
      onPress={() => onPress(task)}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : colors.background }]}>
      <Checkbox
        checked={checked} color={priorityColor(colors, task.priority)} onPress={finish}
        label={task.title + ' 완료'} />
      <View style={styles.body}>
        <Text
          numberOfLines={2}
          style={[type.body as TextStyle, { color: checked ? colors.textFaint : colors.text },
            checked && { textDecorationLine: 'line-through' }]}>
          {task.title}
        </Text>
        {meta.length ? (
          <View style={styles.meta}>
            {meta.map((item) => (
              <View key={item.key} style={styles.metaItem}>
                {item.icon ? <Feather name={item.icon} size={11} color={item.color} /> : null}
                <Text style={[type.small as TextStyle, { color: item.color }]} numberOfLines={1}>{item.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );

  if (!swipeEnabled) return row;
  return (
    <Swipeable
      ref={swipe} friction={1.6} overshootFriction={8} leftThreshold={72} rightThreshold={40}
      renderLeftActions={() => (
        <View style={[styles.complete, { backgroundColor: colors.success }]}>
          <Feather name="check" size={22} color="#FFFFFF" />
          <Text style={styles.actionLabel}>완료</Text>
        </View>
      )}
      renderRightActions={() => (
        <View style={styles.actions}>
          {onSchedule ? (
            <SwipeAction
              icon="clock" label="일정" color={colors.warning}
              onPress={() => {
                swipe.current?.close();
                onSchedule(task);
              }} />
          ) : null}
          {onDelete ? (
            <SwipeAction
              icon="trash-2" label="삭제" color={colors.danger}
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
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 13 },
  body: { flex: 1, gap: 4 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 200 },
  complete: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.xl },
  actions: { flexDirection: 'row' },
  action: { width: 76, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});
