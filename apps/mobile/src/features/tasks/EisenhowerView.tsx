import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Icon, type IconName, Segmented, Txt } from '@/components/ui';
import { type HardwareKeyEvent, matchesCombo, useListCursor, useTaskShortcuts } from '@/features/keyboard';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { ScheduleSheet } from '@/features/tasks/ScheduleSheet';
import { TaskList } from '@/features/tasks/TaskList';
import { TaskMenu } from '@/features/tasks/TaskMenu';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, dueDate, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { usePersistentState } from '@/lib/persist';
import type { Task } from '@/lib/shared';
import { bySmartRank, classifyEisenhower, type EisenhowerQuadrant, type SubtaskProgress } from '@/lib/smart';
import { space, useTheme } from '@/theme';

type MatrixScope = 'near' | 'all';
const isMatrixScope = (value: string): value is MatrixScope => value === 'near' || value === 'all';
const taskId = (task: Task) => task.id;

interface QuadrantMeta {
  key: EisenhowerQuadrant;
  title: string;
  subtitle: string;
  icon: IconName;
  quickAddText: string;
  dueToday?: boolean;
}

const QUADRANTS: QuadrantMeta[] = [
  { key: 'q1', title: '긴급 · 중요', subtitle: '지금 바로 처리하기', icon: 'alert-circle', quickAddText: '오늘 p1 ', dueToday: true },
  { key: 'q2', title: '중요 · 계획', subtitle: '일정 잡아 집중하기', icon: 'compass', quickAddText: 'p2 ' },
  { key: 'q3', title: '긴급 · 빠른 처리', subtitle: '짧게 끝내기', icon: 'clock', quickAddText: '오늘 ', dueToday: true },
  { key: 'q4', title: '나중에 · 보류', subtitle: '여유 있을 때 정리하기', icon: 'inbox', quickAddText: '' },
];

/** TickTick-style Eisenhower Matrix grouping every open root task into 4 actionable quadrants. */
export function EisenhowerView({
  roots, subtaskProgress, refreshing, onRefresh, keyboardActive = false,
}: {
  roots: Task[];
  subtaskProgress: Map<string, SubtaskProgress>;
  refreshing: boolean;
  onRefresh: () => void;
  keyboardActive?: boolean;
}) {
  const { colors } = useTheme();
  const quickAdd = useQuickAdd();
  const flow = useTaskFlow();
  const nowMs = useMinute() * 60_000;
  const [scope, setScope] = usePersistentState<MatrixScope>('dayframe-matrix-scope', 'near', isMatrixScope);
  const [collapsed, setCollapsed] = useState<Set<EisenhowerQuadrant>>(() => new Set(['q4']));
  const [kbdSchedule, setKbdSchedule] = useState<Task | null>(null);
  const [kbdMenu, setKbdMenu] = useState<Task | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);

  const scopedRoots = useMemo(() => {
    if (scope === 'all') return roots;
    const tz = deviceTimeZone();
    const todayRef = Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO(tz).toPlainDate();
    return roots.filter((task) => {
      const bucket = dueBucket(task);
      if (bucket === 'overdue' || bucket === 'today') return true;
      if (task.priority <= 2 && !task.due_at) return true;
      const d = dueDate(task);
      if (!d) return false;
      const delta = todayRef.until(d).days;
      return delta >= 0 && delta <= 7;
    });
  }, [roots, scope, nowMs]);

  const grouped = useMemo(() => {
    const map: Record<EisenhowerQuadrant, Task[]> = { q1: [], q2: [], q3: [], q4: [] };
    for (const task of scopedRoots) {
      map[classifyEisenhower(task, nowMs)].push(task);
    }
    for (const key of ['q1', 'q2', 'q3', 'q4'] as EisenhowerQuadrant[]) {
      map[key].sort((a, b) => bySmartRank(a, b, { nowMs, subtaskProgress }));
    }
    return map;
  }, [scopedRoots, subtaskProgress, nowMs]);

  const flatTasks = useMemo(
    () => QUADRANTS.flatMap((q) => (collapsed.has(q.key) ? [] : grouped[q.key])),
    [collapsed, grouped],
  );

  const cursor = useListCursor(flatTasks, taskId, {
    enabled: keyboardActive,
    scrollRef,
    estimatedRowHeight: 64,
  });

  const handleAddSubtask = useCallback((task: Task) => {
    quickAdd.open({ parentTaskId: task.id });
  }, [quickAdd]);

  const handleBeforeKey = useCallback((event: HardwareKeyEvent): boolean => {
    if (event.editing || event.modal) return false;
    if (matchesCombo(event, 'shift+a')) {
      if (!event.repeat) {
        haptic.tap();
        setScope(scope === 'near' ? 'all' : 'near');
      }
      return true;
    }
    return false;
  }, [scope, setScope]);

  useTaskShortcuts(cursor, {
    enabled: keyboardActive && !kbdSchedule && !kbdMenu,
    onSchedule: setKbdSchedule,
    onOpenMenu: setKbdMenu,
    onAddSubtask: handleAddSubtask,
    onBefore: handleBeforeKey,
  });

  const toggle = (key: EisenhowerQuadrant) => {
    haptic.tap();
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingTop: space.lg, paddingBottom: 140, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}>
        <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
        <Segmented<MatrixScope>
          value={scope} onChange={setScope}
          options={[
            { value: 'near', label: '오늘 · 이번 주', icon: 'sun' },
            { value: 'all', label: `전체 (${roots.length})`, icon: 'layers' },
          ]} />
        <Txt variant="small" tone="muted">
          우선순위(높음 이상)와 일정(오늘·기한 지남) 기준으로 자동 분류합니다. 할 일을 길게 눌러 바꾸면 바로 이동합니다.
        </Txt>
        </View>
        {QUADRANTS.map((meta) => {
          const items = grouped[meta.key];
          const isCollapsed = collapsed.has(meta.key);
          return (
            // The quadrant's place in the order is its meaning, so every quadrant looks the same: a heading, then rows.
            <View key={meta.key}>
              <View style={[styles.head, { borderBottomColor: colors.border }]}>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={`${meta.title} ${items.length}개 ${isCollapsed ? '펼치기' : '접기'}`}
                  onPress={() => toggle(meta.key)}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Icon name={meta.icon} size={16} color={colors.textFaint} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Txt variant="bodyStrong" style={{ fontWeight: '700' }}>{meta.title}</Txt>
                      <Txt variant="small" tone="faint">{items.length}</Txt>
                    </View>
                    <Txt variant="caption" tone="muted">{meta.subtitle}</Txt>
                  </View>
                  <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textFaint} />
                </Pressable>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={meta.title + '에 할 일 추가'} hitSlop={8}
                  onPress={() => quickAdd.open({ initialText: meta.quickAddText, dueToday: meta.dueToday })}
                  style={({ pressed }) => [styles.addBtn, { opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name="plus" size={17} color={colors.textMuted} />
                </Pressable>
              </View>
              {!isCollapsed ? (
                items.length > 0 ? (
                  <TaskList tasks={items} focusedTaskId={cursor.focusedId} />
                ) : (
                  <Txt variant="small" tone="faint" style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
                    해당하는 할 일이 없습니다.
                  </Txt>
                )
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <ScheduleSheet task={kbdSchedule} onClose={() => setKbdSchedule(null)} onPick={flow.reschedule} />
      <TaskMenu task={kbdMenu} onClose={() => setKbdMenu(null)} onSchedule={setKbdSchedule} />
    </>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth,
    paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: 8,
  },
  addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
