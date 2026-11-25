import { useMemo } from 'react';
import { Easing, useReducedMotion, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';

/** Crisp tactile spring for button/chip press, checkbox bounce, and sliding thumbs. */
export const SPRING_SNAPPY: WithSpringConfig = {
  damping: 18,
  stiffness: 340,
  mass: 0.85,
};

/** Calmer spring for sheets snapping back and larger surface transitions. */
export const SPRING_GENTLE: WithSpringConfig = {
  damping: 22,
  stiffness: 240,
  mass: 1,
};

/** Quick micro-transition (chevron turn, backdrop fade, press tint). */
export const TIMING_FAST: WithTimingConfig = {
  duration: 160,
  easing: Easing.out(Easing.cubic),
};

/** Sheet enter/exit transition. */
export const TIMING_SHEET: WithTimingConfig = {
  duration: 200,
  easing: Easing.out(Easing.cubic),
};

/** Zero-bounce instantaneous spring used when Reduce Motion is enabled. */
const SPRING_INSTANT: WithSpringConfig = {
  damping: 500,
  stiffness: 1000,
  mass: 0.5,
  overshootClamping: true,
};

export interface MotionConfig {
  reduced: boolean;
  pressSpring: WithSpringConfig;
  tabSpring: WithSpringConfig;
  sheetDuration: number;
}

/**
 * Motion preferences for interactive primitives: reads the OS Reduce Motion setting
 * and exposes consistent spring and duration defaults.
 */
export function useMotion(): MotionConfig {
  const reduced = useReducedMotion();
  return useMemo<MotionConfig>(
    () => ({
      reduced,
      pressSpring: reduced ? SPRING_INSTANT : SPRING_SNAPPY,
      tabSpring: reduced ? SPRING_INSTANT : SPRING_GENTLE,
      sheetDuration: reduced ? 0 : 180,
    }),
    [reduced],
  );
}
