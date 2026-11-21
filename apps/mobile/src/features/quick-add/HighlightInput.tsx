import { type Ref, useState } from 'react';
import {
  Platform, StyleSheet, Text, TextInput, type TextInputInstance, type TextInputProps, type TextLayoutEvent, View,
} from 'react-native';

import type { TaskToken } from '@/lib/shared';
import { fontFamily, useTheme } from '@/theme';

import { firstLine, type Line, lineStarts, type PillKind, pills, runs } from './pills';

const LINE_HEIGHT = 28;
/** How far a pill reaches past its text. It must stay inside one space, or it touches the next word. */
const OVERHANG = 3;
/** The reach toward a neighbouring pill, so the two never overlap in the space between them. */
const JOINED = 1;
/** Zero-width and not a space, so a run that ends in spaces keeps their width when measured. */
const HOLD = '\u2060';

export type PillPalette = Record<PillKind, { background: string; foreground: string }>;

/**
 * A text field that turns recognized tokens into pills as you type.
 *
 * Three layers share the same text metrics. The bottom one draws the text, the middle one draws the
 * pills, and the real input sits on top with transparent glyphs, so the keyboard's composition
 * (Korean in particular) is never disturbed and the caret stays visible over a pill.
 */
export function HighlightInput({ value, tokens, palette, ref, ...props }: Omit<TextInputProps, 'style'> & {
  value: string; tokens: TaskToken[]; palette: PillPalette; ref?: Ref<TextInputInstance>;
}) {
  const { colors } = useTheme();
  const [lines, setLines] = useState<Line[]>(firstLine);

  // Where each wrapped line starts. Between a keystroke and its layout the previous starts still hold,
  // because typing only ever lengthens the last line.
  const onTextLayout = (event: TextLayoutEvent) => {
    const next = lineStarts(value, event.nativeEvent.lines);
    if (next) setLines((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  };

  const all = pills(value, tokens);
  const visible = lines.filter((line, index) => index === 0 || line.start < value.length);

  return (
    <View>
      <Text
        style={[styles.text, styles.layer, { color: colors.text }]} textBreakStrategy="simple" onTextLayout={onTextLayout}
        accessible={false} importantForAccessibility="no" aria-hidden>
        {value}
      </Text>
      {all.length > 0 ? visible.map((line, index) => (
        <View key={index} pointerEvents="none" style={[styles.row, { top: line.top, left: line.left }]}>
          {runs(value, line.start, visible[index + 1]?.start ?? value.length, all).map((part, position) => (part.kind ? (
            <View
              key={position}
              style={[styles.pill, { backgroundColor: palette[part.kind].background }, part.joinsBefore && styles.joinsBefore, part.joinsAfter && styles.joinsAfter]}>
              <Text style={[styles.text, { color: palette[part.kind].foreground }]} aria-hidden>{part.text + HOLD}</Text>
            </View>
          ) : <Text key={position} style={[styles.text, styles.spacer]} aria-hidden>{part.text + HOLD}</Text>))}
        </View>
      )) : null}
      <TextInput
        ref={ref} value={value} multiline submitBehavior="submit" returnKeyType="done" autoCapitalize="none" autoCorrect={false}
        placeholderTextColor={colors.textFaint} selectionColor={colors.accentSoft} cursorColor={colors.text}
        underlineColorAndroid="transparent" {...props}
        style={[styles.text, styles.input, Platform.select({ web: { caretColor: colors.text } as object, default: {} })]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Every layer must share every metric, or the caret drifts away from the glyphs.
  text: {
    fontFamily, fontSize: 17, lineHeight: LINE_HEIGHT, letterSpacing: 0, padding: 0, margin: 0, includeFontPadding: false,
    textAlignVertical: 'top', fontWeight: '400', flexShrink: 0,
  },
  layer: { position: 'absolute', left: 0, right: 0, top: 0 },
  row: { position: 'absolute', flexDirection: 'row', height: LINE_HEIGHT },
  spacer: { color: 'transparent' },
  pill: { borderRadius: 9, marginHorizontal: -OVERHANG, paddingHorizontal: OVERHANG, marginVertical: 1, height: LINE_HEIGHT - 2, justifyContent: 'center' },
  joinsBefore: { marginLeft: -JOINED, paddingLeft: JOINED },
  joinsAfter: { marginRight: -JOINED, paddingRight: JOINED },
  input: {
    // Keeps the input above the drawn layers on the web, where positioned elements paint last.
    position: 'relative', zIndex: 1, minHeight: LINE_HEIGHT, maxHeight: LINE_HEIGHT * 5, color: 'transparent',
    backgroundColor: 'transparent', borderWidth: 0,
    ...Platform.select({ web: { outlineStyle: 'none' } as object, default: {} }),
  },
});
