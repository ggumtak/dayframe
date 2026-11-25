import { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ArtView } from './ArtView.tsx';
import { BACKDROP_ASPECT, BACKDROP_H, BACKDROPS, type BackdropVariant } from './backdrop.ts';
import { useArtPalette } from './Illustrations.tsx';

export interface DayBackdropProps {
  /** Which sky to draw; pick it with backdropFor(new Date().getHours()). */
  variant: BackdropVariant;
  /** Band height in logical px. Default 120. It always spans the full width of its parent. */
  height?: number;
  /** Extra style for the absolutely positioned wrapper (e.g. `top`). */
  style?: StyleProp<ViewStyle>;
}

/**
 * A soft sky-and-hills band to place behind a screen header: render it first inside the header's container.
 * It is absolutely positioned at the top, ignores touches, and fades into `colors.background` at its bottom.
 */
export const DayBackdrop = memo(function DayBackdrop({ variant, height = BACKDROP_H, style }: DayBackdropProps) {
  const palette = useArtPalette();
  return (
    <View pointerEvents="none" style={[styles.wrap, { height }, style]}>
      <ArtView art={BACKDROPS[variant]} palette={palette} width="100%" height={height} preserveAspectRatio={BACKDROP_ASPECT} />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
});
