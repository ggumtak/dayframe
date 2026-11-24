import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Icon, type IconName, Segmented, Txt } from '@/components/ui';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { TaskList } from '@/features/tasks/TaskList';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, dueDate, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { usePersistentState } from '@/lib/persist';
import type { Task } from '@/lib/shared';
import { bySmartRank, classifyEisenhower, type EisenhowerQuadrant, type SubtaskProgress } from '@/lib/smart';
import { radius, space, useTheme } from '@/theme';

type MatrixScope = 'near' | 'all';
const isMatrixScope = (value: string): value is MatrixScope => value === 'near' || value === 'all';

interface QuadrantMeta {
  key: EisenhowerQuadrant;
  title: string;
  subtitle: string;
  icon: IconName;
  quickAddText: string;
  dueToday?: boolean;
}

const QUADRANTS: QuadrantMeta[] = [
  { key: 'q1', title: '긴급 · 중요', subtitle: '지금 바로 실행', icon: 'alert-circle', quickAddText: '오늘 p1 ', dueToday: true },
  { key: 'q2', title: '중요 · 계획', subtitle: '일정 잡아 집중', icon: 'compass', quickAddText: 'p2 ' },
  { key: 'q3', title: '긴급 · 빠른 처리', subtitle: '짧게 끝내기', icon: 'clock', quickAddText: '오늘 ', dueToday: true },
  { key: 'q4', title: '나중에 · 보류', subtitle: '정리하거나 미루기', icon: 'inbox', quickAddText: '' },
];

/** TickTick-style Eisenhower Matrix grouping every open root task into 4 actionable quadrants. */
export function EisenhowerView({
  roots, subtaskProgress, refreshing, onRefresh,
}: {
  roots: Task[];
  subtaskProgress: Map<string, SubtaskProgress>;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { colors } = useTheme();
  const quickAdd = useQuickAdd();
  const nowMs = useMinute() * 60_000;
  const [scope, setScope] = usePersistentState<MatrixScope>('dayframe-matrix-scope', 'near', isMatrixScope);
  const [collapsed, setCollapsed] = useState<Set<EisenhowerQuadrant>>(() => new Set(['q4']));

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

  const palette = (key: EisenhowerQuadrant) => {
    if (key === 'q1') return { fg: colors.danger, bg: colors.dangerSoft };
    if (key === 'q2') return { fg: colors.warning, bg: colors.warningSoft };
    if (key === 'q3') return { fg: colors.info, bg: colors.infoSoft };
    return { fg: colors.textMuted, bg: colors.surfaceMuted };
  };

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
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.md }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}>
      <Segmented<MatrixScope>
        value={scope} onChange={setScope}
        options={[
          { value: 'near', label: '오늘 · 이번 주', icon: 'sun' },
          { value: 'all', label: `전체 (${roots.length})`, icon: 'layers' },
        ]} />
      <Txt variant="small" tone="muted">
        우선순위(가장 높음·높음)와 날짜(오늘·지연)를 보고 자동으로 나눕니다. 할 일을 길게 눌러 우선순위나 날짜를 바꾸면 바로 다른 칸으로 옮겨집니다.
      </Txt>
      {QUADRANTS.map((meta) => {
        const items = grouped[meta.key];
        const tone = palette(meta.key);
        const isCollapsed = collapsed.has(meta.key);
        return (
          <View key={meta.key} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={[styles.head, { backgroundColor: tone.bg }]}>
              <Pressable
                accessibilityRole="button" accessibilityLabel={`${meta.title} ${items.length}개 ${isCollapsed ? '펼치기' : '접기'}`}
                onPress={() => toggle(meta.key)}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Icon name={meta.icon} size={16} color={tone.fg} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Txt variant="bodyStrong" style={{ color: tone.fg }}>{meta.title}</Txt>
                    <Txt variant="smallStrong" style={{ color: tone.fg, opacity: 0.8 }}>{items.length}</Txt>
                  </View>
                  <Txt variant="caption" tone="muted">{meta.subtitle}</Txt>
                </View>
                <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={16} color={tone.fg} />
              </Pressable>
              <Pressable
                accessibilityRole="button" accessibilityLabel={meta.title + '에 할 일 추가'} hitSlop={8}
                onPress={() => quickAdd.open({ initialText: meta.quickAddText, dueToday: meta.dueToday })}
                style={({ pressed }) => [styles.addBtn, { opacity: pressed ? 0.6 : 1 }]}>
                <Icon name="plus" size={17} color={tone.fg} />
              </Pressable>
            </View>
            {!isCollapsed ? (
              items.length > 0 ? (
                <TaskList tasks={items} />
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
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingLeft: space.md, paddingRight: space.sm, paddingVertical: 10,
  },
  addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
