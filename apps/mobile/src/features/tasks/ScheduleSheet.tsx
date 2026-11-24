import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { MonthCalendar } from '@/components/MonthCalendar';
import { Button, Chip, Icon, IconButton, Row, Sheet, Txt } from '@/components/ui';
import { useTaskActions, useTaskIndex } from '@/data/tasks';
import { parseErrorMessage } from '@/features/quick-add/messages';
import { reminderSummary } from '@/features/reminders/lead';
import { useReminderOverrides } from '@/features/reminders/overrides';
import { TaskReminderPicker } from '@/features/reminders/ReminderChips';
import { useReminderSettings } from '@/features/reminders/settings';
import {
  describeRecurrence, dueDate, dueMinutes, formatDue, formatDurationMinutes, formatTime, instantFor, type PlainDate, Temporal, today,
} from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { analyzeTask, type RecurrenceMode, type Task, type TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

import { RepeatPicker, repeatPatch } from './RepeatSheet';
import { parseTimeInput, timeInputText } from './timeInput';
import { localTimeString } from './useTaskFlow';

const PLACEHOLDER = '⁣';

const timePresets: { minutes: number | null; label: string }[] = [
  { minutes: null, label: '종일' },
  { minutes: 9 * 60, label: '오전 9시' },
  { minutes: 12 * 60, label: '오후 12시' },
  { minutes: 15 * 60, label: '오후 3시' },
  { minutes: 18 * 60, label: '오후 6시' },
  { minutes: 21 * 60, label: '오후 9시' },
];

/** The month grid re-renders only when the date it shows changes, not on every time or pane change. */
const Calendar = memo(MonthCalendar);

type Pane = 'main' | 'reminder' | 'repeat';
const paneTitles: Record<Pane, string> = { main: '일정 변경', reminder: '알림', repeat: '반복' };

/**
 * Date, time, alert and repeat in one sheet. Day chips and the calendar pick a date in one tap (with the chosen time);
 * the 알림 and 반복 rows swap the sheet's content to their choices and back, so a second sheet never opens on top.
 */
export function ScheduleSheet({ task, onClose, onPick }: {
  task: Task | null; onClose: () => void; onPick: (task: Task, date: PlainDate | null, minutes?: number | null) => void;
}) {
  if (!task) return null;
  // Keyed by task only, so an edit made from inside the sheet (a repeat) does not close and reopen it.
  return <ScheduleContent key={task.id} task={task} onClose={onClose} onPick={onPick} />;
}

function ScheduleContent({ task: opened, onClose, onPick }: {
  task: Task; onClose: () => void; onPick: (task: Task, date: PlainDate | null, minutes?: number | null) => void;
}) {
  const { colors } = useTheme();
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
  const [minutes, setMinutes] = useState<number | null>(initialMinutes);
  // When the saved schedule changes underneath (a repeat set on an undated task), the time selection follows it.
  const scheduleKey = (task.due_at ?? '') + '|' + task.all_day;
  const [shownFor, setShownFor] = useState(scheduleKey);
  if (shownFor !== scheduleKey) {
    setShownFor(scheduleKey);
    setMinutes(initialMinutes);
  }
  const [pane, setPane] = useState<Pane>('main');
  const [typing, setTyping] = useState(false);
  const [when, setWhen] = useState('');
  // The exact-time field's text while it is open.
  const [timeText, setTimeText] = useState<string | null>(null);
  const timeChanged = minutes !== initialMinutes;

  const parsedText = useMemo(() => {
    if (!when.trim()) return null;
    try {
      const { task: parsed, tokens } = analyzeTask({ text: when + ' ' + PLACEHOLDER, timezone: task.timezone });
      const leftover = parsed.title.replace(PLACEHOLDER, '').trim();
      if (leftover) return { error: `‘${leftover}’ 부분을 이해하지 못했습니다.` };
      if (!parsed.due_at && !parsed.duration_minutes) return { error: '날짜, 시간 또는 소요시간을 찾지 못했습니다.' };

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
        dueAt ? formatDue({ due_at: dueAt, all_day: allDay, timezone: task.timezone }) : null,
        parsed.duration_minutes ? formatDurationMinutes(parsed.duration_minutes) : null,
        describeRecurrence(nextRule, nextMode),
      ].filter(Boolean).join(' · ');
      return { patch, label };
    } catch (error) {
      return { error: parseErrorMessage(error) ?? '날짜나 시간을 입력해 주세요.' };
    }
  }, [when, task.timezone, task.recurrence_rule, task.recurrence_mode, task.recurrence_local_time, current]);

  // Day taps read the latest selection through a ref, so the calendar's callback never changes and it is not re-rendered.
  const latest = useRef({ task, minutes, onPick, onClose });
  useEffect(() => {
    latest.current = { task, minutes, onPick, onClose };
  });
  const choose = useCallback((date: PlainDate | null) => {
    const { task: target, minutes: time, onPick: pick, onClose: close } = latest.current;
    pick(target, date, date ? time : undefined);
    close();
  }, []);

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
    showToast(`일정을 ‘${parsedText.label}’(으)로 변경했습니다.`, {
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

  const typedMinutes = timeText === null ? null : parseTimeInput(timeText);
  const applyTypedTime = () => {
    if (typedMinutes === null) return;
    haptic.tap();
    setMinutes(typedMinutes);
    setTimeText(null);
  };

  const saturday = now.add({ days: (6 - now.dayOfWeek + 7) % 7 || 7 });
  const monday = now.add({ days: 8 - now.dayOfWeek });
  const hasCustomTime = minutes !== null && !timePresets.some((item) => item.minutes === minutes);
  const reminder = reminderSummary(reminderOverrides.tasks[task.id], reminderSettings, minutes === null);
  const repeatLabel = describeRecurrence(task.recurrence_rule, task.recurrence_mode);
  // The alert preview follows the time chosen here, before it is saved.
  const previewDue = useMemo(() => (current ? instantFor(current, minutes, task.timezone) : null), [current, minutes, task.timezone]);
  const chevron = <Icon name="chevron-right" size={18} color={colors.textFaint} />;

  return (
    <Sheet visible onClose={pane === 'main' ? onClose : back} title={paneTitles[pane]}>
      {/* The main pane stays mounted while another is shown, so coming back keeps the calendar's month and the chosen time. */}
      <ScrollView
        style={[{ maxHeight: height * 0.72 }, pane !== 'main' && styles.hidden]}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
          <Chip icon="sun" label="오늘" onPress={() => choose(now)} />
          <Chip icon="sunrise" label="내일" onPress={() => choose(now.add({ days: 1 }))} />
          <Chip icon="coffee" label="이번 주말" onPress={() => choose(saturday)} />
          <Chip icon="arrow-right" label="다음 주" onPress={() => choose(monday)} />
          <Chip icon="edit-3" label="직접 입력" selected={typing} onPress={() => setTyping((open) => !open)} />
          {current ? <Chip icon="slash" label="날짜 없음" onPress={() => choose(null)} /> : null}
        </View>

        {typing ? (
          <View style={{ gap: space.sm, marginBottom: space.md }}>
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <TextInput
                value={when} onChangeText={setWhen} autoFocus placeholder="예: 오후 4시, 30분 후, 매주 월수금"
                placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false}
                returnKeyType="done" onSubmitEditing={applyTyped} accessibilityLabel="일정을 글로 입력"
                style={[type.body, styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, flex: 1 }]} />
              <Button label="적용" onPress={applyTyped} disabled={!parsedText?.patch} style={{ minHeight: 46 }} />
            </View>
            {parsedText?.label ? <Txt variant="small" tone="success">{parsedText.label}</Txt> : null}
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
                      accessibilityRole="button" accessibilityLabel={formatTime(minutes) + ', 눌러서 시각 직접 입력'} hitSlop={6}
                      onPress={() => setTimeText((open) => (open === null ? timeInputText(minutes) : null))}
                      style={({ pressed }) => [
                        styles.timeValue, { borderColor: timeText !== null ? colors.accent : colors.border }, pressed && { opacity: 0.6 },
                      ]}>
                      <Txt variant="smallStrong" tone="accent">{formatTime(minutes)}</Txt>
                    </Pressable>
                    <IconButton
                      name="plus" label="15분 뒤로" size={14}
                      onPress={() => nudgeMinutes(15)}
                      style={{ backgroundColor: colors.surfaceMuted, width: 26, height: 26 }} />
                  </View>
                ) : null}
              </View>
              {timeText !== null ? (
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                  <TextInput
                    value={timeText} onChangeText={setTimeText} autoFocus selectTextOnFocus keyboardType="number-pad" maxLength={5}
                    placeholder="1730" placeholderTextColor={colors.textFaint} returnKeyType="done" onSubmitEditing={applyTypedTime}
                    accessibilityLabel="시각 입력, 24시간 기준 숫자 4자리"
                    style={[type.bodyStrong, styles.input, styles.timeInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]} />
                  <Txt
                    variant="small" tone={typedMinutes !== null ? 'accent' : timeText.trim() ? 'danger' : 'muted'}
                    style={{ flex: 1 }} accessibilityLiveRegion="polite">
                    {typedMinutes !== null ? formatTime(typedMinutes) : timeText.trim() ? '00:00–23:59 사이로 입력해 주세요' : '24시간 기준, 예: 1730'}
                  </Txt>
                  <Button label="확인" onPress={applyTypedTime} disabled={typedMinutes === null} style={{ minHeight: 42 }} />
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
                  {hasCustomTime ? (
                    <Chip icon="clock" label={formatTime(minutes)} selected onPress={() => setMinutes(minutes)} />
                  ) : null}
                  {timePresets.map((item) => (
                    <Chip
                      key={item.label} icon={item.minutes === null ? undefined : 'clock'} label={item.label}
                      selected={minutes === item.minutes} onPress={() => setMinutes(item.minutes)} />
                  ))}
                  <Chip icon="edit-2" label="시각 입력" onPress={() => setTimeText(timeInputText(minutes ?? 9 * 60))} />
                </ScrollView>
              )}
              {timeChanged ? (
                <Button
                  label={(current ? '시간만 변경' : '오늘로 적용') + ' (' + (minutes === null ? '종일' : formatTime(minutes)) + ')'}
                  onPress={() => choose(current ?? now)} style={{ minHeight: 42, marginTop: 4 }} />
              ) : null}
            </View>

            {/* Hidden (not unmounted) while the time field has the keyboard up, so the sheet stays short enough to show the field. */}
            <View style={timeText !== null && styles.hidden}>
              <Calendar initial={current ?? now} selected={current} today={now} onSelect={choose} />
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
          <RepeatPicker currentRule={task.recurrence_rule} currentMode={task.recurrence_mode} onSelect={applyRepeat} />
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
      <Icon name="chevron-left" size={18} color={colors.accent} />
      <Txt variant="smallStrong" tone="accent">일정</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
  timeInput: { width: 92, textAlign: 'center' },
  timeValue: { minWidth: 74, alignItems: 'center', borderWidth: 1, borderRadius: radius.sm, paddingVertical: 2 },
  rows: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.sm },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginTop: -space.sm },
  hidden: { display: 'none' },
});
