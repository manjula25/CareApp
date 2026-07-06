import type { ParityAxis } from './parityScore';

/**
 * Pure geometry/color math for the W06 `#radarChart` demographic equity
 * radar (S8 B1), extracted from
 * `reference-materials/caresync-governance.html`'s `drawRadar()` so it's
 * unit-testable without a real `CanvasRenderingContext2D` (jsdom has none) —
 * same split as `populationScatterGeometry.ts` for `PopulationScatterChart`.
 * The ring/spoke/threshold-line visual structure is kept from the mockup
 * unchanged; only the axis set and axis values are real (see
 * `parityScore.ts`'s `buildParityAxes` doc for which 4 axes and why the
 * mockup's other 2 were dropped rather than fabricated).
 */

export interface RadarPoint {
  x: number;
  y: number;
}

/** Radial scale floor, unchanged from the mockup's `VMIN` — values below this floor plot at the center, so small real gaps near 1.0 are still visually legible instead of being crushed into a tiny sliver near the edge. */
export const RADAR_VMIN = 0.75;

/** Grid ring values, unchanged from the mockup. */
export const RADAR_RINGS = [0.8, 0.85, 0.95];

/** Dashed amber threshold ring, unchanged from the mockup's "target >= 0.90" framing. */
export const RADAR_THRESHOLD = 0.9;

/** Outer chart margin (px), unchanged from the mockup's `R = min(W,H)/2 - 26`. */
export const RADAR_MARGIN = 26;

/** `rOf()` from the mockup, unchanged: maps a 0-1 value to a pixel radius against the `RADAR_VMIN` floor, clamped so a value at or below the floor never plots at a negative radius. */
export function radiusForValue(value: number, R: number): number {
  return R * Math.max(0, (value - RADAR_VMIN) / (1 - RADAR_VMIN));
}

export type AxisColorName = 'emerald' | 'amber' | 'red';

/** `axisColor()` from the mockup, unchanged thresholds: >=0.90 emerald, >=0.885 amber, else red. */
export function axisColor(value: number): AxisColorName {
  if (value >= 0.9) return 'emerald';
  if (value >= 0.885) return 'amber';
  return 'red';
}

/**
 * `pt()` from the mockup, generalized to take the center as a parameter
 * instead of reading it from a closure, so it's pure and directly testable.
 * Axis 0 sits at 12 o'clock; axes proceed clockwise, evenly spaced around
 * `n` total axes.
 */
export function axisPoint(index: number, n: number, r: number, cx: number, cy: number): RadarPoint {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / n;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

// Re-exported so callers importing radar geometry don't need a second import
// path for the axis shape it consumes.
export type { ParityAxis };
