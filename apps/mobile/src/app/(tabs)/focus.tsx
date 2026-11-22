import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Button, Card, Chip, Header, Icon, IconButton, Row, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import { useDeleteFocus, useFocusActions, useFocusSessions } from '@/data/focus';
import { useHabits } from '@/data/habits';
import { bySchedule, useTaskIndex } from '@/data/tasks';
import { clampInt, FOCUS_LIMITS, type FocusMode, type FocusPrefs, nextBreak, setFocusPrefs, useFocusPrefs } from '@/features/focus/prefs';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { cancelAlert, prepareAlerts, scheduleAlert } from '@/lib/alerts';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, formatDuration, formatMinutes, formatTime, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { FocusSession } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

const SIZE = 248;
const STROKE = 10;

const pomoPresets = [
  { label: '15 / 3분', focus: 15, rest: 3, longRest: 10 },
  { label: '25 / 5분', focus: 25, rest: 5, longRest: 15 },
  { label: '50 / 10분', focus: 50, rest: 10, longRest: 30 },
] as const;

const timerPresets = [10, 15, 25, 45, 60, 90] as const;
const roundChoices = [2, 3, 4, 6] as const;

type Target = { kind: 'task' | 'habit'; id: string } | null;

function elapsedSeconds(session: FocusSession, now: number): number {
  return Math.max(0, (now - new Date(session.started_at).getTime()) / 1000);
}

/** Stepper + direct number input for choosing minutes freely inside `min..max`. */
function MinuteControl({
  label, value, min, max, step, unit = '분', onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (next: number) => void;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(/[^0-9]/g, ''));
    const next = raw.trim() ? clampInt(parsed, min, max, value) : value;
    onChange(next);
    setDraft(String(next));
  };

  const bump = (delta: number) => {
    haptic.tap();
    const next = clampInt(value + delta, min, max, value);
    onChange(next);
    setDraft(String(next));
  };

  return (
    <View style={styles.controlRow}>
      <Txt variant="bodyStrong" style={{ flex: 1 }}>{label}</Txt>
      <View style={styles.stepper}>
        <IconButton
          name="minus" label={`${label} ${step}${unit} 줄이기`} size={18}
          onPress={() => bump(-step)} style={{ backgroundColor: colors.surfaceMuted, width: 36, height: 36 }} />
        <View style={[styles.numBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <TextInput
            value={focused ? draft : String(value)}
            onFocus={() => {
              setFocused(true);
              setDraft(String(value));
            }}
            onChangeText={(next) => {
              const digits = next.replace(/[^0-9]/g, '');
              setDraft(digits);
              if (digits) {
                const parsed = Number(digits);
                if (parsed >= min && parsed <= max) onChange(parsed);
              }
            }}
            onBlur={() => {
              setFocused(false);
              commit(draft);
            }}
            keyboardType="number-pad" returnKeyType="done" maxLength={3} accessibilityLabel={label}
            style={[type.bodyStrong, { color: colors.text, textAlign: 'center', minWidth: 36, padding: 0 }]} />
          <Txt variant="small" tone="muted">{unit}</Txt>
        </View>
        <IconButton
          name="plus" label={`${label} ${step}${unit} 늘리기`} size={18}
          onPress={() => bump(step)} style={{ backgroundColor: colors.surfaceMuted, width: 36, height: 36 }} />
      </View>
    </View>
  );
}

export default function Focus() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ taskId?: string; habitId?: string; at?: string }>();
  const { data: sessions } = useFocusSessions();
  const { data: habits } = useHabits();
  const { tasks, byId } = useTaskIndex();
  const actions = useFocusActions();
  const deleteFocus = useDeleteFocus();
  const flow = useTaskFlow();
  const prefs = useFocusPrefs();

  const [target, setTarget] = useState<Target>(null);
  const [picking, setPicking] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [pickedRecord, setPickedRecord] = useState<FocusSession | null>(null);
  const [rest, setRest] = useState<{ endsAt: number; seconds: number; long: boolean } | null>(null);
  const breakEndsAt = rest?.endsAt ?? null;
  const [now, setNow] = useState(() => Date.now());
  const finished = useRef(new Set<string>());
  const runningPrefs = useRef<FocusPrefs>(prefs);
  const timeZone = deviceTimeZone();
  useMinute();

  const running = sessions?.find((session) => session.status === 'running') ?? null;
  const minutes = prefs.mode === 'pomodoro' ? prefs.focusMinutes : prefs.timerMinutes;
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

  /** Starts the break a finished Pomodoro round has earned, or does nothing in single-timer mode. */
  const beginRest = (activePrefs: FocusPrefs, roundsBefore: number, from: number) => {
    const earned = nextBreak(activePrefs, roundsBefore);
    if (!earned) return;
    setRest({ endsAt: from + earned.seconds * 1000, seconds: earned.seconds, long: earned.long });
    void scheduleAlert(
      'rest', from + earned.seconds * 1000,
      earned.long ? '긴 휴식이 끝났습니다' : '휴식이 끝났습니다',
      earned.long ? '한 사이클을 마쳤습니다. 준비되면 새 세트를 시작해 보세요.' : '다음 집중을 시작해 보세요.',
    );
  };
  const endRest = () => {
    setRest(null);
    void cancelAlert('rest');
  };

  const nameOf = (session: Pick<FocusSession, 'task_id' | 'habit_id'>) => (session.task_id
    ? byId.get(session.task_id)?.title : session.habit_id ? habits?.find((habit) => habit.id === session.habit_id)?.name : undefined);

  // The interval reads the newest state through this ref, so it never has to be torn down mid-session.
  const latest = useRef({ running, breakEndsAt, rest, byId, actions, flow, beginRest, rounds: todayStats.count });
  useEffect(() => {
    latest.current = { running, breakEndsAt, rest, byId, actions, flow, beginRest, rounds: todayStats.count };
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
        const activePrefs = runningPrefs.current;
        showToast(
          activePrefs.mode === 'pomodoro'
            ? `집중 ${formatMinutes(session.planned_seconds)} 완료!`
            : `타이머 ${formatMinutes(session.planned_seconds)} 완료!`,
          task ? { actionLabel: '할 일도 완료', onAction: () => state.flow.complete(task) } : {},
        );
        state.beginRest(activePrefs, state.rounds, time);
      } else if (!session && state.breakEndsAt !== null && time >= state.breakEndsAt) {
        const wasLong = state.rest?.long ?? false;
        setRest(null);
        haptic.medium();
        showToast(wasLong ? '긴 휴식이 끝났습니다. 준비되면 새 사이클을 시작해 보세요.' : '휴식이 끝났습니다. 다음 집중을 시작해 보세요.');
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
    endRest();
    runningPrefs.current = prefs;
    const earned = nextBreak(prefs, todayStats.count);
    const alertBody = earned
      ? (earned.long ? `긴 휴식 ${earned.minutes}분 쉬어 가세요.` : `${earned.minutes}분 쉬어 가세요.`)
      : '설정한 타이머가 끝났습니다.';
    // Scheduled with the system, so the round's end is announced even when the phone is locked.
    void prepareAlerts().then(() => scheduleAlert('focus', Date.now() + minutes * 60_000, `집중 ${minutes}분 완료`, alertBody));
    actions.start({
      planned_seconds: minutes * 60,
      ...(target?.kind === 'task' ? { task_id: target.id } : target?.kind === 'habit' ? { habit_id: target.id } : {}),
    });
  };

  const stop = (status: 'completed' | 'cancelled') => {
    if (!running) return;
    finished.current.add(running.id);
    void cancelAlert('focus');
    haptic.light();
    actions.finish({ id: running.id, status, ended_at: new Date().toISOString() });
    if (status === 'completed') {
      showToast(`집중 ${formatMinutes(elapsed)} 기록했습니다.`);
      beginRest(runningPrefs.current, todayStats.count, Date.now());
    }
  };

  const candidates = useMemo(() => tasks
    .filter((task) => ['overdue', 'today'].includes(dueBucket(task))).sort(bySchedule).slice(0, 12), [tasks]);
  const otherTasks = useMemo(() => {
    const shown = new Set(candidates.map((task) => task.id));
    return tasks.filter((task) => !shown.has(task.id) && !task.parent_task_id).sort(bySchedule).slice(0, 12);
  }, [tasks, candidates]);
  const activeHabits = (habits ?? []).filter((habit) => !habit.archived_at);
  const targetName = running ? nameOf(running)
    : target ? nameOf({ task_id: target.kind === 'task' ? target.id : null, habit_id: target.kind === 'habit' ? target.id : null }) : undefined;

  const onBreak = !running && breakEndsAt !== null;
  const total = running ? running.planned_seconds : onBreak ? rest!.seconds : minutes * 60;
  const rounds = prefs.roundsBeforeLongBreak;
  const round = todayStats.count % rounds;
  const shown = Math.max(0, running ? remaining : onBreak ? breakRemaining : minutes * 60);
  const ratio = total > 0 ? Math.min(1, Math.max(0, 1 - shown / total)) : 0;
  const r = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const ringColor = onBreak ? colors.success : colors.accent;
  const recent = (sessions ?? []).filter((session) => session.status !== 'running').slice(0, 5);

  return (
    <Screen>
      <Header
        title="집중" subtitle={todayStats.count ? `오늘 ${todayStats.count}회 · ${formatMinutes(todayStats.seconds)}` : '오늘 첫 집중을 시작해 보세요'}
        right={!ticking ? (
          <IconButton name="sliders" label="시간 설정" onPress={() => setConfiguring(true)} color={colors.textMuted} />
        ) : undefined} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.lg, alignItems: 'center' }}>
        {!running ? (
          <View style={{ alignSelf: 'stretch' }}>
            <Segmented<FocusMode>
              value={prefs.mode}
              onChange={(mode) => {
                if (mode === 'timer' && onBreak) endRest();
                setFocusPrefs({ mode });
              }}
              options={[
                { value: 'pomodoro', label: '뽀모도로', icon: 'repeat' },
                { value: 'timer', label: '일반 타이머', icon: 'clock' },
              ]} />
          </View>
        ) : null}

        <Pressable
          disabled={ticking}
          accessibilityRole={ticking ? 'timer' : 'button'}
          accessibilityLabel={ticking
            ? `${onBreak ? '휴식' : '집중'} 남은 시간 ${formatDuration(shown)}`
            : `타이머 ${formatDuration(shown)}, 눌러서 시간 자유 설정`}
          onPress={() => {
            haptic.tap();
            setConfiguring(true);
          }}
          style={({ pressed }) => ({
            width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center', marginTop: space.xs,
            opacity: !ticking && pressed ? 0.75 : 1,
          })}>
          <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
            <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={colors.surfaceMuted} strokeWidth={STROKE} fill="none" />
            {ratio > 0.002 ? (
              <Circle
                cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={ringColor} strokeWidth={STROKE} fill="none" strokeLinecap="round"
                strokeDasharray={`${circumference * ratio} ${circumference}`} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
            ) : null}
          </Svg>
          <Txt variant="caption" tone="muted" style={{ marginBottom: 4 }}>
            {running ? '집중 중' : onBreak ? (rest!.long ? '긴 휴식 중' : '휴식 중') : prefs.mode === 'pomodoro' ? '뽀모도로' : '일반 타이머'}
          </Txt>
          <Txt
            numberOfLines={1} adjustsFontSizeToFit
            style={{ fontSize: 54, lineHeight: 62, fontWeight: '400', fontVariant: ['tabular-nums'], maxWidth: SIZE - 44 }}>
            {formatDuration(shown)}
          </Txt>
          {targetName ? (
            <Txt variant="small" tone="muted" numberOfLines={1} style={{ maxWidth: SIZE - 64, marginTop: 4 }}>{targetName}</Txt>
          ) : !ticking ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
              <Icon name="edit-2" size={11} color={colors.accent} />
              <Txt variant="caption" tone="accent">눌러서 시간 설정</Txt>
            </View>
          ) : null}
        </Pressable>

        {running ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' }}>
            <Button label="그만두기" kind="secondary" icon="x" onPress={() => stop('cancelled')} style={{ flex: 1 }} />
            <Button label="지금 완료" icon="check" onPress={() => stop('completed')} style={{ flex: 1 }} />
          </View>
        ) : (
          <>
            {prefs.mode === 'pomodoro' ? (
              <View style={{ alignSelf: 'stretch', gap: space.sm, alignItems: 'center' }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {pomoPresets.map((preset) => {
                    const selected = prefs.focusMinutes === preset.focus && prefs.shortBreakMinutes === preset.rest && prefs.longBreakMinutes === preset.longRest;
                    return (
                      <Chip
                        key={preset.label} label={preset.label} selected={selected}
                        onPress={() => setFocusPrefs({ focusMinutes: preset.focus, shortBreakMinutes: preset.rest, longBreakMinutes: preset.longRest })} />
                    );
                  })}
                  <Chip icon="sliders" label="직접 설정" onPress={() => setConfiguring(true)} />
                </ScrollView>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }} accessibilityLabel={`${rounds}세트 중 ${round}세트 완료`}>
                  {Array.from({ length: rounds }, (_, index) => (
                    <View
                      key={index}
                      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: index < round ? colors.accent : colors.surfaceMuted }} />
                  ))}
                  <Txt variant="small" tone="muted" style={{ marginLeft: 4 }}>
                    휴식 {prefs.shortBreakMinutes}분 · {rounds - round}세트 후 긴 휴식 {prefs.longBreakMinutes}분
                  </Txt>
                </View>
              </View>
            ) : (
              <View style={{ alignSelf: 'stretch', gap: space.sm, alignItems: 'center' }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {timerPresets.map((preset) => (
                    <Chip
                      key={preset} label={`${preset}분`} selected={prefs.timerMinutes === preset}
                      onPress={() => setFocusPrefs({ timerMinutes: preset })} />
                  ))}
                  <Chip icon="sliders" label="직접 입력" onPress={() => setConfiguring(true)} />
                </ScrollView>
                <Txt variant="small" tone="muted">휴식 없이 설정한 시간이 끝나면 바로 종료됩니다</Txt>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <Chip icon="link" label={targetName ?? '할 일·습관 연결'} color={target ? colors.accent : undefined} onPress={() => setPicking(true)} style={{ maxWidth: 260 }} />
              {target ? <Chip icon="x" label="해제" onPress={() => setTarget(null)} /> : null}
            </View>
            <View style={{ alignSelf: 'stretch', gap: space.sm }}>
              <Button label={onBreak ? '휴식 건너뛰고 집중 시작' : prefs.mode === 'pomodoro' ? '집중 시작' : '타이머 시작'} icon="play" onPress={start} />
              {onBreak ? <Button label="휴식 끝내기" kind="ghost" onPress={endRest} /> : null}
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
                <Pressable
                  key={session.id} accessibilityRole="button" accessibilityLabel={(nameOf(session) ?? '자유 집중') + ' 기록 보기'}
                  onPress={() => setPickedRecord(session)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: pressed ? 0.6 : 1 })}>
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
                </Pressable>
              );
            })}
          </Card>
        ) : null}
      </ScrollView>

      <Sheet visible={configuring} onClose={() => setConfiguring(false)} title={prefs.mode === 'pomodoro' ? '뽀모도로 시간 설정' : '타이머 시간 설정'}>
        <View style={{ gap: space.md }}>
          {prefs.mode === 'pomodoro' ? (
            <>
              <MinuteControl
                label="집중 시간" value={prefs.focusMinutes} min={FOCUS_LIMITS.focus.min} max={FOCUS_LIMITS.focus.max} step={5}
                onChange={(focusMinutes) => setFocusPrefs({ focusMinutes })} />
              <MinuteControl
                label="짧은 휴식" value={prefs.shortBreakMinutes} min={FOCUS_LIMITS.shortBreak.min} max={FOCUS_LIMITS.shortBreak.max} step={1}
                onChange={(shortBreakMinutes) => setFocusPrefs({ shortBreakMinutes })} />
              <MinuteControl
                label="긴 휴식" value={prefs.longBreakMinutes} min={FOCUS_LIMITS.longBreak.min} max={FOCUS_LIMITS.longBreak.max} step={5}
                onChange={(longBreakMinutes) => setFocusPrefs({ longBreakMinutes })} />
              <View style={styles.controlRow}>
                <Txt variant="bodyStrong" style={{ flex: 1 }}>긴 휴식 주기</Txt>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {roundChoices.map((count) => (
                    <Chip
                      key={count} label={`${count}세트`} selected={prefs.roundsBeforeLongBreak === count}
                      onPress={() => setFocusPrefs({ roundsBeforeLongBreak: count })} />
                  ))}
                </View>
              </View>
              <Txt variant="small" tone="muted">
                {prefs.roundsBeforeLongBreak}세트 완료 후 긴 휴식이 끝나면 자동으로 다시 시작하지 않고 대기하며, 다음 집중 시작 시 1세트부터 새 사이클이 시작됩니다.
              </Txt>
            </>
          ) : (
            <>
              <MinuteControl
                label="타이머 시간" value={prefs.timerMinutes} min={FOCUS_LIMITS.focus.min} max={FOCUS_LIMITS.focus.max} step={5}
                onChange={(timerMinutes) => setFocusPrefs({ timerMinutes })} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[5, 10, 15, 25, 30, 45, 60, 90, 120].map((preset) => (
                  <Chip
                    key={preset} label={preset >= 60 && preset % 60 === 0 ? `${preset / 60}시간` : `${preset}분`}
                    selected={prefs.timerMinutes === preset} onPress={() => setFocusPrefs({ timerMinutes: preset })} />
                ))}
              </View>
              <Txt variant="small" tone="muted">1분부터 최대 480분(8시간)까지 숫자를 눌러 직접 입력할 수 있습니다.</Txt>
            </>
          )}
          <Button label="완료" onPress={() => setConfiguring(false)} style={{ marginTop: space.xs }} />
        </View>
      </Sheet>

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
          {otherTasks.length ? <Txt variant="section" tone="muted" style={{ marginTop: space.md }}>다른 할 일</Txt> : null}
          {otherTasks.map((task) => (
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
          {!candidates.length && !otherTasks.length && !activeHabits.length ? (
            <Txt tone="muted" style={{ paddingVertical: space.lg }}>할 일이나 습관이 있으면 여기에서 연결할 수 있습니다.</Txt>
          ) : null}
        </ScrollView>
      </Sheet>

      <Sheet visible={!!pickedRecord} onClose={() => setPickedRecord(null)} title="집중 기록">
        {pickedRecord ? (() => {
          const started = Temporal.Instant.from(pickedRecord.started_at).toZonedDateTimeISO(timeZone);
          const seconds = pickedRecord.ended_at
            ? (new Date(pickedRecord.ended_at).getTime() - new Date(pickedRecord.started_at).getTime()) / 1000 : 0;
          return (
            <View style={{ gap: space.sm }}>
              <Txt variant="bodyStrong">{nameOf(pickedRecord) ?? '자유 집중'}</Txt>
              <Txt tone="muted" style={{ marginBottom: space.md }}>
                {`${started.month}월 ${started.day}일 ${formatTime(started.hour * 60 + started.minute)} · ${formatMinutes(seconds)}`}
              </Txt>
              <Button
                label="이 기록 삭제" kind="danger" icon="trash-2"
                onPress={() => {
                  deleteFocus.mutate(pickedRecord.id);
                  setPickedRecord(null);
                  showToast('집중 기록을 지웠습니다.');
                }} />
              <Button label="닫기" kind="secondary" onPress={() => setPickedRecord(null)} />
            </View>
          );
        })() : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  numBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2,
    borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.sm, height: 38, minWidth: 72,
  },
});
