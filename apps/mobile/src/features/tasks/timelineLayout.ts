/**
 * Pure layout math for the horizontal 60-minute-per-row Timeline grid.
 *
 * Each hour (0..23) is a horizontal row spanning 00..60 minutes from left to right.
 * Any task or focus interval is sliced strictly into the exact minute span(s) it occupies
 * within each hour row, so e.g. 12:10–12:40 occupies 16.67%–66.67% of the 12시 row.
 */

export interface HourSlice {
  hour: number;
  startInHour: number;
  endInHour: number;
  leftPct: number;
  widthPct: number;
  isFirst: boolean;
  isLast: boolean;
}

export interface TrackedItem<T> {
  item: T;
  track: number;
  trackCount: number;
}

export const BASE_HOUR_HEIGHT = 56;
export const EXTRA_TRACK_HEIGHT = 36;
export const FOCUS_STRIP_HEIGHT = 20;
export const MIN_SLICE_MINUTES = 5;

/** Splits an interval `[startMinutes, startMinutes + durationMinutes)` into exact per-hour horizontal slices. */
export function sliceIntervalByHour(
  startMinutes: number,
  durationMinutes: number,
  minVisualMinutes = MIN_SLICE_MINUTES,
): HourSlice[] {
  if (!Number.isFinite(startMinutes) || !Number.isFinite(durationMinutes)) return [];
  const clampedStart = Math.max(0, Math.min(1439, Math.floor(startMinutes)));
  const effectiveDuration = Math.max(minVisualMinutes, durationMinutes);
  const clampedEnd = Math.min(1440, Math.max(clampedStart + 1, clampedStart + effectiveDuration));

  const firstHour = Math.floor(clampedStart / 60);
  const lastHour = Math.floor((clampedEnd - 1) / 60);
  const slices: HourSlice[] = [];

  for (let hour = firstHour; hour <= lastHour; hour++) {
    const startInHour = Math.max(0, clampedStart - hour * 60);
    const endInHour = Math.min(60, clampedEnd - hour * 60);
    if (endInHour <= startInHour) continue;
    slices.push({
      hour,
      startInHour,
      endInHour,
      leftPct: (startInHour / 60) * 100,
      widthPct: ((endInHour - startInHour) / 60) * 100,
      isFirst: hour === firstHour,
      isLast: hour === lastHour,
    });
  }
  return slices;
}

/** Assigns non-overlapping vertical track indices within a single hour row without changing horizontal bounds. */
export function assignRowTracks<T extends { startInHour: number; endInHour: number }>(
  items: T[],
): TrackedItem<T>[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort(
    (a, b) => a.startInHour - b.startInHour || (b.endInHour - b.startInHour) - (a.endInHour - a.startInHour),
  );
  const trackEnds: number[] = [];
  const assigned: { item: T; track: number }[] = [];

  for (const item of sorted) {
    let track = trackEnds.findIndex((end) => end <= item.startInHour);
    if (track === -1) {
      track = trackEnds.length;
      trackEnds.push(item.endInHour);
    } else {
      trackEnds[track] = item.endInHour;
    }
    assigned.push({ item, track });
  }

  const trackCount = Math.max(1, trackEnds.length);
  return assigned.map(({ item, track }) => ({ item, track, trackCount }));
}

/** Computes the height of an hour row given its vertical task tracks and whether it contains focus bars. */
export function hourRowHeight(taskTrackCount: number, hasFocusTrack: boolean): number {
  const extraTracks = Math.max(0, taskTrackCount - 1);
  const focusExtra = hasFocusTrack && taskTrackCount > 0 ? FOCUS_STRIP_HEIGHT + 4 : 0;
  return BASE_HOUR_HEIGHT + extraTracks * EXTRA_TRACK_HEIGHT + focusExtra;
}

/** Computes cumulative Y offsets for each visible hour row. */
export function computeHourOffsets(
  visibleHours: number[],
  heightsByHour: Map<number, number>,
): { offsets: Map<number, number>; totalHeight: number } {
  const offsets = new Map<number, number>();
  let y = 0;
  for (const hour of visibleHours) {
    offsets.set(hour, y);
    y += heightsByHour.get(hour) ?? BASE_HOUR_HEIGHT;
  }
  return { offsets, totalHeight: y };
}

/** Converts a 2D drag (horizontal = minutes within hour, vertical = hours) into a snapped minute-of-day. */
export function snapMinutesFromDrag(
  startMinutes: number,
  deltaX: number,
  deltaY: number,
  laneWidth: number,
  rowHeight: number,
  snapMinutes = 10,
  minMinutes = 0,
): number {
  const safeLane = Math.max(60, laneWidth);
  const safeRow = Math.max(30, rowHeight);
  const hourDelta = Math.round(deltaY / safeRow);
  const minuteDelta = (deltaX / safeLane) * 60;
  const raw = startMinutes + hourDelta * 60 + minuteDelta;
  const snapped = Math.round(raw / snapMinutes) * snapMinutes;
  return Math.max(minMinutes, Math.min(24 * 60 - snapMinutes, snapped));
}
