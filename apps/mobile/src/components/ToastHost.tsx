import Feather from '@expo/vector-icons/Feather';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setActiveToastTrigger, subscribeToasts, type Toast } from '@/lib/toast';
import { elevation, radius, space, type, useMotion, useTheme } from '@/theme';

const DURATION = 4200;

/** Renders the newest toast above the tab bar. A replaced or expired toast runs its `onDismiss`. */
export function ToastHost({ bottomOffset = 0, rightInset = 0, leftInset = 0 }: { bottomOffset?: number; rightInset?: number; leftInset?: number }) {
  const { colors, isDark } = useTheme();
  const { reduced } = useMotion();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const current = useRef<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerActiveAction = useCallback((): boolean => {
    const active = current.current;
    if (!active || !active.actionLabel || !active.onAction) return false;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    current.current = null;
    setActiveToastTrigger(null);
    setToast(null);
    active.onAction();
    return true;
  }, []);

  useEffect(() => {
    const close = (dismissed: boolean) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (dismissed) current.current?.onDismiss?.();
      current.current = null;
      setActiveToastTrigger(null);
    };
    const unsubscribe = subscribeToasts((next) => {
      close(true);
      current.current = next;
      setActiveToastTrigger(next.actionLabel && next.onAction ? triggerActiveAction : null);
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
  }, [triggerActiveAction]);

  const isError = toast?.tone === 'error';
  // One neutral, inverted toast for every message; an error adds only a small red icon, never a red fill.
  const background = isDark ? colors.surfaceElevated : colors.text;
  const foreground = isDark ? colors.text : colors.background;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + bottomOffset + space.lg, left: space.lg + leftInset, right: space.lg + rightInset }]}>
      {toast ? (
        <Animated.View
          key={toast.id}
          entering={reduced ? undefined : FadeInDown.duration(180)}
          exiting={reduced ? undefined : FadeOutDown.duration(160)}
          accessibilityLiveRegion="polite" accessibilityRole="alert"
          style={[
            styles.toast,
            { backgroundColor: background },
            isDark && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
            elevation(colors, 2),
          ]}>
          {isError ? <Feather name="alert-circle" size={18} color={colors.danger} /> : null}
          <Text style={[type.small as TextStyle, { color: foreground, flex: 1 }]} numberOfLines={2}>{toast.message}</Text>
          {toast.actionLabel ? (
            <Pressable
              accessibilityRole="button" accessibilityLabel={toast.actionLabel} hitSlop={8}
              onPress={() => {
                if (!triggerActiveAction()) {
                  if (timer.current) {
                    clearTimeout(timer.current);
                    timer.current = null;
                  }
                  current.current = null;
                  setActiveToastTrigger(null);
                  setToast(null);
                  toast.onAction?.();
                }
              }}
              style={({ pressed }) => [
                styles.actionPill,
                isDark
                  ? { backgroundColor: pressed ? colors.border : colors.surfaceMuted }
                  : {
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.textMuted,
                    backgroundColor: pressed ? colors.textMuted : 'transparent',
                  },
              ]}>
              <Text style={[type.smallStrong as TextStyle, { color: isDark ? colors.accentText : colors.background }]}>
                {toast.actionLabel}
              </Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'flex-start' },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.md, paddingHorizontal: space.lg,
    minHeight: 58, paddingVertical: space.sm, maxWidth: 520, width: '100%',
  },
  actionPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm,
  },
});
