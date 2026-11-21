import Feather from '@expo/vector-icons/Feather';
import { Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

/** A round check that fills with a small bounce, so finishing something feels like something. */
export function Checkbox({ checked, color, size = 22, tinted, onPress, label }: {
  checked: boolean; color?: string; size?: number;
  /** Washes the empty circle with its colour, so a priority shows before the task is read. */
  tinted?: boolean; onPress: () => void; label: string;
}) {
  const { colors } = useTheme();
  const tint = color ?? colors.textFaint;
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} hitSlop={10}
      onPress={() => {
        scale.set(withSequence(withTiming(0.82, { duration: 80 }), withSpring(1, { damping: 9, stiffness: 320 })));
        if (checked) haptic.light();
        else haptic.success();
        onPress();
      }}>
      <Animated.View
        style={[{
          width: size, height: size, borderRadius: size / 2, borderWidth: tinted ? 2 : 1.5, borderColor: tint,
          backgroundColor: checked ? tint : tinted ? tint + '1F' : 'transparent', alignItems: 'center', justifyContent: 'center',
        }, animated]}>
        {checked ? <Feather name="check" size={size * 0.62} color={colors.surface} /> : null}
      </Animated.View>
    </Pressable>
  );
}
