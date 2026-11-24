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
 * Uses a single `<Text>` render pass with nested `<Text>` spans underneath a transparent `<TextInput>`
 * when tokens exist on single-paragraph text; automatically falls back to a standard visible `<TextInput>`
 * for plain text or multi-line pastes so long checklists scroll cleanly without overlay drift.
 */
export function HighlightInput({ value, tokens, palette, disableHighlight, ref, ...props }: Omit<TextInputProps, 'style'> & {
  value: string; tokens: TaskToken[]; palette: PillPalette; disableHighlight?: boolean; ref?: Ref<TextInputInstance>;
}) {
  const { colors } = useTheme();
  const useOverlay = !disableHighlight && tokens.length > 0 && !value.includes('\n');
  const parts = useOverlay ? segments(value, pills(value, tokens)) : [];

  return (
    <View>
      {useOverlay ? (
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
      ) : null}
      <TextInput
        ref={ref} value={value} multiline submitBehavior="submit" returnKeyType="done" autoCapitalize="none" autoCorrect={false}
        placeholderTextColor={colors.textFaint} selectionColor={colors.accentSoft} cursorColor={colors.text}
        // The drawn highlight layer only works in place: never hand the text to Android's full-screen landscape editor.
        underlineColorAndroid="transparent" disableFullscreenUI {...props}
        style={[
          styles.text,
          styles.input,
          { color: useOverlay ? 'transparent' : colors.text },
          Platform.select({ web: { caretColor: colors.text } as object, default: {} }),
        ]} />
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
    position: 'relative', zIndex: 1, minHeight: LINE_HEIGHT, maxHeight: LINE_HEIGHT * 5,
    backgroundColor: 'transparent', borderWidth: 0,
    ...Platform.select({ web: { outlineStyle: 'none' } as object, default: {} }),
  },
});
