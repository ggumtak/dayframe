import { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon, IconButton, Txt } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { radius, space, type, useTheme } from '@/theme';

import { HabitAvatar } from './HabitAvatar';
import { HABIT_COLORS, HABIT_EMOJIS, nextQuote, softTint } from './palette';

export interface HabitLook { emoji?: string; color?: string }

const EmojiCell = memo(function EmojiCell({ emoji, selected, tint, onPick }: {
  emoji: string; selected: boolean; tint: string; onPick: (emoji: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`아이콘 ${emoji}`} accessibilityState={{ selected }}
      onPress={() => onPick(emoji)}
      style={({ pressed }) => [styles.emoji, {
        backgroundColor: selected ? tint : 'transparent', borderColor: selected ? colors.border : 'transparent', opacity: pressed ? 0.6 : 1,
      }]}>
      <Text style={styles.emojiText} allowFontScaling={false}>{emoji}</Text>
    </Pressable>
  );
});

/**
 * Chooses how a habit looks: a live preview, the colour swatches and a grid of emoji. Picking the selected
 * emoji again clears it, so the avatar falls back to the name's first character.
 */
export function HabitLookPicker({ name, look, onChange }: { name: string; look: HabitLook; onChange: (look: HabitLook) => void }) {
  const { colors, isDark } = useTheme();
  const tint = look.color ? softTint(look.color, isDark) : colors.surfaceMuted;
  // The latest look and handler, read when a cell is tapped, so the memoised cells keep one stable callback
  // while the name is being typed.
  const latest = useRef({ look, onChange });
  useEffect(() => {
    latest.current = { look, onChange };
  });
  const pickEmoji = useCallback((emoji: string) => {
    haptic.tap();
    const current = latest.current.look;
    latest.current.onChange({ ...current, emoji: current.emoji === emoji ? undefined : emoji });
  }, []);
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <HabitAvatar name={name || '습관'} emoji={look.emoji} color={look.color} size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyStrong" numberOfLines={1}>{name.trim() || '습관 이름'}</Txt>
          <Txt variant="small" tone="muted">아이콘과 색을 골라 보세요</Txt>
        </View>
      </View>
      <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel="색">
        {HABIT_COLORS.map((color) => {
          const selected = look.color === color;
          return (
            <Pressable
              key={color} accessibilityRole="radio" accessibilityLabel={`색 ${HABIT_COLORS.indexOf(color) + 1}`} accessibilityState={{ selected }}
              hitSlop={4}
              onPress={() => {
                haptic.tap();
                onChange({ ...look, color: selected ? undefined : color });
              }}
              style={({ pressed }) => [styles.swatch, { backgroundColor: color, opacity: pressed ? 0.7 : 1, borderColor: selected ? colors.text : 'transparent' }]}>
              {selected ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.grid}>
        {HABIT_EMOJIS.map((emoji) => (
          <EmojiCell key={emoji} emoji={emoji} selected={look.emoji === emoji} tint={tint} onPick={pickEmoji} />
        ))}
      </View>
    </View>
  );
}

/** The 응원 문구 field: free text, with a button that offers the next suggestion. */
export function QuoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.quote, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <TextInput
        value={value} onChangeText={onChange} placeholder="나에게 건넬 한마디" placeholderTextColor={colors.textFaint}
        maxLength={40} accessibilityLabel="응원 문구" returnKeyType="done"
        style={[type.body, { flex: 1, color: colors.text, minHeight: 48 }]} />
      <IconButton
        name="refresh-cw" label="다른 문구 추천" size={18} color={colors.textMuted}
        onPress={() => {
          haptic.tap();
          onChange(nextQuote(value));
        }} />
    </View>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 4 },
  emoji: { width: '16.66%', maxWidth: 52, aspectRatio: 1, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 24, lineHeight: 30, textAlign: 'center' },
  quote: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingLeft: space.lg, paddingRight: space.xs },
});
