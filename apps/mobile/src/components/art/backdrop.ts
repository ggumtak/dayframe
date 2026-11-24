// Geometry of DayBackdrop: a wide, short sky-and-hills band that sits behind a screen header.
// Every colour is the screen background blended a little towards the accent or the warm colour, so header
// text in `colors.text` keeps its contrast (backdrop.test.ts checks it for every accent in both modes).
// The canvas is 480×120 and is drawn with `xMaxYMax slice`: narrower screens crop the left side, never
// stretch it, and the sun/moon stays on the right, away from the title. Pure data, no React: see scene.ts.
import { type Art, crescent, type Paint, type Shape, sparkle } from './scene.ts';

export type BackdropVariant = 'morning' | 'afternoon' | 'evening' | 'night';
export const BACKDROP_VARIANTS: readonly BackdropVariant[] = ['morning', 'afternoon', 'evening', 'night'];

export const BACKDROP_W = 480;
export const BACKDROP_H = 120;
export const BACKDROP_ASPECT = 'xMaxYMax slice';

/** Which backdrop fits a local hour (0–23; other numbers wrap): 5–10 morning, 11–16 afternoon, 17–19 evening, else night. */
export function backdropFor(hour: number): BackdropVariant {
  const h = Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 12;
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'afternoon';
  if (h >= 17 && h < 20) return 'evening';
  return 'night';
}

const tint = (tone: 'accent' | 'warm', t: number): Paint => ['bg', tone, t];

const FAR_HILL = 'M0 90C70 76 150 74 230 84S380 70 480 78V120H0Z';
const NEAR_HILL = 'M0 104C90 92 170 96 250 101S400 88 480 94V120H0Z';

const cloud = (x: number, y: number, w: number, paint: Paint): Shape[] => [
  { k: 'rect', x, y, w, h: 12, r: 6, fill: paint },
  { k: 'circle', cx: x + w * 0.42, cy: y + 2, r: 9, fill: paint },
];

interface Mood { sky: Paint; horizon: Paint; far: Paint; near: Paint; extra: Shape[] }

const MOODS: Record<BackdropVariant, Mood> = {
  morning: {
    sky: tint('accent', 0.06),
    horizon: tint('warm', 0.1),
    far: tint('accent', 0.07),
    near: tint('accent', 0.11),
    extra: [
      { k: 'circle', cx: 396, cy: 74, r: 30, fill: tint('warm', 0.12) },
      { k: 'circle', cx: 396, cy: 74, r: 18, fill: tint('warm', 0.24) },
      ...cloud(300, 40, 44, 'glow'),
    ],
  },
  afternoon: {
    sky: tint('accent', 0.11),
    horizon: tint('accent', 0.05),
    far: tint('accent', 0.09),
    near: tint('accent', 0.14),
    extra: [
      { k: 'circle', cx: 410, cy: 34, r: 26, fill: tint('warm', 0.13) },
      { k: 'circle', cx: 410, cy: 34, r: 15, fill: tint('warm', 0.26) },
      ...cloud(318, 48, 50, 'glow'),
      ...cloud(436, 64, 36, 'glow'),
    ],
  },
  evening: {
    sky: tint('accent', 0.1),
    horizon: tint('warm', 0.17),
    far: tint('accent', 0.1),
    near: tint('accent', 0.16),
    extra: [
      { k: 'circle', cx: 392, cy: 90, r: 40, fill: tint('warm', 0.12) },
      { k: 'circle', cx: 392, cy: 90, r: 24, fill: tint('warm', 0.24) },
      { k: 'rect', x: 270, y: 52, w: 70, h: 4, r: 2, fill: tint('warm', 0.22) },
      { k: 'rect', x: 300, y: 62, w: 46, h: 4, r: 2, fill: tint('warm', 0.2) },
    ],
  },
  night: {
    sky: tint('accent', 0.15),
    horizon: tint('accent', 0.08),
    far: tint('accent', 0.12),
    near: tint('accent', 0.19),
    extra: [
      { k: 'path', d: crescent(404, 40, 15, 7, -5, 13), fill: tint('warm', 0.3) },
      { k: 'path', d: sparkle(330, 30, 4), fill: tint('warm', 0.26) },
      { k: 'path', d: sparkle(450, 70, 3.5), fill: tint('accent', 0.32) },
      { k: 'circle', cx: 290, cy: 52, r: 1.6, fill: tint('accent', 0.34) },
      { k: 'circle', cx: 362, cy: 62, r: 1.4, fill: tint('accent', 0.34) },
      { k: 'circle', cx: 446, cy: 24, r: 1.6, fill: tint('warm', 0.3) },
      { k: 'circle', cx: 236, cy: 30, r: 1.4, fill: tint('accent', 0.28) },
    ],
  },
};

function build(variant: BackdropVariant): Art {
  const m = MOODS[variant];
  return {
    w: BACKDROP_W,
    h: BACKDROP_H,
    gradients: [
      { id: `dfSky-${variant}`, stops: [{ offset: 0, paint: m.sky }, { offset: 0.62, paint: m.horizon }, { offset: 1, paint: 'bg' }] },
      { id: `dfFade-${variant}`, stops: [{ offset: 0.55, paint: 'bg', opacity: 0 }, { offset: 1, paint: 'bg', opacity: 1 }] },
    ],
    shapes: [
      { k: 'rect', x: 0, y: 0, w: BACKDROP_W, h: BACKDROP_H, grad: `dfSky-${variant}` },
      ...m.extra,
      { k: 'path', d: FAR_HILL, fill: m.far },
      { k: 'path', d: NEAR_HILL, fill: m.near },
      { k: 'rect', x: 0, y: 0, w: BACKDROP_W, h: BACKDROP_H, grad: `dfFade-${variant}` },
    ],
  };
}

export const BACKDROPS: Record<BackdropVariant, Art> = {
  morning: build('morning'),
  afternoon: build('afternoon'),
  evening: build('evening'),
  night: build('night'),
};

/** Every paint a backdrop uses (for the contrast test). */
export function backdropPaints(variant: BackdropVariant): Paint[] {
  const art = BACKDROPS[variant];
  const paints: Paint[] = [];
  for (const s of art.shapes) if (s.fill) paints.push(s.fill);
  for (const g of art.gradients ?? []) for (const st of g.stops) paints.push(st.paint);
  return paints;
}
