# Dayframe artwork

Original flat illustrations drawn in code with `react-native-svg`. Every colour comes from `useTheme()` at render time, so the
pieces follow light/dark mode and whichever accent the user picks. There is no text in the art; Korean copy stays in the screens.

```tsx
import { DayBackdrop, EmptyToday, backdropFor } from '@/components/art';

<EmptyToday size={160} />
<DayBackdrop variant={backdropFor(new Date().getHours())} />
```

## Empty-state illustrations

All take `size?: number` (width in logical px, default 160; height is `size × 0.75`). Decorative: hidden from screen readers.

| Component       | Depicts                                                   | Intended screen                       |
| --------------- | --------------------------------------------------------- | ------------------------------------- |
| `EmptyToday`    | Mug of tea under a warm crescent moon                     | 오늘, nothing left today               |
| `EmptyList`     | Blank checklist card with an accent add button            | A project / list with no tasks yet    |
| `EmptyUpcoming` | Month card with only today marked, a sun rising behind    | 다가오는 일정 with nothing scheduled    |
| `EmptyHabits`   | Sprout in a pot beside a small seedling                   | 습관 with no habits yet                 |
| `EmptyFocus`    | Stopwatch with its first quarter softly filled            | 집중 history with no sessions yet       |
| `EmptySearch`   | Magnifier over an empty card                              | Search with no results                |
| `EmptyDone`     | Ribbon badge with a dashed rim and faint check            | 완료 view with nothing completed yet    |
| `OfflineArt`    | Cloud whose signal is crossed out by a warm slash         | Could not load / offline              |
| `AllDoneArt`    | Accent check medal in a burst of confetti                 | Finished everything today             |

Shared language: 160×120 canvas, a soft `surfaceMuted` disc behind the subject, "paper" objects with a 2.5 outline, radius 8
(4 for small parts), the accent for the one thing that matters, and everything else in neutrals: since the calm colour
system (DESIGN.md) `artPalette()` draws the `accentSoft`/`accentMid` echoes and the `warm` touches in greys, so a piece adds
at most one hue to a screen. Screens use 120 px (`EMPTY_ART`). `DayBackdrop` is no longer shown on Today; it stays here, unused.

## `DayBackdrop`

Props: `variant: 'morning' | 'afternoon' | 'evening' | 'night'`, `height?: number` (default 120), `style?`.
A full-width, absolutely positioned band of sky and hills to render first inside a header container; it ignores touches and
fades into `colors.background` at its bottom. Colours are the background blended 6–30 % towards the accent or warm colour,
so header text in `colors.text` keeps ≥ 7:1 contrast on every part of it (checked in `art.test.ts` for every accent, both modes).
Drawn with `xMaxYMax slice` on a 480×120 canvas: from 320 to 480 px wide it crops on the left and never stretches; the
sun / moon stays on the right, away from the title.

`backdropFor(hour)` picks the variant: 5–10 morning, 11–16 afternoon, 17–19 evening, otherwise night.

## Files

- `scene.ts` – the drawing model (shapes with colour roles), the theme→art palette, and `svgNodes()`/`toSvgString()`.
- `illustrations.ts`, `backdrop.ts` – the geometry, as plain data.
- `ArtView.tsx` – maps `svgNodes()` onto react-native-svg elements. `Illustrations.tsx`, `DayBackdrop.tsx` – the components.
- `samples.ts` – sample themes and accents for previews and tests only.

## Previewing

`node scripts/art/render.mjs` renders contact sheets to `scripts/art/out/` (git-ignored) with Playwright. It imports the same
geometry files and draws them with `toSvgString()`, which serialises the same `svgNodes()` list `ArtView` renders, so the
PNGs show exactly what the app draws.
