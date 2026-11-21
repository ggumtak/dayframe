import { useState } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';

import { type PlainDate, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { space, type, useTheme } from '@/theme';

import { Icon, IconButton, Txt } from './ui';

const names = ['월', '화', '수', '목', '금', '토', '일'];

export type DayMark = 'done' | 'partial' | 'skipped';

/** A Monday-first month grid for picking a date or reading per-day marks. */
export function MonthCalendar({ initial, selected, today, marks, dots, min, max, onSelect, onLongPress, onMonthChange }: {
  initial: PlainDate;
  selected?: PlainDate | null;
  today: PlainDate;
  marks?: Map<string, DayMark>;
  /** Days with something on them, shown as a small dot under the date. */
  dots?: Set<string>;
  min?: PlainDate;
  max?: PlainDate;
  onSelect?: (date: PlainDate) => void;
  /** A long press on a day, for screens that act on a day straight away. */
  onLongPress?: (date: PlainDate) => void;
  /** Told when the shown month changes, for screens that list the month's contents. */
  onMonthChange?: (month: Temporal.PlainYearMonth) => void;
}) {
  const { colors } = useTheme();
  const [month, setMonthState] = useState(() => initial.toPlainYearMonth());
  const [picking, setPicking] = useState(false);
  const [pickYear, setPickYear] = useState(month.year);
  const setMonth = (next: Temporal.PlainYearMonth) => {
    setMonthState(next);
    onMonthChange?.(next);
  };
  const first = month.toPlainDate({ day: 1 });
  const cells: (PlainDate | null)[] = [
    ...Array.from({ length: first.dayOfWeek - 1 }, () => null),
    ...Array.from({ length: month.daysInMonth }, (_, index) => first.add({ days: index })),
  ];
  while (cells.length % 7) cells.push(null);

  return (
    <View>
      <View style={styles.nav}>
        <IconButton name="chevron-left" label="이전 달" onPress={() => setMonth(month.subtract({ months: 1 }))} />
        <Pressable
          accessibilityRole="button" accessibilityLabel={`${month.year}년 ${month.month}월, 눌러서 다른 달 고르기`} hitSlop={8}
          onPress={() => {
            setPickYear(month.year);
            setPicking(!picking);
          }}
          style={styles.title}>
          <Txt variant="bodyStrong">{month.year}년 {month.month}월</Txt>
          <Icon name={picking ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {month.equals(today.toPlainYearMonth()) ? null : (
            <Pressable accessibilityRole="button" accessibilityLabel="이번 달로" hitSlop={8} onPress={() => setMonth(today.toPlainYearMonth())}>
              <Txt variant="smallStrong" tone="accent">오늘</Txt>
            </Pressable>
          )}
          <IconButton name="chevron-right" label="다음 달" onPress={() => setMonth(month.add({ months: 1 }))} />
        </View>
      </View>
      {picking ? (
        <View style={[styles.picker, { borderColor: colors.border }]}>
          <View style={styles.pickerYear}>
            <IconButton name="chevron-left" label="이전 해" onPress={() => setPickYear(pickYear - 1)} />
            <Txt variant="bodyStrong">{pickYear}년</Txt>
            <IconButton name="chevron-right" label="다음 해" onPress={() => setPickYear(pickYear + 1)} />
          </View>
          <View style={styles.months}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((number) => {
              const active = pickYear === month.year && number === month.month;
              return (
                <Pressable
                  key={number} accessibilityRole="button" accessibilityLabel={`${pickYear}년 ${number}월`} accessibilityState={{ selected: active }}
                  onPress={() => {
                    haptic.tap();
                    setMonth(Temporal.PlainYearMonth.from({ year: pickYear, month: number }));
                    setPicking(false);
                  }}
                  style={[styles.monthCell, { backgroundColor: active ? colors.accent : colors.surfaceMuted }]}>
                  <Txt variant="smallStrong" style={{ color: active ? colors.onAccent : colors.text }}>{number}월</Txt>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      <View style={styles.week}>
        {names.map((name) => <Txt key={name} variant="caption" tone="faint" style={styles.cell}>{name}</Txt>)}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <View key={row} style={styles.week}>
          {cells.slice(row * 7, row * 7 + 7).map((date, column) => {
            if (!date) return <View key={column} style={styles.cell} />;
            const key = date.toString();
            const mark = marks?.get(key);
            const isSelected = !!selected && Temporal.PlainDate.compare(selected, date) === 0;
            const isToday = Temporal.PlainDate.compare(today, date) === 0;
            const disabled = !onSelect || (!!min && Temporal.PlainDate.compare(date, min) < 0)
              || (!!max && Temporal.PlainDate.compare(date, max) > 0);
            const fill = isSelected ? colors.accent : mark === 'done' ? colors.success
              : mark === 'partial' ? colors.successSoft : mark === 'skipped' ? colors.surfaceMuted : 'transparent';
            const foreground = isSelected || mark === 'done' ? colors.onAccent
              : disabled && onSelect ? colors.textFaint : isToday ? colors.accent : colors.text;
            return (
              <Pressable
                key={column} disabled={disabled} accessibilityRole="button"
                accessibilityLabel={`${date.month}월 ${date.day}일`} accessibilityState={{ selected: isSelected, disabled }}
                onPress={() => {
                  haptic.tap();
                  onSelect?.(date);
                }}
                onLongPress={onLongPress ? () => {
                  haptic.medium();
                  onLongPress(date);
                } : undefined}
                style={styles.cell}>
                <View style={[styles.day, { backgroundColor: fill }, isToday && !isSelected && { borderWidth: 1.5, borderColor: colors.accent }]}>
                  <Text style={[type.small as TextStyle, { color: foreground, fontWeight: isToday ? '700' : '400' }]}>{date.day}</Text>
                </View>
                {dots ? (
                  <View style={[styles.dot, { backgroundColor: dots.has(key) ? (isSelected ? colors.accent : colors.textFaint) : 'transparent' }]} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', textAlign: 'center', paddingVertical: 3 },
  day: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  picker: { borderWidth: 1, borderRadius: 12, padding: space.sm, marginBottom: space.sm },
  pickerYear: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between' },
  monthCell: { width: '23%', height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
