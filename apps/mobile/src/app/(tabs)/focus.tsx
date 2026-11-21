import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Button, Card, Chip, Header, Icon, Row, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import { useFocusActions, useFocusSessions } from '@/data/focus';
import { useHabits } from '@/data/habits';
import { bySchedule, useTaskIndex } from '@/data/tasks';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, formatDuration, formatMinutes, formatTime, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { FocusSession } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { space, useTheme } from '@/theme';

/** Pomodoro rhythms: focus, a short break after each round, and a long break after every fourth. */
const modes = [
  { minutes: 25, rest: 5, longRest: 15, label: '25분 집중', detail: '휴식 5분' },
  { minutes: 50, rest: 10, longRest: 30, label: '50분 집중', detail: '휴식 10분' },
] as const;
const ROUNDS = 4;
const modeFor = (plannedSeconds: number) => (plannedSeconds > 40 * 60 ? modes[1] : modes[0]);
const SIZE = 248;
const STROKE = 10;

type Target = { kind: 'task' | 'habit'; id: string } | null;

function elapsedSeconds(session: FocusSession, now: number): number {
  return Math.max(0, (now - new Date(session.started_at).getTime()) / 1000);
}

export default function Focus() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ taskId?: string; habitId?: string; at?: string }>();
  const { data: sessions } = useFocusSessions();
  const { data: habits } = useHabits();
  const { tasks, byId } = useTaskIndex();
  const actions = useFocusActions();
  const flow = useTaskFlow();
  const [chosen, setChosen] = useState<number | null>(null);
  const [target, setTarget] = useState<Target>(null);
  const [picking, setPicking] = useState(false);
  const [rest, setRest] = useState<{ endsAt: number; seconds: number; long: boolean } | null>(null);
  const breakEndsAt = rest?.endsAt ?? null;
  const [now, setNow] = useState(() => Date.now());
  const finished = useRef(new Set<string>());
  const timeZone = deviceTimeZone();
  useMinute();

  const running = sessions?.find((session) => session.status === 'running') ?? null;
  // Opens on the rhythm used last time.
  const lastPlanned = sessions?.find((session) => session.status !== 'running')?.planned_seconds;
  const mode = modes.find((item) => item.minutes === chosen) ?? modeFor(lastPlanned ?? 0);
  const minutes = mode.minutes;
  const ticking = !!running || breakEndsAt !== null;

  // Arriving from a task or habit attaches it to the next session.
  // `at` differs on every arrival, so coming back from the same task attaches it again.
  const link = (params.taskId ? 'task:' + params.taskId : params.habitId ? 'habit:' + params.habitId : '') + '@' + (params.at ?? '');
  const [appliedLink, setAppliedLink] = useState('@');
  if (link !== appliedLink) {
    setAppliedLink(link);
    if (params.taskId) setTarget({ kind: 'task', id: params.taskId });
    else if (params.habitId) setTarget({ kind: 'habit', id: params.habitId });
  }

  // Totalled on every render: the timer and `useMinute` keep this screen current across midnight.
  const day = Temporal.Now.plainDateISO(timeZone);
  const doneToday = (sessions ?? []).filter((session) => session.status === 'completed' && session.ended_at
    && Temporal.Instant.from(session.started_at).toZonedDateTimeISO(timeZone).toPlainDate().equals(day));
  const todayStats = {
    count: doneToday.length,
    seconds: doneToday.reduce((sum, session) =>
      sum + (new Date(session.ended_at!).getTime() - new Date(session.started_at).getTime()) / 1000, 0),
  };

  /** Starts the break a finished round has earned: a long one after every fourth round of the day. */
  const beginRest = (plannedSeconds: number, roundsBefore: number, from: number) => {
    const rhythm = modeFor(plannedSeconds);
    const long = (roundsBefore + 1) % ROUNDS === 0;
    const seconds = (long ? rhythm.longRest : rhythm.rest) * 60;
    setRest({ endsAt: from + seconds * 1000, seconds, long });
  };

  const nameOf = (session: Pick<FocusSession, 'task_id' | 'habit_id'>) => (session.task_id
    ? byId.get(session.task_id)?.title : session.habit_id ? habits?.find((habit) => habit.id === session.habit_id)?.name : undefined);

  // The interval reads the newest state through this ref, so it never has to be torn down mid-session.
  const latest = useRef({ running, breakEndsAt, byId, actions, flow, beginRest, rounds: todayStats.count });
  useEffect(() => {
    latest.current = { running, breakEndsAt, byId, actions, flow, beginRest, rounds: todayStats.count };
  });

  useEffect(() => {
    if (!ticking) return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      const state = latest.current;
      const session = state.running;
      // The timer is anchored to the recorded start time, so it also ends correctly after the app was closed.
      const endsAt = session ? new Date(session.started_at).getTime() + session.planned_seconds * 1000 : 0;
      if (session && time >= endsAt && !finished.current.has(session.id)) {
        finished.current.add(session.id);
        state.actions.finish({ id: session.id, status: 'completed', ended_at: new Date(endsAt).toISOString() });
        haptic.success();
        const task = session.task_id ? state.byId.get(session.task_id) : undefined;
        showToast(`집중 ${formatMinutes(session.planned_seconds)} 완료!`, task
          ? { actionLabel: '할 일도 완료', onAction: () => state.flow.complete(task) } : {});
        state.beginRest(session.planned_seconds, state.rounds, time);
      } else if (!session && state.breakEndsAt !== null && time >= state.breakEndsAt) {
        setRest(null);
        haptic.medium();
        showToast('휴식이 끝났습니다. 다음 집중을 시작해 보세요.');
      }
    };
    const timer = setInterval(tick, 500);
    activateKeepAwakeAsync('dayframe-focus').catch(() => {});
    return () => {
      clearInterval(timer);
      deactivateKeepAwake('dayframe-focus').catch(() => {});
    };
  }, [ticking]);

  const elapsed = running ? elapsedSeconds(running, now) : 0;
  const remaining = running ? running.planned_seconds - elapsed : minutes * 60;
  const breakRemaining = breakEndsAt === null ? 0 : (breakEndsAt - now) / 1000;

  const start = () => {
    haptic.medium();
    setRest(null);
    actions.start({
      planned_seconds: minutes * 60,
      ...(target?.kind === 'task' ? { task_id: target.id } : target?.kind === 'habit' ? { habit_id: target.id } : {}),
    });
  };

  const stop = (status: 'completed' | 'cancelled') => {
    if (!running) return;
    finished.current.add(running.id);
    haptic.light();
    actions.finish({ id: running.id, status, ended_at: new Date().toISOString() });
    if (status === 'completed') {
      showToast(`집중 ${formatMinutes(elapsed)} 기록했습니다.`);
      beginRest(running.planned_seconds, todayStats.count, Date.now());
    }
  };

  const candidates = useMemo(() => tasks
    .filter((task) => ['overdue', 'today'].includes(dueBucket(task))).sort(bySchedule).slice(0, 12), [tasks]);
  const activeHabits = (habits ?? []).filter((habit) => !habit.archived_at);
  const targetName = running ? nameOf(running)
    : target ? nameOf({ task_id: target.kind === 'task' ? target.id : null, habit_id: target.kind === 'habit' ? target.id : null }) : undefined;

  const onBreak = !running && breakEndsAt !== null;
  const total = running ? running.planned_seconds : onBreak ? rest!.seconds : minutes * 60;
  const round = todayStats.count % ROUNDS;
  const shown = Math.max(0, running ? remaining : onBreak ? breakRemaining : minutes * 60);
  const ratio = total > 0 ? Math.min(1, Math.max(0, 1 - shown / total)) : 0;
  const r = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const ringColor = onBreak ? colors.success : colors.accent;
  const recent = (sessions ?? []).filter((session) => session.status !== 'running').slice(0, 5);

  return (
    <Screen>
      <Header
        title="집중" subtitle={todayStats.count ? `오늘 ${todayStats.count}회 · ${formatMinutes(todayStats.seconds)}` : '오늘 첫 집중을 시작해 보세요'} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.lg, alignItems: 'center' }}>
        <View
          style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center', marginTop: space.sm }}
          accessibilityRole="timer" accessibilityLabel={`${onBreak ? '휴식' : '집중'} 남은 시간 ${formatDuration(shown)}`}>
          <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
            <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={colors.surfaceMuted} strokeWidth={STROKE} fill="none" />
            {ratio > 0.002 ? (
              <Circle
                cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={ringColor} strokeWidth={STROKE} fill="none" strokeLinecap="round"
                strokeDasharray={`${circumference * ratio} ${circumference}`} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
            ) : null}
          </Svg>
          <Txt variant="caption" tone="muted" style={{ marginBottom: 4 }}>
            {running ? '집중 중' : onBreak ? (rest!.long ? '긴 휴식 중' : '휴식 중') : '준비'}
          </Txt>
          <Txt style={{ fontSize: 56, lineHeight: 64, fontWeight: '300', fontVariant: ['tabular-nums'] }}>{formatDuration(shown)}</Txt>
          {targetName ? (
            <Txt variant="small" tone="muted" numberOfLines={1} style={{ maxWidth: SIZE - 64, marginTop: 4 }}>{targetName}</Txt>
          ) : null}
        </View>

        {running ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' }}>
            <Button label="그만두기" kind="secondary" icon="x" onPress={() => stop('cancelled')} style={{ flex: 1 }} />
            <Button label="지금 완료" icon="check" onPress={() => stop('completed')} style={{ flex: 1 }} />
          </View>
        ) : (
          <>
            <View style={{ alignSelf: 'stretch', gap: space.sm }}>
              <Segmented<string>
                value={String(minutes)} onChange={(value) => setChosen(Number(value))}
                options={modes.map((item) => ({ value: String(item.minutes), label: item.label + ' · ' + item.detail }))} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }} accessibilityLabel={`${ROUNDS}회 중 ${round}회 완료`}>
                {Array.from({ length: ROUNDS }, (_, index) => (
                  <View
                    key={index}
                    style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: index < round ? colors.accent : colors.surfaceMuted }} />
                ))}
                <Txt variant="small" tone="muted" style={{ marginLeft: 4 }}>
                  {ROUNDS - round}회 더 하면 긴 휴식 {mode.longRest}분
                </Txt>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <Chip icon="link" label={targetName ?? '할 일·습관 연결'} color={target ? colors.accent : undefined} onPress={() => setPicking(true)} style={{ maxWidth: 260 }} />
              {target ? <Chip icon="x" label="해제" onPress={() => setTarget(null)} /> : null}
            </View>
            <View style={{ alignSelf: 'stretch', gap: space.sm }}>
              <Button label={onBreak ? '휴식 건너뛰고 집중 시작' : '집중 시작'} icon="play" onPress={start} />
              {onBreak ? <Button label="휴식 끝내기" kind="ghost" onPress={() => setRest(null)} /> : null}
            </View>
          </>
        )}

        {recent.length ? (
          <Card style={{ alignSelf: 'stretch', gap: space.sm }}>
            <Txt variant="section" tone="muted">최근 기록</Txt>
            {recent.map((session) => {
              const started = Temporal.Instant.from(session.started_at).toZonedDateTimeISO(timeZone);
              const seconds = session.ended_at ? (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000 : 0;
              return (
                <View key={session.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Icon
                    name={session.status === 'completed' ? 'check-circle' : 'x-circle'} size={18}
                    color={session.status === 'completed' ? colors.success : colors.textFaint} />
                  <View style={{ flex: 1 }}>
                    <Txt numberOfLines={1}>{nameOf(session) ?? '자유 집중'}</Txt>
                    <Txt variant="small" tone="muted">
                      {started.month}월 {started.day}일 {formatTime(started.hour * 60 + started.minute)}
                    </Txt>
                  </View>
                  <Txt variant="smallStrong" tone={session.status === 'completed' ? 'default' : 'faint'}>{formatMinutes(seconds)}</Txt>
                </View>
              );
            })}
          </Card>
        ) : null}
      </ScrollView>

      <Sheet visible={picking} onClose={() => setPicking(false)} title="무엇에 집중할까요?">
        <ScrollView style={{ maxHeight: 420 }}>
          {candidates.length ? <Txt variant="section" tone="muted">오늘 할 일</Txt> : null}
          {candidates.map((task) => (
            <Row
              key={task.id} icon="check-square" label={task.title}
              onPress={() => {
                setTarget({ kind: 'task', id: task.id });
                setPicking(false);
              }} />
          ))}
          {activeHabits.length ? <Txt variant="section" tone="muted" style={{ marginTop: space.md }}>습관</Txt> : null}
          {activeHabits.map((habit) => (
            <Row
              key={habit.id} icon="repeat" label={habit.name}
              onPress={() => {
                setTarget({ kind: 'habit', id: habit.id });
                setPicking(false);
              }} />
          ))}
          {!candidates.length && !activeHabits.length ? (
            <Txt tone="muted" style={{ paddingVertical: space.lg }}>오늘 할 일이나 습관이 있으면 여기에서 연결할 수 있습니다.</Txt>
          ) : null}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}
