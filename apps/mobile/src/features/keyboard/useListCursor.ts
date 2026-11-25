import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useKeyboard } from './manager';
import { moveCursor, nextCursorAfterRemoval } from './normalize';

export interface ScrollableRef {
  scrollTo?: (opts: { y: number; animated?: boolean }) => void;
}

export interface UseListCursorOptions {
  enabled?: boolean;
  scrollRef?: RefObject<ScrollableRef | null>;
  estimatedRowHeight?: number;
  headerOffset?: number;
}

export interface ListCursor<T> {
  focusedId: string | null;
  focusedIndex: number;
  focusedItem: T | null;
  isFocused: (id: string) => boolean;
  move: (delta: number) => T | null;
  moveNext: () => T | null;
  movePrev: () => T | null;
  moveFirst: () => T | null;
  moveLast: () => T | null;
  focusIndex: (index: number) => T | null;
  setFocusedId: (id: string | null) => void;
  clear: () => void;
}

interface CursorState {
  id: string | null;
  lastIndex: number;
}

const DEFAULT_ROW_HEIGHT = 56;

export function useListCursor<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  options?: UseListCursorOptions,
): ListCursor<T> {
  const { keyboardMode } = useKeyboard();
  const enabled = options?.enabled !== false;
  const active = keyboardMode && enabled;
  const scrollRef = options?.scrollRef;
  const estimatedRowHeight = options?.estimatedRowHeight ?? DEFAULT_ROW_HEIGHT;
  const headerOffset = options?.headerOffset ?? 0;

  const ids = useMemo(() => items.map(keyOf), [items, keyOf]);
  const [cursor, setCursor] = useState<CursorState>({ id: null, lastIndex: -1 });

  let resolvedId = cursor.id;
  let resolvedIndex = resolvedId !== null ? ids.indexOf(resolvedId) : -1;
  let nextLastIndex = cursor.lastIndex;

  if (active && cursor.id !== null) {
    if (resolvedIndex >= 0) {
      nextLastIndex = resolvedIndex;
    } else {
      resolvedId = nextCursorAfterRemoval(ids, cursor.id, cursor.lastIndex);
      resolvedIndex = resolvedId !== null ? ids.indexOf(resolvedId) : -1;
      nextLastIndex = resolvedIndex;
    }

    if (resolvedId !== cursor.id || nextLastIndex !== cursor.lastIndex) {
      setCursor({ id: resolvedId, lastIndex: nextLastIndex });
    }
  }

  const focusedId = active ? resolvedId : null;
  const focusedIndex = active ? resolvedIndex : -1;
  const focusedItem = active && focusedIndex >= 0 ? (items[focusedIndex] ?? null) : null;

  const stateRef = useRef({
    items,
    ids,
    enabled,
    focusedIndex,
    scrollRef,
    estimatedRowHeight,
    headerOffset,
  });

  useEffect(() => {
    stateRef.current = {
      items,
      ids,
      enabled,
      focusedIndex,
      scrollRef,
      estimatedRowHeight,
      headerOffset,
    };
  });

  const scrollToIndex = useCallback((index: number) => {
    const {
      scrollRef: targetScrollRef,
      estimatedRowHeight: rowHeight,
      headerOffset: offset,
    } = stateRef.current;
    const scroller = targetScrollRef?.current;
    if (!scroller?.scrollTo) return;
    const y = index <= 0 ? 0 : Math.max(0, offset + index * rowHeight - rowHeight * 2);
    scroller.scrollTo({ y, animated: true });
  }, []);

  const focusIndex = useCallback(
    (index: number): T | null => {
      const { items: list, ids: listIds, enabled: isEnabled } = stateRef.current;
      if (!isEnabled || list.length === 0) return null;
      const clamped = Math.min(list.length - 1, Math.max(0, index));
      const nextId = listIds[clamped];
      stateRef.current.focusedIndex = clamped;
      setCursor({ id: nextId, lastIndex: clamped });
      scrollToIndex(clamped);
      return list[clamped] ?? null;
    },
    [scrollToIndex],
  );

  const move = useCallback(
    (delta: number): T | null => {
      const {
        items: list,
        ids: listIds,
        enabled: isEnabled,
        focusedIndex: current,
      } = stateRef.current;
      if (!isEnabled || list.length === 0) return null;
      const nextIndex = moveCursor(current, delta, list.length);
      if (nextIndex < 0) return null;
      const nextId = listIds[nextIndex];
      stateRef.current.focusedIndex = nextIndex;
      setCursor({ id: nextId, lastIndex: nextIndex });
      scrollToIndex(nextIndex);
      return list[nextIndex] ?? null;
    },
    [scrollToIndex],
  );

  const moveNext = useCallback(() => move(1), [move]);
  const movePrev = useCallback(() => move(-1), [move]);
  const moveFirst = useCallback(() => focusIndex(0), [focusIndex]);
  const moveLast = useCallback(
    () => focusIndex(stateRef.current.items.length - 1),
    [focusIndex],
  );

  const setFocusedId = useCallback(
    (id: string | null) => {
      if (id === null) {
        stateRef.current.focusedIndex = -1;
        setCursor({ id: null, lastIndex: -1 });
        return;
      }
      const nextIndex = stateRef.current.ids.indexOf(id);
      stateRef.current.focusedIndex = nextIndex;
      setCursor({ id, lastIndex: nextIndex });
      if (nextIndex >= 0) {
        scrollToIndex(nextIndex);
      }
    },
    [scrollToIndex],
  );

  const clear = useCallback(() => {
    stateRef.current.focusedIndex = -1;
    setCursor({ id: null, lastIndex: -1 });
  }, []);

  const isFocused = useCallback(
    (id: string) => focusedId !== null && focusedId === id,
    [focusedId],
  );

  return useMemo<ListCursor<T>>(
    () => ({
      focusedId,
      focusedIndex,
      focusedItem,
      isFocused,
      move,
      moveNext,
      movePrev,
      moveFirst,
      moveLast,
      focusIndex,
      setFocusedId,
      clear,
    }),
    [
      clear,
      focusIndex,
      focusedId,
      focusedIndex,
      focusedItem,
      isFocused,
      move,
      moveFirst,
      moveLast,
      moveNext,
      movePrev,
      setFocusedId,
    ],
  );
}
