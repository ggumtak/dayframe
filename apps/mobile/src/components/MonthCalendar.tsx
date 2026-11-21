import { useState } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';

import { type PlainDate, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { space, type, useTheme } from '@/theme';

import { IconButton, Txt } from './ui';

const names = ['월', '화', '수', '목', '금', '토', '일'];

export type DayMark = 'done' | 'partial' | 'skipped';

/** A Monday-first month grid for picking a date or reading per-day marks. */
export function MonthCalendar({ initial, selected, today, marks, dots, min, max, onSelect }: {
  initial: PlainDate;
  selected?: PlainDate | null;
  today: PlainDate;
  marks?: Map<string, DayMark>;
  /** Days with something on them, shown as a small dot under the date. */
  dots?: Set<string>;
  min?: PlainDate;
  max?: PlainDate;
  onSelect?: (date: PlainDate) => void;
}) {
  const { colors } = useTheme();
  const [month, setMonth] = useState(() => initial.toPlainYearMonth());
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
        <Txt variant="bodyStrong">{month.year}년 {month.month}월</Txt>
        <IconButton name="chevron-right" label="다음 달" onPress={() => setMonth(month.add({ months: 1 }))} />
      </View>
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
});
