import { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { IconButton, Txt } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { radius, space, type, useTheme } from '@/theme';

import { HabitAvatar } from './HabitAvatar';
import { HABIT_EMOJIS, nextQuote } from './palette';

export interface HabitLook { emoji?: string; color?: string }

const EmojiCell = memo(function EmojiCell({ emoji, selected, onPick }: {
  emoji: string; selected: boolean; onPick: (emoji: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`아이콘 ${emoji}`} accessibilityState={{ selected }}
      onPress={() => onPick(emoji)}
      style={({ pressed }) => [styles.emoji, {
        backgroundColor: selected ? colors.accentSoft : 'transparent', borderColor: selected ? colors.accent : 'transparent', opacity: pressed ? 0.6 : 1,
      }]}>
      <Text style={styles.emojiText} allowFontScaling={false}>{emoji}</Text>
    </Pressable>
  );
});

/**
 * Chooses how a habit looks: a live preview and a grid of emoji. Picking the selected emoji again clears it, so the
 * avatar falls back to the name's first character. Habit colours are no longer offered or drawn (a stored colour
 * stays in `look.color` and is passed back untouched), because in habit grids colour already means "done".
 */
export function HabitLookPicker({ name, look, onChange }: { name: string; look: HabitLook; onChange: (look: HabitLook) => void }) {
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
        <HabitAvatar name={name || '습관'} emoji={look.emoji} size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyStrong" numberOfLines={1}>{name.trim() || '습관 이름'}</Txt>
          <Txt variant="small" tone="muted">아이콘을 골라 보세요</Txt>
        </View>
      </View>
      <View style={styles.grid}>
        {HABIT_EMOJIS.map((emoji) => (
          <EmojiCell key={emoji} emoji={emoji} selected={look.emoji === emoji} onPick={pickEmoji} />
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 4 },
  emoji: { width: '16.66%', maxWidth: 52, aspectRatio: 1, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 24, lineHeight: 30, textAlign: 'center' },
  quote: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingLeft: space.lg, paddingRight: space.xs },
});
