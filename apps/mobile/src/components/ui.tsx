import Feather from '@expo/vector-icons/Feather';
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, type PressableProps, type StyleProp, StyleSheet, Text, type TextProps, type TextStyle,
  View, type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, useAnimatedStyle, useDerivedValue, useSharedValue, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyHandler } from '@/features/keyboard/manager';
import { matchesCombo } from '@/features/keyboard/normalize';
import { KEY_PRIORITY } from '@/features/keyboard/types';
import { haptic } from '@/lib/haptics';
import { useLayout } from '@/lib/layoutContext';
import { elevation, radius, space, SPRING_GENTLE, TIMING_FAST, TIMING_SHEET, type, useMotion, useTheme } from '@/theme';

export type IconName = ComponentProps<typeof Feather>['name'];

type Variant = keyof typeof type;
type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'danger' | 'onAccent';

const SEGMENT_PAD = 3;
const CHIP_HIT_SLOP = { top: 6, bottom: 6, left: 2, right: 2 } as const;
const SKELETON_TITLE_WIDTHS = ['68%', '54%', '76%', '62%', '48%', '70%'] as const;
const SKELETON_META_WIDTHS = ['34%', '26%', '40%', '30%', '24%', '36%'] as const;
const DEFAULT_SHEET_HEIGHT = 360;

export function Txt({ variant = 'body', tone = 'default', tabular, style, ...props }: TextProps & {
  variant?: Variant; tone?: Tone; tabular?: boolean;
}) {
  const { colors } = useTheme();
  const color = {
    default: colors.text, muted: colors.textMuted, faint: colors.textFaint, accent: colors.accentText,
    danger: colors.danger, onAccent: colors.onAccent,
  }[tone];
  return <Text {...props} style={[type[variant] as TextStyle, { color }, tabular && styles.tabular, style]} />;
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
  const { colors } = useTheme();
  const { reduced } = useMotion();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        style,
        pressed && { backgroundColor: colors.surfaceMuted, opacity: 0.9 },
        pressed && !reduced && styles.pressScaleSm,
      ]}>
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

/**
 * Buttons by weight. `primary` is the one filled accent button a screen may have (DESIGN.md); every other action is
 * `secondary` (neutral fill), `ghost` (no fill, accent label) or `danger` (neutral fill, red label).
 */
export function Button({ label, onPress, kind = 'primary', icon, leading, loading, disabled, style, ...props }: Omit<PressableProps, 'style'> & {
  label: string; kind?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName; leading?: ReactNode; loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  const palette = {
    primary: { background: colors.accent, pressedBackground: colors.accent, foreground: colors.onAccent, icon: colors.onAccent },
    secondary: { background: colors.surfaceMuted, pressedBackground: colors.border, foreground: colors.text, icon: colors.textMuted },
    ghost: { background: 'transparent', pressedBackground: colors.surfaceMuted, foreground: colors.accentText, icon: colors.accentText },
    danger: { background: colors.surfaceMuted, pressedBackground: colors.border, foreground: colors.danger, icon: colors.danger },
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
        styles.button,
        {
          backgroundColor: !inactive && pressed ? palette.pressedBackground : palette.background,
          opacity: inactive ? 0.5 : kind === 'primary' && pressed ? 0.9 : 1,
        },
        !inactive && pressed && !reduced && styles.pressScale,
        style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={palette.foreground} />
        : leading ?? (icon ? <Icon name={icon} size={18} color={palette.icon} /> : null)}
      <Text style={[type.bodyStrong as TextStyle, { color: palette.foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, icon, selected, tone, color, onPress, style, accessibilityLabel }: {
  label: string; icon?: IconName; selected?: boolean;
  /** Screen-reader label when the visible word alone is too short ("이번 주" → "이번 주 할 일만 보기"). */
  accessibilityLabel?: string;
  /** `set`: the chip shows a value (a date, a tag) in full-strength text; `danger`: that value is overdue. */
  tone?: 'set' | 'danger';
  color?: string; onPress?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
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
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected: !!selected }}
      hitSlop={CHIP_HIT_SLOP}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [
        ...base,
        pressed && { backgroundColor: selected ? colors.accentSoft : colors.surfaceMuted, opacity: selected ? 0.88 : 1 },
        pressed && !reduced && styles.pressScaleSm,
      ]}>
      {content}
    </Pressable>
  );
}

export function SectionTitle({ title, count, action, tone }: { title: string; count?: number; action?: ReactNode; tone?: Tone }) {
  return (
    <View style={styles.section}>
      <Txt variant="section" tone={tone} accessibilityRole="header">{title}</Txt>
      {count ? <Txt variant="small" tone="faint" tabular>{count}</Txt> : null}
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
  const { reduced } = useMotion();
  const turn = useDerivedValue(() => withTiming(open ? 1 : 0, { duration: reduced ? 0 : 180 }));
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
      {count ? <Txt variant="small" tone="faint" tabular>{count}</Txt> : null}
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

/** Hairline divider for stacked rows inside cards and sheets. */
export function Divider({ inset = 0, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border, marginLeft: inset }, style]} />;
}

/** Quiet monochrome placeholder rows matching TaskRow proportions during loading states. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  const pulse = useSharedValue(reduced ? 0.72 : 1);

  useEffect(() => {
    if (reduced) {
      pulse.set(0.72);
      return;
    }
    pulse.set(
      withRepeat(
        withSequence(withTiming(0.42, { duration: 750 }), withTiming(1, { duration: 750 })),
        -1,
        false,
      ),
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [reduced, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View accessibilityRole="progressbar" accessibilityLabel="불러오는 중" style={styles.skeletonList}>
      {Array.from({ length: rows }, (_, index) => {
        const titleWidth = SKELETON_TITLE_WIDTHS[index % SKELETON_TITLE_WIDTHS.length];
        const metaWidth = SKELETON_META_WIDTHS[index % SKELETON_META_WIDTHS.length];
        return (
          <Animated.View key={index} style={[styles.skeletonRow, pulseStyle]}>
            <View style={[styles.skeletonCheck, { backgroundColor: colors.surfaceMuted }]} />
            <View style={[styles.skeletonBody, { borderBottomColor: colors.border }]}>
              <View style={[styles.skeletonTitle, { width: titleWidth, backgroundColor: colors.surfaceMuted }]} />
              <View style={[styles.skeletonMeta, { width: metaWidth, backgroundColor: colors.surfaceMuted }]} />
            </View>
          </Animated.View>
        );
      })}
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
  const { colors, isDark } = useTheme();
  const { reduced, tabSpring } = useMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const count = Math.max(1, options.length);
  const segmentWidth = trackWidth > SEGMENT_PAD * 2 ? (trackWidth - SEGMENT_PAD * 2) / count : 0;
  const thumbX = useSharedValue(0);
  const hasMeasured = useRef(false);
  const prevWidth = useRef(0);

  useEffect(() => {
    if (segmentWidth <= 0) return;
    const target = activeIndex * segmentWidth;
    if (!hasMeasured.current || prevWidth.current !== segmentWidth || reduced) {
      thumbX.set(target);
      hasMeasured.current = true;
      prevWidth.current = segmentWidth;
    } else {
      thumbX.set(withSpring(target, tabSpring));
    }
  }, [activeIndex, segmentWidth, reduced, tabSpring, thumbX]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  const thumbDecoration = [
    { backgroundColor: colors.surface },
    isDark ? { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border } : null,
    elevation(colors),
  ];

  return (
    <View
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next > 0 && Math.abs(next - trackWidth) > 0.5) setTrackWidth(next);
      }}
      style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}
      accessibilityRole="tablist">
      {segmentWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.segmentThumb, { width: segmentWidth }, ...thumbDecoration, thumbStyle]}
        />
      ) : null}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value} accessibilityRole="tab" accessibilityLabel={option.label} accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) haptic.tap();
              onChange(option.value);
            }}
            style={[styles.segment, segmentWidth === 0 && active && thumbDecoration]}>
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
  const { colors, isDark } = useTheme();
  const { reduced, sheetDuration } = useMotion();
  const insets = useSafeAreaInsets();
  const { sheet } = useLayout();
  const [rendered, setRendered] = useState(visible);
  const sheetHeightRef = useRef(DEFAULT_SHEET_HEIGHT);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedByDrag = useSharedValue(false);
  const backdropOpacity = useSharedValue(visible && reduced ? 1 : 0);
  const translateY = useSharedValue(visible && reduced ? 0 : DEFAULT_SHEET_HEIGHT);

  if (visible && !rendered) setRendered(true);
  if (!visible && rendered && sheetDuration === 0) setRendered(false);

  useEffect(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (visible) {
      dismissedByDrag.set(false);
      backdropOpacity.set(reduced ? 1 : withTiming(1, TIMING_FAST));
      translateY.set(reduced ? 0 : withTiming(0, TIMING_SHEET));
      return;
    }
    const distance = Math.max(sheetHeightRef.current, DEFAULT_SHEET_HEIGHT);
    if (!rendered || sheetDuration === 0) {
      backdropOpacity.set(0);
      translateY.set(distance);
      return;
    }
    backdropOpacity.set(withTiming(0, { duration: sheetDuration }));
    translateY.set(withTiming(distance, { duration: sheetDuration }));
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setRendered(false);
    }, sheetDuration);
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, [visible, rendered, reduced, sheetDuration, backdropOpacity, translateY, dismissedByDrag]);

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
    .onBegin(() => {
      dismissedByDrag.set(false);
    })
    .onUpdate((event) => {
      translateY.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      if (event.translationY > 72 || event.velocityY > 650) {
        dismissedByDrag.set(true);
        haptic.tap();
        onClose();
      } else {
        translateY.set(reduced ? 0 : withSpring(0, SPRING_GENTLE));
      }
    })
    .onFinalize(() => {
      if (!dismissedByDrag.get()) {
        translateY.set(reduced ? 0 : withSpring(0, SPRING_GENTLE));
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const sheetMotion = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Modal visible={rendered} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }} pointerEvents={visible ? 'auto' : 'none'}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable accessibilityLabel="닫기" style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} />
          </Animated.View>
          <Animated.View
            onLayout={(event) => {
              const h = event.nativeEvent.layout.height;
              if (h > 0) sheetHeightRef.current = h;
            }}
            style={[
              styles.sheet,
              { backgroundColor: colors.surfaceElevated, paddingBottom: insets.bottom + space.lg, maxHeight: sheet.maxHeight },
              isDark && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
              sheet.maxWidth === undefined ? null : { maxWidth: sheet.maxWidth, width: '100%', alignSelf: 'center' },
              sheetMotion,
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
export function Row({ icon, leading, label, detail, onPress, tone = 'default', trailing }: {
  icon?: IconName; leading?: ReactNode; label: string; detail?: string; onPress?: () => void; tone?: 'default' | 'danger'; trailing?: ReactNode;
}) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label} disabled={!onPress} onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}>
      {leading ?? (icon ? <Icon name={icon} size={20} color={tone === 'danger' ? colors.danger : colors.textMuted} /> : null)}
      <Text style={[type.body as TextStyle, { color, flex: 1 }]} numberOfLines={1}>{label}</Text>
      {detail ? <Txt variant="small" tone="muted" numberOfLines={1}>{detail}</Txt> : null}
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1, width: '100%', alignSelf: 'center' },
  tabular: { fontVariant: ['tabular-nums'] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pressScale: { transform: [{ scale: 0.97 }] },
  pressScaleSm: { transform: [{ scale: 0.95 }] },
  button: {
    minHeight: 48, borderRadius: radius.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: space.sm,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 34, borderRadius: radius.sm, borderWidth: 1,
  },
  section: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: 6, minHeight: 50 },
  fold: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, minHeight: 48, marginTop: space.md },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  divider: { height: StyleSheet.hairlineWidth },
  skeletonList: { paddingTop: space.xs },
  skeletonRow: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: space.lg },
  skeletonCheck: { width: 22, height: 22, borderRadius: 11, marginTop: 12, marginRight: space.md },
  skeletonBody: { flex: 1, gap: 8, paddingVertical: 13, paddingRight: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 46 },
  skeletonTitle: { height: 15, borderRadius: 6 },
  skeletonMeta: { height: 11, borderRadius: 5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xxl, minHeight: 240 },
  emptyWithArt: { paddingVertical: space.xl },
  emptyArt: { marginBottom: space.xs },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: SEGMENT_PAD, position: 'relative' },
  segmentThumb: { position: 'absolute', left: SEGMENT_PAD, top: SEGMENT_PAD, bottom: SEGMENT_PAD, borderRadius: radius.sm },
  segment: {
    flex: 1, minHeight: 36, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: space.md,
  },
  sheet: {
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.sm, flexShrink: 1,
  },
  handleArea: { paddingTop: 2 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
});
