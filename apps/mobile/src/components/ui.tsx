import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, type PressableProps, type StyleProp, StyleSheet, Text, type TextProps, type TextStyle,
  View, type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn, SlideInDown, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyHandler } from '@/features/keyboard/manager';
import { matchesCombo } from '@/features/keyboard/normalize';
import { KEY_PRIORITY } from '@/features/keyboard/types';
import { haptic } from '@/lib/haptics';
import { useLayout } from '@/lib/layoutContext';
import { elevation, radius, space, type, useTheme } from '@/theme';

export type IconName = ComponentProps<typeof Feather>['name'];

type Variant = keyof typeof type;
type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'danger' | 'onAccent';

export function Txt({ variant = 'body', tone = 'default', style, ...props }: TextProps & { variant?: Variant; tone?: Tone }) {
  const { colors } = useTheme();
  const color = {
    default: colors.text, muted: colors.textMuted, faint: colors.textFaint, accent: colors.accentText,
    danger: colors.danger, onAccent: colors.onAccent,
  }[tone];
  return <Text {...props} style={[type[variant] as TextStyle, { color }, style]} />;
}

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Feather name={name} size={size} color={color ?? colors.text} />;
}

/**
 * The page frame: themed background with the status bar inset applied. On a tablet everything inside (header,
 * lists, bottom bars) sits in a centred column, `READING_MAX` wide unless `maxWidth` asks for more; on a phone the
 * column is the whole width, as before.
 */
export function Screen({ children, style, maxWidth }: { children: ReactNode; style?: StyleProp<ViewStyle>; maxWidth?: number }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { column } = useLayout();
  const columnMax = column.maxWidth === undefined ? undefined : maxWidth ?? column.maxWidth;
  return (
    <View style={[{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }, style]}>
      <View style={[styles.column, columnMax === undefined ? null : { maxWidth: columnMax }]}>{children}</View>
    </View>
  );
}

export function Header({ title, subtitle, left, right }: { title: string; subtitle?: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      {left}
      <View style={{ flex: 1 }}>
        <Txt variant="title" numberOfLines={1} accessibilityRole="header">{title}</Txt>
        {subtitle ? <Txt variant="small" tone="muted" style={{ marginTop: 2 }}>{subtitle}</Txt> : null}
      </View>
      {right}
    </View>
  );
}

export function IconButton({ name, label, onPress, color, size = 22, style }: {
  name: IconName; label: string; onPress: () => void; color?: string; size?: number; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, style]}>
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

/**
 * Buttons by weight. `primary` is the one filled accent button a screen may have (DESIGN.md); every other action is
 * `secondary` (neutral fill), `ghost` (no fill, accent label) or `danger` (neutral fill, red label).
 */
export function Button({ label, onPress, kind = 'primary', icon, loading, disabled, style, ...props }: Omit<PressableProps, 'style'> & {
  label: string; kind?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName; loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const palette = {
    primary: { background: colors.accent, foreground: colors.onAccent, icon: colors.onAccent },
    secondary: { background: colors.surfaceMuted, foreground: colors.text, icon: colors.textMuted },
    ghost: { background: 'transparent', foreground: colors.accentText, icon: colors.accentText },
    danger: { background: colors.surfaceMuted, foreground: colors.danger, icon: colors.danger },
  }[kind];
  const inactive = disabled || loading;
  return (
    <Pressable
      {...props} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!inactive }}
      disabled={inactive}
      onPress={(event) => {
        haptic.light();
        onPress?.(event);
      }}
      style={({ pressed }) => [
        styles.button, { backgroundColor: palette.background, opacity: inactive ? 0.5 : pressed ? 0.8 : 1 }, style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={palette.foreground} />
        : icon ? <Icon name={icon} size={18} color={palette.icon} /> : null}
      <Text style={[type.bodyStrong as TextStyle, { color: palette.foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, icon, selected, tone, color, onPress, style }: {
  label: string; icon?: IconName; selected?: boolean;
  /** `set`: the chip shows a value (a date, a tag) in full-strength text; `danger`: that value is overdue. */
  tone?: 'set' | 'danger';
  color?: string; onPress?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  // Neutral unless selected; a selected chip is the accent outline and label on accentSoft. `color` tints only
  // the icon (a list's own mark in a list picker). The border stays neutral even when the label is red.
  const foreground = selected ? colors.accentText : tone === 'danger' ? colors.danger : tone === 'set' ? colors.text : colors.textMuted;
  const iconColor = color ?? (selected ? colors.accentText : tone === 'danger' ? colors.danger : tone === 'set' ? colors.textMuted : colors.textFaint);
  const content = (
    <>
      {icon ? <Icon name={icon} size={13} color={iconColor} /> : null}
      <Text style={[type.smallStrong as TextStyle, { color: foreground }]} numberOfLines={1}>{label}</Text>
    </>
  );
  const base = [styles.chip, { backgroundColor: selected ? colors.accentSoft : 'transparent', borderColor: selected ? colors.accent : colors.border }, style];
  if (!onPress) return <View style={base}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected }}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [...base, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

export function SectionTitle({ title, count, action, tone }: { title: string; count?: number; action?: ReactNode; tone?: Tone }) {
  return (
    <View style={styles.section}>
      <Txt variant="section" tone={tone} accessibilityRole="header">{title}</Txt>
      {count ? <Txt variant="small" tone="faint">{count}</Txt> : null}
      <View style={{ flex: 1 }} />
      {action}
    </View>
  );
}

/**
 * A section heading that folds its section: the whole line is the button, it shows the press, and the
 * arrow turns as the section opens.
 */
export function FoldHeader({ title, titleTone, count, detail, detailTone = 'muted', open, onToggle, label }: {
  title: string; titleTone?: Tone; count?: number; detail?: string; detailTone?: Tone; open: boolean; onToggle: () => void;
  /** What the section holds, for screen readers: "오늘 완료한 일". */
  label: string;
}) {
  const { colors } = useTheme();
  const turn = useDerivedValue(() => withTiming(open ? 1 : 0, { duration: 180 }));
  const arrow = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 180}deg` }] }));
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${label} ${open ? '접기' : '펼치기'}`} accessibilityState={{ expanded: open }}
      android_ripple={{ color: colors.border }}
      onPress={() => {
        haptic.tap();
        onToggle();
      }}
      style={({ pressed }) => [styles.fold, { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' }]}>
      <Txt variant="section" tone={titleTone} accessibilityRole="header">{title}</Txt>
      {count ? <Txt variant="small" tone="faint">{count}</Txt> : null}
      <View style={{ flex: 1 }} />
      {detail ? <Txt variant="small" tone={detailTone}>{detail}</Txt> : null}
      <Animated.View style={arrow}><Icon name="chevron-down" size={18} color={colors.textMuted} /></Animated.View>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      {children}
    </View>
  );
}

/** Width of an empty-state illustration: keeps the art, text and action above the fold on a 360×760 screen. */
export const EMPTY_ART = 120;

/**
 * A centred message for an empty or failed screen. `art` (an illustration from `@/components/art`) replaces the
 * icon circle when given; `icon` stays the fallback, and empty states inside sheets or small cards keep using it.
 */
export function EmptyState({ icon, art, title, message, action }: {
  icon: IconName; art?: ReactNode; title: string; message?: string; action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.empty, art ? styles.emptyWithArt : null]}>
      {art ? (
        <View style={styles.emptyArt}>{art}</View>
      ) : (
        <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceMuted }]}>
          <Icon name={icon} size={26} color={colors.textMuted} />
        </View>
      )}
      <Txt variant="bodyStrong" style={{ textAlign: 'center' }}>{title}</Txt>
      {message ? <Txt variant="small" tone="muted" style={{ textAlign: 'center' }}>{message}</Txt> : null}
      {action}
    </View>
  );
}

export function Loading() {
  const { colors } = useTheme();
  return <View style={styles.empty}><ActivityIndicator color={colors.accent} /></View>;
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string; icon?: IconName }[]; onChange: (value: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value} accessibilityRole="tab" accessibilityLabel={option.label} accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) haptic.tap();
              onChange(option.value);
            }}
            style={[styles.segment, active && [{ backgroundColor: colors.surface }, elevation(colors)]]}>
            {option.icon ? <Icon name={option.icon} size={14} color={active ? colors.text : colors.textMuted} /> : null}
            <Text style={[type.smallStrong as TextStyle, { color: active ? colors.text : colors.textMuted }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressBar({ value, color, height = 6 }: { value: number; color?: string; height?: number }) {
  const { colors } = useTheme();
  const ratio = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
      style={{ height, borderRadius: height, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
      <View style={{ width: `${ratio * 100}%`, height, borderRadius: height, backgroundColor: color ?? colors.accent }} />
    </View>
  );
}

/**
 * A bottom sheet that slides up smoothly and dismisses by dragging its handle down or tapping the backdrop. It never
 * grows past the window (with the keyboard up, its scroll view shrinks instead) and, on a tablet, is at most
 * `SHEET_MAX` wide and centred.
 */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { sheet } = useLayout();
  const translateY = useSharedValue(0);

  useKeyHandler(
    (event) => {
      if (matchesCombo(event, 'escape')) {
        if (!event.repeat) onClose();
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: visible },
  );

  const drag = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((event) => {
      translateY.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      if (event.translationY > 72 || event.velocityY > 650) {
        haptic.tap();
        translateY.set(0);
        onClose();
      } else {
        translateY.set(withSpring(0, { damping: 20, stiffness: 260 }));
      }
    });

  const sheetMotion = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View entering={FadeIn.duration(160)} style={StyleSheet.absoluteFill}>
            <Pressable accessibilityLabel="닫기" style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} />
          </Animated.View>
          <Animated.View
            entering={SlideInDown.duration(220)}
            style={[
              styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + space.lg, maxHeight: sheet.maxHeight },
              sheet.maxWidth === undefined ? null : { maxWidth: sheet.maxWidth, width: '100%', alignSelf: 'center' }, sheetMotion,
            ]}>
            <GestureDetector gesture={drag}>
              <View style={styles.handleArea}>
                <View style={[styles.grabber, { backgroundColor: colors.border }]} />
                {title ? <Txt variant="heading" style={{ marginBottom: space.md }}>{title}</Txt> : null}
              </View>
            </GestureDetector>
            {children}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** A full-width row for sheets and settings lists. */
export function Row({ icon, label, detail, onPress, tone = 'default', trailing }: {
  icon?: IconName; label: string; detail?: string; onPress?: () => void; tone?: 'default' | 'danger'; trailing?: ReactNode;
}) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label} disabled={!onPress} onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {icon ? <Icon name={icon} size={20} color={tone === 'danger' ? colors.danger : colors.textMuted} /> : null}
      <Text style={[type.body as TextStyle, { color, flex: 1 }]} numberOfLines={1}>{label}</Text>
      {detail ? <Txt variant="small" tone="muted" numberOfLines={1}>{detail}</Txt> : null}
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  button: {
    minHeight: 48, borderRadius: radius.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: space.sm,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 30, borderRadius: radius.sm, borderWidth: 1,
  },
  section: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: 6, minHeight: 50 },
  fold: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, minHeight: 48, marginTop: space.md },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xxl, minHeight: 240 },
  emptyWithArt: { paddingVertical: space.xl },
  emptyArt: { marginBottom: space.xs },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: {
    flex: 1, minHeight: 32, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: space.md,
  },
  sheet: {
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.sm, flexShrink: 1,
  },
  handleArea: { paddingTop: 2 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
});
