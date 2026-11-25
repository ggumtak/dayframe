import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Icon, type IconName, Segmented, Txt } from '@/components/ui';
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
import { radius, space, useTheme } from '@/theme';

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
  const { dayStartHour } = usePersonalPrefs();
  const { model, sheets } = useTaskListModel();
  const nowMs = useMinute() * 60_000;
  const [scope, setScope] = usePersistentState<MatrixScope>('dayframe-matrix-scope', 'near', isMatrixScope);
  const [collapsedRaw, setCollapsedRaw] = usePersistentState<string>('dayframe-matrix-collapsed', 'q4', isCollapsedString);
  const [focusedQuadrant, setFocusedQuadrant] = useState<EisenhowerQuadrant | null>(null);
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

  const visibleQuadrants = useMemo(
    () => (focusedQuadrant ? QUADRANTS.filter((q) => q.key === focusedQuadrant) : QUADRANTS),
    [focusedQuadrant],
  );

  const flatTasks = useMemo(
    () => visibleQuadrants.flatMap((q) => (!focusedQuadrant && collapsed.has(q.key) ? [] : grouped[q.key])),
    [visibleQuadrants, focusedQuadrant, collapsed, grouped],
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
    if (matchesCombo(event, 'escape') && focusedQuadrant) {
      if (!event.repeat) setFocusedQuadrant(null);
      return true;
    }
    return false;
  }, [scope, setScope, focusedQuadrant]);

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

  const selectQuadrant = useCallback((key: EisenhowerQuadrant) => {
    haptic.tap();
    if (focusedQuadrant === key) {
      setFocusedQuadrant(null);
      return;
    }
    if (collapsed.has(key)) {
      const next = new Set(collapsed);
      next.delete(key);
      persistCollapsed(next);
    }
    setFocusedQuadrant(key);
  }, [focusedQuadrant, collapsed, persistCollapsed]);

  return (
    <>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingTop: space.md, paddingBottom: 140, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}>
        <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
          <Segmented<MatrixScope>
            value={scope} onChange={setScope}
            options={[
              { value: 'near', label: '오늘 · 이번 주', icon: 'sun' },
              { value: 'all', label: `전체 (${roots.length})`, icon: 'layers' },
            ]} />

          <View style={styles.grid}>
            {QUADRANTS.map((meta) => {
              const count = grouped[meta.key].length;
              const active = focusedQuadrant === meta.key;
              return (
                <Pressable
                  key={meta.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${meta.title} ${count}개 ${active ? '필터 해제' : '만 보기'}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => selectQuadrant(meta.key)}
                  style={({ pressed }) => [
                    styles.gridCard,
                    {
                      backgroundColor: active ? colors.accentSoft : colors.surface,
                      borderColor: active ? colors.accent : colors.border,
                      opacity: pressed ? 0.78 : 1,
                    },
                  ]}>
                  <View style={styles.gridCardTop}>
                    <Icon name={meta.icon} size={14} color={active ? colors.accentText : colors.textFaint} />
                    <Txt variant="smallStrong" tone={active ? 'accent' : 'default'} numberOfLines={1} style={{ flex: 1 }}>
                      {meta.title}
                    </Txt>
                    <Txt variant="bodyStrong" tone={active ? 'accent' : count > 0 ? 'default' : 'faint'} tabular>
                      {count}
                    </Txt>
                  </View>
                  <Txt variant="caption" tone={active ? 'accent' : 'muted'} numberOfLines={1}>
                    {meta.subtitle}
                  </Txt>
                </Pressable>
              );
            })}
          </View>

          {focusedQuadrant ? (
            <View style={styles.filterBar}>
              <Txt variant="caption" tone="muted">선택한 사분면만 보고 있습니다</Txt>
              <Pressable
                accessibilityRole="button" accessibilityLabel="모든 사분면 보기" hitSlop={8}
                onPress={() => {
                  haptic.tap();
                  setFocusedQuadrant(null);
                }}>
                <Txt variant="smallStrong" tone="accent">전체 보기</Txt>
              </Pressable>
            </View>
          ) : null}
        </View>

        {visibleQuadrants.map((meta) => {
          const items = grouped[meta.key];
          const isCollapsed = !focusedQuadrant && collapsed.has(meta.key);
          return (
            // The quadrant's place in the order is its meaning, so every quadrant looks the same: a heading, then rows.
            <View key={meta.key}>
              <View style={[styles.head, { borderBottomColor: colors.border }]}>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={`${meta.title} ${items.length}개 ${isCollapsed ? '펼치기' : '접기'}`}
                  disabled={!!focusedQuadrant}
                  onPress={() => toggle(meta.key)}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Icon name={meta.icon} size={16} color={colors.textFaint} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Txt variant="bodyStrong" style={{ fontWeight: '700' }}>{meta.title}</Txt>
                      <Txt variant="small" tone="faint" tabular>{items.length}</Txt>
                    </View>
                    <Txt variant="caption" tone="muted">{meta.subtitle}</Txt>
                  </View>
                  {!focusedQuadrant ? (
                    <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textFaint} />
                  ) : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={meta.title + '에 할 일 추가'} hitSlop={10}
                  onPress={() => quickAdd.open({ initialText: meta.quickAddText, dueToday: meta.dueToday })}
                  style={({ pressed }) => [styles.addBtn, { opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name="plus" size={17} color={colors.textMuted} />
                </Pressable>
              </View>
              {!isCollapsed ? (
                items.length > 0 ? (
                  <TaskRows model={model} tasks={items} focusedTaskId={cursor.focusedId} />
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
      <TaskListSheets sheets={sheets} />
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  gridCard: {
    width: '48.5%',
    flexGrow: 1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    gap: 4,
  },
  gridCardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth,
    paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: 8,
  },
  addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
