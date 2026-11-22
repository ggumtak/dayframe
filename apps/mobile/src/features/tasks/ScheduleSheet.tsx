import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { MonthCalendar } from '@/components/MonthCalendar';
import { Button, Chip, Sheet, Txt } from '@/components/ui';
import { useTaskActions } from '@/data/tasks';
import { parseErrorMessage } from '@/features/quick-add/messages';
import { describeRecurrence, dueDate, dueMinutes, formatDue, formatTime, type PlainDate, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { analyzeTask, type Task, type TaskPatch } from '@/lib/shared';
import { radius, space, type, useTheme } from '@/theme';

const PLACEHOLDER = '⁣';

const timePresets: { minutes: number | null; label: string }[] = [
  { minutes: null, label: '종일' },
  { minutes: 9 * 60, label: '오전 9시' },
  { minutes: 12 * 60, label: '오후 12시' },
  { minutes: 15 * 60, label: '오후 3시' },
  { minutes: 18 * 60, label: '오후 6시' },
  { minutes: 21 * 60, label: '오후 9시' },
];

/** Quick reschedule: common days as chips, quick time slots, calendar, and optional natural-language entry. */
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
      const { task: parsed } = analyzeTask({ text: when + ' ' + PLACEHOLDER, timezone: task.timezone });
      const leftover = parsed.title.replace(PLACEHOLDER, '').trim();
      if (leftover) return { error: `‘${leftover}’ 부분을 이해하지 못했습니다.` };
      if (!parsed.due_at) return { error: '날짜나 시간을 찾지 못했습니다.' };
      const patch: TaskPatch = {
        due_at: parsed.due_at, all_day: parsed.all_day, recurrence_rule: parsed.recurrence_rule,
        recurrence_local_time: parsed.recurrence_local_time ?? null,
      };
      const label = [formatDue({ due_at: parsed.due_at, all_day: parsed.all_day, timezone: task.timezone }),
        describeRecurrence(parsed.recurrence_rule)].filter(Boolean).join(' · ');
      return { patch, label };
    } catch (error) {
      return { error: parseErrorMessage(error) ?? '날짜나 시간을 입력해 주세요.' };
    }
  }, [when, task.timezone]);

  const choose = (date: PlainDate | null) => {
    onPick(task, date, date ? minutes : undefined);
    onClose();
  };

  const applyTyped = () => {
    if (!parsedText?.patch) return;
    actions.update(task.id, parsedText.patch);
    haptic.success();
    onClose();
  };

  const saturday = now.add({ days: (6 - now.dayOfWeek + 7) % 7 || 7 });
  const monday = now.add({ days: 8 - now.dayOfWeek });
  const hasCustomInitial = initialMinutes !== null && !timePresets.some((item) => item.minutes === initialMinutes);

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
              value={when} onChangeText={setWhen} autoFocus placeholder="예: 내일 오후 7시 30분, 매주 월수금"
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
            <Txt variant="caption" tone="muted">시간</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {hasCustomInitial ? (
                <Chip icon="clock" label={formatTime(initialMinutes)} selected={minutes === initialMinutes} onPress={() => setMinutes(initialMinutes)} />
              ) : null}
              {timePresets.map((item) => (
                <Chip
                  key={item.label} icon={item.minutes === null ? undefined : 'clock'} label={item.label}
                  selected={minutes === item.minutes} onPress={() => setMinutes(item.minutes)} />
              ))}
            </ScrollView>
          </View>

          <MonthCalendar initial={current ?? now} selected={current} today={now} onSelect={choose} />

          {timeChanged ? (
            <Button
              label={(current ? '시간만 변경' : '오늘로 적용') + ' (' + (minutes === null ? '종일' : formatTime(minutes)) + ')'}
              onPress={() => choose(current ?? now)} style={{ marginTop: space.md }} />
          ) : null}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
});
