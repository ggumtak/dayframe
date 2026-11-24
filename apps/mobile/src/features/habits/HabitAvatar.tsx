import { memo } from 'react';
import { Text, View } from 'react-native';

import { fontFamily, useTheme } from '@/theme';

import { initialOf, softTint } from './palette';

/**
 * A habit's face: its emoji on a soft circle of its colour. Without an emoji it shows the name's first
 * character, in the habit's colour when it has one and on a neutral circle when it has neither.
 */
export const HabitAvatar = memo(function HabitAvatar({ name, emoji, color, size = 28 }: {
  name: string; emoji?: string; color?: string; size?: number;
}) {
  const { colors, isDark } = useTheme();
  const background = color ? softTint(color, isDark) : colors.surfaceMuted;
  return (
    <View
      accessible={false} importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: background, alignItems: 'center', justifyContent: 'center' }}>
      {emoji ? (
        <Text style={{ fontSize: Math.round(size * 0.55), lineHeight: Math.round(size * 0.72), textAlign: 'center' }} allowFontScaling={false}>
          {emoji}
        </Text>
      ) : (
        <Text
          allowFontScaling={false}
          style={{ fontFamily, fontSize: Math.round(size * 0.46), lineHeight: Math.round(size * 0.62), fontWeight: '700', color: color ?? colors.textMuted }}>
          {initialOf(name)}
        </Text>
      )}
    </View>
  );
});
