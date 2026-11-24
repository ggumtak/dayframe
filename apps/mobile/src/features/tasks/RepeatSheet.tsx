import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, Icon, IconButton, Row, Segmented, Sheet, Txt } from '@/components/ui';
import { describeRecurrence, dueMinutes, instantFor, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { recurrence, type RecurrenceMode, type Task, type TaskPatch } from '@/lib/shared';
import { radius, space, useTheme } from '@/theme';

import { localTimeString } from './useTaskFlow';

type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
type DayCode = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

const WEEKDAYS: { code: DayCode; label: string }[] = [
  { code: 'MO', label: '월' },
  { code: 'TU', label: '화' },
  { code: 'WE', label: '수' },
  { code: 'TH', label: '목' },
  { code: 'FR', label: '금' },
  { code: 'SA', label: '토' },
  { code: 'SU', label: '일' },
];

const repeatOptions: { rule: string | null; label: string; detail?: string }[] = [
  { rule: null, label: '반복 없음' },
  { rule: 'FREQ=DAILY', label: '매일' },
  { rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: '평일', detail: '월~금' },
  { rule: 'FREQ=WEEKLY;BYDAY=SA,SU', label: '주말', detail: '토~일' },
  { rule: 'FREQ=WEEKLY', label: '매주' },
  { rule: 'FREQ=WEEKLY;INTERVAL=2', label: '격주' },
  { rule: 'FREQ=MONTHLY', label: '매월' },
  { rule: 'FREQ=MONTHLY;BYMONTHDAY=-1', label: '매월 말일' },
  { rule: 'FREQ=YEARLY', label: '매년' },
];

export function buildRRule(frequency: Freq, interval: number, weekdays: DayCode[], lastDay: boolean): string {
  const safeInterval = Math.max(1, Math.min(52, Math.round(interval)));
  const ordered = WEEKDAYS.map((d) => d.code).filter((code) => weekdays.includes(code));
  return 'FREQ=' + frequency
    + (safeInterval > 1 ? ';INTERVAL=' + safeInterval : '')
    + (frequency === 'WEEKLY' && ordered.length > 0 ? ';BYDAY=' + ordered.join(',') : '')
    + (frequency === 'MONTHLY' && lastDay ? ';BYMONTHDAY=-1' : '');
}

/**
 * The schedule fields for giving a task a repeat (or taking it away), keeping its time of day. A task without a date
 * starts repeating from today, all day. Null when nothing would change.
 */
export function repeatPatch(task: Task, rule: string | null, mode: RecurrenceMode): TaskPatch | null {
  if (rule === task.recurrence_rule && mode === task.recurrence_mode) return null;
  if (!rule) return { recurrence_rule: null, recurrence_mode: 'schedule', recurrence_local_time: null };
  const minutes = dueMinutes(task);
  return task.due_at
    ? { recurrence_rule: rule, recurrence_mode: mode, recurrence_local_time: task.all_day || minutes === null ? null : localTimeString(minutes) }
    : {
      due_at: instantFor(today(task.timezone), null, task.timezone), all_day: true,
      recurrence_rule: rule, recurrence_mode: mode, recurrence_local_time: null,
    };
}

/** Repeat picker with schedule vs. completion-based recurrence modes, common presets, and a custom RRULE builder. */
export function RepeatSheet({
  visible, currentRule, currentMode = 'schedule', onClose, onSelect,
}: {
  visible: boolean;
  currentRule: string | null;
  currentMode?: RecurrenceMode;
  onClose: () => void;
  onSelect: (rule: string | null, mode: RecurrenceMode) => void;
}) {
  if (!visible) return null;
  return (
    <Sheet visible onClose={onClose} title="반복 설정">
      <RepeatPicker currentRule={currentRule} currentMode={currentMode} onSelect={onSelect} />
    </Sheet>
  );
}

/** The repeat choices without a sheet around them, for screens that show them inside their own sheet. */
export function RepeatPicker({ currentRule, currentMode = 'schedule', onSelect }: {
  currentRule: string | null;
  currentMode?: RecurrenceMode;
  onSelect: (rule: string | null, mode: RecurrenceMode) => void;
}) {
  // Keyed by the saved rule so the editor starts over from it whenever it changes.
  return (
    <RepeatPickerContent
      key={(currentRule ?? 'none') + '|' + currentMode} currentRule={currentRule} currentMode={currentMode} onSelect={onSelect} />
  );
}

function RepeatPickerContent({
  currentRule, currentMode, onSelect,
}: {
  currentRule: string | null;
  currentMode: RecurrenceMode;
  onSelect: (rule: string | null, mode: RecurrenceMode) => void;
}) {
  const { colors } = useTheme();
  const initialParsed = (() => {
    if (!currentRule) return { frequency: 'WEEKLY' as Freq, interval: 1, weekdays: [] as DayCode[], lastDay: false };
    try {
      const p = recurrence(currentRule);
      return { frequency: p.frequency, interval: p.interval, weekdays: p.weekdays as DayCode[], lastDay: p.lastDay };
    } catch {
      return { frequency: 'WEEKLY' as Freq, interval: 1, weekdays: [] as DayCode[], lastDay: false };
    }
  })();

  const isPreset = repeatOptions.some((item) => item.rule === currentRule);
  const [mode, setMode] = useState<RecurrenceMode>(currentMode);
  const [tab, setTab] = useState<'presets' | 'custom'>(currentRule && !isPreset ? 'custom' : 'presets');
  const [frequency, setFrequency] = useState<Freq>(initialParsed.frequency);
  const [interval, setInterval] = useState<number>(initialParsed.interval);
  const [weekdays, setWeekdays] = useState<DayCode[]>(initialParsed.weekdays);
  const [lastDay, setLastDay] = useState<boolean>(initialParsed.lastDay);

  const customRule = buildRRule(frequency, interval, weekdays, lastDay);
  const unitLabel = frequency === 'DAILY' ? '일' : frequency === 'WEEKLY' ? '주' : frequency === 'MONTHLY' ? '개월' : '년';

  const toggleDay = (code: DayCode) => {
    haptic.tap();
    setWeekdays((prev) => (prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code]));
  };

  return (
    <View>
      <View style={{ gap: 6, marginBottom: space.md }}>
        <Segmented<RecurrenceMode>
          value={mode} onChange={setMode}
          options={[
            { value: 'schedule', label: '일정 기준', icon: 'calendar' },
            { value: 'completion', label: '완료일 기준', icon: 'check-circle' },
          ]} />
        <Txt variant="caption" tone="muted">
          {mode === 'completion'
            ? '실제로 완료한 날을 기준으로 다음 날짜를 정합니다. (예: 필터 교체, 청소, 미용실)'
            : '원래 정해진 날짜·요일에 맞춰 반복합니다. (예: 주간 회의, 월세 납부)'}
        </Txt>
      </View>

      <View style={{ marginBottom: space.md }}>
        <Segmented<'presets' | 'custom'>
          value={tab} onChange={setTab}
          options={[{ value: 'presets', label: '빠른 선택', icon: 'repeat' }, { value: 'custom', label: '직접 설정', icon: 'sliders' }]} />
      </View>

      {tab === 'presets' ? (
        <ScrollView style={{ maxHeight: 330 }}>
          {repeatOptions.map((item) => {
            const active = currentRule === item.rule && (item.rule === null || currentMode === mode);
            const label = item.rule && mode === 'completion' ? '완료 후 ' + item.label : item.label;
            return (
              <Row
                key={item.label} icon={item.rule ? 'repeat' : 'slash'} label={label} detail={item.detail}
                trailing={active ? <Icon name="check" size={18} color={colors.accent} /> : undefined}
                onPress={() => onSelect(item.rule, item.rule ? mode : 'schedule')} />
            );
          })}
        </ScrollView>
      ) : (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {([
              { value: 'DAILY', label: '일' },
              { value: 'WEEKLY', label: '주' },
              { value: 'MONTHLY', label: '개월' },
              { value: 'YEARLY', label: '년' },
            ] as { value: Freq; label: string }[]).map((opt) => (
              <Chip
                key={opt.value} label={opt.label} selected={frequency === opt.value}
                onPress={() => setFrequency(opt.value)} style={{ flex: 1, justifyContent: 'center' }} />
            ))}
          </View>

          <View style={styles.intervalRow}>
            <Txt variant="bodyStrong" style={{ flex: 1 }}>반복 간격</Txt>
            <IconButton
              name="minus" label="간격 줄이기" size={18}
              onPress={() => setInterval((n) => Math.max(1, n - 1))}
              style={{ backgroundColor: colors.surfaceMuted, width: 36, height: 36 }} />
            <Txt variant="bodyStrong" style={{ minWidth: 64, textAlign: 'center' }}>{interval}{unitLabel}마다</Txt>
            <IconButton
              name="plus" label="간격 늘리기" size={18}
              onPress={() => setInterval((n) => Math.min(52, n + 1))}
              style={{ backgroundColor: colors.surfaceMuted, width: 36, height: 36 }} />
          </View>

          {frequency === 'WEEKLY' ? (
            <View style={{ gap: space.sm }}>
              <Txt variant="caption" tone="muted">반복 요일 (선택하지 않으면 현재 요일)</Txt>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {WEEKDAYS.map((day) => {
                  const active = weekdays.includes(day.code);
                  return (
                    <Pressable
                      key={day.code} accessibilityRole="checkbox" accessibilityState={{ checked: active }}
                      onPress={() => toggleDay(day.code)}
                      style={[
                        styles.dayBtn,
                        {
                          backgroundColor: active ? colors.accent : colors.surfaceMuted,
                          borderColor: active ? colors.accent : colors.border,
                        },
                      ]}>
                      <Txt variant="smallStrong" style={{ color: active ? colors.onAccent : colors.text }}>{day.label}</Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {frequency === 'MONTHLY' ? (
            <Row
              icon="calendar" label="매월 말일에 반복" detail={lastDay ? '켜짐' : '꺼짐'}
              trailing={<Icon name={lastDay ? 'check-circle' : 'circle'} size={20} color={lastDay ? colors.accent : colors.textFaint} />}
              onPress={() => {
                haptic.tap();
                setLastDay((prev) => !prev);
              }} />
          ) : null}

          <View style={[styles.preview, { backgroundColor: colors.surfaceMuted }]}>
            <Icon name="repeat" size={15} color={colors.accent} />
            <Txt variant="smallStrong" tone="accent">{describeRecurrence(customRule, mode) ?? customRule}</Txt>
          </View>

          <Button label="반복 적용" onPress={() => onSelect(customRule, mode)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  intervalRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dayBtn: {
    flex: 1, height: 38, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  preview: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: radius.md, paddingVertical: 10,
  },
});
