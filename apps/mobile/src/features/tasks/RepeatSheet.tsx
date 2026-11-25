import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, Icon, IconButton, Row, Segmented, Sheet, Txt } from '@/components/ui';
import type { TimeFormat } from '@/features/settings/prefs';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { describeRecurrence, deviceTimeZone, dueMinutes, formatDue, instantFor, Temporal, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { nextOccurrence, recurrence, type RecurrenceMode, type Task, type TaskPatch } from '@/lib/shared';
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

function previewNextOccurrence(
  rule: string | null,
  mode: RecurrenceMode,
  timezone: string,
  dueAt: string | null,
  allDay: boolean,
  localTime: string | null,
  timeFormat: TimeFormat,
): string | null {
  if (!rule) return null;
  try {
    const now = Temporal.Now.instant();
    const anchorAt = dueAt ?? instantFor(today(timezone), null, timezone);
    const floor = mode === 'completion'
      ? now
      : dueAt && Temporal.Instant.compare(Temporal.Instant.from(dueAt), now) > 0
        ? Temporal.Instant.from(dueAt)
        : now;
    const next = nextOccurrence(rule, timezone, anchorAt, floor, allDay, localTime, mode);
    return formatDue({ due_at: next, timezone, all_day: allDay }, timeFormat);
  } catch {
    return null;
  }
}

/** Repeat picker with schedule vs. completion-based recurrence modes, common presets, and a custom RRULE builder. */
export function RepeatSheet({
  visible, currentRule, currentMode = 'schedule', dueAt, timezone, allDay, localTime, onClose, onSelect,
}: {
  visible: boolean;
  currentRule: string | null;
  currentMode?: RecurrenceMode;
  dueAt?: string | null;
  timezone?: string;
  allDay?: boolean;
  localTime?: string | null;
  onClose: () => void;
  onSelect: (rule: string | null, mode: RecurrenceMode) => void;
}) {
  if (!visible) return null;
  return (
    <Sheet visible onClose={onClose} title="반복 설정">
      <RepeatPicker
        currentRule={currentRule} currentMode={currentMode}
        dueAt={dueAt} timezone={timezone} allDay={allDay} localTime={localTime}
        onSelect={onSelect} />
    </Sheet>
  );
}

/** The repeat choices without a sheet around them, for screens that show them inside their own sheet. */
export function RepeatPicker({
  currentRule, currentMode = 'schedule', dueAt, timezone, allDay, localTime, onSelect,
}: {
  currentRule: string | null;
  currentMode?: RecurrenceMode;
  dueAt?: string | null;
  timezone?: string;
  allDay?: boolean;
  localTime?: string | null;
  onSelect: (rule: string | null, mode: RecurrenceMode) => void;
}) {
  // Keyed by the saved rule so the editor starts over from it whenever it changes.
  return (
    <RepeatPickerContent
      key={(currentRule ?? 'none') + '|' + currentMode}
      currentRule={currentRule} currentMode={currentMode}
      dueAt={dueAt ?? null} timezone={timezone ?? deviceTimeZone()} allDay={allDay ?? true} localTime={localTime ?? null}
      onSelect={onSelect} />
  );
}

function RepeatPickerContent({
  currentRule, currentMode, dueAt, timezone, allDay, localTime, onSelect,
}: {
  currentRule: string | null;
  currentMode: RecurrenceMode;
  dueAt: string | null;
  timezone: string;
  allDay: boolean;
  localTime: string | null;
  onSelect: (rule: string | null, mode: RecurrenceMode) => void;
}) {
  const { colors } = useTheme();
  const { timeFormat } = usePersonalPrefs();
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

  const presetNextPreview = useMemo(
    () => previewNextOccurrence(currentRule, mode, timezone, dueAt, allDay, localTime, timeFormat),
    [currentRule, mode, timezone, dueAt, allDay, localTime, timeFormat],
  );
  const customNextPreview = useMemo(
    () => previewNextOccurrence(customRule, mode, timezone, dueAt, allDay, localTime, timeFormat),
    [customRule, mode, timezone, dueAt, allDay, localTime, timeFormat],
  );

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
            ? '완료한 날을 기준으로 다음 일정을 잡습니다. (예: 필터 교체, 청소, 미용실)'
            : '정해진 날짜와 요일에 맞춰 반복합니다. (예: 주간 회의, 월세 납부)'}
        </Txt>
      </View>

      <View style={{ marginBottom: space.md }}>
        <Segmented<'presets' | 'custom'>
          value={tab} onChange={setTab}
          options={[{ value: 'presets', label: '빠른 선택', icon: 'repeat' }, { value: 'custom', label: '직접 설정', icon: 'sliders' }]} />
      </View>

      {tab === 'presets' ? (
        <View style={{ gap: space.sm }}>
          {presetNextPreview ? (
            <View style={[styles.previewRow, { backgroundColor: colors.surfaceMuted }]}>
              <Icon name="calendar" size={14} color={colors.textMuted} />
              <Txt variant="small" tone="muted">다음 반복:</Txt>
              <Txt variant="smallStrong" tabular>{presetNextPreview}</Txt>
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: 330 }}>
            {repeatOptions.map((item) => {
              const active = currentRule === item.rule && (item.rule === null || currentMode === mode);
              const label = item.rule && mode === 'completion' ? '완료 후 ' + item.label : item.label;
              return (
                <Row
                  key={item.label} icon={item.rule ? 'repeat' : 'slash'} label={label} detail={item.detail}
                  trailing={active ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
                  onPress={() => onSelect(item.rule, item.rule ? mode : 'schedule')} />
              );
            })}
          </ScrollView>
        </View>
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
            <Txt variant="bodyStrong" tabular style={{ minWidth: 64, textAlign: 'center' }}>{interval}{unitLabel}마다</Txt>
            <IconButton
              name="plus" label="간격 늘리기" size={18}
              onPress={() => setInterval((n) => Math.min(52, n + 1))}
              style={{ backgroundColor: colors.surfaceMuted, width: 36, height: 36 }} />
          </View>

          {frequency === 'WEEKLY' ? (
            <View style={{ gap: space.sm }}>
              <Txt variant="caption" tone="muted">반복 요일 (선택하지 않으면 현재 요일 기준)</Txt>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {WEEKDAYS.map((day) => {
                  const active = weekdays.includes(day.code);
                  return (
                    <Pressable
                      key={day.code} accessibilityRole="checkbox" accessibilityLabel={day.label + '요일'} accessibilityState={{ checked: active }}
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
              trailing={<Icon name={lastDay ? 'check-circle' : 'circle'} size={20} color={lastDay ? colors.accentText : colors.textFaint} />}
              onPress={() => {
                haptic.tap();
                setLastDay((prev) => !prev);
              }} />
          ) : null}

          <View style={[styles.preview, { backgroundColor: colors.surfaceMuted }]}>
            <View style={styles.previewLine}>
              <Icon name="repeat" size={15} color={colors.textMuted} />
              <Txt variant="smallStrong">{describeRecurrence(customRule, mode) ?? customRule}</Txt>
            </View>
            {customNextPreview ? (
              <Txt variant="meta" tone="muted" tabular>다음 반복: {customNextPreview}</Txt>
            ) : null}
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
  previewRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: space.md,
  },
  preview: {
    alignItems: 'center', justifyContent: 'center', gap: 4,
    borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: space.md,
  },
  previewLine: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
});
