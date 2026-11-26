import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { Icon, Txt } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { space, useMotion, useTheme } from '@/theme';

/**
 * The one look for "기한 지남" above a day's tasks (Today list, Timeline, Upcoming): a plain row, red mark and count on
 * the left, two text actions on the right. With `open`/`onToggle` the left part folds the overdue rows below it.
 */
export function OverdueBar({
  count, onSpread, onMoveToday, spreadLabel = '여러 날에 나누어 배정하기', moveTodayLabel = '모두 오늘로 옮기기',
  open, onToggle, separator = false,
}: {
  count: number;
  /** Shown only when given. */
  onSpread?: () => void;
  /** The caller owns the haptic and the toast: moving is a success, not a tap. */
  onMoveToday: () => void;
  spreadLabel?: string;
  moveTodayLabel?: string;
  open?: boolean;
  onToggle?: () => void;
  /** A hairline under the row, where the layout below has no edge of its own. */
  separator?: boolean;
}) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  const foldable = open !== undefined && !!onToggle;
  const turn = useDerivedValue(() => withTiming(open ? 1 : 0, { duration: reduced ? 0 : 180 }));
  const arrow = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 180}deg` }] }));

  const label = (
    <>
      <Icon name="alert-circle" size={14} color={colors.danger} />
      <Txt variant="smallStrong" tone="danger" accessibilityRole="header">기한 지남</Txt>
      <Txt variant="small" tone="danger" tabular>{count}</Txt>
      {foldable ? <Animated.View style={arrow}><Icon name="chevron-down" size={16} color={colors.textFaint} /></Animated.View> : null}
    </>
  );

  return (
    <View style={[styles.row, separator && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      {foldable ? (
        <Pressable
          accessibilityRole="button" accessibilityLabel={`기한 지난 할 일 ${count}개 ${open ? '접기' : '펼치기'}`}
          accessibilityState={{ expanded: !!open }} hitSlop={8}
          onPress={() => {
            haptic.tap();
            onToggle();
          }}
          style={({ pressed }) => [styles.label, { opacity: pressed ? 0.6 : 1 }]}>
          {label}
        </Pressable>
      ) : (
        <View style={styles.label}>{label}</View>
      )}
      <View style={{ flex: 1 }} />
      {onSpread ? (
        <Pressable
          accessibilityRole="button" accessibilityLabel={spreadLabel} hitSlop={8}
          onPress={() => {
            haptic.tap();
            onSpread();
          }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Txt variant="smallStrong">일정 분산</Txt>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button" accessibilityLabel={moveTodayLabel} hitSlop={8} onPress={onMoveToday}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
        <Txt variant="smallStrong" tone="muted">오늘로</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg, minHeight: 44, paddingHorizontal: space.lg },
  label: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
});
