import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { subscribeToasts, type Toast } from '@/lib/toast';
import { elevation, radius, space, type, useTheme } from '@/theme';

const DURATION = 4200;

/** Renders the newest toast above the tab bar. A replaced or expired toast runs its `onDismiss`. */
export function ToastHost({ bottomOffset = 0, rightInset = 0 }: { bottomOffset?: number; rightInset?: number }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const current = useRef<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const close = (dismissed: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      if (dismissed) current.current?.onDismiss?.();
      current.current = null;
    };
    const unsubscribe = subscribeToasts((next) => {
      close(true);
      current.current = next;
      setToast(next);
      timer.current = setTimeout(() => {
        close(true);
        setToast(null);
      }, DURATION);
    });
    return () => {
      unsubscribe();
      close(true);
    };
  }, []);

  if (!toast) return null;
  const isError = toast.tone === 'error';
  const background = isError ? colors.danger : isDark ? colors.surfaceMuted : colors.text;
  const foreground = isError ? '#FFFFFF' : isDark ? colors.text : colors.background;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + bottomOffset + space.lg, right: space.lg + rightInset }]}>
      <Animated.View
        key={toast.id} entering={FadeInDown.duration(180)} exiting={FadeOutDown.duration(160)}
        accessibilityLiveRegion="polite" accessibilityRole="alert"
        style={[styles.toast, { backgroundColor: background }, elevation(colors, 2)]}>
        {isError ? <Feather name="alert-circle" size={18} color="#FFFFFF" /> : null}
        <Text style={[type.small as TextStyle, { color: foreground, flex: 1 }]} numberOfLines={2}>{toast.message}</Text>
        {toast.actionLabel ? (
          <Pressable
            accessibilityRole="button" accessibilityLabel={toast.actionLabel} hitSlop={10}
            onPress={() => {
              if (timer.current) clearTimeout(timer.current);
              current.current = null;
              toast.onAction?.();
              setToast(null);
            }}>
            <Text style={[type.smallStrong as TextStyle, { color: isDark ? colors.accent : '#8DB3FF' }]}>
              {toast.actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'flex-start' },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.md, paddingHorizontal: space.lg,
    minHeight: 58, paddingVertical: space.sm, maxWidth: 520, width: '100%',
  },
});
