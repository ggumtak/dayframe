import { Pressable, type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { haptic } from '@/lib/haptics';
import { useMotion, useTheme } from '@/theme';

/** Cute monochrome AI assistant buddy mark; decorative, inherits theme colour. */
export function AiIcon({ size = 20, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <Svg
      width={size} height={size} viewBox="0 0 24 24"
      accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden pointerEvents="none">
      <Rect x={3.5} y={7.5} width={15} height={12} rx={5} fill="none" stroke={stroke} strokeWidth={1.75} />
      <Path d="M11 7.5V4.8" fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" />
      <Circle cx={11} cy={3.8} r={1.25} fill={stroke} />
      <Circle cx={8.6} cy={12.8} r={1.2} fill={stroke} />
      <Circle cx={13.4} cy={12.8} r={1.2} fill={stroke} />
      <Path d="M9.1 15.8c.55.6 1.2.9 1.9.9s1.35-.3 1.9-.9" fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M19.8 3.2l.55 1.75 1.75.55-1.75.55-.55 1.75-.55-1.75-1.75-.55 1.75-.55z" fill={stroke} />
    </Svg>
  );
}

/** Header-sized icon button hosting AiIcon, matching IconButton's geometry and press feedback. */
export function AiIconButton({ label, onPress, color, size = 21, style }: {
  label: string; onPress: () => void; color?: string; size?: number; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        style,
        pressed && { backgroundColor: colors.surfaceMuted, opacity: 0.9 },
        pressed && !reduced && styles.pressScale,
      ]}>
      <AiIcon size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pressScale: { transform: [{ scale: 0.94 }] },
});
