import { memo } from 'react';
import { Text, View } from 'react-native';

import { fontFamily, useTheme } from '@/theme';

import { initialOf } from './palette';

/**
 * A habit's face: its emoji, or the name's first character, on a neutral circle. A habit's stored colour is no
 * longer drawn: in habit grids colour already means "done", so a second colour per habit would compete with it.
 */
export const HabitAvatar = memo(function HabitAvatar({ name, emoji, size = 28 }: {
  name: string; emoji?: string; size?: number;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessible={false} importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
      {emoji ? (
        <Text style={{ fontSize: Math.round(size * 0.55), lineHeight: Math.round(size * 0.72), textAlign: 'center' }} allowFontScaling={false}>
          {emoji}
        </Text>
      ) : (
        <Text
          allowFontScaling={false}
          style={{ fontFamily, fontSize: Math.round(size * 0.46), lineHeight: Math.round(size * 0.62), fontWeight: '700', color: colors.textMuted }}>
          {initialOf(name)}
        </Text>
      )}
    </View>
  );
});
