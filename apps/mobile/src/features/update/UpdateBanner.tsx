import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import { Icon, IconButton, Txt } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

import { useUpdate } from './useUpdate';

/** A quiet one-line notice that a newer release exists. Tapping it opens the update card in Settings. */
export function UpdateBanner() {
  const { colors } = useTheme();
  const { available, required, release } = useUpdate();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!available || !release || (!required && dismissed === release.version)) return null;
  return (
    <Animated.View entering={FadeInUp.duration(200)} exiting={FadeOutUp.duration(160)} style={styles.wrap}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`새 버전 ${release.version} 업데이트`}
        onPress={() => router.push('/settings')}
        style={({ pressed }) => [styles.banner, { backgroundColor: required ? colors.warningSoft : colors.accentSoft, opacity: pressed ? 0.8 : 1 }]}>
        <Icon name="download" size={16} color={required ? colors.warning : colors.accent} />
        <View style={{ flex: 1 }}>
          <Txt variant="smallStrong" style={{ color: required ? colors.warning : colors.accent }}>
            {required ? '업데이트가 필요합니다' : `새 버전 ${release.version} 사용 가능`}
          </Txt>
        </View>
        <Txt variant="smallStrong" style={{ color: required ? colors.warning : colors.accent }}>업데이트</Txt>
        {required ? null : (
          <IconButton
            name="x" label="업데이트 알림 닫기" size={16} color={colors.accent} style={{ width: 28, height: 28 }}
            onPress={() => setDismissed(release.version)} />
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingLeft: space.md, paddingRight: space.sm, minHeight: 44 },
});
