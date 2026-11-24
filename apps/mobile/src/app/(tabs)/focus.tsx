import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, type TextStyle, TextInput, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Checkbox } from '@/components/Checkbox';
import { Button, Card, Chip, Header, Icon, IconButton, Row, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import { useDeleteFocus, useFocusActions, useFocusSessions } from '@/data/focus';
import { useHabits } from '@/data/habits';
import { bySchedule, useSubtaskProgress, useTaskIndex } from '@/data/tasks';
import {
  clampInt, EMPTY_SESSION_MOD, FOCUS_LIMITS, focusDoneTitle, type FocusMode, type FocusPrefs, nextBreak, setFocusPrefs, setFocusSessionMod,
  STOPWATCH_MAX_SECONDS, useFocusPrefs, useFocusSessionMod, weeklyFocusStats,
} from '@/features/focus/prefs';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { cancelAlert, prepareAlerts, scheduleAlert } from '@/lib/alerts';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, formatDuration, formatMinutes, formatTime, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { FocusSession } from '@/lib/shared';
import { useTabScrollTop } from '@/lib/tabScroll';
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

const MIN_RECORD_SECONDS = 60;
const sessionSeconds = (session: FocusSession) =>
  (session.ended_at ? (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000 : 0);
/** Stopped within a minute of starting: kept out of the lists so an accidental tap leaves no trace. */
const isFalseStart = (session: FocusSession) => session.status === 'cancelled' && sessionSeconds(session) < MIN_RECORD_SECONDS;

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
  const params = useLocalSearchParams<{ taskId?: string; habitId?: string; duration?: string; at?: string }>();
  const { data: sessions } = useFocusSessions();
  const { data: habits } = useHabits();
  const { tasks, byId, children } = useTaskIndex();
  const { completedChildren } = useSubtaskProgress();
  const actions = useFocusActions();
  const deleteFocus = useDeleteFocus();
  const flow = useTaskFlow();
  const quickAdd = useQuickAdd();
  const prefs = useFocusPrefs();
  const sessionMod = useFocusSessionMod();

  const [target, setTarget] = useState<Target>(null);
  const [picking, setPicking] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [pickedRecord, setPickedRecord] = useState<FocusSession | null>(null);
  const [rest, setRest] = useState<{ endsAt: number; seconds: number; long: boolean } | null>(null);
  const breakEndsAt = rest?.endsAt ?? null;
  const [now, setNow] = useState(() => Date.now());
  const finished = useRef(new Set<string>());
  const runningPrefs = useRef<FocusPrefs>(prefs);
  const scrollRef = useRef<ScrollViewInstance>(null);
  useTabScrollTop('focus', scrollRef);
  const timeZone = deviceTimeZone();
  useMinute();

  const running = sessions?.find((session) => session.status === 'running') ?? null;
  const activeMod = running && sessionMod.id === running.id
    ? sessionMod
    : { ...EMPTY_SESSION_MOD, id: running?.id ?? '' };
  const isPaused = !!running && activeMod.pausedAt !== null;
  const isRunningStopwatch = !!running && running.planned_seconds === STOPWATCH_MAX_SECONDS;

  // Keep the focus view distraction-free by hiding the floating + button while a session is running.
  useEffect(() => {
    quickAdd.setFabHidden(!!running);
    return () => quickAdd.setFabHidden(false);
  }, [quickAdd, running]);

  const minutes = prefs.mode === 'pomodoro' ? prefs.focusMinutes : prefs.timerMinutes;
  const ticking = (!!running && !isPaused) || breakEndsAt !== null;

  // Arriving from a task or habit attaches it to the next session (and syncs estimated task duration if given).
  const link = (params.taskId ? 'task:' + params.taskId : params.habitId ? 'habit:' + params.habitId : '') + '@' + (params.at ?? '');
  const [appliedLink, setAppliedLink] = useState('@');
  if (link !== appliedLink) {
    setAppliedLink(link);
    if (params.taskId) setTarget({ kind: 'task', id: params.taskId });
    else if (params.habitId) setTarget({ kind: 'habit', id: params.habitId });
  }
  const appliedDurationLink = useRef('@');
  useEffect(() => {
    if (!params.duration || running || appliedDurationLink.current === link) return;
    appliedDurationLink.current = link;
    const mins = Number(params.duration);
    if (Number.isFinite(mins) && mins >= FOCUS_LIMITS.focus.min && mins <= FOCUS_LIMITS.focus.max) {
      setFocusPrefs({ timerMinutes: Math.round(mins), focusMinutes: Math.round(mins) });
    }
  }, [link, params.duration, running]);

  // Totalled on every render: the timer and `useMinute` keep this screen current across midnight.
  const day = Temporal.Now.plainDateISO(timeZone);
  const doneToday = (sessions ?? []).filter((session) => session.status === 'completed' && session.ended_at
    && Temporal.Instant.from(session.started_at).toZonedDateTimeISO(timeZone).toPlainDate().equals(day));
  const todayStats = {
    count: doneToday.length,
    seconds: doneToday.reduce((sum, session) =>
      sum + (new Date(session.ended_at!).getTime() - new Date(session.started_at).getTime()) / 1000, 0),
  };

  const weekly = useMemo(() => weeklyFocusStats(sessions ?? [], day, timeZone), [sessions, day, timeZone]);

  /** Starts the break a finished Pomodoro round has earned, or does nothing in timer/stopwatch mode. */
  const beginRest = (activePrefs: FocusPrefs, roundsBefore: number, from: number) => {
    const earned = nextBreak(activePrefs, roundsBefore);
    if (!earned) return;
    setRest({ endsAt: from + earned.seconds * 1000, seconds: earned.seconds, long: earned.long });
    void scheduleAlert(
      'rest', from + earned.seconds * 1000,
      earned.long ? '긴 휴식이 끝났습니다' : '휴식이 끝났습니다',
      earned.long ? '한 사이클을 마쳤습니다. 준비되면 새 사이클을 시작해 보세요.' : '다음 집중을 시작해 보세요.',
    );
  };
  const endRest = () => {
    setRest(null);
    void cancelAlert('rest');
  };

  const nameOf = (session: Pick<FocusSession, 'task_id' | 'habit_id'>) => (session.task_id
    ? byId.get(session.task_id)?.title : session.habit_id ? habits?.find((habit) => habit.id === session.habit_id)?.name : undefined);

  const latest = useRef({
    running, activeMod, isRunningStopwatch, breakEndsAt, rest, byId, actions, flow, beginRest, rounds: todayStats.count,
  });
  useEffect(() => {
    latest.current = {
      running, activeMod, isRunningStopwatch, breakEndsAt, rest, byId, actions, flow, beginRest, rounds: todayStats.count,
    };
  });

  useEffect(() => {
    if (!ticking) return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      const state = latest.current;
      const session = state.running;
      if (session && !state.isRunningStopwatch && state.activeMod.pausedAt === null) {
        const planned = session.planned_seconds + state.activeMod.extraSeconds;
        const endsAt = new Date(session.started_at).getTime() + state.activeMod.pausedMs + planned * 1000;
        if (time >= endsAt && !finished.current.has(session.id)) {
          finished.current.add(session.id);
          const netEnd = Math.max(new Date(session.started_at).getTime() + 1000, endsAt - state.activeMod.pausedMs);
          state.actions.finish({ id: session.id, status: 'completed', ended_at: new Date(netEnd).toISOString() });
          setFocusSessionMod(EMPTY_SESSION_MOD);
          haptic.success();
          const task = session.task_id ? state.byId.get(session.task_id) : undefined;
          const activePrefs = runningPrefs.current;
          showToast(
            activePrefs.mode === 'pomodoro'
              ? `집중 ${formatMinutes(planned)} 완료!`
              : `타이머 ${formatMinutes(planned)} 완료!`,
            task ? { actionLabel: '할 일도 완료', onAction: () => state.flow.complete(task) } : {},
          );
          state.beginRest(activePrefs, state.rounds, time);
        }
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

  const effectiveNow = activeMod.pausedAt ?? now;
  const elapsed = running
    ? Math.max(0, (effectiveNow - new Date(running.started_at).getTime() - activeMod.pausedMs) / 1000)
    : 0;
  const plannedSeconds = running ? running.planned_seconds + activeMod.extraSeconds : minutes * 60;
  const remaining = running ? Math.max(0, plannedSeconds - elapsed) : minutes * 60;
  const breakRemaining = breakEndsAt === null ? 0 : (breakEndsAt - now) / 1000;

  // `remainingSec` is when the alert fires; `plannedSec` is the session's whole length, which its title names.
  const scheduleRunningAlert = (remainingSec: number, plannedSec: number, activePrefs: FocusPrefs) => {
    if (activePrefs.mode === 'stopwatch' || remainingSec <= 1) return;
    const earned = nextBreak(activePrefs, todayStats.count);
    const alertBody = earned
      ? (earned.long ? `긴 휴식입니다. ${earned.minutes}분 쉬어 가세요.` : `${earned.minutes}분 쉬어 가세요.`)
      : '설정한 타이머가 끝났습니다.';
    void prepareAlerts().then(() =>
      scheduleAlert('focus', Date.now() + remainingSec * 1000, focusDoneTitle(activePrefs.mode, plannedSec), alertBody));
  };

  const start = () => {
    haptic.medium();
    endRest();
    setFocusSessionMod(EMPTY_SESSION_MOD);
    runningPrefs.current = prefs;
    const isStopwatch = prefs.mode === 'stopwatch';
    const seconds = isStopwatch ? STOPWATCH_MAX_SECONDS : minutes * 60;
    if (!isStopwatch) scheduleRunningAlert(seconds, seconds, prefs);
    actions.start({
      planned_seconds: seconds,
      ...(target?.kind === 'task' ? { task_id: target.id } : target?.kind === 'habit' ? { habit_id: target.id } : {}),
    });
  };

  const togglePause = () => {
    if (!running) return;
    haptic.tap();
    const t = Date.now();
    if (isPaused) {
      const nextPausedMs = activeMod.pausedMs + (t - activeMod.pausedAt!);
      setFocusSessionMod({ id: running.id, pausedAt: null, pausedMs: nextPausedMs, extraSeconds: activeMod.extraSeconds });
      setNow(t);
      if (!isRunningStopwatch) scheduleRunningAlert(remaining, plannedSeconds, runningPrefs.current);
    } else {
      void cancelAlert('focus');
      setFocusSessionMod({ id: running.id, pausedAt: t, pausedMs: activeMod.pausedMs, extraSeconds: activeMod.extraSeconds });
    }
  };

  const extendFiveMin = () => {
    if (!running || isRunningStopwatch) return;
    haptic.tap();
    const nextExtra = activeMod.extraSeconds + 300;
    setFocusSessionMod({ id: running.id, pausedAt: activeMod.pausedAt, pausedMs: activeMod.pausedMs, extraSeconds: nextExtra });
    if (!isPaused) scheduleRunningAlert(remaining + 300, plannedSeconds + 300, runningPrefs.current);
    showToast('집중 시간을 5분 연장했습니다.');
  };

  const stop = (status: 'completed' | 'cancelled') => {
    if (!running) return;
    finished.current.add(running.id);
    void cancelAlert('focus');
    haptic.light();
    const startedMs = new Date(running.started_at).getTime();
    const netElapsedMs = Math.max(1000, (activeMod.pausedAt ?? Date.now()) - startedMs - activeMod.pausedMs);
    const netSeconds = netElapsedMs / 1000;
    // A run of under a minute is a false start, not focus: it earns no record, round or break (Forest does the same).
    const counts = status === 'completed' && netSeconds >= MIN_RECORD_SECONDS;
    const endedAt = new Date(startedMs + netElapsedMs).toISOString();
    actions.finish({ id: running.id, status: counts ? 'completed' : 'cancelled', ended_at: endedAt });
    setFocusSessionMod(EMPTY_SESSION_MOD);
    if (counts) {
      const task = running.task_id ? byId.get(running.task_id) : undefined;
      showToast(
        `집중 ${formatMinutes(netSeconds)} 기록했습니다.`,
        task ? { actionLabel: '할 일도 완료', onAction: () => flow.complete(task) } : {},
      );
      if (!isRunningStopwatch) beginRest(runningPrefs.current, todayStats.count, Date.now());
    } else if (status === 'completed') {
      showToast('1분이 안 된 집중은 기록하지 않습니다.');
    }
  };

  const candidates = useMemo(() => tasks
    .filter((task) => ['overdue', 'today'].includes(dueBucket(task))).sort(bySchedule).slice(0, 12), [tasks]);
  const otherTasks = useMemo(() => {
    const shown = new Set(candidates.map((task) => task.id));
    return tasks.filter((task) => !shown.has(task.id) && !task.parent_task_id).sort(bySchedule).slice(0, 12);
  }, [tasks, candidates]);
  const activeHabits = (habits ?? []).filter((habit) => !habit.archived_at);

  const linkedTaskId = running ? running.task_id : (target?.kind === 'task' ? target.id : null);
  const linkedTask = linkedTaskId ? byId.get(linkedTaskId) : undefined;
  const linkedOpenSubs = linkedTask ? (children.get(linkedTask.id) ?? []) : [];
  const linkedDoneSubs = linkedTask ? (completedChildren.get(linkedTask.id) ?? []) : [];
  const linkedTotalSubs = linkedOpenSubs.length + linkedDoneSubs.length;

  const targetName = running ? nameOf(running)
    : target ? nameOf({ task_id: target.kind === 'task' ? target.id : null, habit_id: target.kind === 'habit' ? target.id : null }) : undefined;

  const onBreak = !running && breakEndsAt !== null;
  const rounds = prefs.roundsBeforeLongBreak;
  const round = todayStats.count % rounds;
  const shown = running
    ? (isRunningStopwatch ? elapsed : remaining)
    : onBreak ? Math.max(0, breakRemaining) : prefs.mode === 'stopwatch' ? 0 : minutes * 60;
  const ratio = running
    ? (isRunningStopwatch ? (elapsed % 60) / 60 : Math.min(1, Math.max(0, 1 - remaining / Math.max(1, plannedSeconds))))
    : onBreak ? Math.min(1, Math.max(0, 1 - breakRemaining / Math.max(1, rest!.seconds))) : 0;
  const r = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  // One accent for the ring in every state; paused is the lighter step, and the label says which state it is.
  const ringColor = isPaused ? colors.accentRamp[1] : colors.accent;
  const recent = (sessions ?? []).filter((session) => session.status !== 'running' && !isFalseStart(session)).slice(0, 5);
  const canConfigure = !running && !onBreak && prefs.mode !== 'stopwatch';

  return (
    <Screen>
      <Header
        title="집중" subtitle={todayStats.count ? `오늘 ${todayStats.count}회 · ${formatMinutes(todayStats.seconds)}` : '오늘 첫 집중을 시작해 보세요'}
        right={canConfigure ? (
          <IconButton name="sliders" label="시간 설정" onPress={() => setConfiguring(true)} color={colors.textMuted} />
        ) : undefined} />
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.lg, alignItems: 'center' }}>
        {!running ? (
          <View style={{ alignSelf: 'stretch' }}>
            <Segmented<FocusMode>
              value={prefs.mode}
              onChange={(mode) => {
                if (mode !== 'pomodoro' && onBreak) endRest();
                setFocusPrefs({ mode });
              }}
              options={[
                { value: 'pomodoro', label: '뽀모도로', icon: 'repeat' },
                { value: 'timer', label: '타이머', icon: 'clock' },
                { value: 'stopwatch', label: '스톱워치', icon: 'play-circle' },
              ]} />
          </View>
        ) : null}

        <Pressable
          disabled={!canConfigure}
          accessibilityRole={running || onBreak ? 'timer' : 'button'}
          accessibilityLabel={running || onBreak
            ? `${onBreak ? '휴식' : isRunningStopwatch ? '스톱워치' : '집중'} ${formatDuration(shown)}`
            : `타이머 ${formatDuration(shown)}`}
          onPress={() => {
            if (!canConfigure) return;
            haptic.tap();
            setConfiguring(true);
          }}
          style={({ pressed }) => ({
            width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center', marginTop: space.xs,
            opacity: canConfigure && pressed ? 0.75 : 1,
          })}>
          <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
            <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={colors.surfaceMuted} strokeWidth={STROKE} fill="none" />
            {ratio > 0.002 ? (
              <Circle
                cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={ringColor} strokeWidth={STROKE} fill="none" strokeLinecap="round"
                strokeDasharray={`${circumference * ratio} ${circumference}`} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
            ) : null}
          </Svg>
          <Txt variant="caption" tone={isPaused || onBreak ? 'default' : 'muted'} style={[{ marginBottom: 4 }, (isPaused || onBreak) && { fontWeight: '600' }]}>
            {isPaused ? '일시정지됨'
              : running ? (isRunningStopwatch ? '스톱워치 측정 중' : '집중 중')
                : onBreak ? (rest!.long ? '긴 휴식 중' : '휴식 중')
                  : prefs.mode === 'pomodoro' ? '뽀모도로' : prefs.mode === 'timer' ? '일반 타이머' : '스톱워치'}
          </Txt>
          <Txt
            numberOfLines={1} adjustsFontSizeToFit
            style={{ fontSize: 54, lineHeight: 62, fontWeight: '400', fontVariant: ['tabular-nums'], maxWidth: SIZE - 44 }}>
            {formatDuration(shown)}
          </Txt>
          {targetName ? (
            <Txt variant="small" tone="muted" numberOfLines={1} style={{ maxWidth: SIZE - 64, marginTop: 4 }}>{targetName}</Txt>
          ) : canConfigure ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
              <Icon name="edit-2" size={11} color={colors.textFaint} />
              <Txt variant="caption" tone="muted">눌러서 시간 설정</Txt>
            </View>
          ) : null}
        </Pressable>

        {running ? (
          <View style={{ alignSelf: 'stretch', gap: space.sm }}>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                label={isPaused ? '계속' : '일시정지'} kind="secondary" icon={isPaused ? 'play' : 'pause'}
                onPress={togglePause} style={{ flex: 1 }} />
              {!isRunningStopwatch ? (
                <Button label="+5분 연장" kind="secondary" icon="plus" onPress={extendFiveMin} style={{ flex: 1 }} />
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="그만두기" kind="ghost" icon="x" onPress={() => stop('cancelled')} style={{ flex: 1 }} />
              <Button label={isRunningStopwatch ? '기록 완료' : '지금 완료'} icon="check" onPress={() => stop('completed')} style={{ flex: 1 }} />
            </View>
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
            ) : prefs.mode === 'timer' ? (
              <View style={{ alignSelf: 'stretch', gap: space.sm, alignItems: 'center' }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {timerPresets.map((preset) => (
                    <Chip
                      key={preset} label={`${preset}분`} selected={prefs.timerMinutes === preset}
                      onPress={() => setFocusPrefs({ timerMinutes: preset })} />
                  ))}
                  <Chip icon="sliders" label="직접 입력" onPress={() => setConfiguring(true)} />
                </ScrollView>
                <Txt variant="small" tone="muted">정한 시간이 지나면 휴식 없이 끝납니다</Txt>
              </View>
            ) : (
              <Txt variant="small" tone="muted" style={{ textAlign: 'center' }}>
                시간 제한 없이 잽니다. 끝나면 ‘기록 완료’를 누르세요.
              </Txt>
            )}

            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <Chip icon="link" label={targetName ?? '할 일·습관 연결'} tone={target ? 'set' : undefined} onPress={() => setPicking(true)} style={{ maxWidth: 260 }} />
              {target ? <Chip icon="x" label="해제" onPress={() => setTarget(null)} /> : null}
            </View>
            <View style={{ alignSelf: 'stretch', gap: space.sm }}>
              <Button
                label={onBreak ? '휴식 건너뛰고 집중 시작' : prefs.mode === 'pomodoro' ? '집중 시작' : prefs.mode === 'timer' ? '타이머 시작' : '스톱워치 시작'}
                icon="play" onPress={start} />
              {onBreak ? <Button label="휴식 끝내기" kind="ghost" onPress={endRest} /> : null}
            </View>
          </>
        )}

        {linkedTask ? (
          <Card style={{ alignSelf: 'stretch', gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Checkbox
                checked={false} size={20}
                onPress={() => flow.complete(linkedTask)} label={linkedTask.title + ' 완료'} />
              <Pressable
                onPress={() => router.push({ pathname: '/task/[id]', params: { id: linkedTask.id } })}
                style={{ flex: 1 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>{linkedTask.title}</Txt>
                {linkedTotalSubs > 0 ? (
                  <Txt variant="caption" tone="muted">
                    체크리스트 {linkedDoneSubs.length}/{linkedTotalSubs} 완료
                  </Txt>
                ) : null}
              </Pressable>
              <IconButton
                name="maximize-2" label="할 일 자세히 보기" size={16} color={colors.textFaint}
                onPress={() => router.push({ pathname: '/task/[id]', params: { id: linkedTask.id } })}
                style={{ width: 32, height: 32 }} />
            </View>
            {linkedTotalSubs > 0 ? (
              <>
                <View style={{ gap: 2 }}>
                  {linkedOpenSubs.map((sub) => (
                    <View key={sub.id} style={styles.focusSubRow}>
                      <Checkbox
                        checked={false} size={18}
                        onPress={() => flow.complete(sub)} label={sub.title + ' 완료'} />
                      <Txt variant="small" numberOfLines={2} style={{ flex: 1 }}>{sub.title}</Txt>
                    </View>
                  ))}
                  {linkedDoneSubs.map((sub) => (
                    <View key={sub.id} style={styles.focusSubRow}>
                      <Checkbox
                        checked done size={18}
                        onPress={() => flow.reopen(sub)} label={sub.title + ' 다시 열기'} />
                      <Text numberOfLines={1} style={[type.small as TextStyle, { color: colors.textFaint, textDecorationLine: 'line-through', flex: 1 }]}>
                        {sub.title}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </Card>
        ) : null}

        {weekly.totalCount > 0 ? (
          <Card style={{ alignSelf: 'stretch', gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Txt variant="section" tone="muted">최근 7일 집중</Txt>
              <Txt variant="smallStrong">
                {formatMinutes(weekly.totalSeconds)} · {weekly.totalCount}회
              </Txt>
            </View>
            <View style={styles.chart} accessibilityLabel={`최근 7일 집중 ${formatMinutes(weekly.totalSeconds)}`}>
              {weekly.days.map((bar) => {
                const height = bar.minutes > 0 ? Math.max(8, Math.round((bar.minutes / weekly.maxMinutes) * 64)) : 4;
                return (
                  <View key={bar.date} style={styles.barCol}>
                    <Txt variant="caption" tone={bar.isToday ? 'default' : 'faint'} style={{ height: 14 }}>
                      {bar.minutes > 0 ? `${bar.minutes}m` : ''}
                    </Txt>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            height,
                            backgroundColor: bar.minutes === 0
                              ? colors.surfaceMuted
                              : bar.isToday ? colors.accent : colors.accentRamp[1],
                          },
                        ]} />
                    </View>
                    <Txt variant="caption" tone={bar.isToday ? 'default' : 'muted'} style={{ fontWeight: bar.isToday ? '700' : '500' }}>
                      {bar.weekday}
                    </Txt>
                  </View>
                );
              })}
            </View>
            <Txt variant="caption" tone="faint">막대 위 숫자는 그날 집중한 시간(분)입니다.</Txt>
          </Card>
        ) : null}

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
                    color={session.status === 'completed' ? colors.textMuted : colors.textFaint} />
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
                {prefs.roundsBeforeLongBreak}세트를 마치고 긴 휴식이 끝나면 타이머가 멈추고 기다립니다. 다음 집중은 1세트부터 다시 셉니다.
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
              <Txt variant="small" tone="muted">숫자를 눌러 1분에서 480분(8시간)까지 직접 입력할 수 있습니다.</Txt>
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
              detail={task.duration_minutes ? `${task.duration_minutes}분` : undefined}
              onPress={() => {
                setTarget({ kind: 'task', id: task.id });
                if (task.duration_minutes && task.duration_minutes <= FOCUS_LIMITS.focus.max) {
                  setFocusPrefs({ timerMinutes: task.duration_minutes, focusMinutes: task.duration_minutes });
                }
                setPicking(false);
              }} />
          ))}
          {otherTasks.length ? <Txt variant="section" tone="muted" style={{ marginTop: space.md }}>다른 할 일</Txt> : null}
          {otherTasks.map((task) => (
            <Row
              key={task.id} icon="check-square" label={task.title}
              detail={task.duration_minutes ? `${task.duration_minutes}분` : undefined}
              onPress={() => {
                setTarget({ kind: 'task', id: task.id });
                if (task.duration_minutes && task.duration_minutes <= FOCUS_LIMITS.focus.max) {
                  setFocusPrefs({ timerMinutes: task.duration_minutes, focusMinutes: task.duration_minutes });
                }
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
  focusSubRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6,
  },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 102 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: { height: 64, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  barFill: { width: 22, borderRadius: 6 },
});
