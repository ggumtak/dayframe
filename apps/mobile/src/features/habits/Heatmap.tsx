import { StyleSheet, View } from 'react-native';

import { Txt } from '@/components/ui';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { type PlainDate, Temporal, weekStart } from '@/lib/dates';
import type { Habit, HabitLog } from '@/lib/shared';
import { space, useTheme } from '@/theme';

const WEEKS = 17;
const CELL = 15;
const GAP = 3;

type CellKind = 'outside' | 'met' | 'partial' | 'frozen' | 'skipped' | 'missed';

function HeatmapCell({ kind, size = CELL }: { kind: CellKind; size?: number }) {
  const { colors } = useTheme();
  const radius = size >= 14 ? 4 : 3;

  if (kind === 'outside') {
    return (
      <View
        style={{
          width: size, height: size, borderRadius: radius,
          backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.surfaceMuted, opacity: 0.5,
        }}
      />
    );
  }
  if (kind === 'met') {
    return <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.accent }} />;
  }
  if (kind === 'partial') {
    return <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.accentRamp[1] }} />;
  }
  if (kind === 'frozen') {
    return (
      <View
        style={[
          styles.frozenCell,
          {
            width: size, height: size, borderRadius: radius,
            backgroundColor: colors.accentSoft, borderColor: colors.accentRamp[1],
          },
        ]}>
        <View style={[styles.frozenSlash, { width: Math.round(size * 1.5), backgroundColor: colors.accentRamp[1] }]} />
      </View>
    );
  }
  if (kind === 'skipped') {
    return (
      <View
        style={{
          width: size, height: size, borderRadius: radius,
          backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.control,
        }}
      />
    );
  }
  return <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.surfaceMuted }} />;
}

/** Seventeen weeks of check-ins, one column per week, most recent on the right. */
export function Heatmap({ habit, logs, today }: { habit: Habit; logs: HabitLog[]; today: PlainDate }) {
  const prefs = usePersonalPrefs();
  const byDate = new Map(logs.map((log) => [log.log_date, log]));
  const start = weekStart(today, prefs.startOfWeek).subtract({ weeks: WEEKS - 1 });
  const first = Temporal.PlainDate.from(habit.start_date);
  const perDay = habit.cadence === 'daily' ? habit.target_count : 1;
  const months: { column: number; label: string }[] = [];

  const columns = Array.from({ length: WEEKS }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const date = start.add({ days: week * 7 + weekday });
    if (weekday === 0 && date.day <= 7) months.push({ column: week, label: date.month + '월' });
    const log = byDate.get(date.toString());
    const outside = Temporal.PlainDate.compare(date, today) > 0 || Temporal.PlainDate.compare(date, first) < 0;
    const kind: CellKind = outside
      ? 'outside'
      : !log
        ? 'missed'
        : log.status === 'frozen'
          ? 'frozen'
          : log.status === 'skipped'
            ? 'skipped'
            : log.count === 0
              ? 'missed'
              : log.count >= perDay
                ? 'met'
                : 'partial';
    return { key: date.toString(), kind };
  }));

  return (
    <View accessibilityLabel={`최근 ${WEEKS}주 기록`} accessibilityRole="image">
      <View style={{ height: 16 }}>
        {months.map((month) => (
          <Txt key={month.column} variant="caption" tone="faint" style={{ position: 'absolute', left: month.column * (CELL + GAP) }}>
            {month.label}
          </Txt>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: GAP }}>
        {columns.map((column, index) => (
          <View key={index} style={{ gap: GAP }}>
            {column.map((cell) => (
              <HeatmapCell key={cell.key} kind={cell.kind} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Matching compact legend for Heatmap cells (keeps 1-hue monochrome + accent ramp). */
export function HeatmapLegend() {
  const items: { kind: CellKind; label: string }[] = [
    { kind: 'met', label: '달성' },
    { kind: 'partial', label: '일부' },
    { kind: 'frozen', label: '쉬어감' },
    { kind: 'skipped', label: '건너뜀' },
    { kind: 'missed', label: '기록 없음' },
  ];
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.kind} style={styles.legendItem}>
          <HeatmapCell kind={item.kind} size={11} />
          <Txt variant="caption" tone="faint">{item.label}</Txt>
        </View>
      ))}
    </View>
  );
}

export const heatmapWidth = WEEKS * (CELL + GAP) - GAP;

const styles = StyleSheet.create({
  frozenCell: {
    borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  frozenSlash: {
    height: 1.5, transform: [{ rotate: '-45deg' }],
  },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingTop: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
