// Geometry of the empty-state illustrations. Every piece shares one language:
//   - a 160×120 canvas with a soft ground disc behind the subject (HALO),
//   - objects as flat "paper" shapes with a 2.5 outline in `line`, corner radius 8 (4 for small parts),
//   - the accent for the one thing that matters in the scene, accentMid/accentSoft for its echoes,
//   - a single warm touch (moon, sun, sparkle) from the theme's warning colour.
// Pure data, no React: see scene.ts.
import { arc, type Art, crescent, type Paint, polar, type Shape, sparkle, turnedRect } from './scene.ts';

export const ART_W = 160;
export const ART_H = 120;
const SW = 2.5;

const HALO: Shape = { k: 'circle', cx: 80, cy: 60, r: 46, fill: 'ground' };
const floor = (cx: number, rx: number): Shape => ({ k: 'ellipse', cx, cy: 103, rx, ry: 3.5, fill: 'faint' });

const art = (shapes: Shape[]): Art => ({ w: ART_W, h: ART_H, shapes });

/** Nothing left today: a mug of tea under a warm crescent moon. */
export const EMPTY_TODAY = art([
  HALO,
  floor(76, 34),
  { k: 'ellipse', cx: 74, cy: 98, rx: 30, ry: 5, fill: 'paper', stroke: 'line', sw: SW },
  { k: 'path', d: 'M92 66H96Q105 66 105 75Q105 84 96 84H92', stroke: 'accent', sw: 5 },
  { k: 'path', d: 'M54 60H94V84Q94 97 81 97H67Q54 97 54 84Z', fill: 'accent' },
  { k: 'rect', x: 54, y: 60, w: 40, h: 6, fill: 'accentMid' },
  { k: 'path', d: 'M54 76H94', stroke: 'onAccent', sw: 2, op: 0.45 },
  { k: 'path', d: 'M66 52Q61 46 66 40Q71 34 66 28', stroke: 'accentMid', sw: SW },
  { k: 'path', d: 'M79 52Q74 47 79 42Q84 37 79 32', stroke: 'accentMid', sw: SW },
  { k: 'path', d: crescent(118, 32, 11, 5, -4, 9), fill: 'warm' },
  { k: 'path', d: sparkle(130, 58, 4.5), fill: 'warm' },
  { k: 'path', d: sparkle(38, 40, 4), fill: 'accentMid' },
  { k: 'circle', cx: 44, cy: 70, r: 2, fill: 'line' },
]);

const listRow = (y: number, len: number): Shape[] => [
  { k: 'circle', cx: 60, cy: y, r: 5, stroke: 'line', sw: SW },
  { k: 'rect', x: 71, y: y - 3, w: len, h: 6, r: 3, fill: 'ground' },
];

/** No tasks yet: a blank checklist card with an accent "add" button. */
export const EMPTY_LIST = art([
  HALO,
  { k: 'rect', x: 46, y: 20, w: 68, h: 82, r: 8, fill: 'paper', stroke: 'line', sw: SW },
  { k: 'rect', x: 56, y: 31, w: 28, h: 6, r: 3, fill: 'accentMid' },
  ...listRow(52, 32),
  ...listRow(68, 26),
  ...listRow(84, 30),
  { k: 'circle', cx: 114, cy: 96, r: 13, fill: 'accent' },
  { k: 'path', d: 'M114 90V102M108 96H120', stroke: 'onAccent', sw: 3 },
  { k: 'path', d: sparkle(127, 34, 5), fill: 'warm' },
  { k: 'circle', cx: 34, cy: 58, r: 2, fill: 'line' },
]);

const calendarCells: Shape[] = [];
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 5; col++) {
    const today = row === 0 && col === 1;
    calendarCells.push({ k: 'rect', x: 52 + col * 12, y: 54 + row * 12, w: 7, h: 7, r: 2, fill: today ? 'accent' : 'ground' });
  }
}

/** A clear calendar ahead: a month card with only today marked, a warm sun rising behind it. */
export const EMPTY_UPCOMING = art([
  HALO,
  { k: 'circle', cx: 124, cy: 30, r: 9, fill: 'warm' },
  { k: 'circle', cx: 124, cy: 30, r: 14, stroke: 'warm', sw: 2, dash: '2.5 5.3', op: 0.7 },
  { k: 'rect', x: 42, y: 30, w: 76, h: 70, r: 8, fill: 'paper', stroke: 'line', sw: SW },
  { k: 'path', d: 'M42 38Q42 30 50 30H110Q118 30 118 38V44H42Z', fill: 'accent' },
  { k: 'rect', x: 42, y: 30, w: 76, h: 70, r: 8, stroke: 'line', sw: SW },
  { k: 'rect', x: 57, y: 23, w: 5, h: 13, r: 2.5, fill: 'paper', stroke: 'line', sw: 2 },
  { k: 'rect', x: 98, y: 23, w: 5, h: 13, r: 2.5, fill: 'paper', stroke: 'line', sw: 2 },
  ...calendarCells,
  { k: 'path', d: sparkle(34, 52, 4.5), fill: 'accentMid' },
  { k: 'circle', cx: 132, cy: 66, r: 2, fill: 'line' },
]);

const SEED: Paint = ['accentMid', 'accent', 0.35];

/** No habits yet: a sprout in a pot, with small steps leading up to it. */
export const EMPTY_HABITS = art([
  HALO,
  floor(80, 30),
  { k: 'path', d: 'M80 76C80 64 80 54 80 42', stroke: 'accent', sw: 3 },
  { k: 'path', d: 'M80 64C70 64 61 58 58 48C69 47 77 53 80 64Z', fill: 'accentMid' },
  { k: 'path', d: 'M80 54C90 54 99 47 101 36C90 36 82 42 80 54Z', fill: 'accent' },
  { k: 'circle', cx: 80, cy: 40, r: 3.5, fill: 'warm' },
  { k: 'path', d: 'M65 82H95L91.5 99Q91 102 88 102H72Q69 102 68.5 99Z', fill: 'paper', stroke: 'line', sw: SW },
  { k: 'rect', x: 61, y: 74, w: 38, h: 9, r: 3, fill: 'accent' },
  floor(48, 10),
  { k: 'path', d: 'M48 102V92', stroke: SEED, sw: 2.5 },
  { k: 'path', d: 'M48 96C43 96 40 93 39 89C44 89 47 91 48 96Z', fill: SEED },
  { k: 'path', d: 'M48 94C53 94 56 91 57 86C52 86 49 89 48 94Z', fill: SEED },
  { k: 'path', d: sparkle(122, 40, 5), fill: 'warm' },
  { k: 'circle', cx: 116, cy: 78, r: 2, fill: 'line' },
]);

const FOCUS_C: [number, number] = [80, 64];
const tick = (deg: number): Shape => {
  const [x1, y1] = polar(FOCUS_C[0], FOCUS_C[1], 25, deg);
  const [x2, y2] = polar(FOCUS_C[0], FOCUS_C[1], 21, deg);
  return { k: 'line', x1, y1, x2, y2, stroke: 'line', sw: SW };
};
const [handX, handY] = polar(FOCUS_C[0], FOCUS_C[1], 16, 90);

/** No focus sessions yet: a calm stopwatch with its first quarter softly filled. */
export const EMPTY_FOCUS = art([
  HALO,
  { k: 'rect', x: 74, y: 23, w: 12, h: 7, r: 3, fill: 'line' },
  { k: 'rect', x: 78, y: 28, w: 4, h: 6, fill: 'line' },
  { k: 'path', d: turnedRect(103, 40, 5, 9, 45), fill: 'line' },
  { k: 'circle', cx: 80, cy: 64, r: 31, fill: 'paper', stroke: 'line', sw: SW },
  { k: 'path', d: `M80 64L80 39${arc(80, 64, 25, 0, 90).replace(/^M[^A]+/, '')}Z`, fill: ['accentSoft', 'accent', 0.22] },
  tick(0), tick(90), tick(180), tick(270),
  { k: 'line', x1: 80, y1: 64, x2: handX, y2: handY, stroke: 'accent', sw: 3 },
  { k: 'line', x1: 80, y1: 64, x2: 80, y2: 47, stroke: 'accent', sw: 3 },
  { k: 'circle', cx: 80, cy: 64, r: 4, fill: 'accent' },
  { k: 'path', d: sparkle(38, 46, 3.5), fill: 'accentMid' },
  { k: 'path', d: sparkle(124, 30, 5), fill: 'warm' },
  { k: 'circle', cx: 124, cy: 92, r: 2, fill: 'line' },
]);

/** No results: a magnifier over an empty card. */
export const EMPTY_SEARCH = art([
  HALO,
  { k: 'rect', x: 36, y: 32, w: 60, h: 44, r: 8, fill: 'paper', stroke: 'line', sw: SW },
  { k: 'rect', x: 46, y: 43, w: 30, h: 6, r: 3, fill: 'ground' },
  { k: 'rect', x: 46, y: 56, w: 20, h: 6, r: 3, fill: 'ground' },
  { k: 'line', x1: 111, y1: 82, x2: 124, y2: 96, stroke: 'accent', sw: 9 },
  { k: 'circle', cx: 98, cy: 68, r: 19, fill: 'paper', stroke: 'accent', sw: 5 },
  { k: 'path', d: arc(98, 68, 12, 285, 345), stroke: 'accentSoft', sw: 3 },
  { k: 'path', d: sparkle(126, 36, 5), fill: 'warm' },
  { k: 'circle', cx: 40, cy: 94, r: 2, fill: 'line' },
  { k: 'circle', cx: 52, cy: 100, r: 1.6, fill: 'line' },
]);

/** Nothing completed yet: a ribbon badge still waiting to be earned (dashed rim, faint check). */
export const EMPTY_DONE = art([
  HALO,
  { k: 'path', d: 'M70 74L60 100L69 96L74 104L82 80Z', fill: 'accentMid' },
  { k: 'path', d: 'M90 74L100 100L91 96L86 104L78 80Z', fill: ['accentMid', 'accent', 0.35] },
  { k: 'circle', cx: 80, cy: 56, r: 26, fill: 'paper', stroke: 'line', sw: SW, dash: '6 5' },
  { k: 'circle', cx: 80, cy: 56, r: 17, fill: 'ground' },
  { k: 'path', d: 'M72 56L78 62L89 50', stroke: 'line', sw: 3.5 },
  { k: 'path', d: sparkle(120, 30, 5), fill: 'warm' },
  { k: 'path', d: sparkle(38, 44, 3.5), fill: 'accentMid' },
  { k: 'circle', cx: 124, cy: 76, r: 2, fill: 'line' },
]);

/** Could not load: a cloud whose signal is crossed out by a warm slash. */
export const OFFLINE = art([
  HALO,
  { k: 'path', d: 'M50 90H110A15 15 0 0 0 113 60.5A21 21 0 0 0 75 47A17 17 0 0 0 49 62A14 14 0 0 0 50 90Z', fill: 'paper', stroke: 'line', sw: SW },
  { k: 'circle', cx: 80, cy: 81, r: 3.5, fill: 'accent' },
  { k: 'path', d: arc(80, 81, 10, 312, 408), stroke: 'accent', sw: 3.5 },
  { k: 'path', d: arc(80, 81, 18, 315, 405), stroke: 'accentMid', sw: 3.5 },
  { k: 'line', x1: 70, y1: 55, x2: 100, y2: 83, stroke: 'paper', sw: 9 },
  { k: 'line', x1: 70, y1: 55, x2: 100, y2: 83, stroke: 'warm', sw: 3.5 },
  { k: 'circle', cx: 40, cy: 100, r: 2, fill: 'line' },
  { k: 'circle', cx: 124, cy: 98, r: 2.5, fill: 'faint' },
  { k: 'path', d: sparkle(128, 34, 4), fill: 'accentMid' },
]);

const confetti = (cx: number, cy: number, deg: number, fill: Shape['fill']): Shape => ({ k: 'path', d: turnedRect(cx, cy, 9, 4, deg), fill });

/** Everything done today: an accent check medal in a burst of confetti. */
export const ALL_DONE = art([
  HALO,
  { k: 'circle', cx: 80, cy: 60, r: 34, stroke: 'accentSoft', sw: 3 },
  { k: 'circle', cx: 80, cy: 60, r: 26, fill: 'accent' },
  { k: 'path', d: 'M68 60L77 69L93 52', stroke: 'onAccent', sw: 5 },
  confetti(40, 32, 30, 'warm'),
  confetti(124, 26, -25, 'accentMid'),
  confetti(132, 76, 40, 'accent'),
  confetti(30, 82, -35, 'accentMid'),
  confetti(108, 104, 15, 'warm'),
  confetti(56, 106, -60, 'accentSoft'),
  { k: 'circle', cx: 58, cy: 18, r: 2.5, fill: 'accent' },
  { k: 'circle', cx: 104, cy: 14, r: 2, fill: 'warm' },
  { k: 'circle', cx: 138, cy: 50, r: 2, fill: 'line' },
  { k: 'circle', cx: 24, cy: 56, r: 2, fill: 'line' },
  { k: 'path', d: sparkle(124, 48, 5.5), fill: 'warm' },
  { k: 'path', d: sparkle(36, 56, 4.5), fill: 'accent' },
]);

export const ILLUSTRATIONS = {
  EmptyToday: EMPTY_TODAY,
  EmptyList: EMPTY_LIST,
  EmptyUpcoming: EMPTY_UPCOMING,
  EmptyHabits: EMPTY_HABITS,
  EmptyFocus: EMPTY_FOCUS,
  EmptySearch: EMPTY_SEARCH,
  EmptyDone: EMPTY_DONE,
  OfflineArt: OFFLINE,
  AllDoneArt: ALL_DONE,
} as const;
export type IllustrationName = keyof typeof ILLUSTRATIONS;
