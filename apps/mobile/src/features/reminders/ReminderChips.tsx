import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button, Chip, Icon, IconButton, Txt } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { radius, space, useTheme } from '@/theme';

import {
  alertPreview, allDayLeadDays, allDayLeadLabel, allDayLeads, joinLead, type LeadParts, leadLabel, reminderSummary, splitLead, timedLeads,
} from './lead';
import { requestReminderPermission } from './notify';
import { setHabitReminder, setTaskReminder, type TaskReminder, useReminderOverrides } from './overrides';
import { alertTime } from './plan';
import { useReminderSettings } from './settings';

/**
 * This task's alert: the default from settings, a lead time, a custom days/hours/minutes lead, or none.
 * `dueAt` is the occurrence the preview line is worked out from; `onPicked` runs after a choice is saved.
 */
export function TaskReminderPicker({ taskId, allDay, dueAt, timezone, repeats = false, onPicked }: {
  taskId: string; allDay: boolean; dueAt: string | null; timezone: string; repeats?: boolean; onPicked?: () => void;
}) {
  const { colors } = useTheme();
  const settings = useReminderSettings();
  const overrides = useReminderOverrides();
  const own = overrides.tasks[taskId];
  // The custom editor's values while it is open; nothing is saved until 적용.
  const [draft, setDraft] = useState<LeadParts | null>(null);
  // "Already past" is judged against when the choices opened, which is close enough for a sheet held open briefly.
  const [openedAt] = useState(() => Date.now());
  if (Platform.OS !== 'android') return null;

  const pick = (value: TaskReminder | null) => {
    haptic.tap();
    setTaskReminder(taskId, value);
    setDraft(null);
    onPicked?.();
  };
  const isPreset = (value: number) => typeof own === 'number' && (allDay ? allDayLeadDays(own) === allDayLeadDays(value) : own === value);
  const customValue = !allDay && typeof own === 'number' && !timedLeads.includes(own) ? own : null;
  const fallback = reminderSummary(undefined, settings, allDay).label;
  const allDayBlocked = allDay && settings.allDayHour === null;

  // The preview follows what is on screen: the draft while editing, else the saved choice.
  const shown = draft ? joinLead(draft) : own;
  const at = !settings.enabled || shown === 'off' || !dueAt ? null
    : alertTime({ all_day: allDay, timezone }, dueAt, settings, shown);
  const preview = alertPreview(at, timezone, openedAt, repeats);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip label={'기본 (' + fallback + ')'} selected={own === undefined && !draft} onPress={() => pick(null)} />
        {allDayBlocked ? null : (allDay ? allDayLeads : timedLeads).map((value) => (
          <Chip
            key={value} label={allDay ? allDayLeadLabel(value, settings.allDayHour!) : leadLabel(value)}
            selected={!draft && isPreset(value)} onPress={() => pick(value)} />
        ))}
        {allDay ? null : (
          <Chip
            icon="sliders" label={customValue !== null && !draft ? leadLabel(customValue) : '직접 지정'} selected={customValue !== null || !!draft}
            onPress={() => {
              haptic.tap();
              setDraft((open) => (open ? null : splitLead(customValue ?? (typeof own === 'number' ? own : settings.leadMinutes))));
            }} />
        )}
        <Chip icon="bell-off" label="끄기" selected={own === 'off' && !draft} onPress={() => pick('off')} />
      </View>

      {draft ? (
        <View style={[styles.editor, { backgroundColor: colors.surfaceMuted }]}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <LeadStepper unit="일" value={draft.days} max={30} step={1} onChange={(days) => setDraft({ ...draft, days })} />
            <LeadStepper unit="시간" value={draft.hours} max={23} step={1} onChange={(hours) => setDraft({ ...draft, hours })} />
            <LeadStepper unit="분" value={draft.minutes} max={55} step={5} onChange={(minutes) => setDraft({ ...draft, minutes })} />
          </View>
          <Button label={joinLead(draft) === 0 ? '정시로 적용' : leadLabel(joinLead(draft)) + '으로 적용'} onPress={() => pick(joinLead(draft))} style={{ minHeight: 42 }} />
        </View>
      ) : null}

      {preview ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="bell" size={13} color={colors.textMuted} />
          <Txt variant="small" tone="muted" style={{ flex: 1 }}>{preview}</Txt>
        </View>
      ) : null}
      {!settings.enabled ? <Txt variant="small" tone="muted">설정 → 알림과 위젯에서 할 일 알림이 꺼져 있습니다.</Txt> : null}
      {settings.enabled && allDayBlocked ? (
        <Txt variant="small" tone="muted">설정 → 알림과 위젯에서 종일 할 일의 알림 시각을 정하면 당일·하루 전 알림을 고를 수 있습니다.</Txt>
      ) : null}
    </View>
  );
}

/** One column of the custom lead: a unit with − and + around its value. */
function LeadStepper({ unit, value, max, step, onChange }: {
  unit: string; value: number; max: number; step: number; onChange: (value: number) => void;
}) {
  const { colors } = useTheme();
  const change = (delta: number) => {
    haptic.tap();
    // Steps land on multiples of `step`, so a stored 7 goes to 10 or 5.
    const next = delta > 0 ? Math.floor(value / step) * step + step : Math.ceil(value / step) * step - step;
    onChange(Math.max(0, Math.min(max, next)));
  };
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <Txt variant="caption" tone="muted">{unit}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconButton
          name="minus" label={unit + ' 줄이기'} size={14} onPress={() => change(-1)}
          style={{ backgroundColor: colors.surface, width: 28, height: 28 }} />
        <Txt variant="bodyStrong" style={{ minWidth: 26, textAlign: 'center' }} accessibilityLabel={value + unit}>{value}</Txt>
        <IconButton
          name="plus" label={unit + ' 늘리기'} size={14} onPress={() => change(1)}
          style={{ backgroundColor: colors.surface, width: 28, height: 28 }} />
      </View>
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

const styles = StyleSheet.create({
  editor: { borderRadius: radius.md, padding: space.md, gap: space.md },
});
