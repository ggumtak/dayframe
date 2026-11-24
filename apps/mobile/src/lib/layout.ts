/**
 * Window size classes and the few measurements screens take from them. Pure, so it is tested without React and
 * worked out once per window change (`LayoutProvider` in `src/lib/layoutContext.tsx`).
 *
 * Phones (compact) get exactly the measurements they had before tablets were supported: full-width content,
 * no column, no second pane.
 */

/** Width class breakpoints in dp, as Material's window size classes. */
export const MEDIUM_MIN = 600;
export const EXPANDED_MIN = 840;
/** A device whose shortest side reaches this rotates freely; anything smaller is a phone and stays portrait. */
export const TABLET_MIN_SIDE = 600;
/** Widest a reading column (lists, forms, details) grows. */
export const READING_MAX = 720;
/** Widest a bottom sheet grows. */
export const SHEET_MAX = 560;
/** Widest the two-pane Today frame grows (list + timeline). */
export const PANE_FRAME_MAX = 1200;
/** Space kept above a sheet so it never reaches the status bar. */
export const SHEET_TOP_GAP = 24;
/**
 * Below this window height (a landscape tablet) a tablet's focus timer puts the dial and its controls side by side:
 * stacked, they would push the start button to the bottom edge.
 */
export const SHORT_HEIGHT = 900;

export type WidthClass = 'compact' | 'medium' | 'expanded';

export interface TwoPaneFrame {
  /** Space left and right of the frame. */
  inset: number;
  /** The list pane, on the left. */
  listWidth: number;
  /** The side pane, on the right. */
  sideWidth: number;
}

export interface Layout {
  widthClass: WidthClass;
  landscape: boolean;
  /** The reading column: `width` is its width, `inset` the empty space either side of it (0 on phones). */
  column: { width: number; inset: number; maxWidth: number | undefined };
  /** Set only on an expanded landscape window: Today shows its list and the timeline side by side. */
  twoPane: TwoPaneFrame | null;
  /** Widest a sheet may be (`undefined` on phones: full width as before) and how tall it may grow. */
  sheet: { maxWidth: number | undefined; maxHeight: number };
  /** A tablet window shorter than `SHORT_HEIGHT` (landscape): the focus timer lays its dial and controls side by side. */
  short: boolean;
}

export function widthClassOf(width: number): WidthClass {
  if (width >= EXPANDED_MIN) return 'expanded';
  if (width >= MEDIUM_MIN) return 'medium';
  return 'compact';
}

/** Whether a screen of this size (dp) is a tablet: its shortest side is at least 600 dp. */
export function isTabletSize(width: number, height: number): boolean {
  return Math.min(width, height) >= TABLET_MIN_SIDE;
}

export function twoPaneFrame(width: number): TwoPaneFrame {
  const frame = Math.min(width, PANE_FRAME_MAX);
  const listWidth = Math.min(READING_MAX, Math.round(frame * 0.6));
  return { inset: Math.floor((width - frame) / 2), listWidth, sideWidth: frame - listWidth };
}

export function deriveLayout(width: number, height: number, topInset = 0): Layout {
  const widthClass = widthClassOf(width);
  const landscape = width > height;
  const compact = widthClass === 'compact';
  const columnWidth = compact ? width : Math.min(width, READING_MAX);
  return {
    widthClass,
    landscape,
    column: { width: columnWidth, inset: Math.floor((width - columnWidth) / 2), maxWidth: compact ? undefined : READING_MAX },
    twoPane: widthClass === 'expanded' && landscape ? twoPaneFrame(width) : null,
    sheet: { maxWidth: compact ? undefined : SHEET_MAX, maxHeight: Math.max(0, height - topInset - SHEET_TOP_GAP) },
    short: !compact && height < SHORT_HEIGHT,
  };
}

/**
 * How many equal cells of at least `minCell` dp fit across `available` dp (gaps of `gap` between them), kept
 * between `min` and `max`.
 */
export function gridColumns(available: number, minCell: number, min: number, max: number, gap = 0): number {
  const fit = Math.floor((available + gap) / (minCell + gap));
  return Math.max(min, Math.min(max, fit));
}

/** Whether two layouts give screens the same measurements, so a window change that alters none of them re-renders nothing. */
export function sameLayout(a: Layout, b: Layout): boolean {
  return a.widthClass === b.widthClass && a.landscape === b.landscape && a.short === b.short
    && a.column.width === b.column.width && a.column.inset === b.column.inset
    && a.sheet.maxWidth === b.sheet.maxWidth && a.sheet.maxHeight === b.sheet.maxHeight
    && (a.twoPane === b.twoPane || (!!a.twoPane && !!b.twoPane && a.twoPane.inset === b.twoPane.inset
      && a.twoPane.listWidth === b.twoPane.listWidth && a.twoPane.sideWidth === b.twoPane.sideWidth));
}
