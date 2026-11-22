import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, type TextStyle, View } from 'react-native';

import { Checkbox } from '@/components/Checkbox';
import { Button, Sheet, Txt } from '@/components/ui';
import { useDeleteFocus } from '@/data/focus';
import { dueMinutes, formatTime, Temporal } from '@/lib/dates';
import type { FocusSession, Task } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { priorityColor, radius, space, type, useTheme } from '@/theme';

const HOUR = 76;
const GUTTER = 62;
const BLOCK = 36;

const hourLabel = (hour: number) => (hour < 12 ? '오전 ' : '오후 ') + (hour % 12 === 0 ? 12 : hour % 12) + '시';

interface Placed { task: Task; start: number; column: number; columns: number }

/** Tasks have no duration, so each occupies a half-hour slot; ones that collide share the row's width. */
function place(tasks: Task[]): Placed[] {
  const timed = tasks
    .map((task) => ({ task, start: dueMinutes(task) }))
    .filter((item): item is { task: Task; start: number } => item.start !== null)
    .sort((a, b) => a.start - b.start);
  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const close = () => {
    const columns = Math.max(1, ...group.map((item) => item.column + 1));
    group.forEach((item) => { item.columns = columns; });
    group = [];
  };
  for (const { task, start } of timed) {
    if (start >= groupEnd) close();
    const taken = new Set(group.filter((item) => item.start + BLOCK > start).map((item) => item.column));
    let column = 0;
    while (taken.has(column)) column++;
    const item = { task, start, column, columns: 1 };
    group.push(item);
    placed.push(item);
    groupEnd = Math.max(groupEnd, start + BLOCK);
  }
  close();
  return placed;
}

/** A day laid out by the clock: timed tasks as blocks, finished focus sessions as the time actually spent. */
export function Timeline({ tasks, sessions, timeZone, onComplete, onAddAt }: {
  tasks: Task[]; sessions: FocusSession[]; timeZone: string; onComplete: (task: Task) => void; onAddAt: (minutes: number) => void;
}) {
  const { colors } = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const scrolled = useRef(false);
  const [now, setNow] = useState(() => Temporal.Now.zonedDateTimeISO(timeZone));
  const nowMinutes = now.hour * 60 + now.minute;
  const placed = useMemo(() => place(tasks), [tasks]);
  const allDay = tasks.filter((task) => task.all_day);
  const [picked, setPicked] = useState<{ id: string; start: number; end: number; spent: number } | null>(null);
  const deleteFocus = useDeleteFocus();

  useEffect(() => {
    const timer = setInterval(() => setNow(Temporal.Now.zonedDateTimeISO(timeZone)), 60_000);
    return () => clearInterval(timer);
  }, [timeZone]);

  const focusBlocks = useMemo(() => sessions.flatMap((session) => {
    if (session.status !== 'completed' || !session.ended_at) return [];
    const start = Temporal.Instant.from(session.started_at).toZonedDateTimeISO(timeZone);
    if (Temporal.PlainDate.compare(start.toPlainDate(), now.toPlainDate()) !== 0) return [];
    const minutes = Math.max(10, Temporal.Instant.from(session.started_at).until(Temporal.Instant.from(session.ended_at)).total('minutes'));
    const end = Temporal.Instant.from(session.ended_at).toZonedDateTimeISO(timeZone);
    return [{ id: session.id, start: start.hour * 60 + start.minute, minutes, end: end.hour * 60 + end.minute, spent: Math.round(Temporal.Instant.from(session.started_at).until(Temporal.Instant.from(session.ended_at)).total('minutes')) }];
  }), [sessions, timeZone, now]);

  return (
    <View style={{ flex: 1 }}>
      {allDay.length ? (
        <View style={[styles.allDay, { borderBottomColor: colors.border }]}>
          <Txt variant="caption" tone="faint" style={{ width: GUTTER - space.lg }}>종일</Txt>
          <View style={{ flex: 1, gap: 6 }}>
            {allDay.map((task) => (
              <Pressable
                key={task.id} accessibilityRole="button" accessibilityLabel={task.title}
                onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
                style={[styles.allDayItem, { backgroundColor: colors.surfaceMuted }]}>
                <Checkbox checked={false} size={18} color={priorityColor(colors, task.priority)} onPress={() => onComplete(task)} label={task.title + ' 완료'} />
                <Text numberOfLines={1} style={[type.small as TextStyle, { color: colors.text, flex: 1 }]}>{task.title}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <ScrollView
        ref={scroll} contentContainerStyle={{ paddingBottom: 140 }}
        onLayout={() => {
          if (scrolled.current) return;
          scrolled.current = true;
          scroll.current?.scrollTo({ y: Math.max(0, (nowMinutes / 60 - 1.5) * HOUR), animated: false });
        }}>
        <View style={{ height: HOUR * 24, marginTop: space.md }}>
          {Array.from({ length: 24 }, (_, hour) => (
            <Pressable
              key={hour} accessibilityRole="button" accessibilityLabel={formatTime(hour * 60) + '에 할 일 추가'}
              onPress={() => onAddAt(hour * 60)}
              style={[styles.hour, { top: hour * HOUR, borderTopColor: colors.border }]}>
              <Txt variant="caption" tone="faint" style={styles.hourLabel} numberOfLines={1}>{hourLabel(hour)}</Txt>
            </Pressable>
          ))}

          {focusBlocks.map((block) => (
            <Pressable
              key={block.id} accessibilityRole="button" accessibilityLabel={`집중 기록 ${formatTime(block.start)}, ${block.spent}분`}
              onPress={() => setPicked(block)}
              style={[styles.focus, { top: (block.start / 60) * HOUR, height: (block.minutes / 60) * HOUR, backgroundColor: colors.accentSoft, borderLeftColor: colors.accent }]} />
          ))}

          <View pointerEvents="box-none" style={styles.lane}>
            {placed.map(({ task, start, column, columns }) => {
              const tint = priorityColor(colors, task.priority);
              return (
                <Pressable
                  key={task.id} accessibilityRole="button" accessibilityLabel={formatTime(start) + ' ' + task.title}
                  onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
                  style={[styles.block, {
                    top: (start / 60) * HOUR + 1, height: (BLOCK / 60) * HOUR - 2,
                    left: `${(column / columns) * 100}%`, width: `${100 / columns}%`,
                  }]}>
                  <View style={[styles.blockInner, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftColor: tint }]}>
                    <Checkbox checked={false} size={18} color={tint} onPress={() => onComplete(task)} label={task.title + ' 완료'} />
                    <Text numberOfLines={1} style={[type.small as TextStyle, { color: colors.text, flex: 1 }]}>{task.title}</Text>
                    {columns === 1 ? <Txt variant="caption" tone={start < nowMinutes ? 'danger' : 'muted'}>{formatTime(start)}</Txt> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View pointerEvents="none" style={[styles.now, { top: (nowMinutes / 60) * HOUR }]}>
            <View style={[styles.nowDot, { backgroundColor: colors.danger }]} />
            <View style={{ flex: 1, height: 1.5, backgroundColor: colors.danger }} />
          </View>
        </View>
      </ScrollView>
      <Sheet visible={!!picked} onClose={() => setPicked(null)} title="집중 기록">
        {picked ? (
          <View style={{ gap: space.sm }}>
            <Txt tone="muted">{formatTime(picked.start) + ' – ' + formatTime(picked.end) + ' · ' + (picked.spent < 1 ? '1분 미만' : picked.spent + '분')}</Txt>
            <Txt variant="small" tone="faint" style={{ marginBottom: space.md }}>타임라인의 파란 막대는 끝낸 집중 시간입니다. 시험으로 켠 기록이라면 지워도 됩니다.</Txt>
            <Button
              label="이 기록 삭제" kind="danger" icon="trash-2"
              onPress={() => {
                deleteFocus.mutate(picked.id);
                setPicked(null);
                showToast('집중 기록을 지웠습니다.');
              }} />
            <Button label="닫기" kind="secondary" onPress={() => setPicked(null)} />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  allDay: { flexDirection: 'row', paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  allDayItem: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.sm, paddingHorizontal: space.sm, minHeight: 34 },
  // Every layer stops at the same right margin as the rest of the app.
  hour: { position: 'absolute', left: GUTTER, right: space.lg, height: HOUR, borderTopWidth: StyleSheet.hairlineWidth },
  hourLabel: { position: 'absolute', left: -GUTTER + space.sm, top: -7, width: GUTTER - space.md },
  lane: { position: 'absolute', top: 0, bottom: 0, left: GUTTER + 4, right: space.lg },
  block: { position: 'absolute', paddingRight: 4 },
  blockInner: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3, paddingHorizontal: space.sm,
  },
  focus: { position: 'absolute', left: GUTTER + 4, right: space.lg, borderRadius: radius.sm, borderLeftWidth: 3, opacity: 0.7 },
  now: { position: 'absolute', left: GUTTER - 4, right: space.lg, flexDirection: 'row', alignItems: 'center' },
  nowDot: { width: 8, height: 8, borderRadius: 4, marginRight: -1 },
});
