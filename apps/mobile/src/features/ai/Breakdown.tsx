import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, Sheet, Txt } from '@/components/ui';
import { nextPosition, useCompletedTasks, useTaskIndex } from '@/data/tasks';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { deviceTimeZone, formatDurationMinutes } from '@/lib/dates';
import type { Task } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { fontFamily, radius, space, useTheme } from '@/theme';

import { runAi } from './client';
import { AiErrorView, AiLoading, KeyGate, Toggle, UsageLine } from './components';
import { BREAKDOWN_SYSTEM, breakdownUser } from './prompts';
import { type BreakdownStep, breakdownSchema } from './schemas';
import { useAiRequest } from './useAiRequest';

interface Draft extends BreakdownStep {
  key: number;
  include: boolean;
}

/**
 * 큰 일 쪼개기 for one task: asks as soon as it mounts, shows the steps to tick and rename, and adds the
 * chosen ones as subtasks. Used by AiBreakdownSheet and the /assistant/breakdown screen.
 */
export function BreakdownPanel({ task, onDone, maxHeight, inSheet }: { task: Task; onDone: () => void; maxHeight?: number; inSheet?: boolean }) {
  const { colors } = useTheme();
  const flow = useTaskFlow();
  const { children } = useTaskIndex();
  const { data: completed } = useCompletedTasks();
  const request = useAiRequest<BreakdownStep[]>();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  const open = useMemo(() => children.get(task.id) ?? [], [children, task.id]);
  const done = useMemo(() => (completed ?? []).filter((item) => item.parent_task_id === task.id), [completed, task.id]);
  const existing = useMemo(() => [...open, ...done].map((item) => item.title), [open, done]);

  const ask = async () => {
    setDrafts(null);
    const result = await request.run((signal) => runAi({
      feature: 'breakdown', system: BREAKDOWN_SYSTEM, user: breakdownUser(task.title, task.notes, existing),
      schema: breakdownSchema(existing), effort: 'low', signal,
    }));
    if (result) setDrafts(result.data.map((step, index) => ({ ...step, key: index, include: true })));
  };

  // Ask once when opened; the panel only mounts when the owner asked for a breakdown.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = drafts?.filter((draft) => draft.include && draft.title.trim()) ?? [];

  const add = () => {
    if (!chosen.length) return;
    const zone = deviceTimeZone();
    const base = nextPosition([...open, ...done]);
    chosen.forEach((step, index) => {
      flow.create({
        input: {
          title: step.title.trim(), priority: 4, timezone: zone, position: base + index * 1024, parent_task_id: task.id,
          ...(step.minutes ? { duration_minutes: step.minutes } : {}),
        },
      });
    });
    showToast(`하위 작업 ${chosen.length}개를 추가했습니다.`);
    onDone();
  };

  const { state } = request;
  return (
    // In a sheet, going to the key screen closes the sheet first so the screen is not opened underneath it.
    <KeyGate onLeave={inSheet ? onDone : undefined}>
      {state.status === 'loading' ? (
        <AiLoading message="바로 시작할 수 있는 단계로 나누고 있습니다" onCancel={() => { request.cancel(); onDone(); }} />
      ) : state.status === 'error' ? (
        <AiErrorView kind={state.kind} detail={state.detail} onRetry={() => void ask()} onLeave={inSheet ? onDone : undefined} />
      ) : state.status === 'done' && drafts ? (
        <View style={{ gap: space.md }}>
          <ScrollView style={maxHeight ? { maxHeight } : undefined} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm }}>
            <Txt variant="small" tone="muted">‘{task.title}’의 하위 작업으로 추가합니다. 항목을 눌러 바로 수정할 수 있습니다.</Txt>
            {drafts.map((draft) => (
              <View key={draft.key} style={[styles.row, { borderColor: colors.border, opacity: draft.include ? 1 : 0.5 }]}>
                <Toggle
                  on={draft.include} label={`${draft.title} 포함`}
                  onPress={() => setDrafts((list) => list?.map((item) => (item.key === draft.key ? { ...item, include: !item.include } : item)) ?? null)} />
                <TextInput
                  value={draft.title} accessibilityLabel="하위 작업 제목" returnKeyType="done"
                  onChangeText={(title) => setDrafts((list) => list?.map((item) => (item.key === draft.key ? { ...item, title } : item)) ?? null)}
                  style={[styles.input, { color: colors.text, fontFamily }]} />
                {draft.minutes ? <Txt variant="caption" tone="faint">{formatDurationMinutes(draft.minutes)}</Txt> : null}
              </View>
            ))}
            <UsageLine result={state.result} />
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="다시 나누기" kind="secondary" icon="refresh-cw" onPress={() => void ask()} style={{ flex: 1 }} />
            <Button
              label={chosen.length ? `하위 작업 ${chosen.length}개 추가` : '선택한 항목 없음'} disabled={!chosen.length} onPress={add}
              style={{ flex: 1.6 }} />
          </View>
        </View>
      ) : null}
    </KeyGate>
  );
}

/** "AI로 쪼개기" from a task's menu or detail screen. Mounts its content (and asks) only while open. */
export function AiBreakdownSheet({ task, visible, onClose }: { task: Task | null; visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible && !!task} onClose={onClose} title="큰 일 쪼개기">
      {visible && task ? <BreakdownPanel task={task} onDone={onClose} maxHeight={440} inSheet /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderWidth: 1 },
  input: { flex: 1, fontSize: 16, lineHeight: 22, paddingVertical: 6 },
});
