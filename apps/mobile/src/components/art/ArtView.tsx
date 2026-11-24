import { createElement, memo, type ComponentType, type ReactElement } from 'react';
import Svg, { Circle, Defs, Ellipse, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { type Art, type ArtPalette, defNodes, type NodeTag, type SvgNode, svgNodes } from './scene';

// Each tag of the shared element list maps to one react-native-svg element; attributes pass through as-is
// (svgNodes() already produces react-native-svg's camelCase props), so the app draws exactly what
// toSvgString() — and therefore scripts/art/render.mjs — draws.
const ELEMENTS: Record<NodeTag, ComponentType<Record<string, unknown>>> = {
  rect: Rect as ComponentType<Record<string, unknown>>,
  circle: Circle as ComponentType<Record<string, unknown>>,
  ellipse: Ellipse as ComponentType<Record<string, unknown>>,
  path: Path as ComponentType<Record<string, unknown>>,
  line: Line as ComponentType<Record<string, unknown>>,
  linearGradient: LinearGradient as ComponentType<Record<string, unknown>>,
  stop: Stop as ComponentType<Record<string, unknown>>,
};

function toElement(node: SvgNode, key: number): ReactElement {
  return createElement(ELEMENTS[node.tag], { key, ...node.attrs }, node.children?.map(toElement));
}

export interface ArtViewProps {
  art: Art;
  palette: ArtPalette;
  width: number | string;
  height: number;
  preserveAspectRatio?: string;
}

/** Draws one piece of artwork. Decorative: hidden from screen readers (the screen's own text says it). */
export const ArtView = memo(function ArtView({ art, palette, width, height, preserveAspectRatio }: ArtViewProps) {
  const defs = defNodes(art, palette);
  return (
    <Svg
      width={width} height={height} viewBox={`0 0 ${art.w} ${art.h}`} preserveAspectRatio={preserveAspectRatio}
      accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden pointerEvents="none">
      {defs.length ? <Defs>{defs.map(toElement)}</Defs> : null}
      {svgNodes(art, palette).map(toElement)}
    </Svg>
  );
});
