import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button, IconButton, Sheet, Txt } from '@/components/ui';
import { queryClient } from '@/data/client';
import { useFocusActions, useFocusSessions } from '@/data/focus';
import { periodProgress, useHabitActions, useHabits } from '@/data/habits';
import { keys } from '@/data/keys';
import { useTaskIndex } from '@/data/tasks';
import {
  clampInt, EMPTY_SESSION_MOD, FOCUS_LIMITS, focusDoneTitle, type FocusMode, type FocusPrefs, type FocusSessionMod,
  nextBreak, normalizeFocusPrefs, setFocusSessionMod, STOPWATCH_MAX_SECONDS, useFocusPrefs, useFocusSessionMod,
} from '@/features/focus/prefs';
import { nextCheckIn } from '@/features/habits/checkIn';
import { logsByDate } from '@/features/habits/goal';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { cancelAlert, prepareAlerts, scheduleAlert } from '@/lib/alerts';
import { api } from '@/lib/api';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, formatDuration, formatMinutes, logicalToday, type PlainDate, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { createLocalStore, registerAccountStoreReset } from '@/lib/localStore';
import type { FocusSession, Habit } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, useMotion, useTheme } from '@/theme';

export const MIN_RECORD_SECONDS = 60;
export const MINI_BAR_HEIGHT = 54;

export type FocusTarget = { kind: 'task' | 'habit'; id: string } | null;

export interface FocusRestState {
  endsAt: number;
  seconds: number;
  long: boolean;
}

export interface StartForOptions {
  taskId?: string | null;
  habitId?: string | null;
  title?: string;
  minutes?: number | null;
  autoStart?: boolean;
}

interface ActiveSessionMeta {
  id: string;
  mode: FocusMode;
  prefs: FocusPrefs;
}

interface FocusMetaStoreState {
  active: ActiveSessionMeta | null;
  modes: Record<string, FocusMode>;
}

const EMPTY_META: FocusMetaStoreState = { active: null, modes: {} };
const MAX_RECORDED_MODES = 200;

function isFocusMode(value: unknown): value is FocusMode {
  return value === 'pomodoro' || value === 'timer' || value === 'stopwatch';
}

const restStore = createLocalStore<FocusRestState | null>({
  key: 'dayframe-focus-rest-v1',
  initial: null,
  accountScoped: true,
  parse: (raw) => {
    const parsed = JSON.parse(raw) as Partial<FocusRestState> | null;
    if (
      !parsed
      || typeof parsed.endsAt !== 'number'
      || typeof parsed.seconds !== 'number'
      || typeof parsed.long !== 'boolean'
      || parsed.endsAt <= Date.now()
    ) {
      return null;
    }
    return { endsAt: parsed.endsAt, seconds: Math.max(1, parsed.seconds), long: parsed.long };
  },
});

const metaStore = createLocalStore<FocusMetaStoreState>({
  key: 'dayframe-focus-meta-v1',
  initial: EMPTY_META,
  accountScoped: true,
  parse: (raw) => {
    const parsed = JSON.parse(raw) as Partial<FocusMetaStoreState> | null;
    if (!parsed || typeof parsed !== 'object') return EMPTY_META;
    const modes: Record<string, FocusMode> = {};
    if (parsed.modes && typeof parsed.modes === 'object') {
      for (const [id, mode] of Object.entries(parsed.modes)) {
        if (isFocusMode(mode)) modes[id] = mode;
      }
    }
    const rawActive = parsed.active;
    const active: ActiveSessionMeta | null = rawActive && typeof rawActive.id === 'string' && isFocusMode(rawActive.mode)
      ? { id: rawActive.id, mode: rawActive.mode, prefs: normalizeFocusPrefs(rawActive.prefs) }
      : null;
    return { active, modes };
  },
});

registerAccountStoreReset(() => {
  setFocusSessionMod(EMPTY_SESSION_MOD);
});

function pruneModes(modes: Record<string, FocusMode>): Record<string, FocusMode> {
  const entries = Object.entries(modes);
  if (entries.length <= MAX_RECORDED_MODES) return modes;
  return Object.fromEntries(entries.slice(entries.length - MAX_RECORDED_MODES));
}

function recordSessionMeta(id: string, mode: FocusMode, prefs: FocusPrefs) {
  metaStore.set((prev) => ({
    active: { id, mode, prefs },
    modes: pruneModes({ ...prev.modes, [id]: mode }),
  }));
}

function clearActiveSessionMeta(id: string) {
  metaStore.set((prev) => (prev.active?.id === id ? { ...prev, active: null } : prev));
}

function clampDurationMinutes(minutes: number | null | undefined): number | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return null;
  if (minutes < FOCUS_LIMITS.focus.min || minutes > FOCUS_LIMITS.focus.max) return null;
  return clampInt(minutes, FOCUS_LIMITS.focus.min, FOCUS_LIMITS.focus.max, FOCUS_LIMITS.focus.min);
}

function targetsMatch(session: Pick<FocusSession, 'task_id' | 'habit_id'>, next: FocusTarget): boolean {
  if (!next) return !session.task_id && !session.habit_id;
  if (next.kind === 'task') return session.task_id === next.id && !session.habit_id;
  return session.habit_id === next.id && !session.task_id;
}

function modeLabel(mode: FocusMode): string {
  return mode === 'pomodoro' ? '뽀모도로' : mode === 'timer' ? '타이머' : '스톱워치';
}

export interface FocusStatusValue {
  running: FocusSession | null;
  activeMod: FocusSessionMod;
  isActive: boolean;
  isPaused: boolean;
  isRunningStopwatch: boolean;
  activeMode: FocusMode;
  rest: FocusRestState | null;
  onBreak: boolean;
  target: FocusTarget;
  durationOverride: number | null;
  effectiveMinutes: number;
  day: PlainDate;
  timeZone: string;
  todayStats: { count: number; seconds: number };
  pomodoroRoundsToday: number;
  targetName: string | undefined;
  nameOf: (session: Pick<FocusSession, 'task_id' | 'habit_id'>) => string | undefined;
  setTarget: (next: FocusTarget) => void;
  setDurationOverride: (minutes: number | null) => void;
  start: (override?: { target?: FocusTarget; minutes?: number | null }) => void;
  startFor: (options: StartForOptions) => void;
  togglePause: () => void;
  extendFiveMin: () => void;
  stop: (status: 'completed' | 'cancelled', options?: { skipRest?: boolean }) => void;
  endRest: () => void;
}

export interface FocusClockValue {
  now: number;
  elapsed: number;
  plannedSeconds: number;
  remaining: number;
  breakRemaining: number;
  netSeconds: number;
  shown: number;
  ratio: number;
}

export type FocusRuntimeValue = FocusStatusValue & FocusClockValue;

const noop = () => {};

const FocusStatusContext = createContext<FocusStatusValue | null>(null);
const FocusClockContext = createContext<FocusClockValue>({
  now: 0,
  elapsed: 0,
  plannedSeconds: 0,
  remaining: 0,
  breakRemaining: 0,
  netSeconds: 0,
  shown: 0,
  ratio: 0,
});

interface PendingSwitch {
  forSessionId: string;
  nextTarget: FocusTarget;
  title?: string;
  minutes: number | null;
  autoStart: boolean;
}

export function FocusRuntimeProvider({ children }: { children: ReactNode }) {
  const { data: sessions } = useFocusSessions();
  const { data: habits } = useHabits();
  const habitActions = useHabitActions();
  const { byId } = useTaskIndex();
  const actions = useFocusActions();
  const flow = useTaskFlow();
  const prefs = useFocusPrefs();
  const sessionMod = useFocusSessionMod();
  const personalPrefs = usePersonalPrefs();
  const rest = restStore.useValue();
  const meta = metaStore.useValue();

  const [target, setTargetState] = useState<FocusTarget>(null);
  const [durationOverride, setDurationOverrideState] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const finishedRef = useRef(new Set<string>());
  const pendingStartMetaRef = useRef<{ mode: FocusMode; prefs: FocusPrefs } | null>(null);

  const timeZone = deviceTimeZone();
  const minute = useMinute();

  const running = useMemo(
    () => sessions?.find((session) => session.status === 'running') ?? null,
    [sessions],
  );
  const activeMod = useMemo<FocusSessionMod>(
    () => (running && sessionMod.id === running.id ? sessionMod : { ...EMPTY_SESSION_MOD, id: running?.id ?? '' }),
    [running, sessionMod],
  );
  const isPaused = !!running && activeMod.pausedAt !== null;
  const isRunningStopwatch = !!running && running.planned_seconds === STOPWATCH_MAX_SECONDS;
  const breakEndsAt = rest?.endsAt ?? null;
  const onBreak = !running && breakEndsAt !== null;
  const isActive = !!running || onBreak;
  const ticking = (!!running && !isPaused) || onBreak;

  const activeSessionPrefs = useMemo<FocusPrefs>(() => {
    if (!running) return prefs;
    if (meta.active?.id === running.id) return meta.active.prefs;
    if (isRunningStopwatch) return { ...prefs, mode: 'stopwatch' };
    const storedMode = meta.modes[running.id];
    if (storedMode) return { ...prefs, mode: storedMode };
    return prefs;
  }, [running, meta.active, meta.modes, isRunningStopwatch, prefs]);

  const activeMode: FocusMode = running ? activeSessionPrefs.mode : prefs.mode;

  // Bind the running session's ID to its mode/prefs right after creation so restarts & Pomodoro counts stay accurate.
  useEffect(() => {
    if (!running) return;
    if (meta.active?.id === running.id) return;
    const pending = pendingStartMetaRef.current;
    if (pending) {
      pendingStartMetaRef.current = null;
      recordSessionMeta(running.id, pending.mode, pending.prefs);
      return;
    }
    const inferredMode: FocusMode = running.planned_seconds === STOPWATCH_MAX_SECONDS
      ? 'stopwatch'
      : (meta.modes[running.id] ?? prefs.mode);
    recordSessionMeta(running.id, inferredMode, { ...prefs, mode: inferredMode });
  }, [running, meta.active?.id, meta.modes, prefs]);

  const activePendingSwitch = running && pendingSwitch?.forSessionId === running.id ? pendingSwitch : null;

  const effectiveMinutes = prefs.mode === 'stopwatch'
    ? 0
    : (durationOverride ?? (prefs.mode === 'pomodoro' ? prefs.focusMinutes : prefs.timerMinutes));

  const day = useMemo(
    () => (minute >= 0 ? logicalToday(timeZone, personalPrefs.dayStartHour) : logicalToday(timeZone, personalPrefs.dayStartHour)),
    [timeZone, personalPrefs.dayStartHour, minute],
  );

  const { todayStats, pomodoroRoundsToday } = useMemo(() => {
    const doneToday = (sessions ?? []).filter((session) => {
      if (session.status !== 'completed' || !session.ended_at) return false;
      const sessionDay = logicalToday(timeZone, personalPrefs.dayStartHour, Temporal.Instant.from(session.started_at));
      return sessionDay.equals(day);
    });
    const seconds = doneToday.reduce(
      (sum, session) => sum + Math.max(0, (new Date(session.ended_at!).getTime() - new Date(session.started_at).getTime()) / 1000),
      0,
    );
    const pomoCount = doneToday.filter((session) => {
      if (session.planned_seconds === STOPWATCH_MAX_SECONDS) return false;
      const recordedMode = meta.modes[session.id];
      if (recordedMode) return recordedMode === 'pomodoro';
      return session.planned_seconds === prefs.focusMinutes * 60;
    }).length;
    return {
      todayStats: { count: doneToday.length, seconds },
      pomodoroRoundsToday: pomoCount,
    };
  }, [sessions, timeZone, personalPrefs.dayStartHour, day, meta.modes, prefs.focusMinutes]);

  const nameOf = useCallback(
    (session: Pick<FocusSession, 'task_id' | 'habit_id'>) => (session.task_id
      ? byId.get(session.task_id)?.title
      : session.habit_id
        ? habits?.find((habit) => habit.id === session.habit_id)?.name
        : undefined),
    [byId, habits],
  );

  const targetName = running
    ? nameOf(running)
    : target
      ? nameOf({
        task_id: target.kind === 'task' ? target.id : null,
        habit_id: target.kind === 'habit' ? target.id : null,
      })
      : undefined;

  const beginRest = useCallback((runPrefs: FocusPrefs, roundsBefore: number, from: number) => {
    const earned = nextBreak(runPrefs, roundsBefore);
    if (!earned) return;
    restStore.set({ endsAt: from + earned.seconds * 1000, seconds: earned.seconds, long: earned.long });
    void scheduleAlert(
      'rest',
      from + earned.seconds * 1000,
      earned.long ? '긴 휴식이 끝났습니다' : '휴식이 끝났습니다',
      earned.long ? '한 사이클을 마쳤습니다. 준비되면 새 사이클을 시작해 보세요.' : '다음 집중을 시작해 보세요.',
    );
  }, []);

  const endRest = useCallback(() => {
    restStore.set(null);
    void cancelAlert('rest');
  }, []);

  const logHabitFromFocus = useCallback(async (habit: Habit) => {
    const date = logicalToday(habit.timezone, personalPrefs.dayStartHour).toString();
    let cachedLogs = queryClient.getQueryData<Awaited<ReturnType<typeof api.habitLogs>>>(keys.habitLogs(habit.id));
    if (!cachedLogs) {
      try {
        cachedLogs = await queryClient.fetchQuery({ queryKey: keys.habitLogs(habit.id), queryFn: () => api.habitLogs(habit.id) });
      } catch {
        cachedLogs = [];
      }
    }
    const resolvedLogs = cachedLogs ?? [];
    const todayCount = logsByDate(resolvedLogs).get(date)?.count ?? 0;
    const progress = periodProgress(habit, resolvedLogs, date);
    const next = nextCheckIn(habit, todayCount, progress);
    if (next.status === null) {
      showToast(`‘${habit.name}’은 이미 오늘 목표를 달성했습니다.`);
      return;
    }
    if (next.reaches) haptic.success();
    else haptic.light();
    habitActions.setLog({ habitId: habit.id, date, status: next.status, count: next.count });
    showToast(next.reaches ? `‘${habit.name}’ 목표를 달성했습니다.` : `‘${habit.name}’ 습관을 기록했습니다.`);
  }, [habitActions, personalPrefs.dayStartHour]);

  const finishToastOptions = useCallback((session: Pick<FocusSession, 'task_id' | 'habit_id'>) => {
    if (session.task_id) {
      const task = byId.get(session.task_id);
      if (task) return { actionLabel: '할 일 완료', onAction: () => flow.complete(task) };
    }
    if (session.habit_id) {
      const habit = habits?.find((item) => item.id === session.habit_id);
      if (habit) return { actionLabel: '습관 기록', onAction: () => { void logHabitFromFocus(habit); } };
    }
    return {};
  }, [byId, flow, habits, logHabitFromFocus]);

  const scheduleRunningAlert = useCallback((remainingSec: number, plannedSec: number, runPrefs: FocusPrefs, roundsBefore: number) => {
    if (runPrefs.mode === 'stopwatch' || remainingSec <= 1) return;
    const earned = nextBreak(runPrefs, roundsBefore);
    const alertBody = earned
      ? (earned.long ? `긴 휴식입니다. ${earned.minutes}분 쉬어 가세요.` : `${earned.minutes}분 쉬어 가세요.`)
      : '설정한 타이머가 끝났습니다.';
    void prepareAlerts().then(() =>
      scheduleAlert('focus', Date.now() + remainingSec * 1000, focusDoneTitle(runPrefs.mode, plannedSec), alertBody));
  }, []);

  const latestRef = useRef({
    running,
    activeMod,
    isRunningStopwatch,
    breakEndsAt,
    rest,
    actions,
    activeSessionPrefs,
    pomodoroRoundsToday,
    beginRest,
    finishToastOptions,
  });
  useEffect(() => {
    latestRef.current = {
      running,
      activeMod,
      isRunningStopwatch,
      breakEndsAt,
      rest,
      actions,
      activeSessionPrefs,
      pomodoroRoundsToday,
      beginRest,
      finishToastOptions,
    };
  });

  // Global tick loop: runs across all tabs so sessions and breaks always auto-finish on time.
  useEffect(() => {
    if (!ticking) return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      const state = latestRef.current;
      const session = state.running;
      if (session && !state.isRunningStopwatch && state.activeMod.pausedAt === null) {
        const planned = session.planned_seconds + state.activeMod.extraSeconds;
        const endsAt = new Date(session.started_at).getTime() + state.activeMod.pausedMs + planned * 1000;
        if (time >= endsAt && !finishedRef.current.has(session.id)) {
          finishedRef.current.add(session.id);
          const netEnd = Math.max(new Date(session.started_at).getTime() + 1000, endsAt - state.activeMod.pausedMs);
          state.actions.finish({ id: session.id, status: 'completed', ended_at: new Date(netEnd).toISOString() });
          setFocusSessionMod(EMPTY_SESSION_MOD);
          clearActiveSessionMeta(session.id);
          haptic.success();
          const runPrefs = state.activeSessionPrefs;
          showToast(
            runPrefs.mode === 'pomodoro'
              ? `${formatMinutes(planned)} 집중을 마쳤습니다.`
              : `${formatMinutes(planned)} 타이머가 끝났습니다.`,
            state.finishToastOptions(session),
          );
          state.beginRest(runPrefs, state.pomodoroRoundsToday, time);
        }
      } else if (!session && state.breakEndsAt !== null && time >= state.breakEndsAt) {
        const wasLong = state.rest?.long ?? false;
        restStore.set(null);
        haptic.medium();
        showToast(wasLong ? '긴 휴식이 끝났습니다. 준비되면 새 사이클을 시작해 보세요.' : '휴식이 끝났습니다. 다음 집중을 시작해 보세요.');
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    const appSub = Platform.OS !== 'web'
      ? AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active') tick();
      })
      : null;
    return () => {
      clearInterval(timer);
      appSub?.remove();
    };
  }, [ticking]);

  // Only keep the screen awake while a focus session is actively running and the user opted in.
  const shouldKeepAwake = !!running && !isPaused && personalPrefs.focusKeepAwake;
  useEffect(() => {
    if (!shouldKeepAwake) return;
    activateKeepAwakeAsync('dayframe-focus').catch(() => {});
    return () => {
      deactivateKeepAwake('dayframe-focus').catch(() => {});
    };
  }, [shouldKeepAwake]);

  const setTarget = useCallback((next: FocusTarget) => {
    setTargetState(next);
    if (!next) setDurationOverrideState(null);
  }, []);

  const setDurationOverride = useCallback((minutes: number | null) => {
    setDurationOverrideState(clampDurationMinutes(minutes));
  }, []);

  const start = useCallback((override?: { target?: FocusTarget; minutes?: number | null }) => {
    haptic.medium();
    endRest();
    setFocusSessionMod(EMPTY_SESSION_MOD);
    const useTarget = override && 'target' in override ? (override.target ?? null) : target;
    const useMinutes = override && 'minutes' in override ? clampDurationMinutes(override.minutes) : durationOverride;
    const isStopwatch = prefs.mode === 'stopwatch';
    const mins = useMinutes ?? (prefs.mode === 'pomodoro' ? prefs.focusMinutes : prefs.timerMinutes);
    const seconds = isStopwatch ? STOPWATCH_MAX_SECONDS : mins * 60;
    const runPrefs: FocusPrefs = { ...prefs };
    pendingStartMetaRef.current = { mode: prefs.mode, prefs: runPrefs };
    if (!isStopwatch) scheduleRunningAlert(seconds, seconds, runPrefs, pomodoroRoundsToday);
    actions.start({
      planned_seconds: seconds,
      ...(useTarget?.kind === 'task' ? { task_id: useTarget.id } : useTarget?.kind === 'habit' ? { habit_id: useTarget.id } : {}),
    });
    setNow(Date.now());
  }, [actions, durationOverride, endRest, pomodoroRoundsToday, prefs, scheduleRunningAlert, target]);

  const startFor = useCallback((options: StartForOptions) => {
    const nextTarget: FocusTarget = options.taskId
      ? { kind: 'task', id: options.taskId }
      : options.habitId
        ? { kind: 'habit', id: options.habitId }
        : null;
    const clampedMinutes = clampDurationMinutes(options.minutes);
    const autoStart = Boolean(options.autoStart);

    if (running) {
      if (targetsMatch(running, nextTarget)) return;
      setPendingSwitch({ forSessionId: running.id, nextTarget, title: options.title, minutes: clampedMinutes, autoStart });
      return;
    }

    setTargetState(nextTarget);
    setDurationOverrideState(clampedMinutes);
    if (autoStart) {
      start({ target: nextTarget, minutes: clampedMinutes });
    }
  }, [running, start]);

  const effectiveNow = activeMod.pausedAt ?? now;
  const elapsed = running
    ? Math.max(0, (effectiveNow - new Date(running.started_at).getTime() - activeMod.pausedMs) / 1000)
    : 0;
  const plannedSeconds = running ? running.planned_seconds + activeMod.extraSeconds : effectiveMinutes * 60;
  const remaining = running ? Math.max(0, plannedSeconds - elapsed) : effectiveMinutes * 60;
  const breakRemaining = breakEndsAt === null ? 0 : Math.max(0, (breakEndsAt - now) / 1000);
  const netSeconds = running ? elapsed : 0;
  const shown = running
    ? (isRunningStopwatch ? elapsed : remaining)
    : onBreak ? breakRemaining : prefs.mode === 'stopwatch' ? 0 : effectiveMinutes * 60;
  const ratio = running
    ? (isRunningStopwatch ? (elapsed % 60) / 60 : Math.min(1, Math.max(0, 1 - remaining / Math.max(1, plannedSeconds))))
    : onBreak && rest ? Math.min(1, Math.max(0, 1 - breakRemaining / Math.max(1, rest.seconds))) : 0;

  const togglePause = useCallback(() => {
    if (!running) return;
    haptic.tap();
    const t = Date.now();
    if (isPaused) {
      const nextPausedMs = activeMod.pausedMs + (t - activeMod.pausedAt!);
      setFocusSessionMod({ id: running.id, pausedAt: null, pausedMs: nextPausedMs, extraSeconds: activeMod.extraSeconds });
      setNow(t);
      const currentElapsed = Math.max(0, (t - new Date(running.started_at).getTime() - nextPausedMs) / 1000);
      const currentPlanned = running.planned_seconds + activeMod.extraSeconds;
      const currentRemaining = Math.max(0, currentPlanned - currentElapsed);
      if (!isRunningStopwatch) scheduleRunningAlert(currentRemaining, currentPlanned, activeSessionPrefs, pomodoroRoundsToday);
    } else {
      void cancelAlert('focus');
      setFocusSessionMod({ id: running.id, pausedAt: t, pausedMs: activeMod.pausedMs, extraSeconds: activeMod.extraSeconds });
    }
  }, [activeMod, activeSessionPrefs, isPaused, isRunningStopwatch, pomodoroRoundsToday, running, scheduleRunningAlert]);

  const extendFiveMin = useCallback(() => {
    if (!running || isRunningStopwatch) return;
    haptic.tap();
    const nextExtra = activeMod.extraSeconds + 300;
    setFocusSessionMod({ id: running.id, pausedAt: activeMod.pausedAt, pausedMs: activeMod.pausedMs, extraSeconds: nextExtra });
    if (!isPaused) {
      const t = Date.now();
      const currentElapsed = Math.max(0, (t - new Date(running.started_at).getTime() - activeMod.pausedMs) / 1000);
      const nextPlanned = running.planned_seconds + nextExtra;
      const nextRemaining = Math.max(0, nextPlanned - currentElapsed);
      scheduleRunningAlert(nextRemaining, nextPlanned, activeSessionPrefs, pomodoroRoundsToday);
    }
    showToast('집중 시간을 5분 연장했습니다.');
  }, [activeMod, activeSessionPrefs, isPaused, isRunningStopwatch, pomodoroRoundsToday, running, scheduleRunningAlert]);

  const stop = useCallback((status: 'completed' | 'cancelled', options?: { skipRest?: boolean }) => {
    if (!running) return;
    finishedRef.current.add(running.id);
    void cancelAlert('focus');
    haptic.light();
    const startedMs = new Date(running.started_at).getTime();
    const netElapsedMs = Math.max(1000, (activeMod.pausedAt ?? Date.now()) - startedMs - activeMod.pausedMs);
    const sessionNetSeconds = netElapsedMs / 1000;
    // A run of under a minute is a false start, not focus: it earns no record, round or break.
    const counts = status === 'completed' && sessionNetSeconds >= MIN_RECORD_SECONDS;
    const endedAt = new Date(startedMs + netElapsedMs).toISOString();
    actions.finish({ id: running.id, status: counts ? 'completed' : 'cancelled', ended_at: endedAt });
    setFocusSessionMod(EMPTY_SESSION_MOD);
    clearActiveSessionMeta(running.id);
    if (counts) {
      showToast(
        `${formatMinutes(sessionNetSeconds)} 집중을 기록했습니다.`,
        finishToastOptions(running),
      );
      if (!isRunningStopwatch && !options?.skipRest) {
        beginRest(activeSessionPrefs, pomodoroRoundsToday, Date.now());
      }
    } else if (status === 'completed') {
      showToast('1분 미만 집중은 기록되지 않습니다.');
    }
  }, [actions, activeMod, activeSessionPrefs, beginRest, finishToastOptions, isRunningStopwatch, pomodoroRoundsToday, running]);

  const confirmSwitch = useCallback(() => {
    if (!activePendingSwitch) return;
    const next = activePendingSwitch;
    setPendingSwitch(null);
    if (running) {
      const startedMs = new Date(running.started_at).getTime();
      const netElapsedMs = Math.max(1000, (activeMod.pausedAt ?? Date.now()) - startedMs - activeMod.pausedMs);
      stop(netElapsedMs / 1000 >= MIN_RECORD_SECONDS ? 'completed' : 'cancelled', { skipRest: true });
    }
    setTargetState(next.nextTarget);
    setDurationOverrideState(next.minutes);
    if (next.autoStart) {
      start({ target: next.nextTarget, minutes: next.minutes });
    }
  }, [activeMod.pausedAt, activeMod.pausedMs, activePendingSwitch, running, start, stop]);

  const statusValue = useMemo<FocusStatusValue>(() => ({
    running,
    activeMod,
    isActive,
    isPaused,
    isRunningStopwatch,
    activeMode,
    rest,
    onBreak,
    target,
    durationOverride,
    effectiveMinutes,
    day,
    timeZone,
    todayStats,
    pomodoroRoundsToday,
    targetName,
    nameOf,
    setTarget,
    setDurationOverride,
    start,
    startFor,
    togglePause,
    extendFiveMin,
    stop,
    endRest,
  }), [
    running, activeMod, isActive, isPaused, isRunningStopwatch, activeMode, rest, onBreak, target,
    durationOverride, effectiveMinutes, day, timeZone, todayStats, pomodoroRoundsToday, targetName,
    nameOf, setTarget, setDurationOverride, start, startFor, togglePause, extendFiveMin, stop, endRest,
  ]);

  const clockValue = useMemo<FocusClockValue>(() => ({
    now,
    elapsed,
    plannedSeconds,
    remaining,
    breakRemaining,
    netSeconds,
    shown,
    ratio,
  }), [now, elapsed, plannedSeconds, remaining, breakRemaining, netSeconds, shown, ratio]);

  const currentSwitchName = running ? (nameOf(running) ?? modeLabel(activeMode)) : '현재 집중';
  const nextSwitchName = activePendingSwitch
    ? (activePendingSwitch.title
      ?? (activePendingSwitch.nextTarget
        ? nameOf({
          task_id: activePendingSwitch.nextTarget.kind === 'task' ? activePendingSwitch.nextTarget.id : null,
          habit_id: activePendingSwitch.nextTarget.kind === 'habit' ? activePendingSwitch.nextTarget.id : null,
        })
        : undefined)
      ?? '새 집중')
    : '';
  const switchWillSave = !!running && netSeconds >= MIN_RECORD_SECONDS;

  return (
    <FocusStatusContext.Provider value={statusValue}>
      <FocusClockContext.Provider value={clockValue}>
        {children}
        <Sheet visible={!!activePendingSwitch} onClose={() => setPendingSwitch(null)} title="진행 중인 집중을 바꿀까요?">
          <View style={{ gap: space.md }}>
            <Txt tone="muted">
              {`현재 ‘${currentSwitchName}’ 집중이 진행 중입니다. `}
              {switchWillSave
                ? `지금까지 ${formatMinutes(netSeconds)} 집중을 기록하고 ‘${nextSwitchName}’으로 전환할까요?`
                : `현재 세션을 취소하고 ‘${nextSwitchName}’으로 전환할까요?`}
            </Txt>
            <Button
              label={switchWillSave ? '기록하고 전환' : (activePendingSwitch?.autoStart ? '전환하고 시작' : '대상 전환')}
              icon="play"
              onPress={confirmSwitch}
            />
            <Button label="현재 집중 유지" kind="secondary" onPress={() => setPendingSwitch(null)} />
          </View>
        </Sheet>
      </FocusClockContext.Provider>
    </FocusStatusContext.Provider>
  );
}

/** Non-ticking focus state and controls (safe for TabBar indicators and toast layout without 500ms re-renders). */
export function useFocusStatus(): FocusStatusValue {
  const ctx = useContext(FocusStatusContext);
  if (!ctx) {
    return {
      running: null,
      activeMod: EMPTY_SESSION_MOD,
      isActive: false,
      isPaused: false,
      isRunningStopwatch: false,
      activeMode: 'pomodoro',
      rest: null,
      onBreak: false,
      target: null,
      durationOverride: null,
      effectiveMinutes: 25,
      day: logicalToday(deviceTimeZone()),
      timeZone: deviceTimeZone(),
      todayStats: { count: 0, seconds: 0 },
      pomodoroRoundsToday: 0,
      targetName: undefined,
      nameOf: () => undefined,
      setTarget: noop,
      setDurationOverride: noop,
      start: noop,
      startFor: noop,
      togglePause: noop,
      extendFiveMin: noop,
      stop: noop,
      endRest: noop,
    };
  }
  return ctx;
}

/** Full live focus runtime including the 500ms timer clock values. */
export function useFocusRuntime(): FocusRuntimeValue {
  const status = useFocusStatus();
  const clock = useContext(FocusClockContext);
  return useMemo(() => ({ ...status, ...clock }), [status, clock]);
}

/**
 * Sleek floating/docked mini-bar rendered above the bottom tab bar whenever a focus session or rest break
 * is active and the user is browsing another tab.
 */
export function GlobalFocusMiniBar({ hidden = false }: { hidden?: boolean }) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  const { running, isPaused, isRunningStopwatch, activeMode, rest, onBreak, targetName, shown, ratio, togglePause, endRest } = useFocusRuntime();

  if (hidden || (!running && !onBreak)) return null;

  const title = onBreak
    ? (rest?.long ? '긴 휴식 중' : '휴식 중')
    : (targetName ?? modeLabel(activeMode));
  const stateLabel = onBreak
    ? '휴식'
    : isPaused
      ? '일시정지'
      : isRunningStopwatch
        ? '측정 중'
        : '집중 중';
  const accentColor = isPaused ? colors.accentRamp[1] : colors.accent;
  const pct = Math.max(0, Math.min(100, ratio * 100));

  return (
    <View style={[styles.miniBarWrap, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: accentColor }]} />
      </View>
      <View style={styles.miniBarContent}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title} ${stateLabel} ${formatDuration(shown)}, 집중 탭으로 이동`}
          onPress={() => {
            haptic.tap();
            router.navigate('/focus');
          }}
          style={({ pressed }) => [
            styles.miniBarMain,
            pressed && { opacity: 0.72 },
            pressed && !reduced && styles.miniPressed,
          ]}>
          <View style={[styles.statusDot, { backgroundColor: accentColor }]} />
          <Txt variant="bodyStrong" tabular style={styles.miniTime}>
            {formatDuration(shown)}
          </Txt>
          <View style={styles.miniMeta}>
            <Txt variant="smallStrong" numberOfLines={1}>{title}</Txt>
            <Txt variant="caption" tone="muted" numberOfLines={1}>{stateLabel}</Txt>
          </View>
        </Pressable>
        {running ? (
          <IconButton
            name={isPaused ? 'play' : 'pause'}
            label={isPaused ? '집중 이어하기' : '집중 일시정지'}
            size={18}
            color={colors.text}
            onPress={togglePause}
            style={{ width: 36, height: 36, backgroundColor: colors.surfaceMuted }}
          />
        ) : (
          <IconButton
            name="x"
            label="휴식 종료"
            size={18}
            color={colors.textMuted}
            onPress={() => {
              haptic.tap();
              endRest();
            }}
            style={{ width: 36, height: 36, backgroundColor: colors.surfaceMuted }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  miniBarWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  progressTrack: {
    height: 2.5,
    width: '100%',
    overflow: 'hidden',
  },
  progressFill: {
    height: 2.5,
  },
  miniBarContent: {
    height: MINI_BAR_HEIGHT - 2.5,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  miniBarMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 40,
  },
  miniPressed: {
    transform: [{ scale: 0.99 }],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  miniTime: {
    letterSpacing: -0.4,
    minWidth: 52,
  },
  miniMeta: {
    flex: 1,
    gap: 1,
  },
});
