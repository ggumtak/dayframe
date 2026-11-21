import { type ReactNode, useEffect } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { elevation, useTheme } from '@/theme';

interface Drag {
  /** Index being dragged, or -1 when idle. */
  active: SharedValue<number>;
  /** Slot the dragged row would land in if released now. */
  target: SharedValue<number>;
  offset: SharedValue<number>;
  heights: SharedValue<number[]>;
}

function SortableRow({ index, count, drag, enabled, onDrop, onHold, children }: {
  index: number; count: number; drag: Drag; enabled: boolean; onDrop: (from: number, to: number) => void;
  /** A long press released without moving: the row is not dragged, so it can offer a menu instead. */
  onHold?: () => void; children: ReactNode;
}) {
  const { colors } = useTheme();
  const { active, target, offset, heights } = drag;

  const slotFor = (translation: number) => {
    // Walk outward from the row's own slot, crossing a neighbour once past its midpoint.
    const sizes = heights.get();
    let slot = index;
    let travelled = 0;
    if (translation > 0) {
      while (slot < count - 1 && translation > travelled + (sizes[slot + 1] ?? 0) / 2) travelled += sizes[++slot] ?? 0;
    } else {
      while (slot > 0 && -translation > travelled + (sizes[slot - 1] ?? 0) / 2) travelled += sizes[--slot] ?? 0;
    }
    return slot;
  };

  /** How far the dragged row travels to rest in `slot`. */
  const settle = (slot: number) => {
    const sizes = heights.get();
    let distance = 0;
    for (let i = index + 1; i <= slot; i++) distance += sizes[i] ?? 0;
    for (let i = slot; i < index; i++) distance -= sizes[i] ?? 0;
    return distance;
  };

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activateAfterLongPress(280)
    .runOnJS(true)
    .onStart(() => {
      haptic.medium();
      offset.set(0);
      target.set(index);
      active.set(index);
    })
    .onUpdate((event) => {
      if (active.get() !== index) return;
      offset.set(event.translationY);
      const slot = slotFor(event.translationY);
      if (slot !== target.get()) {
        haptic.tap();
        target.set(slot);
      }
    })
    .onEnd((event) => {
      if (active.get() !== index) return;
      if (onHold && Math.abs(event.translationY) < 8 && Math.abs(event.translationX) < 8) {
        offset.set(withTiming(0, { duration: 120 }));
        active.set(-1);
        onHold();
        return;
      }
      const slot = target.get();
      offset.set(withTiming(settle(slot), { duration: 140 }));
      // Commit after the row has slid into its slot, so the list re-renders in place.
      setTimeout(() => onDrop(index, slot), 150);
    })
    .onFinalize((_event, success) => {
      if (!success && active.get() === index) {
        offset.set(withTiming(0, { duration: 140 }));
        active.set(-1);
      }
    });

  const style = useAnimatedStyle(() => {
    const dragging = active.value;
    if (dragging === index) {
      return { transform: [{ translateY: offset.value }, { scale: withSpring(1.02) }], zIndex: 10, opacity: 0.97 };
    }
    let shift = 0;
    if (dragging !== -1) {
      const size = heights.value[dragging] ?? 0;
      if (dragging < index && index <= target.value) shift = -size;
      else if (target.value <= index && index < dragging) shift = size;
    }
    return {
      transform: [{ translateY: dragging === -1 ? 0 : withTiming(shift, { duration: 160 }) }, { scale: 1 }],
      zIndex: 0, opacity: 1,
    };
  });

  const raised = { backgroundColor: colors.surface, borderRadius: 12, ...elevation(colors, 2) };
  const lifted = useAnimatedStyle(() => (active.value === index
    ? raised
    : { backgroundColor: 'transparent', borderRadius: 0, shadowOpacity: 0, elevation: 0 }));

  const measure = (event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    if (heights.get()[index] === height) return;
    const next = heights.get().slice();
    next[index] = height;
    heights.set(next);
  };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View onLayout={measure} style={[style, lifted]}>{children}</Animated.View>
    </GestureDetector>
  );
}

/** A vertical list whose rows can be picked up with a long press and dropped in a new order. */
export function SortableList<T>({ items, keyOf, renderItem, onReorder, onHold, enabled = true }: {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onReorder: (items: T[], moved: T) => void;
  /** Long press and release in place; long press and move still drags. */
  onHold?: (item: T) => void;
  enabled?: boolean;
}) {
  const active = useSharedValue(-1);
  const target = useSharedValue(-1);
  const offset = useSharedValue(0);
  const heights = useSharedValue<number[]>([]);
  const drag: Drag = { active, target, offset, heights };
  const order = items.map(keyOf).join('|');

  useEffect(() => {
    // Rows now sit in their new slots; clear the transforms that got them there.
    active.set(-1);
    offset.set(0);
  }, [order, active, offset]);

  const drop = (from: number, to: number) => {
    if (from === to || !items[from]) {
      active.set(-1);
      offset.set(0);
      return;
    }
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next, moved);
  };

  return (
    <View>
      {items.map((item, index) => (
        <SortableRow
          key={keyOf(item)} index={index} count={items.length} drag={drag} enabled={enabled} onDrop={drop}
          onHold={onHold ? () => onHold(item) : undefined}>
          {renderItem(item)}
        </SortableRow>
      ))}
    </View>
  );
}
