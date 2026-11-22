import { type Ref } from 'react';
import {
  Platform, StyleSheet, Text, TextInput, type TextInputInstance, type TextInputProps, View,
} from 'react-native';

import type { TaskToken } from '@/lib/shared';
import { fontFamily, useTheme } from '@/theme';

import { type PillKind, pills, segments } from './pills';

const LINE_HEIGHT = 28;

export type PillPalette = Record<PillKind, { background: string; foreground: string }>;

/**
 * A text field that highlights recognized schedule, project, tag and priority tokens as you type.
 *
 * Uses a single `<Text>` render pass with nested `<Text>` spans underneath a transparent `<TextInput>`,
 * so every glyph is drawn exactly once with native kerning and wrapping (no double-drawn shadow/ghosting
 * on Android) while keeping Korean IME composition undisturbed.
 */
export function HighlightInput({ value, tokens, palette, ref, ...props }: Omit<TextInputProps, 'style'> & {
  value: string; tokens: TaskToken[]; palette: PillPalette; ref?: Ref<TextInputInstance>;
}) {
  const { colors } = useTheme();
  const parts = segments(value, pills(value, tokens));

  return (
    <View>
      <Text
        style={[styles.text, styles.layer, { color: colors.text }]}
        accessible={false} importantForAccessibility="no" aria-hidden>
        {parts.map((part, index) => (part.kind ? (
          <Text
            key={index}
            style={{ backgroundColor: palette[part.kind].background, color: palette[part.kind].foreground }}>
            {part.text}
          </Text>
        ) : (
          <Text key={index}>{part.text}</Text>
        )))}
      </Text>
      <TextInput
        ref={ref} value={value} multiline submitBehavior="submit" returnKeyType="done" autoCapitalize="none" autoCorrect={false}
        placeholderTextColor={colors.textFaint} selectionColor={colors.accentSoft} cursorColor={colors.text}
        underlineColorAndroid="transparent" {...props}
        style={[styles.text, styles.input, Platform.select({ web: { caretColor: colors.text } as object, default: {} })]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Both layers share identical typography metrics so the caret always aligns with the glyphs.
  text: {
    fontFamily, fontSize: 17, lineHeight: LINE_HEIGHT, letterSpacing: 0, padding: 0, margin: 0, includeFontPadding: false,
    textAlignVertical: 'top', fontWeight: '400',
  },
  layer: { position: 'absolute', left: 0, right: 0, top: 0 },
  input: {
    // Keeps the input above the drawn text on the web, where positioned elements paint last.
    position: 'relative', zIndex: 1, minHeight: LINE_HEIGHT, maxHeight: LINE_HEIGHT * 5, color: 'transparent',
    backgroundColor: 'transparent', borderWidth: 0,
    ...Platform.select({ web: { outlineStyle: 'none' } as object, default: {} }),
  },
});
