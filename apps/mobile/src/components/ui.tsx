import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, type PressableProps, type StyleProp, StyleSheet, Text, type TextProps, type TextStyle,
  View, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/lib/haptics';
import { elevation, radius, space, type, useTheme } from '@/theme';

export type IconName = ComponentProps<typeof Feather>['name'];

type Variant = keyof typeof type;
type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'danger' | 'success' | 'onAccent';

export function Txt({ variant = 'body', tone = 'default', style, ...props }: TextProps & { variant?: Variant; tone?: Tone }) {
  const { colors } = useTheme();
  const color = {
    default: colors.text, muted: colors.textMuted, faint: colors.textFaint, accent: colors.accent,
    danger: colors.danger, success: colors.success, onAccent: colors.onAccent,
  }[tone];
  return <Text {...props} style={[type[variant] as TextStyle, { color }, style]} />;
}

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Feather name={name} size={size} color={color ?? colors.text} />;
}

/** The page frame: themed background with the status bar inset applied. */
export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return <View style={[{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }, style]}>{children}</View>;
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

export function Button({ label, onPress, kind = 'primary', icon, loading, disabled, style, ...props }: Omit<PressableProps, 'style'> & {
  label: string; kind?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName; loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const palette = {
    primary: { background: colors.accent, foreground: colors.onAccent },
    secondary: { background: colors.surfaceMuted, foreground: colors.text },
    ghost: { background: 'transparent', foreground: colors.accent },
    danger: { background: colors.dangerSoft, foreground: colors.danger },
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
        : icon ? <Icon name={icon} size={18} color={palette.foreground} /> : null}
      <Text style={[type.bodyStrong as TextStyle, { color: palette.foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, icon, selected, color, onPress, style }: {
  label: string; icon?: IconName; selected?: boolean; color?: string; onPress?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const foreground = selected ? colors.accent : color ?? colors.textMuted;
  const content = (
    <>
      {icon ? <Icon name={icon} size={13} color={foreground} /> : null}
      <Text style={[type.smallStrong as TextStyle, { color: foreground }]} numberOfLines={1}>{label}</Text>
    </>
  );
  const base = [styles.chip, { backgroundColor: selected ? colors.accentSoft : 'transparent', borderColor: selected ? colors.accentSoft : colors.border }, style];
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

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      {children}
    </View>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.accentSoft }]}>
        <Icon name={icon} size={26} color={colors.accent} />
      </View>
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

/** A bottom sheet for choices that need no keyboard. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel="닫기" style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + space.lg }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          {title ? <Txt variant="heading" style={{ marginBottom: space.md }}>{title}</Txt> : null}
          {children}
        </View>
      </KeyboardAvoidingView>
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
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xxl, minHeight: 240 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: {
    flex: 1, minHeight: 32, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: space.md,
  },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.sm },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
});
