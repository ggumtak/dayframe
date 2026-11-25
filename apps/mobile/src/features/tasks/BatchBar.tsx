import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MonthCalendar } from '@/components/MonthCalendar';
import { Button, Chip, Icon, type IconName, Row, Sheet, Txt } from '@/components/ui';
import { queryClient } from '@/data/client';
import { keys } from '@/data/keys';
import { hideTasks, unhideTasks, useProjects, useSections, useTaskActions, withDescendants } from '@/data/tasks';
import { KEY_PRIORITY, matchesCombo, useKeyHandler } from '@/features/keyboard';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { deviceTimeZone, dueMinutes, formatDurationMinutes, instantFor, type PlainDate, today, weekdayName } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import type { Priority, Task, TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { elevation, radius, space, useTheme } from '@/theme';

import { priorityLabel, priorityMark } from './priority';
import { schedulePatch, useTaskFlow } from './useTaskFlow';

type SheetKind = null | 'schedule' | 'duration' | 'priority' | 'move' | 'delete';

const batchDurationChoices: { minutes: number | null; label: string }[] = [
  { minutes: 15, label: '15분' },
  { minutes: 30, label: '30분' },
  { minutes: 60, label: '1시간' },
  { minutes: null, label: '지우기' },
];

function BatchButton({ icon, label, accessibilityLabel, color, onPress }: {
  icon: IconName; label: string; accessibilityLabel?: string; color?: string; onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress}
      style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={18} color={color ?? colors.textMuted} />
      <Txt variant="caption" numberOfLines={1} style={{ color: color ?? colors.text }}>{label}</Txt>
    </Pressable>
  );
}

/** Floating bar for applying bulk actions (complete, reschedule, duration, priority, move, delete) to selected tasks. */
export function BatchBar({
  selected, totalCount, onSelectAll, onCancel,
}: {
  selected: Task[];
  totalCount: number;
  onSelectAll: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const quickAdd = useQuickAdd();
  const flow = useTaskFlow();
  const actions = useTaskActions();
  const { data: projects } = useProjects();
  const { data: sections } = useSections();
  const [sheet, setSheet] = useState<SheetKind>(null);

  useEffect(() => {
    quickAdd.setFabHidden(true);
    return () => quickAdd.setFabHidden(false);
  }, [quickAdd]);

  const count = selected.length;
  const now = today(deviceTimeZone());
  const tomorrow = now.add({ days: 1 });
  const isWeekendToday = now.dayOfWeek >= 6;
  const weekend = now.add({ days: (6 - now.dayOfWeek + 7) % 7 || 7 });
  const weekendLabel = `${isWeekendToday ? '다음 주말' : '이번 주말'} · ${weekdayName(weekend)}`;
  const monday = now.add({ days: 8 - now.dayOfWeek });

  const batchComplete = () => {
    if (!count) return;
    haptic.success();
    const snapshot = [...selected];
    const completedCache = queryClient.getQueryData<Task[]>(keys.completedTasks) ?? [];
    for (const task of snapshot) {
      actions.complete(task);
      if (task.recurrence_rule) {
        for (const child of completedCache.filter((item) => item.parent_task_id === task.id)) {
          actions.reopen(child);
        }
      }
    }
    showToast(`할 일 ${count}개를 완료했습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => {
        for (const task of snapshot) flow.uncomplete(task, task.due_at);
      },
    });
    onCancel();
  };

  const batchReschedule = (date: PlainDate | null) => {
    if (!count) return;
    haptic.success();
    const snapshot = selected.map((task) => {
      const previous = {
        due_at: task.due_at,
        all_day: task.all_day,
        recurrence_rule: task.recurrence_rule,
        recurrence_mode: task.recurrence_mode,
        recurrence_local_time: task.recurrence_local_time,
        occurrence_at: task.occurrence_at,
      };
      let usedPreserve = false;
      let movedDueAt: string | null = null;
      if (date && task.recurrence_rule && task.due_at) {
        usedPreserve = true;
        const currentMinutes = dueMinutes(task);
        movedDueAt = task.recurrence_local_time
          ? date.toZonedDateTime({ timeZone: task.timezone, plainTime: task.recurrence_local_time }).toInstant().toString()
          : instantFor(date, currentMinutes, task.timezone);
        actions.update(task.id, { due_at: movedDueAt, expected_due_at: task.due_at, preserve_recurrence: true });
      } else {
        actions.update(task.id, schedulePatch(task, date));
      }
      return { id: task.id, previous, usedPreserve, movedDueAt };
    });
    setSheet(null);
    showToast(date ? `할 일 ${count}개의 일정을 바꿨습니다.` : `할 일 ${count}개의 날짜를 지웠습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => {
        const cached = queryClient.getQueryData<Task[]>(keys.tasks) ?? [];
        for (const entry of snapshot) {
          if (entry.usedPreserve && entry.previous.due_at) {
            const current = cached.find((item) => item.id === entry.id);
            actions.update(entry.id, {
              due_at: entry.previous.due_at,
              expected_due_at: current?.due_at ?? entry.movedDueAt ?? entry.previous.due_at,
              preserve_recurrence: true,
            });
          } else {
            const revertPatch: TaskPatch = {
              due_at: entry.previous.due_at,
              all_day: entry.previous.all_day,
              recurrence_rule: entry.previous.recurrence_rule,
              recurrence_mode: entry.previous.recurrence_mode,
              recurrence_local_time: entry.previous.recurrence_local_time,
            };
            actions.update(entry.id, revertPatch);
            if (entry.previous.occurrence_at) {
              queryClient.setQueryData<Task[]>(keys.tasks, (list) => list?.map((item) => (
                item.id === entry.id ? { ...item, occurrence_at: entry.previous.occurrence_at } : item
              )));
            }
          }
        }
      },
    });
    onCancel();
  };

  const batchDuration = (minutes: number | null) => {
    if (!count) return;
    haptic.tap();
    const snapshot = selected.map((task) => ({ id: task.id, duration_minutes: task.duration_minutes }));
    for (const task of selected) actions.update(task.id, { duration_minutes: minutes });
    setSheet(null);
    const label = minutes ? formatDurationMinutes(minutes) : null;
    showToast(
      label
        ? `할 일 ${count}개의 소요 시간을 ${label}${josa(label, '으로/로')} 설정했습니다.`
        : `할 일 ${count}개의 소요 시간을 지웠습니다.`,
      {
        actionLabel: '실행 취소',
        onAction: () => {
          for (const entry of snapshot) {
            actions.update(entry.id, { duration_minutes: entry.duration_minutes });
          }
        },
      },
    );
    onCancel();
  };

  const batchPriority = (priority: Priority) => {
    if (!count) return;
    haptic.tap();
    for (const task of selected) actions.update(task.id, { priority });
    setSheet(null);
    showToast(`할 일 ${count}개의 우선순위를 ‘${priorityLabel(priority)}’으로 바꿨습니다.`);
    onCancel();
  };

  const batchMove = (projectId: string | null, sectionId: string | null, label: string) => {
    if (!count) return;
    haptic.success();
    for (const task of selected) {
      if (!task.parent_task_id) actions.update(task.id, { project_id: projectId, section_id: sectionId });
    }
    setSheet(null);
    showToast(`할 일 ${count}개를 ${label}${josa(label, '으로/로')} 옮겼습니다.`);
    onCancel();
  };

  const batchDelete = () => {
    if (!count) return;
    haptic.warning();
    const allOpen = queryClient.getQueryData<Task[]>(keys.tasks) ?? [];
    const selectedSet = new Set(selected.map((task) => task.id));
    const rootIds = selected
      .filter((task) => !task.parent_task_id || !selectedSet.has(task.parent_task_id))
      .map((task) => task.id);
    const hiddenSet = new Set<string>();
    for (const id of rootIds) {
      for (const descendantId of withDescendants(allOpen, id)) hiddenSet.add(descendantId);
    }
    const hiddenIds = [...hiddenSet];
    hideTasks(hiddenIds);
    setSheet(null);
    showToast(`${count}개 삭제했습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => unhideTasks(hiddenIds),
      onDismiss: () => {
        for (const id of rootIds) actions.remove(id);
      },
    });
    onCancel();
  };

  useKeyHandler(
    (event) => {
      if (matchesCombo(event, 'escape')) {
        onCancel();
        return true;
      }
      if (event.editing) return false;
      if (matchesCombo(event, 'mod+a')) {
        onSelectAll();
        return true;
      }
      if (count > 0) {
        if (matchesCombo(event, 'x')) {
          batchComplete();
          return true;
        }
        if (matchesCombo(event, 's')) {
          setSheet('schedule');
          return true;
        }
        if (matchesCombo(event, 'd')) {
          setSheet('duration');
          return true;
        }
        if (matchesCombo(event, 'p')) {
          setSheet('priority');
          return true;
        }
        if (matchesCombo(event, 'm')) {
          setSheet('move');
          return true;
        }
        if (matchesCombo(event, 'delete') || matchesCombo(event, 'backspace')) {
          setSheet('delete');
          return true;
        }
      }
      return false;
    },
    { priority: KEY_PRIORITY.screen + 10, enabled: sheet === null },
  );

  useKeyHandler(
    (event) => {
      if (matchesCombo(event, 'escape')) {
        setSheet(null);
        return true;
      }
      if (event.editing) return false;

      if (sheet === 'priority') {
        if (
          matchesCombo(event, '1')
          || matchesCombo(event, '2')
          || matchesCombo(event, '3')
          || matchesCombo(event, '4')
        ) {
          batchPriority(Number(event.key) as Priority);
          return true;
        }
      } else if (sheet === 'duration') {
        if (matchesCombo(event, '1')) {
          batchDuration(15);
          return true;
        }
        if (matchesCombo(event, '2')) {
          batchDuration(30);
          return true;
        }
        if (matchesCombo(event, '3')) {
          batchDuration(60);
          return true;
        }
        if (matchesCombo(event, '0') || matchesCombo(event, 'delete') || matchesCombo(event, 'backspace')) {
          batchDuration(null);
          return true;
        }
      } else if (sheet === 'schedule') {
        if (matchesCombo(event, '1') || matchesCombo(event, 't')) {
          batchReschedule(now);
          return true;
        }
        if (matchesCombo(event, '2') || matchesCombo(event, 'w')) {
          batchReschedule(tomorrow);
          return true;
        }
        if (matchesCombo(event, '3')) {
          batchReschedule(weekend);
          return true;
        }
        if (matchesCombo(event, '4')) {
          batchReschedule(monday);
          return true;
        }
        if (matchesCombo(event, '0') || matchesCombo(event, 'delete') || matchesCombo(event, 'backspace')) {
          batchReschedule(null);
          return true;
        }
      } else if (sheet === 'delete') {
        if (matchesCombo(event, 'enter')) {
          batchDelete();
          return true;
        }
      }

      return true;
    },
    { priority: KEY_PRIORITY.sheet, enabled: sheet !== null },
  );

  return (
    <>
      <View style={[styles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }, elevation(colors, 2)]}>
        <View style={styles.topRow}>
          <Txt variant="smallStrong" tabular>{count}개 선택됨</Txt>
          <View style={{ flex: 1 }} />
          <Pressable hitSlop={8} onPress={onSelectAll}>
            <Txt variant="smallStrong" tone="muted">{count === totalCount ? '선택 해제' : '전체 선택'}</Txt>
          </Pressable>
          <Pressable hitSlop={8} onPress={onCancel} style={{ marginLeft: space.md }}>
            <Txt variant="smallStrong">닫기</Txt>
          </Pressable>
        </View>
        <View style={[styles.actions, { borderTopColor: colors.border, opacity: count ? 1 : 0.45 }]} pointerEvents={count ? 'auto' : 'none'}>
          <BatchButton icon="check-circle" label="완료" onPress={batchComplete} />
          <BatchButton icon="calendar" label="일정" onPress={() => setSheet('schedule')} />
          <BatchButton icon="clock" label="소요" accessibilityLabel="소요 시간" onPress={() => setSheet('duration')} />
          <BatchButton icon="flag" label="우선순위" onPress={() => setSheet('priority')} />
          <BatchButton icon="folder" label="이동" onPress={() => setSheet('move')} />
          <BatchButton icon="trash-2" label="삭제" color={colors.danger} onPress={() => setSheet('delete')} />
        </View>
      </View>

      <Sheet visible={sheet === 'schedule'} onClose={() => setSheet(null)} title={`할 일 ${count}개 일정 변경`}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
          <Chip icon="sun" label={`오늘 · ${weekdayName(now)}`} onPress={() => batchReschedule(now)} />
          <Chip icon="sunrise" label={`내일 · ${weekdayName(tomorrow)}`} onPress={() => batchReschedule(tomorrow)} />
          <Chip icon="coffee" label={weekendLabel} onPress={() => batchReschedule(weekend)} />
          <Chip icon="arrow-right" label={`다음 주 · ${weekdayName(monday)}`} onPress={() => batchReschedule(monday)} />
          <Chip icon="slash" label="날짜 없음" onPress={() => batchReschedule(null)} />
        </View>
        <MonthCalendar initial={now} today={now} onSelect={batchReschedule} />
      </Sheet>

      <Sheet visible={sheet === 'duration'} onClose={() => setSheet(null)} title={`할 일 ${count}개 소요 시간 변경`}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {batchDurationChoices.map((choice) => (
            <Chip
              key={choice.label}
              icon={choice.minutes === null ? 'slash' : 'clock'}
              label={choice.label}
              onPress={() => batchDuration(choice.minutes)}
              style={{ flexGrow: 1, justifyContent: 'center' }} />
          ))}
        </View>
      </Sheet>

      <Sheet visible={sheet === 'priority'} onClose={() => setSheet(null)} title={`할 일 ${count}개 우선순위 변경`}>
        {([1, 2, 3, 4] as Priority[]).map((p) => (
          <Row
            key={p} icon="flag"
            label={priorityLabel(p)}
            trailing={p < 4 ? <Txt style={{ fontWeight: '700' }}>{priorityMark(p)}</Txt> : undefined}
            onPress={() => batchPriority(p)} />
        ))}
      </Sheet>

      <Sheet visible={sheet === 'move'} onClose={() => setSheet(null)} title={`옮길 목록 선택 (${count}개)`}>
        <ScrollView style={{ maxHeight: 380 }}>
          <Row icon="inbox" label="미분류" onPress={() => batchMove(null, null, '미분류')} />
          {(projects ?? []).map((project) => {
            const projSections = (sections ?? []).filter((s) => s.project_id === project.id);
            return (
              <View key={project.id}>
                <Row icon="hash" label={project.name} onPress={() => batchMove(project.id, null, '#' + project.name)} />
                {projSections.map((section) => (
                  <View key={section.id} style={{ paddingLeft: space.xl }}>
                    <Row
                      icon="bookmark" label={section.name}
                      onPress={() => batchMove(project.id, section.id, `#${project.name} · ${section.name}`)} />
                  </View>
                ))}
              </View>
            );
          })}
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title={`할 일 ${count}개를 삭제할까요?`}>
        <Txt tone="muted" style={{ marginBottom: space.lg }}>
          선택한 할 일 {count}개와 하위 작업이 삭제됩니다. 삭제 직후 실행 취소로 되돌릴 수 있습니다.
        </Txt>
        <View style={{ gap: space.sm }}>
          <Button label={`${count}개 삭제`} kind="danger" onPress={batchDelete} />
          <Button label="취소" kind="secondary" onPress={() => setSheet(null)} />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', left: space.md, right: space.md, bottom: space.md,
    borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: 10,
  },
  actions: {
    flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8,
  },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 4 },
});
