import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { MonthCalendar } from '@/components/MonthCalendar';
import { Button, Chip, Icon, IconButton, Row, Sheet, Txt } from '@/components/ui';
import { useTaskActions, useTaskIndex } from '@/data/tasks';
import { KEY_PRIORITY, matchesCombo, useKeyHandler } from '@/features/keyboard';
import { parseErrorMessage } from '@/features/quick-add/messages';
import { reminderSummary } from '@/features/reminders/lead';
import { useReminderOverrides } from '@/features/reminders/overrides';
import { TaskReminderPicker } from '@/features/reminders/ReminderChips';
import { useReminderSettings } from '@/features/reminders/settings';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import {
  describeRecurrence, dueDate, dueMinutes, formatDue, formatDurationMinutes, formatTime, instantFor, type PlainDate, Temporal, today,
  weekdayName,
} from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { analyzeTask, type RecurrenceMode, type Task, type TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

import { RepeatPicker, repeatPatch } from './RepeatSheet';
import { parseTimeInput, timeInputText } from './timeInput';
import { localTimeString, type RescheduleOptions } from './useTaskFlow';

const PLACEHOLDER = '⁣';

const timePresets: { minutes: number | null; label: string }[] = [
  { minutes: null, label: '종일' },
  { minutes: 9 * 60, label: '오전 9시' },
  { minutes: 12 * 60, label: '낮 12시' },
  { minutes: 15 * 60, label: '오후 3시' },
  { minutes: 18 * 60, label: '오후 6시' },
  { minutes: 21 * 60, label: '오후 9시' },
];

const durationPresets: { minutes: number | null; label: string }[] = [
  { minutes: null, label: '없음' },
  { minutes: 15, label: '15분' },
  { minutes: 30, label: '30분' },
  { minutes: 60, label: '1시간' },
  { minutes: 120, label: '2시간' },
];

/** Supports both prefix ("오후 5시", "pm 5") and suffix ("5pm", "5:30pm") forms alongside 24h ("17:30", "1730"). */
function parseFlexibleTimeInput(text: string): number | null {
  const trimmed = text.trim();
  const direct = parseTimeInput(trimmed);
  if (direct !== null) return direct;
  const suffix = /^(\d{1,2}(?::\d{1,2})?)\s*(am|pm)$/i.exec(trimmed);
  if (suffix) return parseTimeInput(`${suffix[2]} ${suffix[1]}`);
  return null;
}

/** The month grid re-renders only when the date it shows changes, not on every time or pane change. */
const Calendar = memo(MonthCalendar);

type Pane = 'main' | 'reminder' | 'repeat';
const paneTitles: Record<Pane, string> = { main: '일정 변경', reminder: '알림', repeat: '반복' };

export type SchedulePickHandler = (
  task: Task,
  date: PlainDate | null,
  minutes?: number | null,
  options?: RescheduleOptions,
) => void;

/**
 * Date, time, duration, alert and repeat in one sheet. Day chips and the calendar pick a date in one tap (applying any
 * staged time and duration in one shot); the 알림 and 반복 rows swap the sheet's content to their choices and back, so a
 * second sheet never opens on top.
 */
export function ScheduleSheet({ task, onClose, onPick }: {
  task: Task | null; onClose: () => void; onPick: SchedulePickHandler;
}) {
  if (!task) return null;
  // Keyed by task only, so an edit made from inside the sheet (a repeat) does not close and reopen it.
  return <ScheduleContent key={task.id} task={task} onClose={onClose} onPick={onPick} />;
}

function ScheduleContent({ task: opened, onClose, onPick }: {
  task: Task; onClose: () => void; onPick: SchedulePickHandler;
}) {
  const { colors } = useTheme();
  const { timeFormat } = usePersonalPrefs();
  const actions = useTaskActions();
  const { height } = useWindowDimensions();
  const reminderSettings = useReminderSettings();
  const reminderOverrides = useReminderOverrides();
  // A caller may hold the task as it was when the sheet opened; the live copy shows edits made here.
  const { byId } = useTaskIndex();
  const task = byId.get(opened.id) ?? opened;
  const now = useMemo(() => today(task.timezone), [task.timezone]);
  const current = useMemo(() => dueDate({ due_at: task.due_at, timezone: task.timezone }), [task.due_at, task.timezone]);
  const initialMinutes = dueMinutes(task);
  const initialDuration = task.duration_minutes ?? null;
  const [minutes, setMinutes] = useState<number | null>(initialMinutes);
  const [duration, setDuration] = useState<number | null>(initialDuration);
  // When the saved schedule changes underneath (a repeat set on an undated task), the staged selection follows it.
  const scheduleKey = (task.due_at ?? '') + '|' + task.all_day + '|' + String(initialDuration ?? '');
  const [shownFor, setShownFor] = useState(scheduleKey);
  if (shownFor !== scheduleKey) {
    setShownFor(scheduleKey);
    setMinutes(initialMinutes);
    setDuration(initialDuration);
  }
  const [pane, setPane] = useState<Pane>('main');
  const [typing, setTyping] = useState(false);
  const [when, setWhen] = useState('');
  // The exact-time field's text while it is open.
  const [timeText, setTimeText] = useState<string | null>(null);
  const timeChanged = minutes !== initialMinutes;
  const durationChanged = duration !== initialDuration;

  const parsedText = useMemo(() => {
    if (!when.trim()) return null;
    try {
      const { task: parsed, tokens } = analyzeTask({ text: when + ' ' + PLACEHOLDER, timezone: task.timezone });
      const leftover = parsed.title.replace(PLACEHOLDER, '').trim();
      if (leftover) return { error: `‘${leftover}’ 부분은 인식하지 못했습니다.` };
      if (!parsed.due_at && !parsed.duration_minutes) return { error: '날짜나 시간, 소요 시간을 함께 입력해 주세요.' };

      const hasDateToken = tokens.some((token) => token.kind === 'date');
      const hasTimeToken = tokens.some((token) => token.kind === 'time');
      const hasRecurrenceToken = tokens.some((token) => token.kind === 'recurrence');

      // If the user typed only a time (e.g. "오후 4시") on an existing dated task, keep its current date.
      let dueAt = parsed.due_at;
      let allDay = parsed.all_day;
      let localTime = parsed.recurrence_local_time ?? null;
      if (parsed.due_at && !hasDateToken && !hasRecurrenceToken && hasTimeToken && current) {
        const parsedTime = Temporal.Instant.from(parsed.due_at).toZonedDateTimeISO(task.timezone);
        const mins = parsedTime.hour * 60 + parsedTime.minute;
        dueAt = instantFor(current, mins, task.timezone);
        allDay = false;
        localTime = localTimeString(mins);
      }

      // Preserve existing recurrence when the user didn't explicitly type a new recurrence rule.
      const keepRecurrence = !hasRecurrenceToken && !!task.recurrence_rule;
      const nextRule = hasRecurrenceToken ? parsed.recurrence_rule : (keepRecurrence ? task.recurrence_rule : null);
      const nextMode = hasRecurrenceToken ? parsed.recurrence_mode : (keepRecurrence ? task.recurrence_mode : 'schedule');

      const patch: TaskPatch = {
        ...(dueAt ? {
          due_at: dueAt,
          all_day: allDay,
          recurrence_rule: nextRule,
          recurrence_mode: nextMode,
          recurrence_local_time: nextRule ? (allDay ? null : localTime ?? task.recurrence_local_time) : null,
        } : {}),
        ...(parsed.duration_minutes ? { duration_minutes: parsed.duration_minutes } : {}),
      };
      const label = [
        dueAt ? formatDue({ due_at: dueAt, all_day: allDay, timezone: task.timezone }, timeFormat) : null,
        parsed.duration_minutes ? formatDurationMinutes(parsed.duration_minutes) : null,
        describeRecurrence(nextRule, nextMode),
      ].filter(Boolean).join(' · ');
      return { patch, label };
    } catch (error) {
      return { error: parseErrorMessage(error) ?? '날짜나 시간을 입력해 주세요.' };
    }
  }, [when, task.timezone, task.recurrence_rule, task.recurrence_mode, task.recurrence_local_time, current, timeFormat]);

  // Day taps read the latest selection through a ref, so the calendar's callback never changes and it is not re-rendered.
  const latest = useRef({ task, minutes, duration, durationChanged, onPick, onClose });
  useEffect(() => {
    latest.current = { task, minutes, duration, durationChanged, onPick, onClose };
  });
  const choose = useCallback((date: PlainDate | null, overrideMinutes?: number | null) => {
    const {
      task: target,
      minutes: stagedTime,
      duration: stagedDuration,
      durationChanged: hasDurationChange,
      onPick: pick,
      onClose: close,
    } = latest.current;
    const effectiveMinutes = overrideMinutes !== undefined ? overrideMinutes : stagedTime;
    const options = hasDurationChange ? { durationMinutes: stagedDuration } : undefined;
    pick(target, date, date ? effectiveMinutes : undefined, options);
    close();
  }, []);

  const applyDurationOnly = () => {
    const prevDuration = task.duration_minutes;
    actions.update(task.id, { duration_minutes: duration });
    haptic.success();
    const label = duration ? formatDurationMinutes(duration) : null;
    showToast(label ? `소요 시간을 ${label}${josa(label, '으로/로')} 설정했습니다.` : '소요 시간을 지웠습니다.', {
      actionLabel: '실행 취소',
      onAction: () => actions.update(task.id, { duration_minutes: prevDuration }),
    });
    onClose();
  };

  const applyStaged = () => {
    if (timeChanged) {
      choose(current ?? now);
    } else if (durationChanged) {
      applyDurationOnly();
    }
  };

  const applyPlusOneHour = () => {
    if (minutes !== null) {
      const baseDate = current ?? now;
      const total = minutes + 60;
      const targetDate = total >= 1440 ? baseDate.add({ days: 1 }) : baseDate;
      choose(targetDate, total % 1440);
      return;
    }
    const nextHour = Temporal.Now.zonedDateTimeISO(task.timezone).add({ hours: 1 });
    choose(nextHour.toPlainDate(), nextHour.hour * 60 + nextHour.minute);
  };

  const applyTyped = () => {
    if (!parsedText?.patch) return;
    const prevPatch: TaskPatch = {
      due_at: task.due_at,
      all_day: task.all_day,
      recurrence_rule: task.recurrence_rule,
      recurrence_mode: task.recurrence_mode,
      recurrence_local_time: task.recurrence_local_time,
      duration_minutes: task.duration_minutes,
    };
    actions.update(task.id, parsedText.patch);
    haptic.success();
    showToast(`일정을 ‘${parsedText.label}’${josa(parsedText.label, '으로/로')} 바꿨습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => actions.update(task.id, prevPatch),
    });
    onClose();
  };

  const back = useCallback(() => setPane('main'), []);
  const applyRepeat = (rule: string | null, mode: RecurrenceMode) => {
    const patch = repeatPatch(task, rule, mode);
    if (patch) {
      actions.update(task.id, patch);
      haptic.tap();
    }
    back();
  };

  const nudgeMinutes = (delta: number) => {
    haptic.tap();
    const base = minutes ?? 9 * 60;
    setMinutes((base + delta + 1440) % 1440);
  };

  const typedMinutes = timeText === null ? null : parseFlexibleTimeInput(timeText);
  const applyTypedTime = () => {
    if (typedMinutes === null) return;
    haptic.tap();
    setMinutes(typedMinutes);
    setTimeText(null);
  };

  const tomorrow = now.add({ days: 1 });
  const dayAfterTomorrow = now.add({ days: 2 });
  // On Sat/Sun, target next Saturday and label it honestly as "다음 주말"; on Mon-Fri, target this Saturday ("이번 주말").
  const isWeekendToday = now.dayOfWeek >= 6;
  const weekend = now.add({ days: (6 - now.dayOfWeek + 7) % 7 || 7 });
  const weekendLabel = `${isWeekendToday ? '다음 주말' : '이번 주말'} · ${weekdayName(weekend)}`;
  const monday = now.add({ days: 8 - now.dayOfWeek });
  const plusOneWeekBase = current && Temporal.PlainDate.compare(current, now) >= 0 ? current : now;
  const plusOneWeek = plusOneWeekBase.add({ days: 7 });
  const showPlusOneHour = minutes !== null || (current !== null && current.equals(now));
  const hasCustomTime = minutes !== null && !timePresets.some((item) => item.minutes === minutes);
  const hasCustomDuration = duration !== null && !durationPresets.some((item) => item.minutes === duration);
  const reminder = reminderSummary(reminderOverrides.tasks[task.id], reminderSettings, minutes === null);
  const repeatLabel = describeRecurrence(task.recurrence_rule, task.recurrence_mode);
  // The alert preview follows the time chosen here, before it is saved.
  const previewDue = useMemo(() => (current ? instantFor(current, minutes, task.timezone) : null), [current, minutes, task.timezone]);
  const chevron = <Icon name="chevron-right" size={18} color={colors.textFaint} />;

  const stagedButtonLabel = (() => {
    const parts: string[] = [];
    if (timeChanged) parts.push(minutes === null ? '종일' : formatTime(minutes, timeFormat));
    if (durationChanged) parts.push(duration === null ? '소요 없음' : formatDurationMinutes(duration));
    const detail = parts.join(' · ');
    if (timeChanged && durationChanged) {
      return `${current ? '시간·소요 시간 변경' : '오늘로 적용'} (${detail})`;
    }
    if (timeChanged) {
      return `${current ? '시간만 변경' : '오늘로 적용'} (${detail})`;
    }
    return `소요 시간 변경 (${detail})`;
  })();

  useKeyHandler(
    (event) => {
      if (matchesCombo(event, 'escape')) {
        if (timeText !== null) {
          setTimeText(null);
          return true;
        }
        if (typing) {
          setTyping(false);
          return true;
        }
        if (pane !== 'main') {
          back();
          return true;
        }
        onClose();
        return true;
      }

      if (matchesCombo(event, 'mod+enter')) {
        if (typing && parsedText?.patch) {
          applyTyped();
          return true;
        }
        if (timeText !== null && typedMinutes !== null) {
          applyTypedTime();
          return true;
        }
      }

      if (event.editing) return false;

      if (pane === 'main') {
        if (matchesCombo(event, '1') || matchesCombo(event, 't')) {
          choose(now);
          return true;
        }
        if (matchesCombo(event, '2') || matchesCombo(event, 'w')) {
          choose(tomorrow);
          return true;
        }
        if (matchesCombo(event, '3')) {
          choose(weekend);
          return true;
        }
        if (matchesCombo(event, '4')) {
          choose(monday);
          return true;
        }
        if (matchesCombo(event, '0') || matchesCombo(event, 'delete') || matchesCombo(event, 'backspace')) {
          if (current) {
            choose(null);
            return true;
          }
        }
        if (matchesCombo(event, 'i')) {
          setTyping((open) => !open);
          return true;
        }
        if (matchesCombo(event, 'r')) {
          setPane('repeat');
          return true;
        }
        if (Platform.OS === 'android' && matchesCombo(event, 'b')) {
          setPane('reminder');
          return true;
        }
        if (matchesCombo(event, '+') || matchesCombo(event, '=')) {
          nudgeMinutes(15);
          return true;
        }
        if (matchesCombo(event, '-')) {
          nudgeMinutes(-15);
          return true;
        }
        if (matchesCombo(event, 'enter') && (timeChanged || durationChanged)) {
          applyStaged();
          return true;
        }
      }

      return true;
    },
    { priority: KEY_PRIORITY.sheet },
  );

  return (
    <Sheet visible onClose={pane === 'main' ? onClose : back} title={paneTitles[pane]}>
      {/* The main pane stays mounted while another is shown, so coming back keeps the calendar's month and the chosen time. */}
      <ScrollView
        style={[{ maxHeight: height * 0.72 }, pane !== 'main' && styles.hidden]}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
          <Chip icon="sun" label={`오늘 · ${weekdayName(now)}`} onPress={() => choose(now)} />
          <Chip icon="moon" label="오늘 저녁 (19:00)" onPress={() => choose(now, 19 * 60)} />
          {showPlusOneHour ? <Chip icon="fast-forward" label="+1시간" onPress={applyPlusOneHour} /> : null}
          <Chip icon="sunrise" label={`내일 · ${weekdayName(tomorrow)}`} onPress={() => choose(tomorrow)} />
          <Chip icon="calendar" label={`모레 · ${weekdayName(dayAfterTomorrow)}`} onPress={() => choose(dayAfterTomorrow)} />
          <Chip icon="coffee" label={weekendLabel} onPress={() => choose(weekend)} />
          <Chip icon="arrow-right" label={`다음 주 · ${weekdayName(monday)}`} onPress={() => choose(monday)} />
          <Chip icon="plus-circle" label={`+1주 · ${weekdayName(plusOneWeek)}`} onPress={() => choose(plusOneWeek)} />
          <Chip icon="edit-3" label="직접 입력" selected={typing} onPress={() => setTyping((open) => !open)} />
          {current ? <Chip icon="slash" label="날짜 없음" onPress={() => choose(null)} /> : null}
        </View>

        {typing ? (
          <View style={{ gap: space.sm, marginBottom: space.md }}>
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <TextInput
                value={when} onChangeText={setWhen} autoFocus placeholder="예: 오후 4시, 30분 후, 매주 월수금"
                placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false}
                returnKeyType="done" onSubmitEditing={applyTyped} accessibilityLabel="일정 직접 입력"
                style={[type.body, styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, flex: 1 }]} />
              <Button label="적용" onPress={applyTyped} disabled={!parsedText?.patch} style={{ minHeight: 46 }} />
            </View>
            {parsedText?.label ? <Txt variant="small" tone="muted">{parsedText.label}</Txt> : null}
            {parsedText?.error ? <Txt variant="small" tone="danger">{parsedText.error}</Txt> : null}
          </View>
        ) : (
          <>
            <View style={{ gap: 6, marginBottom: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Txt variant="caption" tone="muted">시간</Txt>
                {minutes !== null ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <IconButton
                      name="minus" label="15분 앞당기기" size={14}
                      onPress={() => nudgeMinutes(-15)}
                      style={{ backgroundColor: colors.surfaceMuted, width: 26, height: 26 }} />
                    <Pressable
                      accessibilityRole="button" accessibilityLabel={formatTime(minutes, timeFormat) + ', 눌러서 시간 직접 입력'} hitSlop={6}
                      onPress={() => setTimeText((open) => (open === null ? timeInputText(minutes) : null))}
                      style={({ pressed }) => [
                        styles.timeValue, { borderColor: timeText !== null ? colors.accent : colors.border }, pressed && { opacity: 0.6 },
                      ]}>
                      <Txt variant="smallStrong" tone="accent" tabular>{formatTime(minutes, timeFormat)}</Txt>
                    </Pressable>
                    <IconButton
                      name="plus" label="15분 미루기" size={14}
                      onPress={() => nudgeMinutes(15)}
                      style={{ backgroundColor: colors.surfaceMuted, width: 26, height: 26 }} />
                  </View>
                ) : null}
              </View>
              {timeText !== null ? (
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                  <TextInput
                    value={timeText} onChangeText={setTimeText} autoFocus selectTextOnFocus keyboardType="default" maxLength={12}
                    autoCapitalize="none" autoCorrect={false}
                    placeholder="17:30, 오후 5시" placeholderTextColor={colors.textFaint} returnKeyType="done" onSubmitEditing={applyTypedTime}
                    accessibilityLabel="시간 입력 (예: 17:30, 오후 5시, 5pm)"
                    style={[type.bodyStrong, styles.input, styles.timeInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]} />
                  <Txt
                    variant="small" tone={typedMinutes !== null ? 'accent' : timeText.trim() ? 'danger' : 'muted'}
                    style={{ flex: 1 }} accessibilityLiveRegion="polite">
                    {typedMinutes !== null ? formatTime(typedMinutes, timeFormat) : timeText.trim() ? '예: 17:30, 오후 5시, 5pm' : '17:30 / 오후 5시 / 5pm'}
                  </Txt>
                  <Button label="확인" onPress={applyTypedTime} disabled={typedMinutes === null} style={{ minHeight: 42 }} />
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
                  {hasCustomTime ? (
                    <Chip icon="clock" label={formatTime(minutes, timeFormat)} selected onPress={() => setMinutes(minutes)} />
                  ) : null}
                  {timePresets.map((item) => (
                    <Chip
                      key={item.label} icon={item.minutes === null ? undefined : 'clock'} label={item.label}
                      selected={minutes === item.minutes} onPress={() => setMinutes(item.minutes)} />
                  ))}
                  <Chip icon="edit-2" label="시간 입력" onPress={() => setTimeText(timeInputText(minutes ?? 9 * 60))} />
                </ScrollView>
              )}
            </View>

            <View style={{ gap: 6, marginBottom: space.md }}>
              <Txt variant="caption" tone="muted">소요 시간</Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
                {hasCustomDuration ? (
                  <Chip icon="clock" label={formatDurationMinutes(duration)} selected onPress={() => setDuration(duration)} />
                ) : null}
                {durationPresets.map((item) => (
                  <Chip
                    key={item.label} icon={item.minutes === null ? 'slash' : 'clock'} label={item.label}
                    selected={duration === item.minutes} onPress={() => setDuration(item.minutes)} />
                ))}
              </ScrollView>
              {timeChanged || durationChanged ? (
                <Button label={stagedButtonLabel} onPress={applyStaged} style={{ minHeight: 42, marginTop: 4 }} />
              ) : null}
            </View>

            {/* Hidden (not unmounted) while the time field has the keyboard up, so the sheet stays short enough to show the field. */}
            <View style={timeText !== null && styles.hidden}>
              <Calendar initial={current ?? now} selected={current} today={now} onSelect={(date) => choose(date)} />
            </View>

            <View style={[styles.rows, { borderTopColor: colors.border }]}>
              {Platform.OS === 'android' ? (
                <Row
                  icon={reminder.off ? 'bell-off' : 'bell'} label="알림" detail={reminder.label} trailing={chevron}
                  onPress={() => setPane('reminder')} />
              ) : null}
              <Row icon="repeat" label="반복" detail={repeatLabel ?? '반복 없음'} trailing={chevron} onPress={() => setPane('repeat')} />
            </View>
          </>
        )}
      </ScrollView>

      {pane === 'reminder' ? (
        <View style={{ gap: space.md }}>
          <BackRow onPress={back} />
          <TaskReminderPicker
            taskId={task.id} allDay={minutes === null} dueAt={previewDue} timezone={task.timezone}
            repeats={!!task.recurrence_rule} onPicked={back} />
        </View>
      ) : null}
      {pane === 'repeat' ? (
        <View style={{ gap: space.md }}>
          <BackRow onPress={back} />
          <RepeatPicker
            currentRule={task.recurrence_rule} currentMode={task.recurrence_mode}
            dueAt={previewDue ?? task.due_at} timezone={task.timezone} allDay={minutes === null}
            localTime={minutes === null ? null : localTimeString(minutes)}
            onSelect={applyRepeat} />
        </View>
      ) : null}
    </Sheet>
  );
}

/** Returns from the 알림 or 반복 choices to the date and time. */
function BackRow({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel="일정으로 돌아가기" hitSlop={8} onPress={onPress}
      style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}>
      <Icon name="chevron-left" size={18} color={colors.accentText} />
      <Txt variant="smallStrong" tone="accent">일정</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
  timeInput: { minWidth: 112, textAlign: 'center' },
  timeValue: { minWidth: 74, alignItems: 'center', borderWidth: 1, borderRadius: radius.sm, paddingVertical: 2 },
  rows: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.sm },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginTop: -space.sm },
  hidden: { display: 'none' },
});
