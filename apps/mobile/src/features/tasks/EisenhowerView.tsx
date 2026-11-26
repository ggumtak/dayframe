import { useCallback, useMemo, useRef } from 'react';
import { Pressable, RefreshControl, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { QuadrantIcon } from '@/components/QuadrantIcon';
import { Chip, Icon, Txt } from '@/components/ui';
import { type HardwareKeyEvent, matchesCombo, useListCursor, useTaskShortcuts } from '@/features/keyboard';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { TaskListSheets, TaskRows, useTaskListModel } from '@/features/tasks/TaskList';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueDate, logicalToday, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { usePersistentState } from '@/lib/persist';
import type { Task } from '@/lib/shared';
import { bySmartRank, classifyEisenhower, type EisenhowerQuadrant, type SubtaskProgress } from '@/lib/smart';
import { space, useTheme } from '@/theme';

type MatrixScope = 'near' | 'all';
const isMatrixScope = (value: string): value is MatrixScope => value === 'near' || value === 'all';
const QUADRANT_KEYS: readonly EisenhowerQuadrant[] = ['q1', 'q2', 'q3', 'q4'];
const isQuadrantKey = (value: string): value is EisenhowerQuadrant =>
  value === 'q1' || value === 'q2' || value === 'q3' || value === 'q4';
const isCollapsedString = (value: string): value is string =>
  value === '' || value.split(',').every(isQuadrantKey);
const taskId = (task: Task) => task.id;

interface QuadrantMeta {
  key: EisenhowerQuadrant;
  /** One word on screen (DESIGN.md rule 15); the icon's filled cell shows where the quadrant sits. */
  title: string;
  /** What screen readers hear: the word plus what puts a task there. */
  a11y: string;
  quickAddText: string;
  dueToday?: boolean;
}

const QUADRANTS: QuadrantMeta[] = [
  { key: 'q1', title: '먼저', a11y: '먼저 (중요하고 오늘까지)', quickAddText: '오늘 p1 ', dueToday: true },
  { key: 'q2', title: '계획', a11y: '계획 (중요, 여유 있음)', quickAddText: 'p2 ' },
  { key: 'q3', title: '오늘', a11y: '오늘 (오늘까지)', quickAddText: '오늘 ', dueToday: true },
  { key: 'q4', title: '나중에', a11y: '나중에', quickAddText: '' },
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
  const { dayStartHour } = usePersonalPrefs();
  const { model, sheets } = useTaskListModel();
  const nowMs = useMinute() * 60_000;
  const [scope, setScope] = usePersistentState<MatrixScope>('dayframe-matrix-scope', 'near', isMatrixScope);
  const [collapsedRaw, setCollapsedRaw] = usePersistentState<string>('dayframe-matrix-collapsed', 'q4', isCollapsedString);
  const scrollRef = useRef<ScrollViewInstance>(null);

  const collapsed = useMemo(
    () => new Set<EisenhowerQuadrant>(collapsedRaw ? collapsedRaw.split(',').filter(isQuadrantKey) : []),
    [collapsedRaw],
  );

  const effectiveNowMs = useMemo(() => {
    const shift = Math.max(0, Math.min(5, Math.round(dayStartHour)));
    return nowMs - shift * 3_600_000;
  }, [nowMs, dayStartHour]);

  const scopedRoots = useMemo(() => {
    if (scope === 'all') return roots;
    const tz = deviceTimeZone();
    const todayRef = logicalToday(tz, dayStartHour, Temporal.Instant.fromEpochMilliseconds(nowMs));
    return roots.filter((task) => {
      if (task.priority <= 2 && !task.due_at) return true;
      const d = dueDate(task);
      if (!d) return false;
      const delta = todayRef.until(d).days;
      return delta <= 7;
    });
  }, [roots, scope, nowMs, dayStartHour]);

  const grouped = useMemo(() => {
    const map: Record<EisenhowerQuadrant, Task[]> = { q1: [], q2: [], q3: [], q4: [] };
    for (const task of scopedRoots) {
      map[classifyEisenhower(task, effectiveNowMs)].push(task);
    }
    for (const key of QUADRANT_KEYS) {
      map[key].sort((a, b) => bySmartRank(a, b, { nowMs, subtaskProgress }));
    }
    return map;
  }, [scopedRoots, subtaskProgress, nowMs, effectiveNowMs]);

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
    enabled: keyboardActive && !sheets.scheduling && !sheets.menu,
    onSchedule: sheets.setScheduling,
    onOpenMenu: sheets.setMenu,
    onAddSubtask: handleAddSubtask,
    onBefore: handleBeforeKey,
  });

  const persistCollapsed = useCallback((next: Set<EisenhowerQuadrant>) => {
    const serialized = QUADRANT_KEYS.filter((k) => next.has(k)).join(',');
    setCollapsedRaw(serialized);
  }, [setCollapsedRaw]);

  const toggle = useCallback((key: EisenhowerQuadrant) => {
    haptic.tap();
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persistCollapsed(next);
  }, [collapsed, persistCollapsed]);

  return (
    <>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingTop: space.xs, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}>
        <View style={styles.scopeRow}>
          <Chip
            label="이번 주" accessibilityLabel="이번 주 할 일만 보기" selected={scope === 'near'}
            onPress={() => setScope('near')} />
          <Chip
            label="전체" accessibilityLabel="전체 할 일 보기" selected={scope === 'all'}
            onPress={() => setScope('all')} />
        </View>

        {QUADRANTS.map((meta, index) => {
          const items = grouped[meta.key];
          const empty = items.length === 0;
          const isCollapsed = collapsed.has(meta.key);
          const add = (
            <Pressable
              accessibilityRole="button" accessibilityLabel={meta.title + '에 할 일 추가'} hitSlop={10}
              onPress={() => quickAdd.open({ initialText: meta.quickAddText, dueToday: meta.dueToday })}
              style={({ pressed }) => [styles.addBtn, { opacity: pressed ? 0.6 : 1 }]}>
              <Icon name="plus" size={17} color={colors.textMuted} />
            </Pressable>
          );
          return (
            // The quadrant's place in the order is its meaning, so every quadrant looks the same: a heading, then rows.
            // An empty quadrant is one quiet row: dimmed mark and name, no count, nothing to fold.
            <View key={meta.key} style={index > 0 ? styles.section : undefined}>
              <View style={[styles.head, { borderBottomColor: colors.border }]}>
                {empty ? (
                  <View style={styles.headMain} accessible accessibilityRole="header" accessibilityLabel={`${meta.a11y} 0개`}>
                    <QuadrantIcon quadrant={meta.key} dim />
                    <Txt variant="bodyStrong" tone="faint" style={styles.headTitle}>{meta.title}</Txt>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button" accessibilityLabel={`${meta.a11y} ${items.length}개 ${isCollapsed ? '펼치기' : '접기'}`}
                    accessibilityState={{ expanded: !isCollapsed }}
                    onPress={() => toggle(meta.key)}
                    style={styles.headMain}>
                    <QuadrantIcon quadrant={meta.key} />
                    <Txt variant="bodyStrong" style={styles.headTitle}>{meta.title}</Txt>
                    <Txt variant="small" tone="faint" tabular>{items.length}</Txt>
                    <View style={{ flex: 1 }} />
                    <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textFaint} />
                  </Pressable>
                )}
                {add}
              </View>
              {!isCollapsed && !empty ? <TaskRows model={model} tasks={items} focusedTaskId={cursor.focusedId} /> : null}
            </View>
          );
        })}
      </ScrollView>
      <TaskListSheets sheets={sheets} />
    </>
  );
}

const styles = StyleSheet.create({
  scopeRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.xs },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth,
    paddingLeft: space.lg, paddingRight: space.sm, minHeight: 44,
  },
  section: { marginTop: space.sm },
  headMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  headTitle: { fontWeight: '700' },
  addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
