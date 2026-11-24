import { memo, useMemo } from 'react';

import { useTheme } from '@/theme';

import { ArtView } from './ArtView';
import { ART_H, ART_W, ILLUSTRATIONS, type IllustrationName } from './illustrations';
import { type Art, artPalette } from './scene';

export interface IllustrationProps {
  /** Width in logical px; height follows at 3:4. Default 160 (160×120). */
  size?: number;
}

/** The art palette for the current theme and accent, rebuilt only when the colours change. */
export function useArtPalette() {
  const { colors } = useTheme();
  return useMemo(() => artPalette(colors), [colors]);
}

function make(name: IllustrationName) {
  const art: Art = ILLUSTRATIONS[name];
  const Component = memo(function Illustration({ size = ART_W }: IllustrationProps) {
    const palette = useArtPalette();
    return <ArtView art={art} palette={palette} width={size} height={(size * ART_H) / ART_W} />;
  });
  Component.displayName = name;
  return Component;
}

/** Nothing left to do today: a mug of tea under a warm crescent moon. */
export const EmptyToday = make('EmptyToday');
/** A list with no tasks yet: a blank checklist card with an accent add button. */
export const EmptyList = make('EmptyList');
/** A clear calendar ahead: a month card with only today marked and a warm sun behind it. */
export const EmptyUpcoming = make('EmptyUpcoming');
/** No habits yet: a sprout in a pot beside a smaller seedling. */
export const EmptyHabits = make('EmptyHabits');
/** No focus sessions yet: a calm stopwatch with its first quarter filled. */
export const EmptyFocus = make('EmptyFocus');
/** No search results: a magnifier over an empty card. */
export const EmptySearch = make('EmptySearch');
/** Nothing completed yet: a ribbon badge with a dashed rim, still to be earned. */
export const EmptyDone = make('EmptyDone');
/** Could not load / offline: a cloud whose signal is crossed out. */
export const OfflineArt = make('OfflineArt');
/** Everything done today: an accent check medal in a burst of confetti. */
export const AllDoneArt = make('AllDoneArt');
