import type { ScatterPoint } from '../api/client';
import { riskDotColor, type RiskDotColor } from './patient';

/**
 * Pure geometry/color math for the W02 population scatter (Task B2),
 * extracted from `reference-materials/caresync-population.html`'s canvas JS
 * (`px()`/`X()`/`Y()`/the dot-radius formula in its `draw()`) so it's unit
 * testable without a real `CanvasRenderingContext2D` (jsdom has none) —
 * same split as `agentGraphGeometry.ts` for `AgentGraph`.
 *
 * One deliberate departure from the mockup: the mockup plots risk (y) against
 * *days since last contact* (x, 0-90). The S5 population API (A2,
 * `apps/api/src/population/service.ts`) instead gives each patient a
 * `riskScore` (x) and a derived `urgency` (y), both already 0-100 — see this
 * task's spec ("risk (x) × urgency (y)"). `ScatterPoint.x`/`.y` are that exact
 * pair (`x: riskScore`, `y: urgency`), so the projection below just treats
 * both axes as a 0-100 domain instead of the mockup's mixed 0-90/0-100 one.
 */

export interface ChartPadding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Same padding values as the mockup's `PAD` constant. */
export const SCATTER_PADDING: ChartPadding = { left: 38, right: 14, top: 16, bottom: 34 };

/** Both axes are already 0-100 (riskScore and urgency) — see module doc. */
export const SCATTER_DOMAIN_MIN = 0;
export const SCATTER_DOMAIN_MAX = 100;

/** Tick values shared by both axes, since both share the same 0-100 domain. */
export const SCATTER_TICKS: number[] = [0, 25, 50, 75, 100];

export interface PixelPoint {
  x: number;
  y: number;
}

/** `px()` from the mockup, unchanged: linear-interpolate `v` from `[min,max]` into `[a,b]`. */
function interpolate(v: number, min: number, max: number, a: number, b: number): number {
  return a + ((v - min) / (max - min)) * (b - a);
}

/**
 * Projects one scatter point (`x`=riskScore, `y`=urgency, both 0-100) to
 * pixel coordinates inside a `width` x `height` chart area, honoring
 * `padding` for the axis frame/labels/ticks — the mockup's `X()`/`Y()`
 * closures, generalized to take the chart's pixel size as a parameter
 * instead of reading `wrap.clientWidth`/`clientHeight` off the DOM, so it's
 * pure and directly testable. Higher `y` (more urgent) plots nearer the top,
 * same as the mockup.
 */
export function projectPoint(
  point: { x: number; y: number },
  width: number,
  height: number,
  padding: ChartPadding = SCATTER_PADDING
): PixelPoint {
  const x0 = padding.left;
  const x1 = width - padding.right;
  const y0 = height - padding.bottom;
  const y1 = padding.top;
  return {
    x: interpolate(point.x, SCATTER_DOMAIN_MIN, SCATTER_DOMAIN_MAX, x0, x1),
    y: interpolate(point.y, SCATTER_DOMAIN_MIN, SCATTER_DOMAIN_MAX, y0, y1),
  };
}

/**
 * Deterministic 5-7px dot radius, unchanged from the mockup's
 * `5+((Math.round(d.x*7)+Math.round(d.y*13))%3)` — varies the radius a
 * little per point without any randomness, so re-renders (and tests) are
 * stable.
 */
export function scatterDotRadius(point: { x: number; y: number }): number {
  return 5 + ((Math.round(point.x * 7) + Math.round(point.y * 13)) % 3);
}

/** `COLORS` from the mockup, unchanged: same 4 rgb triples keyed by the shared `RiskDotColor` bucket (`lib/patient.ts`). */
export const SCATTER_COLOR_RGB: Record<RiskDotColor, string> = {
  red: '232,72,72',
  amber: '240,151,10',
  violet: '134,97,212',
  emerald: '15,196,138',
};

/** A scatter point's color bucket, reusing the same riskScore thresholds as the patient-panel risk dot (`lib/patient.ts`) for one consistent risk-color mapping across the app. */
export function scatterPointColor(point: ScatterPoint): RiskDotColor {
  return riskDotColor(point.riskScore);
}
