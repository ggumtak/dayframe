import { View } from 'react-native';

import { MonthCalendar } from '@/components/MonthCalendar';
import { Chip, Sheet } from '@/components/ui';
import { dueDate, type PlainDate, today } from '@/lib/dates';
import type { Task } from '@/lib/shared';
import { space } from '@/theme';

/** Quick reschedule: common days as chips, any other day from the calendar. */
export function ScheduleSheet({ task, onClose, onPick }: {
  task: Task | null; onClose: () => void; onPick: (task: Task, date: PlainDate | null) => void;
}) {
  if (!task) return null;
  const now = today(task.timezone);
  const current = dueDate(task);
  const choose = (date: PlainDate | null) => {
    onPick(task, date);
    onClose();
  };
  const saturday = now.add({ days: (6 - now.dayOfWeek + 7) % 7 || 7 });
  const monday = now.add({ days: 8 - now.dayOfWeek });
  return (
    <Sheet visible onClose={onClose} title="일정 변경">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>
        <Chip icon="sun" label="오늘" onPress={() => choose(now)} />
        <Chip icon="sunrise" label="내일" onPress={() => choose(now.add({ days: 1 }))} />
        <Chip icon="coffee" label="이번 주말" onPress={() => choose(saturday)} />
        <Chip icon="arrow-right" label="다음 주" onPress={() => choose(monday)} />
        {current ? <Chip icon="slash" label="날짜 없음" onPress={() => choose(null)} /> : null}
      </View>
      <MonthCalendar initial={current ?? now} selected={current} today={now} onSelect={choose} />
    </Sheet>
  );
}
