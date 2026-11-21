import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { MonthCalendar } from '@/components/MonthCalendar';
import { Button, Chip, Sheet, Txt } from '@/components/ui';
import { dueDate, dueMinutes, formatTime, type PlainDate, today } from '@/lib/dates';
import type { Task } from '@/lib/shared';
import { space } from '@/theme';

const timePresets: { minutes: number | null; label: string }[] = [
  { minutes: null, label: '종일' },
  { minutes: 9 * 60, label: '오전 9시' },
  { minutes: 12 * 60, label: '오후 12시' },
  { minutes: 15 * 60, label: '오후 3시' },
  { minutes: 18 * 60, label: '오후 6시' },
  { minutes: 21 * 60, label: '오후 9시' },
];

/** Quick reschedule: common days as chips, quick time slots, and any other day from the calendar. */
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
  const now = today(task.timezone);
  const current = dueDate(task);
  const initialMinutes = dueMinutes(task);
  const [minutes, setMinutes] = useState<number | null>(initialMinutes);
  const timeChanged = minutes !== initialMinutes;

  const choose = (date: PlainDate | null) => {
    onPick(task, date, date ? minutes : undefined);
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
        {current ? <Chip icon="slash" label="날짜 없음" onPress={() => choose(null)} /> : null}
      </View>

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
    </Sheet>
  );
}
