import { Platform, View } from 'react-native';

import { Chip, Txt } from '@/components/ui';
import { space } from '@/theme';

import { requestReminderPermission } from './notify';
import { setHabitReminder, setTaskReminder, type TaskReminder, useReminderOverrides } from './overrides';
import { useReminderSettings } from './settings';

const leads: { value: TaskReminder; label: string }[] = [
  { value: 0, label: '정시' }, { value: 10, label: '10분 전' }, { value: 30, label: '30분 전' }, { value: 60, label: '1시간 전' },
];

const leadLabel = (minutes: number) => (minutes === 0 ? '정시' : minutes === 60 ? '1시간 전' : minutes + '분 전');

/** This task's alert: the default from settings, another time, or none. */
export function TaskReminderChips({ taskId, allDay }: { taskId: string; allDay: boolean }) {
  const settings = useReminderSettings();
  const overrides = useReminderOverrides();
  if (Platform.OS !== 'android') return null;
  const own = overrides.tasks[taskId];
  const fallback = !settings.enabled ? '알림 꺼짐' : allDay
    ? (settings.allDayHour === null ? '알리지 않음' : '오전 ' + settings.allDayHour + '시')
    : leadLabel(settings.leadMinutes);
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip label={'기본 (' + fallback + ')'} selected={own === undefined} onPress={() => setTaskReminder(taskId, null)} />
        {allDay ? null : leads.map((item) => (
          <Chip key={String(item.value)} label={item.label} selected={own === item.value} onPress={() => setTaskReminder(taskId, item.value)} />
        ))}
        <Chip icon="bell-off" label="끄기" selected={own === 'off'} onPress={() => setTaskReminder(taskId, 'off')} />
      </View>
      {!settings.enabled ? <Txt variant="small" tone="muted">설정 → 알림과 위젯에서 할 일 알림이 꺼져 있습니다.</Txt> : null}
    </View>
  );
}

const times = ['07:00', '09:00', '12:00', '18:00', '21:00', '22:00'];
const timeLabel = (time: string) => {
  const hour = Number(time.slice(0, 2));
  return (hour < 12 ? '오전 ' : '오후 ') + (hour % 12 || 12) + '시' + (time.endsWith(':00') ? '' : ' ' + Number(time.slice(3)) + '분');
};

/** A daily nudge for a habit at a chosen time; it skips a day once the habit is done. */
export function HabitReminderChips({ habitId }: { habitId: string }) {
  const overrides = useReminderOverrides();
  if (Platform.OS !== 'android') return null;
  const own = overrides.habits[habitId];
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip icon="bell-off" label="끄기" selected={!own} onPress={() => setHabitReminder(habitId, null)} />
        {times.map((time) => (
          <Chip
            key={time} label={timeLabel(time)} selected={own === time}
            onPress={() => {
              setHabitReminder(habitId, time);
              // Habit alerts work even with task alerts off, so they ask for permission themselves.
              void requestReminderPermission(true);
            }} />
        ))}
      </View>
      <Txt variant="small" tone="muted">
        {own ? '매일 ' + timeLabel(own) + '에 알려 줍니다. 그날 목표를 채우면 울리지 않고, 알림의 [기록하기]로 바로 기록할 수 있습니다.' : '정해 두면 매일 그 시간에 알려 줍니다.'}
      </Txt>
    </View>
  );
}
