import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native';

import { type PlainDate } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { leadingBlanks, summarizeYear, yearSummaryText } from '@/lib/yearView';
import { type Colors, fontFamily, space, useTheme } from '@/theme';

import { IconButton, Txt } from './ui';

const names = ['월', '화', '수', '목', '금', '토', '일'];

/** Colours for the three busy levels and today's ring, built once per theme and shared by all twelve months. */
interface Palette {
  fills: string[];
  /** Per-level styles, so the 365 day cells share objects instead of allocating their own. */
  inkStyles: TextStyle[];
  fillStyles: ViewStyle[];
  ringStyle: ViewStyle;
  weekday: string[];
  title: string;
  titleCurrent: string;
}

function palette(colors: Colors): Palette {
  // The accent ramp, deepening with workload; the deepest step carries onAccent text in both themes.
  const fills = ['transparent', ...colors.accentRamp];
  const inks = [colors.textMuted, colors.text, colors.text, colors.onAccent];
  return {
    fills,
    inkStyles: inks.map((color) => ({ color })),
    fillStyles: fills.map((backgroundColor) => ({ backgroundColor })),
    ringStyle: { borderWidth: 1.5, borderColor: colors.text },
    // Weekends are not coloured: red means overdue, and accent means something to tap.
    weekday: names.map(() => colors.textFaint),
    title: colors.textMuted,
    titleCurrent: colors.text,
  };
}

/**
 * A year at a glance: twelve small Monday-first months whose days are tinted by how many open tasks fall on them.
 * `counts` holds tasks per "YYYY-MM-DD" (repeats included); tapping a month hands it to `onPickMonth`.
 */
export function YearCalendar({ year, today, counts, columns = 3, onYearChange, onPickMonth }: {
  year: number;
  /** Months per row: 3 on a phone, more where the column is wider. */
  columns?: number;
  today: PlainDate;
  counts: Map<string, number>;
  onYearChange: (year: number) => void;
  onPickMonth: (year: number, month: number) => void;
}) {
  const { colors } = useTheme();
  const months = useMemo(() => summarizeYear(counts, year), [counts, year]);
  const colours = useMemo(() => palette(colors), [colors]);
  const summary = useMemo(() => yearSummaryText(months), [months]);
  // Three columns keep the phone's exact 31 %; more share the row with the same ~3 % gaps.
  const monthWidth = useMemo(() => ({ width: columns === 3 ? '31%' : `${(100 - (columns - 1) * 3) / columns}%` } as const), [columns]);

  return (
    <View>
      <View style={styles.nav}>
        <IconButton name="chevron-left" label="이전 해" onPress={() => onYearChange(year - 1)} />
        <Txt variant="bodyStrong" accessibilityRole="header">{year}년</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {year === today.year ? null : (
            <Pressable
              accessibilityRole="button" accessibilityLabel="올해로 이동" hitSlop={8}
              onPress={() => {
                haptic.tap();
                onYearChange(today.year);
              }}>
              <Txt variant="smallStrong" tone="accent">올해</Txt>
            </Pressable>
          )}
          <IconButton name="chevron-right" label="다음 해" onPress={() => onYearChange(year + 1)} />
        </View>
      </View>
      <Txt variant="small" tone="muted" style={styles.summary}>{summary}</Txt>
      <View style={styles.grid}>
        {months.map((entry) => (
          <MonthBlock
            key={entry.month} year={year} month={entry.month} levels={entry.levels} total={entry.total}
            todayDay={today.year === year && today.month === entry.month ? today.day : 0}
            current={today.year === year && today.month === entry.month}
            dimmed={year < today.year || (year === today.year && entry.month < today.month)}
            colours={colours} width={monthWidth} onPick={onPickMonth} />
        ))}
      </View>
      <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Txt variant="caption" tone="faint">적음</Txt>
        {colours.fills.map((fill, level) => (
          <View key={level} style={[styles.swatch, level ? { backgroundColor: fill } : { borderWidth: 1, borderColor: colors.border }]} />
        ))}
        <Txt variant="caption" tone="faint">많음</Txt>
      </View>
    </View>
  );
}

/** One mini month. Props are plain values (levels as a digit string), so memo skips months whose days did not change. */
const MonthBlock = memo(function MonthBlock({ year, month, levels, total, todayDay, current, dimmed, colours, width, onPick }: {
  year: number; month: number; levels: string; total: number; todayDay: number; current: boolean; dimmed: boolean;
  colours: Palette; width: ViewStyle; onPick: (year: number, month: number) => void;
}) {
  const press = useCallback(() => {
    haptic.tap();
    onPick(year, month);
  }, [onPick, year, month]);

  const blanks = leadingBlanks(year, month);
  const cells = [];
  for (let blank = 0; blank < blanks; blank++) cells.push(<View key={'b' + blank} style={styles.cell} />);
  for (let day = 1; day <= levels.length; day++) {
    const level = Number(levels[day - 1]) as 0 | 1 | 2 | 3;
    const isToday = day === todayDay;
    const text = (
      <Text
        maxFontSizeMultiplier={1.2}
        style={[styles.dayText, colours.inkStyles[level], isToday && styles.todayText]}>
        {day}
      </Text>
    );
    cells.push(level === 0 && !isToday ? (
      <View key={day} style={[styles.cell, styles.center]}>{text}</View>
    ) : (
      <View key={day} style={[styles.cell, styles.pad]}>
        <View style={[styles.fill, colours.fillStyles[level], isToday && colours.ringStyle]}>
          {text}
        </View>
      </View>
    ));
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${year}년 ${month}월, ${total ? '예정된 할 일 ' + total + '개' : '할 일 없음'}, 눌러서 월간 보기`}
      onPress={press}
      style={({ pressed }) => [width, { opacity: pressed ? 0.6 : dimmed ? 0.55 : 1 }]}>
      <Text maxFontSizeMultiplier={1.3} style={[styles.monthTitle, { color: current ? colours.titleCurrent : colours.title }]}>{month}월</Text>
      <View style={styles.row}>
        {names.map((name, idx) => (
          <Text key={name} maxFontSizeMultiplier={1.2} style={[styles.weekday, { color: colours.weekday[idx] }]}>{name}</Text>
        ))}
      </View>
      <View style={styles.row}>{cells}</View>
    </Pressable>
  );
});

const CELL = '14.2857%';

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summary: { textAlign: 'center', marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg, justifyContent: 'space-between' },
  monthTitle: { fontFamily, fontSize: 13, lineHeight: 18, fontWeight: '700', marginBottom: 2, paddingLeft: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, aspectRatio: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pad: { padding: 1 },
  fill: { flex: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  weekday: { width: CELL, fontFamily, fontSize: 9, lineHeight: 14, fontWeight: '500', textAlign: 'center' },
  dayText: { fontFamily, fontSize: 9, lineHeight: 12, textAlign: 'center', includeFontPadding: false },
  todayText: { fontWeight: '800' },
  // Left-aligned so the floating + button at the bottom right never covers it.
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 4, marginTop: space.lg },
  swatch: { width: 12, height: 12, borderRadius: 3 },
});
