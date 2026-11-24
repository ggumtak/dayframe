import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, EmptyState, Icon, IconButton, Loading, Txt } from '@/components/ui';
import { useTasks } from '@/data/tasks';
import { runAi } from '@/features/ai/client';
import { AiErrorView, AiLoading, AiScreen, KeyGate, NoteCard, Toggle, UsageLine } from '@/features/ai/components';
import { blockChanges, type CheckedPlan, checkPlan, collectCandidates, planWindow } from '@/features/ai/plan';
import { setAiPrefs, useAiPrefs } from '@/features/ai/prefs';
import { PLAN_SYSTEM, planUser } from '@/features/ai/prompts';
import { planSchema, type RawPlan } from '@/features/ai/schemas';
import { nowContext } from '@/features/ai/time';
import { useAiRequest } from '@/features/ai/useAiRequest';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { deviceTimeZone, formatDurationMinutes, formatTime, instantFor, Temporal, today } from '@/lib/dates';
import type { TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { priorityMark } from '@/features/tasks/priority';
import { radius, space, useTheme } from '@/theme';

const STEP = 30;

function Stepper({ label, value, onChange, min, max }: { label: string; value: number; onChange: (next: number) => void; min: number; max: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stepper, { backgroundColor: colors.surfaceMuted }]}>
      <Txt variant="small" tone="muted" style={{ flex: 1 }}>{label}</Txt>
      <IconButton name="minus" label={`${label} 30분 앞당기기`} size={16} onPress={() => onChange(Math.max(min, value - STEP))} />
      <Txt variant="bodyStrong" style={{ minWidth: 78, textAlign: 'center' }}>{formatTime(value)}</Txt>
      <IconButton name="plus" label={`${label} 30분 늦추기`} size={16} onPress={() => onChange(Math.min(max, value + STEP))} />
    </View>
  );
}

/** 하루 계획: today's open tasks laid out from now to the end of the day; "적용" sets their times, with one undo. */
export default function Plan() {
  const { colors } = useTheme();
  const zone = deviceTimeZone();
  const { data: tasks, isPending } = useTasks();
  const flow = useTaskFlow();
  const prefs = useAiPrefs();
  const request = useAiRequest<RawPlan>();
  const [plan, setPlan] = useState<CheckedPlan | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const nowInstant = Temporal.Now.instant();
  const now = nowContext(nowInstant, zone);
  const candidates = useMemo(() => collectCandidates(tasks ?? [], Temporal.Now.instant()), [tasks]);
  const span = planWindow(prefs.dayStart, prefs.dayEnd, now.minutes);

  const propose = async () => {
    if (!span || !candidates.length) return;
    const asked = candidates;
    const askedWindow = span;
    setSkipped(new Set());
    const result = await request.run((signal) => runAi({
      feature: 'plan', system: PLAN_SYSTEM, user: planUser(now, askedWindow, asked),
      schema: planSchema(asked.map((candidate) => candidate.id)), effort: 'medium', signal,
    }));
    if (result) setPlan(checkPlan(result.data, asked, askedWindow));
  };

  const chosen = plan?.blocks.filter((block) => !skipped.has(block.candidate.id)) ?? [];
  const changing = chosen.filter((block) => blockChanges(block).time || blockChanges(block).duration);

  const apply = () => {
    if (!changing.length) return;
    const date = today(zone);
    const undo: (() => void)[] = [];
    for (const block of changing) {
      const { task } = block.candidate;
      const { time, duration } = blockChanges(block);
      const dueAt = instantFor(date, block.start, zone);
      if (time && task.recurrence_rule && task.due_at) {
        // Only today's occurrence moves; the series keeps its usual time.
        flow.update(task.id, { due_at: dueAt, expected_due_at: task.due_at, preserve_recurrence: true });
        const previous = task.due_at;
        undo.push(() => flow.update(task.id, { due_at: previous, expected_due_at: dueAt, preserve_recurrence: true }));
      }
      const patch: TaskPatch = {};
      const back: TaskPatch = {};
      if (time && !task.recurrence_rule) {
        Object.assign(patch, { due_at: dueAt, all_day: false });
        Object.assign(back, { due_at: task.due_at, all_day: task.all_day });
      }
      if (duration) {
        patch.duration_minutes = block.minutes;
        back.duration_minutes = task.duration_minutes;
      }
      if (Object.keys(patch).length) {
        flow.update(task.id, patch);
        undo.push(() => flow.update(task.id, back));
      }
    }
    showToast(`할 일 ${changing.length}개의 시간을 정했습니다.`, {
      actionLabel: '실행 취소', onAction: () => undo.forEach((step) => step()),
    });
    router.back();
  };

  const { state } = request;
  const preview = state.status === 'done' && plan;

  const footer = state.status === 'loading' || state.status === 'error' || !candidates.length || !span ? undefined : preview ? (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <Button label="다시 만들기" kind="secondary" icon="refresh-cw" onPress={() => void propose()} style={{ flex: 1 }} />
      <Button label={changing.length ? `적용 (${changing.length})` : '바뀌는 일 없음'} icon="check" disabled={!changing.length} onPress={apply} style={{ flex: 1.4 }} />
    </View>
  ) : (
    <Button label="계획 세우기" icon="zap" onPress={() => void propose()} />
  );

  let body;
  if (isPending) body = <Loading />;
  else if (state.status === 'loading') body = <AiLoading message="오늘 남은 시간에 할 일을 배치하고 있습니다" onCancel={request.cancel} />;
  else if (state.status === 'error') body = <AiErrorView kind={state.kind} detail={state.detail} onRetry={() => void propose()} />;
  else if (preview) {
    body = (
      <>
        {plan.note ? <NoteCard icon="sun">{plan.note}</NoteCard> : null}
        {plan.blocks.length ? <Txt variant="section" style={{ marginTop: space.sm }}>제안한 순서</Txt> : null}
        {plan.blocks.map((block) => {
          const on = !skipped.has(block.candidate.id);
          return (
            <View key={block.candidate.id} style={[styles.block, { borderBottomColor: colors.border, opacity: on ? 1 : 0.5 }]}>
              <Toggle
                on={on} label={`${block.candidate.title} 포함`}
                onPress={() => setSkipped((current) => {
                  const next = new Set(current);
                  if (next.has(block.candidate.id)) next.delete(block.candidate.id);
                  else next.add(block.candidate.id);
                  return next;
                })} />
              <View style={{ width: 88 }}>
                <Txt variant="smallStrong">{formatTime(block.start)}</Txt>
                <Txt variant="caption" tone="faint">{formatDurationMinutes(block.minutes)}</Txt>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="body" numberOfLines={2}>
                  {block.candidate.priority < 4 ? <Txt style={styles.mark}>{priorityMark(block.candidate.priority) + ' '}</Txt> : null}
                  {block.candidate.title}
                </Txt>
                {block.fixed ? <Txt variant="caption" tone="muted">이미 정한 시간</Txt>
                  : block.candidate.overdue ? <Txt variant="caption" tone="danger">지연</Txt> : null}
              </View>
            </View>
          );
        })}
        {plan.leftOut.length ? (
          <>
            <Txt variant="section" style={{ marginTop: space.md }}>이번 계획에서 뺀 일</Txt>
            {plan.leftOut.map(({ candidate, reason }) => (
              <View key={candidate.id} style={[styles.left, { backgroundColor: colors.surfaceMuted }]}>
                <Icon name="corner-down-right" size={14} color={colors.textFaint} />
                <View style={{ flex: 1 }}>
                  <Txt variant="small">{candidate.title}</Txt>
                  {reason ? <Txt variant="caption" tone="muted">{reason}</Txt> : null}
                </View>
              </View>
            ))}
          </>
        ) : null}
        <UsageLine result={state.result} />
      </>
    );
  } else if (!candidates.length) {
    body = <EmptyState icon="check-circle" title="오늘 할 일이 없습니다" message="오늘이나 지난 날짜로 잡힌 할 일이 생기면 계획을 세울 수 있습니다." />;
  } else {
    body = (
      <>
        <Txt variant="small" tone="muted">
          오늘 할 일과 지연된 할 일 {candidates.length}개를 우선순위와 걸리는 시간에 맞춰 지금부터 하루 끝까지 배치합니다. 이미 시간을 정한 일은 그대로 둡니다.
        </Txt>
        <Stepper label="하루 시작" value={prefs.dayStart} min={0} max={prefs.dayEnd - 60} onChange={(dayStart) => setAiPrefs({ dayStart })} />
        <Stepper label="하루 끝" value={prefs.dayEnd} min={prefs.dayStart + 60} max={24 * 60} onChange={(dayEnd) => setAiPrefs({ dayEnd })} />
        {!span ? (
          <NoteCard icon="moon">오늘 남은 시간이 거의 없습니다. 하루 끝을 늦추거나 내일 다시 계획해 보세요.</NoteCard>
        ) : (
          <Txt variant="caption" tone="faint">{formatTime(span.start)}부터 {formatTime(span.end)}까지 계획합니다.</Txt>
        )}
        <View style={{ gap: 6, marginTop: space.sm }}>
          {candidates.map((candidate) => (
            <View key={candidate.id} style={styles.candidate}>
              <Txt variant="small" style={{ flex: 1 }} numberOfLines={1}>
                {candidate.priority < 4 ? <Txt variant="small" style={styles.mark}>{priorityMark(candidate.priority) + ' '}</Txt> : null}
                {candidate.title}
              </Txt>
              <Txt variant="caption" tone={candidate.overdue ? 'danger' : 'faint'}>
                {candidate.fixedMinutes !== null ? formatTime(candidate.fixedMinutes) : candidate.overdue ? '지연' : '오늘'}
              </Txt>
            </View>
          ))}
        </View>
      </>
    );
  }

  return (
    <AiScreen title="하루 계획" footer={footer}>
      <KeyGate>{body}</KeyGate>
    </AiScreen>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, paddingLeft: space.md, minHeight: 48 },
  block: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  mark: { fontWeight: '700' },
  left: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md },
  candidate: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
});
