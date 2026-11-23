import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { MonthCalendar } from '@/components/MonthCalendar';
import { Button, Chip, IconButton, Sheet, Txt } from '@/components/ui';
import { useTaskActions } from '@/data/tasks';
import { parseErrorMessage } from '@/features/quick-add/messages';
import {
  describeRecurrence, dueDate, dueMinutes, formatDue, formatDurationMinutes, formatTime, instantFor, type PlainDate, Temporal, today,
} from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { analyzeTask, type Task, type TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

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

/** Quick reschedule: common days as chips, quick time slots + fine stepper, calendar, and natural-language entry. */
export function ScheduleSheet({ task, onClose, onPick }: {
  task: Task | null; onClose: () => void; onPick: (task: Task, date: PlainDate | null, minutes?: number | null) => void;
}) {
  if (!task) return null;
  // Keyed by task + current schedule so the time selection resets whenever a different task opens.
  return <ScheduleContent key={task.id + '|' + (task.due_at ?? '') + '|' + task.all_day} task={task} onClose={onClose} onPick={onPick} />;
}

function ScheduleContent({ task, onClose, onPick }: {
  task: Task; onClose: () => void; onPick: (task: Task, date: PlainDate | null, minutes?: number | null) => void;
}) {
  const { colors } = useTheme();
  const actions = useTaskActions();
  const now = today(task.timezone);
  const current = dueDate(task);
  const initialMinutes = dueMinutes(task);
  const [minutes, setMinutes] = useState<number | null>(initialMinutes);
  const [typing, setTyping] = useState(false);
  const [when, setWhen] = useState('');
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

  const choose = (date: PlainDate | null) => {
    onPick(task, date, date ? minutes : undefined);
    onClose();
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
    showToast(`일정을 ‘${parsedText.label}’(으)로 변경했습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => actions.update(task.id, prevPatch),
    });
    onClose();
  };

  const nudgeMinutes = (delta: number) => {
    haptic.tap();
    const base = minutes ?? 9 * 60;
    setMinutes((base + delta + 1440) % 1440);
  };

  const saturday = now.add({ days: (6 - now.dayOfWeek + 7) % 7 || 7 });
  const monday = now.add({ days: 8 - now.dayOfWeek });
  const hasCustomTime = minutes !== null && !timePresets.some((item) => item.minutes === minutes);

  return (
    <Sheet visible onClose={onClose} title="일정 변경">
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
                  <Txt variant="smallStrong" tone="accent" style={{ minWidth: 74, textAlign: 'center' }}>
                    {formatTime(minutes)}
                  </Txt>
                  <IconButton
                    name="plus" label="15분 뒤로" size={14}
                    onPress={() => nudgeMinutes(15)}
                    style={{ backgroundColor: colors.surfaceMuted, width: 26, height: 26 }} />
                </View>
              ) : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {hasCustomTime ? (
                <Chip icon="clock" label={formatTime(minutes)} selected onPress={() => setMinutes(minutes)} />
              ) : null}
              {timePresets.map((item) => (
                <Chip
                  key={item.label} icon={item.minutes === null ? undefined : 'clock'} label={item.label}
                  selected={minutes === item.minutes} onPress={() => setMinutes(item.minutes)} />
              ))}
            </ScrollView>
            {timeChanged ? (
              <Button
                label={(current ? '시간만 변경' : '오늘로 적용') + ' (' + (minutes === null ? '종일' : formatTime(minutes)) + ')'}
                onPress={() => choose(current ?? now)} style={{ minHeight: 42, marginTop: 4 }} />
            ) : null}
          </View>

          <MonthCalendar initial={current ?? now} selected={current} today={now} onSelect={choose} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
});
