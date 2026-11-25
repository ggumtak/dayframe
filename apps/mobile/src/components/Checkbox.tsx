import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef } from 'react';
import { Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { SPRING_SNAPPY, useMotion, useTheme } from '@/theme';

/**
 * A round check that fills with a small bounce, so finishing something feels like something. The empty ring is the
 * neutral `control` colour for every task (priority is the `!!!` mark, not a colour); it fills with the accent only
 * while checking. `done` draws a completed item that has settled: a quiet grey disc.
 */
export function Checkbox({ checked, done, size = 22, onPress, label }: {
  checked: boolean; done?: boolean; size?: number; onPress: () => void; label: string;
}) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  const scale = useSharedValue(1);
  const checkScale = useSharedValue(checked ? 1 : 0.5);
  const wasChecked = useRef(checked);

  useEffect(() => {
    if (checked && !wasChecked.current) {
      if (reduced) {
        checkScale.set(1);
      } else {
        checkScale.set(0.5);
        checkScale.set(withSpring(1, SPRING_SNAPPY));
      }
    } else if (!checked) {
      checkScale.set(0.5);
    }
    wasChecked.current = checked;
  }, [checked, reduced, checkScale]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const checkAnimated = useAnimatedStyle(() => ({ transform: [{ scale: checkScale.value }] }));
  const fill = done ? colors.textFaint : colors.accent;

  return (
    <Pressable
      accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} hitSlop={10}
      onPressIn={() => {
        if (!reduced) scale.set(withTiming(0.88, { duration: 70 }));
      }}
      onPressOut={() => {
        if (!reduced) scale.set(withSpring(1, SPRING_SNAPPY));
      }}
      onPress={() => {
        if (!reduced) {
          scale.set(withSequence(withTiming(0.82, { duration: 80 }), withSpring(1, { damping: 9, stiffness: 320 })));
        }
        if (checked) haptic.light();
        else haptic.success();
        onPress();
      }}>
      <Animated.View
        style={[{
          width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: checked ? fill : colors.control,
          backgroundColor: checked ? fill : 'transparent', alignItems: 'center', justifyContent: 'center',
        }, animated]}>
        {checked ? (
          <Animated.View style={checkAnimated}>
            <Feather name="check" size={size * 0.62} color={done ? colors.surface : colors.onAccent} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}
