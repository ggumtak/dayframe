import { View } from 'react-native';

import { Txt } from '@/components/ui';
import { type PlainDate, Temporal, weekStart } from '@/lib/dates';
import type { Habit, HabitLog } from '@/lib/shared';
import { useTheme } from '@/theme';

const WEEKS = 17;
const CELL = 15;
const GAP = 3;

/** Seventeen weeks of check-ins, one column per week, most recent on the right. */
export function Heatmap({ habit, logs, today }: { habit: Habit; logs: HabitLog[]; today: PlainDate }) {
  const { colors } = useTheme();
  const byDate = new Map(logs.map((log) => [log.log_date, log]));
  const start = weekStart(today).subtract({ weeks: WEEKS - 1 });
  const first = Temporal.PlainDate.from(habit.start_date);
  const perDay = habit.cadence === 'daily' ? habit.target_count : 1;
  const months: { column: number; label: string }[] = [];

  const columns = Array.from({ length: WEEKS }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const date = start.add({ days: week * 7 + weekday });
    if (weekday === 0 && (week === 0 || date.day <= 7)) months.push({ column: week, label: date.month + '월' });
    const log = byDate.get(date.toString());
    const outside = Temporal.PlainDate.compare(date, today) > 0 || Temporal.PlainDate.compare(date, first) < 0;
    const color = outside ? 'transparent'
      : !log || log.count === 0 ? colors.surfaceMuted
        : log.count >= perDay ? colors.success : colors.successSoft;
    return { key: date.toString(), color, outside };
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
              <View
                key={cell.key}
                style={{
                  width: CELL, height: CELL, borderRadius: 4, backgroundColor: cell.color,
                  borderWidth: cell.outside ? 1 : 0, borderColor: colors.surfaceMuted, opacity: cell.outside ? 0.5 : 1,
                }} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

export const heatmapWidth = WEEKS * (CELL + GAP) - GAP;
