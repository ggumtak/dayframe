import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, type TextStyle, TextInput, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Checkbox } from '@/components/Checkbox';
import { Button, Card, Chip, Header, Icon, IconButton, ProgressBar, Row, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import { useDeleteFocus, useFocusSessions } from '@/data/focus';
import { useHabits } from '@/data/habits';
import { bySchedule, useSubtaskProgress, useTaskIndex } from '@/data/tasks';
import {
  clampInt, FOCUS_LIMITS, type FocusMode, setFocusPrefs, useFocusPrefs, weeklyFocusStats,
} from '@/features/focus/prefs';
import { MIN_RECORD_SECONDS, useFocusRuntime } from '@/features/focus/runtime';
import { KEY_PRIORITY, matchesCombo, useKeyHandler, useListCursor, useScreenContext, useScreenFocused } from '@/features/keyboard';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { dueBucket, formatDuration, formatMinutes, formatTime, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useLayout } from '@/lib/layoutContext';
import type { FocusSession, Habit, Task } from '@/lib/shared';
import { useTabScrollTop } from '@/lib/tabScroll';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

const SIZE = 248;
const STROKE = 10;
const FOCUS_MODES: readonly FocusMode[] = ['pomodoro', 'timer', 'stopwatch'];

type PickerItem =
  | { key: string; kind: 'task'; task: Task }
  | { key: string; kind: 'habit'; habit: Habit };

const pickerItemKey = (item: PickerItem) => item.key;

const pomoPresets = [
  { label: '15 / 3분', focus: 15, rest: 3, longRest: 10 },
  { label: '25 / 5분', focus: 25, rest: 5, longRest: 15 },
  { label: '50 / 10분', focus: 50, rest: 10, longRest: 30 },
] as const;

const timerPresets = [10, 15, 25, 45, 60, 90] as const;
const roundChoices = [2, 3, 4, 6] as const;

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
  const isFocused = useScreenFocused();
  useScreenContext('focus', isFocused);
  const params = useLocalSearchParams<{ taskId?: string; habitId?: string; duration?: string; autostart?: string; at?: string }>();
  const { data: sessions } = useFocusSessions();
  const { data: habits } = useHabits();
  const { tasks, byId, children } = useTaskIndex();
  const { completedChildren } = useSubtaskProgress();
  const deleteFocus = useDeleteFocus();
  const flow = useTaskFlow();
  const quickAdd = useQuickAdd();
  const prefs = useFocusPrefs();
  const personalPrefs = usePersonalPrefs();

  const runtime = useFocusRuntime();
  const {
    running, isPaused, isRunningStopwatch, rest, onBreak, target, durationOverride, day, timeZone,
    todayStats, pomodoroRoundsToday, targetName, nameOf, setTarget, setDurationOverride, start, startFor,
    togglePause, extendFiveMin, stop, endRest, netSeconds, shown, ratio,
  } = runtime;

  const [picking, setPicking] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [configuring, setConfiguring] = useState(false);
  const [confirmCancelSessionId, setConfirmCancelSessionId] = useState<string | null>(null);
  const [pickedRecord, setPickedRecord] = useState<FocusSession | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const pickerScrollRef = useRef<ScrollViewInstance>(null);
  useTabScrollTop('focus', scrollRef);
  const confirmCancel = !!running && confirmCancelSessionId === running.id;

  // Keep the focus view distraction-free by hiding the floating + button while a session is running.
  useEffect(() => {
    quickAdd.setFabHidden(!!running);
    return () => quickAdd.setFabHidden(false);
  }, [quickAdd, running]);

  // Arriving from a task or habit attaches it (with session-local duration & optional 1-tap autostart).
  const link = [
    params.taskId ? 'task:' + params.taskId : params.habitId ? 'habit:' + params.habitId : '',
    params.duration ?? '',
    params.autostart ?? '',
    params.at ?? '',
  ].join('@');
  const appliedLinkRef = useRef('@@@');
  useEffect(() => {
    if (link === appliedLinkRef.current) return;
    appliedLinkRef.current = link;
    if (!params.taskId && !params.habitId && !params.duration && !params.autostart) return;
    const mins = params.duration ? Number(params.duration) : null;
    startFor({
      taskId: params.taskId ?? null,
      habitId: params.habitId ?? null,
      minutes: mins !== null && Number.isFinite(mins) ? mins : null,
      autoStart: params.autostart === '1' || params.autostart === 'true',
    });
  }, [link, params.taskId, params.habitId, params.duration, params.autostart, startFor]);

  const weekly = useMemo(() => weeklyFocusStats(sessions ?? [], day, timeZone), [sessions, day, timeZone]);

  const requestCancel = () => {
    if (!running) return;
    if (netSeconds >= MIN_RECORD_SECONDS) {
      haptic.warning();
      setConfirmCancelSessionId(running.id);
    } else {
      stop('cancelled');
    }
  };

  const normalizedQuery = pickerQuery.trim().toLowerCase();
  const candidates = useMemo(() => {
    const todayTasks = tasks.filter((task) => ['overdue', 'today'].includes(dueBucket(task))).sort(bySchedule);
    if (!normalizedQuery) return todayTasks.slice(0, 12);
    return todayTasks.filter((task) =>
      task.title.toLowerCase().includes(normalizedQuery)
      || (task.notes ? task.notes.toLowerCase().includes(normalizedQuery) : false));
  }, [tasks, normalizedQuery]);

  const otherTasks = useMemo(() => {
    const shownIds = new Set(candidates.map((task) => task.id));
    const pool = tasks.filter((task) => !shownIds.has(task.id) && (normalizedQuery ? true : !task.parent_task_id)).sort(bySchedule);
    if (!normalizedQuery) return pool.slice(0, 12);
    return pool.filter((task) =>
      task.title.toLowerCase().includes(normalizedQuery)
      || (task.notes ? task.notes.toLowerCase().includes(normalizedQuery) : false));
  }, [tasks, candidates, normalizedQuery]);

  const activeHabits = useMemo(() => {
    const list = (habits ?? []).filter((habit) => !habit.archived_at);
    if (!normalizedQuery) return list;
    return list.filter((habit) => habit.name.toLowerCase().includes(normalizedQuery));
  }, [habits, normalizedQuery]);

  const pickerItems = useMemo<PickerItem[]>(() => [
    ...candidates.map((task): PickerItem => ({ key: 'task:' + task.id, kind: 'task', task })),
    ...otherTasks.map((task): PickerItem => ({ key: 'task:' + task.id, kind: 'task', task })),
    ...activeHabits.map((habit): PickerItem => ({ key: 'habit:' + habit.id, kind: 'habit', habit })),
  ], [candidates, otherTasks, activeHabits]);

  const pickerCursor = useListCursor(pickerItems, pickerItemKey, {
    enabled: isFocused && picking,
    scrollRef: pickerScrollRef,
    estimatedRowHeight: 52,
    headerOffset: 24,
  });

  const closePicking = () => {
    pickerCursor.clear();
    setPickerQuery('');
    setPicking(false);
  };

  const selectPickerItem = (item: PickerItem) => {
    if (item.kind === 'task') {
      setTarget({ kind: 'task', id: item.task.id });
      if (item.task.duration_minutes && item.task.duration_minutes <= FOCUS_LIMITS.focus.max) {
        // Keep task duration session-local so it never overwrites the user's persisted Pomodoro/timer defaults.
        setDurationOverride(item.task.duration_minutes);
      } else {
        setDurationOverride(null);
      }
    } else {
      setTarget({ kind: 'habit', id: item.habit.id });
      setDurationOverride(null);
    }
    closePicking();
  };

  const deletePickedRecord = () => {
    if (!pickedRecord) return;
    deleteFocus.mutate(pickedRecord.id);
    setPickedRecord(null);
    showToast('집중 기록을 삭제했습니다.');
  };

  const linkedTaskId = running ? running.task_id : (target?.kind === 'task' ? target.id : null);
  const linkedTask = linkedTaskId ? byId.get(linkedTaskId) : undefined;
  const linkedOpenSubs = linkedTask ? (children.get(linkedTask.id) ?? []) : [];
  const linkedDoneSubs = linkedTask ? (completedChildren.get(linkedTask.id) ?? []) : [];
  const linkedTotalSubs = linkedOpenSubs.length + linkedDoneSubs.length;

  const rounds = prefs.roundsBeforeLongBreak;
  const round = pomodoroRoundsToday % rounds;
  const r = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  // One accent for the ring in every state; paused is the lighter step, and the label says which state it is.
  const ringColor = isPaused ? colors.accentRamp[1] : colors.accent;
  const showProgress = ratio > 0.002;
  const tipAngle = ratio * 2 * Math.PI - Math.PI / 2;
  const tipX = SIZE / 2 + r * Math.cos(tipAngle);
  const tipY = SIZE / 2 + r * Math.sin(tipAngle);

  const recent = (sessions ?? []).filter((session) => session.status !== 'running' && !isFalseStart(session)).slice(0, 5);
  const canConfigure = !running && !onBreak && prefs.mode !== 'stopwatch';

  const goalMinutes = personalPrefs.focusDailyGoalMinutes;
  const todayMinutes = Math.round(todayStats.seconds / 60);
  const goalPct = goalMinutes > 0 ? Math.min(100, Math.round((todayMinutes / goalMinutes) * 100)) : 0;

  useKeyHandler(
    (event) => {
      if (event.editing || event.modal) return false;
      if (matchesCombo(event, 'space') || matchesCombo(event, 'enter')) {
        if (!event.repeat) {
          if (running) togglePause();
          else start();
        }
        return true;
      }
      if (!running && (matchesCombo(event, 'tab') || matchesCombo(event, 'shift+tab') || matchesCombo(event, ']') || matchesCombo(event, '['))) {
        if (!event.repeat) {
          const step = matchesCombo(event, 'shift+tab') || matchesCombo(event, '[') ? -1 : 1;
          const nextMode = FOCUS_MODES[(FOCUS_MODES.indexOf(prefs.mode) + step + FOCUS_MODES.length) % FOCUS_MODES.length];
          if (nextMode !== 'pomodoro' && onBreak) endRest();
          setFocusPrefs({ mode: nextMode });
          haptic.tap();
        }
        return true;
      }
      if (matchesCombo(event, '+') || matchesCombo(event, '=') || matchesCombo(event, 'arrowup')) {
        if (running && !isRunningStopwatch) {
          if (!event.repeat) extendFiveMin();
          return true;
        }
        if (!running && prefs.mode !== 'stopwatch') {
          setDurationOverride(null);
          if (prefs.mode === 'pomodoro') {
            setFocusPrefs({
              focusMinutes: clampInt(prefs.focusMinutes + 5, FOCUS_LIMITS.focus.min, FOCUS_LIMITS.focus.max, prefs.focusMinutes),
            });
          } else {
            setFocusPrefs({
              timerMinutes: clampInt(prefs.timerMinutes + 5, FOCUS_LIMITS.focus.min, FOCUS_LIMITS.focus.max, prefs.timerMinutes),
            });
          }
          haptic.tap();
          return true;
        }
      }
      if (matchesCombo(event, '-') || matchesCombo(event, 'arrowdown')) {
        if (!running && prefs.mode !== 'stopwatch') {
          setDurationOverride(null);
          if (prefs.mode === 'pomodoro') {
            setFocusPrefs({
              focusMinutes: clampInt(prefs.focusMinutes - 5, FOCUS_LIMITS.focus.min, FOCUS_LIMITS.focus.max, prefs.focusMinutes),
            });
          } else {
            setFocusPrefs({
              timerMinutes: clampInt(prefs.timerMinutes - 5, FOCUS_LIMITS.focus.min, FOCUS_LIMITS.focus.max, prefs.timerMinutes),
            });
          }
          haptic.tap();
          return true;
        }
      }
      if (matchesCombo(event, 'x') || matchesCombo(event, 'c')) {
        if (running) {
          if (!event.repeat) stop('completed');
          return true;
        }
      }
      if (matchesCombo(event, 'delete') || matchesCombo(event, 'backspace')) {
        if (running) {
          if (!event.repeat) requestCancel();
          return true;
        }
      }
      if (matchesCombo(event, 'p') || matchesCombo(event, 'l')) {
        if (!running) {
          if (!event.repeat) {
            haptic.tap();
            setPicking(true);
          }
          return true;
        }
      }
      if (matchesCombo(event, 't') || matchesCombo(event, 'o')) {
        if (canConfigure) {
          if (!event.repeat) {
            haptic.tap();
            setConfiguring(true);
          }
          return true;
        }
      }
      if (matchesCombo(event, 'escape')) {
        if (onBreak) {
          if (!event.repeat) {
            haptic.tap();
            endRest();
          }
          return true;
        }
      }
      return false;
    },
    { priority: KEY_PRIORITY.screen, enabled: isFocused && !configuring && !picking && !pickedRecord && !confirmCancel },
  );

  useKeyHandler(
    (event) => {
      if (event.editing) return false;
      if (matchesCombo(event, 'escape')) {
        if (!event.repeat) closePicking();
        return true;
      }
      if (matchesCombo(event, 'j') || matchesCombo(event, 'arrowdown')) {
        pickerCursor.move(1);
        return true;
      }
      if (matchesCombo(event, 'k') || matchesCombo(event, 'arrowup')) {
        pickerCursor.move(-1);
        return true;
      }
      if (matchesCombo(event, 'home')) {
        pickerCursor.moveFirst();
        return true;
      }
      if (matchesCombo(event, 'shift+g') || matchesCombo(event, 'end')) {
        pickerCursor.moveLast();
        return true;
      }
      if (matchesCombo(event, 'enter') || matchesCombo(event, 'space')) {
        if (!event.repeat && pickerCursor.focusedItem) {
          haptic.tap();
          selectPickerItem(pickerCursor.focusedItem);
        }
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: isFocused && picking },
  );

  useKeyHandler(
    (event) => {
      if (matchesCombo(event, 'mod+enter') || (!event.editing && matchesCombo(event, 'enter'))) {
        if (!event.repeat) {
          haptic.tap();
          setConfiguring(false);
        }
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: isFocused && configuring },
  );

  useKeyHandler(
    (event) => {
      if (event.editing) return false;
      if (matchesCombo(event, 'escape')) {
        if (!event.repeat) setPickedRecord(null);
        return true;
      }
      if (matchesCombo(event, 'delete') || matchesCombo(event, 'backspace')) {
        if (!event.repeat) {
          haptic.warning();
          deletePickedRecord();
        }
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: isFocused && !!pickedRecord },
  );

  // A short window (a landscape tablet) puts the dial and its controls side by side so both stay above the fold.
  const { short: sideBySide } = useLayout();
  const modePicker = !running ? (
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
  ) : null;

  return (
    <Screen>
      <Header
        title="집중" subtitle={todayStats.count ? `오늘 ${todayStats.count}회 · ${formatMinutes(todayStats.seconds)}` : '오늘 첫 집중을 시작해 보세요'}
        right={canConfigure ? (
          <IconButton name="sliders" label="시간 설정" onPress={() => setConfiguring(true)} color={colors.textMuted} />
        ) : undefined} />
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.lg, alignItems: 'center' }}>
        {goalMinutes > 0 ? (
          <View
            accessibilityLabel={`오늘 집중 ${todayMinutes}분, 목표 ${goalMinutes}분`}
            style={[styles.goalStrip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.goalHeader}>
              <Txt variant="smallStrong" tabular>{`오늘 집중 ${todayMinutes}분 / 목표 ${goalMinutes}분`}</Txt>
              <Txt variant="caption" tone={todayMinutes >= goalMinutes ? 'accent' : 'muted'} tabular style={{ fontWeight: '600' }}>
                {todayMinutes >= goalMinutes ? '목표 달성' : `${goalPct}%`}
              </Txt>
            </View>
            <ProgressBar value={todayMinutes / goalMinutes} height={5} />
          </View>
        ) : null}

        <View style={sideBySide ? styles.dialRow : styles.dialStack}>
          {sideBySide ? null : modePicker}
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
              {showProgress ? (
                <Circle
                  cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={ringColor} strokeWidth={STROKE} fill="none" strokeLinecap="round"
                  strokeDasharray={`${circumference * ratio} ${circumference}`} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
              ) : null}
              {(running || onBreak) && showProgress ? (
                <Circle cx={tipX} cy={tipY} r={STROKE * 0.65} fill={ringColor} stroke={colors.surface} strokeWidth={2.5} />
              ) : null}
            </Svg>
            <Txt variant="caption" tone={isPaused || onBreak ? 'default' : 'muted'} style={[{ marginBottom: 4 }, (isPaused || onBreak) && { fontWeight: '600' }]}>
              {isPaused ? '일시정지'
                : running ? (isRunningStopwatch ? '측정 중' : '집중 중')
                  : onBreak ? (rest!.long ? '긴 휴식 중' : '휴식 중')
                    : prefs.mode === 'pomodoro' ? '뽀모도로' : prefs.mode === 'timer' ? '타이머' : '스톱워치'}
            </Txt>
            <Txt
              numberOfLines={1} adjustsFontSizeToFit tabular
              style={{ fontSize: 54, lineHeight: 62, fontWeight: '400', letterSpacing: -1.5, maxWidth: SIZE - 44 }}>
              {formatDuration(shown)}
            </Txt>
            {targetName ? (
              <Txt variant="small" tone="muted" numberOfLines={1} style={{ maxWidth: SIZE - 64, marginTop: 4 }}>{targetName}</Txt>
            ) : canConfigure ? (
              <View style={{ marginTop: 8 }}>
                <Icon name="edit-2" size={13} color={colors.textFaint} />
              </View>
            ) : null}
          </Pressable>

          <View style={sideBySide ? styles.controlsSide : styles.dialStack}>
            {sideBySide ? modePicker : null}
            {running ? (
              <View style={{ alignSelf: 'stretch', gap: space.sm }}>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button
                    label={isPaused ? '이어하기' : '일시정지'} kind="secondary" icon={isPaused ? 'play' : 'pause'}
                    onPress={togglePause} style={{ flex: 1 }} />
                  {!isRunningStopwatch ? (
                    <Button label="5분 연장" kind="secondary" icon="plus" onPress={extendFiveMin} style={{ flex: 1 }} />
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="취소" kind="ghost" icon="x" onPress={requestCancel} style={{ flex: 1 }} />
                  <Button label={isRunningStopwatch ? '기록 완료' : '바로 완료'} icon="check" onPress={() => stop('completed')} style={{ flex: 1 }} />
                </View>
              </View>
            ) : (
              <>
                {prefs.mode === 'pomodoro' ? (
                  <View style={{ alignSelf: 'stretch', gap: space.sm, alignItems: 'center' }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {pomoPresets.map((preset) => {
                        const selected = durationOverride === null
                          && prefs.focusMinutes === preset.focus
                          && prefs.shortBreakMinutes === preset.rest
                          && prefs.longBreakMinutes === preset.longRest;
                        return (
                          <Chip
                            key={preset.label} label={preset.label} selected={selected}
                            onPress={() => {
                              setDurationOverride(null);
                              setFocusPrefs({ focusMinutes: preset.focus, shortBreakMinutes: preset.rest, longBreakMinutes: preset.longRest });
                            }} />
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
                      <Txt variant="small" tone="muted" tabular style={{ marginLeft: 4 }}>
                        휴식 {prefs.shortBreakMinutes}분 · {rounds - round}세트 후 긴 휴식 {prefs.longBreakMinutes}분
                      </Txt>
                    </View>
                  </View>
                ) : prefs.mode === 'timer' ? (
                  <View style={{ alignSelf: 'stretch', gap: space.sm, alignItems: 'center' }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {timerPresets.map((preset) => (
                        <Chip
                          key={preset} label={`${preset}분`} selected={durationOverride === null && prefs.timerMinutes === preset}
                          onPress={() => {
                            setDurationOverride(null);
                            setFocusPrefs({ timerMinutes: preset });
                          }} />
                      ))}
                      <Chip icon="sliders" label="직접 설정" onPress={() => setConfiguring(true)} />
                    </ScrollView>
                  </View>
                ) : null}

                {durationOverride !== null && prefs.mode !== 'stopwatch' ? (
                  <View style={styles.overrideNote}>
                    <Txt variant="caption" tone="muted" tabular>
                      이번 집중만 {durationOverride}분으로 적용 중
                    </Txt>
                    <Pressable hitSlop={8} onPress={() => { haptic.tap(); setDurationOverride(null); }}>
                      <Txt variant="caption" tone="accent" style={{ fontWeight: '600' }}>기본값으로</Txt>
                    </Pressable>
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                  <Chip icon="link" label={targetName ?? '할 일·습관 연결'} tone={target ? 'set' : undefined} onPress={() => setPicking(true)} style={{ maxWidth: 260 }} />
                  {target ? <Chip icon="x" label="해제" onPress={() => setTarget(null)} /> : null}
                </View>
                <View style={{ alignSelf: 'stretch', gap: space.sm }}>
                  <Button
                    label={onBreak ? '휴식 건너뛰고 집중 시작' : prefs.mode === 'pomodoro' ? '집중 시작' : prefs.mode === 'timer' ? '타이머 시작' : '스톱워치 시작'}
                    icon="play" onPress={() => start()} />
                  {onBreak ? <Button label="휴식 종료" kind="ghost" onPress={endRest} /> : null}
                </View>
              </>
            )}
          </View>
        </View>

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
                  <Txt variant="caption" tone="muted" tabular>
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
                      onPress={() => flow.reopen(sub)} label={sub.title + ' 완료 취소'} />
                    <Text numberOfLines={1} style={[type.small as TextStyle, { color: colors.textFaint, textDecorationLine: 'line-through', flex: 1 }]}>
                      {sub.title}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}

        {weekly.totalCount > 0 ? (
          <Card style={{ alignSelf: 'stretch', gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Txt variant="section" tone="muted">최근 7일 집중</Txt>
              <Txt variant="smallStrong" tabular>
                {formatMinutes(weekly.totalSeconds)} · {weekly.totalCount}회
              </Txt>
            </View>
            <View style={styles.chart} accessibilityLabel={`최근 7일 집중 ${formatMinutes(weekly.totalSeconds)}`}>
              {weekly.days.map((bar) => {
                const height = bar.minutes > 0 ? Math.max(8, Math.round((bar.minutes / weekly.maxMinutes) * 64)) : 4;
                return (
                  <View key={bar.date} style={styles.barCol}>
                    <Txt variant="caption" tone={bar.isToday ? 'default' : 'faint'} tabular numberOfLines={1} style={{ height: 14 }}>
                      {bar.minutes > 0 ? `${bar.minutes}분` : ''}
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
                    <Txt variant="small" tone="muted" tabular>
                      {started.month}월 {started.day}일 {formatTime(started.hour * 60 + started.minute, personalPrefs.timeFormat)}
                    </Txt>
                  </View>
                  <Txt variant="smallStrong" tone={session.status === 'completed' ? 'default' : 'faint'} tabular>{formatMinutes(seconds)}</Txt>
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
                onChange={(focusMinutes) => {
                  setDurationOverride(null);
                  setFocusPrefs({ focusMinutes });
                }} />
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
                {prefs.roundsBeforeLongBreak}세트 후 긴 휴식이 끝나면 타이머가 자동으로 멈추며, 다음 집중은 1세트부터 다시 시작됩니다.
              </Txt>
            </>
          ) : (
            <>
              <MinuteControl
                label="타이머 시간" value={prefs.timerMinutes} min={FOCUS_LIMITS.focus.min} max={FOCUS_LIMITS.focus.max} step={5}
                onChange={(timerMinutes) => {
                  setDurationOverride(null);
                  setFocusPrefs({ timerMinutes });
                }} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[5, 10, 15, 25, 30, 45, 60, 90, 120].map((preset) => (
                  <Chip
                    key={preset} label={preset >= 60 && preset % 60 === 0 ? `${preset / 60}시간` : `${preset}분`}
                    selected={prefs.timerMinutes === preset}
                    onPress={() => {
                      setDurationOverride(null);
                      setFocusPrefs({ timerMinutes: preset });
                    }} />
                ))}
              </View>
            </>
          )}
          <Button label="완료" onPress={() => setConfiguring(false)} style={{ marginTop: space.xs }} />
        </View>
      </Sheet>

      <Sheet visible={picking} onClose={closePicking} title="무엇에 집중할까요?">
        <View style={[styles.searchBox, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Icon name="search" size={16} color={colors.textFaint} />
          <TextInput
            value={pickerQuery}
            onChangeText={setPickerQuery}
            placeholder="할 일이나 습관 검색"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="집중 대상 검색"
            returnKeyType="search"
            style={[type.body as TextStyle, { flex: 1, color: colors.text, paddingVertical: 0 }]}
          />
          {pickerQuery ? (
            <IconButton
              name="x" label="검색어 지우기" size={16} color={colors.textMuted}
              onPress={() => setPickerQuery('')} style={{ width: 28, height: 28 }} />
          ) : null}
        </View>
        <ScrollView ref={pickerScrollRef} keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }}>
          {candidates.length ? <Txt variant="section" tone="muted">오늘 할 일</Txt> : null}
          {candidates.map((task) => (
            <View
              key={task.id}
              style={pickerCursor.isFocused('task:' + task.id)
                ? [styles.pickerHighlight, { backgroundColor: colors.accentSoft }]
                : undefined}>
              <Row
                icon="check-square" label={task.title}
                detail={task.duration_minutes ? `${task.duration_minutes}분` : undefined}
                onPress={() => selectPickerItem({ key: 'task:' + task.id, kind: 'task', task })} />
            </View>
          ))}
          {otherTasks.length ? <Txt variant="section" tone="muted" style={{ marginTop: space.md }}>다른 할 일</Txt> : null}
          {otherTasks.map((task) => (
            <View
              key={task.id}
              style={pickerCursor.isFocused('task:' + task.id)
                ? [styles.pickerHighlight, { backgroundColor: colors.accentSoft }]
                : undefined}>
              <Row
                icon="check-square" label={task.title}
                detail={task.duration_minutes ? `${task.duration_minutes}분` : undefined}
                onPress={() => selectPickerItem({ key: 'task:' + task.id, kind: 'task', task })} />
            </View>
          ))}
          {activeHabits.length ? <Txt variant="section" tone="muted" style={{ marginTop: space.md }}>습관</Txt> : null}
          {activeHabits.map((habit) => (
            <View
              key={habit.id}
              style={pickerCursor.isFocused('habit:' + habit.id)
                ? [styles.pickerHighlight, { backgroundColor: colors.accentSoft }]
                : undefined}>
              <Row
                icon="repeat" label={habit.name}
                onPress={() => selectPickerItem({ key: 'habit:' + habit.id, kind: 'habit', habit })} />
            </View>
          ))}
          {!candidates.length && !otherTasks.length && !activeHabits.length ? (
            <Txt tone="muted" style={{ paddingVertical: space.lg }}>
              {normalizedQuery ? '검색 결과가 없습니다.' : '등록된 할 일이나 습관이 있으면 이곳에서 연결할 수 있습니다.'}
            </Txt>
          ) : null}
        </ScrollView>
      </Sheet>

      <Sheet visible={confirmCancel} onClose={() => setConfirmCancelSessionId(null)} title="진행 중인 집중을 취소할까요?">
        <View style={{ gap: space.sm }}>
          <Txt tone="muted" style={{ marginBottom: space.sm }}>
            {`지금까지 ${formatMinutes(netSeconds)} 집중했습니다. 기록 없이 취소하면 이번 집중 시간은 저장되지 않습니다.`}
          </Txt>
          <Button
            label="기록하고 완료"
            icon="check"
            onPress={() => {
              setConfirmCancelSessionId(null);
              stop('completed');
            }}
          />
          <Button
            label="기록 없이 취소"
            kind="danger"
            icon="trash-2"
            onPress={() => {
              setConfirmCancelSessionId(null);
              stop('cancelled');
            }}
          />
          <Button label="계속 집중하기" kind="secondary" onPress={() => setConfirmCancelSessionId(null)} />
        </View>
      </Sheet>

      <Sheet visible={!!pickedRecord} onClose={() => setPickedRecord(null)} title="집중 기록">
        {pickedRecord ? (() => {
          const started = Temporal.Instant.from(pickedRecord.started_at).toZonedDateTimeISO(timeZone);
          const seconds = pickedRecord.ended_at
            ? (new Date(pickedRecord.ended_at).getTime() - new Date(pickedRecord.started_at).getTime()) / 1000 : 0;
          return (
            <View style={{ gap: space.sm }}>
              <Txt variant="bodyStrong">{nameOf(pickedRecord) ?? '자유 집중'}</Txt>
              <Txt tone="muted" tabular style={{ marginBottom: space.md }}>
                {`${started.month}월 ${started.day}일 ${formatTime(started.hour * 60 + started.minute, personalPrefs.timeFormat)} · ${formatMinutes(seconds)}`}
              </Txt>
              <Button
                label="이 기록 삭제" kind="danger" icon="trash-2"
                onPress={deletePickedRecord} />
              <Button label="닫기" kind="secondary" onPress={() => setPickedRecord(null)} />
            </View>
          );
        })() : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  goalStrip: {
    alignSelf: 'stretch',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    gap: space.sm,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  // The dial, then its controls, each as wide as the column: the phone layout.
  dialStack: { alignSelf: 'stretch', alignItems: 'center', gap: space.lg },
  dialRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: space.xl },
  controlsSide: { flex: 1, alignItems: 'center', gap: space.lg },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  numBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2,
    borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.sm, height: 38, minWidth: 72,
  },
  overrideNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  focusSubRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6,
  },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 102 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: { height: 64, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  barFill: { width: 22, borderRadius: 6 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    height: 40,
    marginBottom: space.md,
  },
  pickerHighlight: { borderRadius: radius.md, marginHorizontal: -space.sm, paddingHorizontal: space.sm },
});
