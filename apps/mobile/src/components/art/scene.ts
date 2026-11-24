// The drawing model every Dayframe illustration is written in. A piece is plain data (a list of shapes whose
// colours are named roles, never hex values), so the same geometry can be drawn two ways:
//   - by <ArtView> with react-native-svg inside the app, and
//   - by toSvgString() as a standalone SVG for scripts/art/render.mjs.
// Both go through svgNodes() below, which resolves roles to colours and builds every element's attributes,
// so the app and the preview cannot disagree about a single coordinate or colour.
//
// This file must stay free of React and React Native imports: node runs it directly (type stripping).

/** The theme colours the artwork reads. A structural subset of the app's `Colors`. */
export interface ArtColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  warning: string;
  warningSoft: string;
  onAccent: string;
}

/** The roles a shape can be painted with. */
export interface ArtPalette {
  bg: string;
  paper: string;
  ground: string;
  faint: string;
  line: string;
  accent: string;
  accentSoft: string;
  accentMid: string;
  warm: string;
  warmSoft: string;
  /** marks drawn on top of an accent fill (check, plus) */
  onAccent: string;
  /** a touch lighter than the sky behind a backdrop (clouds) */
  glow: string;
}
export type Tone = keyof ArtPalette;
/** A role, or a blend of two roles: [from, to, amount 0..1]. */
export type Paint = Tone | readonly [Tone, Tone, number];

interface Style {
  fill?: Paint;
  stroke?: Paint;
  sw?: number;
  /** stroke-dasharray, e.g. '4 5' */
  dash?: string;
  /** opacity of the whole shape */
  op?: number;
}
export type Shape =
  | (Style & { k: 'rect'; x: number; y: number; w: number; h: number; r?: number })
  | (Style & { k: 'circle'; cx: number; cy: number; r: number })
  | (Style & { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number })
  | (Style & { k: 'path'; d: string })
  | (Style & { k: 'line'; x1: number; y1: number; x2: number; y2: number });

export interface GradientStop { offset: number; paint: Paint; opacity?: number }
/** A top-to-bottom linear gradient, referenced from a shape's fill as `url(#id)` via `{ k: 'rect', grad: id }`. */
export interface Gradient { id: string; stops: readonly GradientStop[] }

export interface Art {
  w: number;
  h: number;
  shapes: readonly (Shape & { grad?: string })[];
  gradients?: readonly Gradient[];
}

// ---- colour maths ----------------------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const s = m[1].length === 3 ? m[1].split('').map((ch) => ch + ch).join('') : m[1];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Blends `a` towards `b` by `t` (0 = a, 1 = b). Non-hex input falls back to whichever side dominates. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return t < 0.5 ? a : b;
  return toHex(ca.map((v, i) => v + (cb[i] - v) * t));
}

function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function artPalette(c: ArtColors): ArtPalette {
  // On a dark theme `surface` is darker than `surfaceMuted`, so paper would read as a hole in the ground disc.
  // There the disc sinks towards the background and paper lifts towards the border instead.
  const dark = luminance(c.background) < 0.2;
  return {
    bg: c.background,
    paper: dark ? mix(c.surfaceMuted, c.border, 0.5) : c.surface,
    ground: dark ? mix(c.background, c.surfaceMuted, 0.7) : c.surfaceMuted,
    faint: c.border,
    line: mix(c.border, c.textFaint, 0.55),
    accent: c.accent,
    accentSoft: c.accentSoft,
    accentMid: mix(c.accentSoft, c.accent, 0.45),
    warm: c.warning,
    warmSoft: c.warningSoft,
    onAccent: c.onAccent,
    glow: dark ? mix(c.background, '#FFFFFF', 0.1) : c.background,
  };
}

export function resolvePaint(p: ArtPalette, paint: Paint): string {
  return typeof paint === 'string' ? p[paint as Tone] : mix(p[paint[0]], p[paint[1]], paint[2]);
}

// ---- one element list for both renderers -----------------------------------------------------------------

export type NodeTag = 'rect' | 'circle' | 'ellipse' | 'path' | 'line' | 'linearGradient' | 'stop';
/** One SVG element: tag, camelCase attributes (as react-native-svg takes them), and children. */
export interface SvgNode { tag: NodeTag; attrs: Record<string, string | number>; children?: SvgNode[] }

const r2 = (n: number) => Math.round(n * 100) / 100;

function styleAttrs(p: ArtPalette, s: Style & { grad?: string }): Record<string, string | number> {
  const a: Record<string, string | number> = {};
  a.fill = s.grad ? `url(#${s.grad})` : s.fill ? resolvePaint(p, s.fill) : 'none';
  if (s.stroke) {
    a.stroke = resolvePaint(p, s.stroke);
    a.strokeWidth = s.sw ?? 2.5;
    a.strokeLinecap = 'round';
    a.strokeLinejoin = 'round';
    if (s.dash) a.strokeDasharray = s.dash;
  }
  if (s.op !== undefined) a.opacity = s.op;
  return a;
}

/** The gradient definitions of a piece (they go inside <Defs>). */
export function defNodes(art: Art, p: ArtPalette): SvgNode[] {
  return (art.gradients ?? []).map((g) => ({
    tag: 'linearGradient',
    attrs: { id: g.id, x1: '0', y1: '0', x2: '0', y2: '1' },
    children: g.stops.map((s) => ({
      tag: 'stop' as const,
      attrs: { offset: String(s.offset), stopColor: resolvePaint(p, s.paint), stopOpacity: s.opacity ?? 1 },
    })),
  }));
}

/** The visible elements of a piece, in paint order. */
export function svgNodes(art: Art, p: ArtPalette): SvgNode[] {
  return art.shapes.map((s): SvgNode => {
    const style = styleAttrs(p, s);
    switch (s.k) {
      case 'rect':
        return { tag: 'rect', attrs: { x: s.x, y: s.y, width: s.w, height: s.h, rx: s.r ?? 0, ry: s.r ?? 0, ...style } };
      case 'circle':
        return { tag: 'circle', attrs: { cx: s.cx, cy: s.cy, r: s.r, ...style } };
      case 'ellipse':
        return { tag: 'ellipse', attrs: { cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry, ...style } };
      case 'line':
        return { tag: 'line', attrs: { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, ...style } };
      case 'path':
        return { tag: 'path', attrs: { d: s.d, ...style } };
    }
  });
}

/** Number of SVG elements a piece renders, root <Svg> and <Defs> included. */
export function nodeCount(art: Art): number {
  const grads = art.gradients ?? [];
  return 1 + art.shapes.length + (grads.length ? 1 + grads.reduce((n, g) => n + 1 + g.stops.length, 0) : 0);
}

const kebab = (k: string) => k.replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase());
const esc = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function nodeToString(n: SvgNode): string {
  const attrs = Object.entries(n.attrs).map(([k, v]) => `${kebab(k)}="${esc(v)}"`).join(' ');
  return n.children?.length ? `<${n.tag} ${attrs}>${n.children.map(nodeToString).join('')}</${n.tag}>` : `<${n.tag} ${attrs}/>`;
}

/** A standalone SVG document of a piece: the exact elements <ArtView> draws. */
export function toSvgString(art: Art, p: ArtPalette, opts: { width?: number; height?: number; preserveAspectRatio?: string } = {}): string {
  const defs = defNodes(art, p);
  const size = `width="${opts.width ?? art.w}" height="${opts.height ?? art.h}"`;
  const par = opts.preserveAspectRatio ? ` preserveAspectRatio="${opts.preserveAspectRatio}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${art.w} ${art.h}"${par}>`
    + (defs.length ? `<defs>${defs.map(nodeToString).join('')}</defs>` : '')
    + svgNodes(art, p).map(nodeToString).join('') + '</svg>';
}

// ---- geometry helpers used by the pieces (run once, at module load) --------------------------------------

/** A four-point sparkle centred on (cx, cy). */
export function sparkle(cx: number, cy: number, r: number): string {
  const k = r * 0.22;
  return `M${r2(cx)} ${r2(cy - r)}Q${r2(cx + k)} ${r2(cy - k)} ${r2(cx + r)} ${r2(cy)}Q${r2(cx + k)} ${r2(cy + k)} ${r2(cx)} ${r2(cy + r)}`
    + `Q${r2(cx - k)} ${r2(cy + k)} ${r2(cx - r)} ${r2(cy)}Q${r2(cx - k)} ${r2(cy - k)} ${r2(cx)} ${r2(cy - r)}Z`;
}

/** A w×h rectangle with rounded-looking ends, centred on (cx, cy) and turned by `deg`, as a path. */
export function turnedRect(cx: number, cy: number, w: number, h: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  const pt = (x: number, y: number) => `${r2(cx + x * Math.cos(a) - y * Math.sin(a))} ${r2(cy + x * Math.sin(a) + y * Math.cos(a))}`;
  return `M${pt(-w / 2, -h / 2)}L${pt(w / 2, -h / 2)}L${pt(w / 2, h / 2)}L${pt(-w / 2, h / 2)}Z`;
}

/** A crescent: the disc (cx, cy, r) minus the disc shifted by (dx, dy) with radius r2. */
export function crescent(cx: number, cy: number, r: number, dx: number, dy: number, rCut: number): string {
  const d = Math.hypot(dx, dy);
  const a = (d * d + r * r - rCut * rCut) / (2 * d);
  const h = Math.sqrt(Math.max(0, r * r - a * a));
  const ux = dx / d;
  const uy = dy / d;
  const mx = cx + ux * a;
  const my = cy + uy * a;
  const p1 = [mx - uy * h, my + ux * h];
  const p2 = [mx + uy * h, my - ux * h];
  return `M${r2(p1[0])} ${r2(p1[1])}A${r} ${r} 0 1 1 ${r2(p2[0])} ${r2(p2[1])}A${rCut} ${rCut} 0 0 0 ${r2(p1[0])} ${r2(p1[1])}Z`;
}

/** A point on a circle, angle in degrees clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))];
}

/** A circular arc from `from` to `to` degrees (clockwise from 12 o'clock). */
export function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M${x1} ${y1}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}
