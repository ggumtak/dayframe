import type { Ref } from 'react';
import { Platform, StyleSheet, Text, TextInput, type TextInputInstance, type TextInputProps, View } from 'react-native';

import type { TaskToken, TaskTokenKind } from '@/lib/shared';
import { useTheme } from '@/theme';

export type TokenTints = Record<TaskTokenKind, string>;

interface Segment { text: string; kind?: TaskTokenKind }

function segment(text: string, tokens: TaskToken[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start < cursor || token.end > text.length) continue;
    if (token.start > cursor) segments.push({ text: text.slice(cursor, token.start) });
    segments.push({ text: text.slice(token.start, token.end), kind: token.kind });
    cursor = token.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

/**
 * A text field that tints recognized tokens as you type. The tint is drawn on a mirror of the text
 * placed behind an ordinary input, so the keyboard's composition (Korean in particular) is never disturbed.
 */
export function HighlightInput({ value, tokens, tints, ref, ...props }: Omit<TextInputProps, 'style'> & {
  value: string; tokens: TaskToken[]; tints: TokenTints; ref?: Ref<TextInputInstance>;
}) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[styles.text, styles.mirror]} accessible={false} importantForAccessibility="no" aria-hidden>
        {segment(value, tokens).map((part, index) => (
          <Text key={index} style={part.kind ? { backgroundColor: tints[part.kind], borderRadius: 4 } : undefined}>{part.text}</Text>
        ))}
      </Text>
      <TextInput
        ref={ref} value={value} multiline submitBehavior="submit" returnKeyType="done" autoCapitalize="none" autoCorrect={false}
        placeholderTextColor={colors.textFaint} selectionColor={colors.accent} cursorColor={colors.accent}
        underlineColorAndroid="transparent" {...props}
        style={[styles.text, styles.input, { color: colors.text }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Both layers must share every metric, or the tint drifts away from the glyphs.
  text: {
    fontSize: 17, lineHeight: 24, letterSpacing: 0, padding: 0, margin: 0, includeFontPadding: false,
    textAlignVertical: 'top', fontWeight: '400',
  },
  mirror: { position: 'absolute', left: 0, right: 0, top: 0, color: 'transparent' },
  input: {
    // Keeps the typed text above the tint layer on the web, where positioned elements paint last.
    position: 'relative', zIndex: 1, minHeight: 24, maxHeight: 120, backgroundColor: 'transparent', borderWidth: 0,
    ...Platform.select({ web: { outlineStyle: 'none' } as object, default: {} }),
  },
});
