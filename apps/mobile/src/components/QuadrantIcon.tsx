import Svg, { Rect } from 'react-native-svg';

import type { EisenhowerQuadrant } from '@/lib/smart';
import { useTheme } from '@/theme';

/** Cell origins in the 18×18 grid: columns = urgency (left = due now), rows = importance (top = important). */
const CELLS: Record<EisenhowerQuadrant, { x: number; y: number }> = {
  q1: { x: 1, y: 1 },
  q2: { x: 10, y: 1 },
  q3: { x: 1, y: 10 },
  q4: { x: 10, y: 10 },
};
const ORDER: readonly EisenhowerQuadrant[] = ['q1', 'q2', 'q3', 'q4'];
const OFF_OPACITY = 0.3;

/**
 * A matrix quadrant's mark: the 2×2 grid of the 매트릭스 tab with the quadrant's own cell filled, so its place in the
 * matrix is its name. Decorative; the heading next to it carries the words.
 */
export function QuadrantIcon({ quadrant, size = 18, dim = false }: { quadrant: EisenhowerQuadrant; size?: number; dim?: boolean }) {
  const { colors } = useTheme();
  return (
    <Svg
      width={size} height={size} viewBox="0 0 18 18"
      accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden pointerEvents="none">
      {ORDER.map((key) => {
        const on = key === quadrant;
        return (
          <Rect
            key={key} x={CELLS[key].x} y={CELLS[key].y} width={7} height={7} rx={2}
            fill={on ? (dim ? colors.textFaint : colors.text) : colors.control}
            fillOpacity={on ? 1 : OFF_OPACITY} />
        );
      })}
    </Svg>
  );
}
