import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MonthCalendar } from '@/components/MonthCalendar';
import { Button, Chip, Icon, type IconName, Row, Sheet, Txt } from '@/components/ui';
import { queryClient } from '@/data/client';
import { keys } from '@/data/keys';
import { useProjects, useSections, useTaskActions } from '@/data/tasks';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { deviceTimeZone, type PlainDate, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import type { Priority, Task } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { elevation, radius, space, useTheme } from '@/theme';

import { priorityLabel, priorityMark } from './priority';

import { useTaskFlow } from './useTaskFlow';

type SheetKind = null | 'schedule' | 'priority' | 'move' | 'delete';

function BatchButton({ icon, label, color, onPress }: { icon: IconName; label: string; color?: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={18} color={color ?? colors.textMuted} />
      <Txt variant="caption" style={{ color: color ?? colors.text }}>{label}</Txt>
    </Pressable>
  );
}

/** Floating bar for applying bulk actions (complete, reschedule, priority, move, delete) to selected tasks. */
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
  const saturday = now.add({ days: (6 - now.dayOfWeek + 7) % 7 || 7 });
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
    for (const task of selected) flow.reschedule(task, date);
    setSheet(null);
    showToast(date ? `할 일 ${count}개의 일정을 바꿨습니다.` : `할 일 ${count}개의 날짜를 지웠습니다.`);
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
    for (const task of selected) actions.remove(task.id);
    setSheet(null);
    showToast(`할 일 ${count}개를 삭제했습니다.`);
    onCancel();
  };

  return (
    <>
      <View style={[styles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }, elevation(colors, 2)]}>
        <View style={styles.topRow}>
          <Txt variant="smallStrong">{count}개 선택됨</Txt>
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
          <BatchButton icon="flag" label="우선순위" onPress={() => setSheet('priority')} />
          <BatchButton icon="folder" label="이동" onPress={() => setSheet('move')} />
          <BatchButton icon="trash-2" label="삭제" color={colors.danger} onPress={() => setSheet('delete')} />
        </View>
      </View>

      <Sheet visible={sheet === 'schedule'} onClose={() => setSheet(null)} title={`할 일 ${count}개 일정 변경`}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
          <Chip icon="sun" label="오늘" onPress={() => batchReschedule(now)} />
          <Chip icon="sunrise" label="내일" onPress={() => batchReschedule(now.add({ days: 1 }))} />
          <Chip icon="coffee" label="이번 주말" onPress={() => batchReschedule(saturday)} />
          <Chip icon="arrow-right" label="다음 주" onPress={() => batchReschedule(monday)} />
          <Chip icon="slash" label="날짜 없음" onPress={() => batchReschedule(null)} />
        </View>
        <MonthCalendar initial={now} today={now} onSelect={batchReschedule} />
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
          선택한 할 일 {count}개와 하위 작업이 모두 삭제되며, 되돌릴 수 없습니다.
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
