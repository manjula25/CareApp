import type { ConfidenceBucket } from '../api/client';

/**
 * Pure geometry/color math for the W06 `#confChart` bar chart (S8 B1),
 * extracted from `reference-materials/caresync-governance.html`'s
 * `drawBars()` so it's unit-testable without a real `CanvasRenderingContext2D`
 * (jsdom has none) — same split as `populationScatterGeometry.ts` for
 * `PopulationScatterChart`.
 *
 * Deliberate departure from the mockup: the mockup hardcodes 5 demo bands
 * (50-59% ... 90-100%) with fabricated counts. The real
 * `GET /api/governance/model` endpoint (`governance/service.ts`) only ever
 * returns the 4 fixed buckets it derives from actual cached agent output
 * (`0-0.5`, `0.5-0.7`, `0.7-0.85`, `0.85-1.0`), so this chart is driven by
 * exactly those 4 real buckets — not the mockup's 5. No intro animation
 * either (unlike the mockup's `ease()`/`requestAnimationFrame` ramp): this is
 * a static snapshot render, same convention `PopulationScatterChart.tsx`
 * documents for its own departure from the mockup's animated scatter.
 */

export interface ChartPadding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Padding for the bar chart's plot area — leaves room for the count label above and band label below each bar (ported from the mockup's `padL/padR/padT/padB`, `top`/`bottom` widened slightly since the real render has no legend to borrow vertical space from). */
export const CONFIDENCE_CHART_PADDING: ChartPadding = { left: 8, right: 8, top: 20, bottom: 18 };

/** Horizontal gap between bars, unchanged from the mockup's `gap`. */
const GAP_PX = 10;

export interface ConfidenceBucketInput {
  range: string;
  count: number;
}

export interface ConfidenceBarLayout {
  range: string;
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

// Colors keyed to the exact 4 bucket ranges `governance/service.ts`'s
// CONFIDENCE_BUCKETS emits, following that module's own clinical-meaning doc
// comment: <0.5 unreliable (red), 0.5-0.7 low-moderate (amber), 0.7-0.85
// moderate-high (cyan), 0.85-1.0 high confidence (emerald) — a 4-color ramp
// rather than the mockup's mostly-cyan 5-band scheme, since our buckets carry
// a real pass/fail-adjacent meaning the mockup's demo bands didn't need to.
const BUCKET_COLOR: Record<string, string> = {
  '0-0.5': '#E84848',
  '0.5-0.7': '#F0970A',
  '0.7-0.85': '#00C8FF',
  '0.85-1.0': '#0FC48A',
};
const DEFAULT_BAR_COLOR = '#00C8FF';

export function confidenceBucketColor(range: string): string {
  return BUCKET_COLOR[range] ?? DEFAULT_BAR_COLOR;
}

/**
 * Projects confidence buckets to pixel bar rectangles inside a `width` x
 * `height` chart area. Scales against the tallest bucket's count (falling
 * back to 1 when every bucket is 0, e.g. today's honest all-zero
 * distribution — see `governance/service.ts`'s deviation note) so bars never
 * divide by zero and simply render at height 0 rather than NaN.
 */
export function computeConfidenceBarLayout(
  buckets: ConfidenceBucketInput[],
  width: number,
  height: number,
  padding: ChartPadding = CONFIDENCE_CHART_PADDING
): ConfidenceBarLayout[] {
  const n = buckets.length;
  if (n === 0) return [];

  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const barWidth = (plotW - GAP_PX * (n - 1)) / n;
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return buckets.map((bucket, i) => {
    const barHeight = (bucket.count / max) * plotH;
    return {
      range: bucket.range,
      count: bucket.count,
      x: padding.left + i * (barWidth + GAP_PX),
      y: padding.top + plotH - barHeight,
      width: barWidth,
      height: barHeight,
      color: confidenceBucketColor(bucket.range),
    };
  });
}

/** Formats a `"min-max"` fractional bucket range (e.g. `"0.85-1.0"`) as a percent range (`"85–100%"`) for the label drawn below each bar. */
export function formatConfidenceBandLabel(range: string): string {
  const [minStr, maxStr] = range.split('-');
  const min = Math.round(Number(minStr) * 100);
  const max = Math.round(Number(maxStr) * 100);
  return `${min}–${max}%`;
}

// Bucket midpoints used only to approximate a single "average confidence"
// headline tile from the bucketed distribution the API returns — the API
// deliberately does not return raw per-finding confidence values (see
// `governance/service.ts`'s `extractConfidences`, which reads them but only
// ever surfaces the bucketed counts), so an exact average isn't available.
// This is a documented approximation over real counts (same "derived stat,
// not fabricated" category as `population/service.ts`'s
// `projectedCostAvoidance`), not a guess.
const BUCKET_MIDPOINT: Record<string, number> = {
  '0-0.5': 0.25,
  '0.5-0.7': 0.6,
  '0.7-0.85': 0.775,
  '0.85-1.0': 0.925,
};

/**
 * Count-weighted average of bucket midpoints, or `undefined` when every
 * bucket is empty (no confidence values have been reported by any agent yet
 * — today's honest state) so the caller can render "—" instead of a
 * misleading 0%/NaN.
 */
export function averageConfidence(buckets: ConfidenceBucketInput[]): number | undefined {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) return undefined;
  const weighted = buckets.reduce((sum, b) => sum + b.count * (BUCKET_MIDPOINT[b.range] ?? 0), 0);
  return weighted / total;
}

// Re-exported for callers that want the API's own bucket type name.
export type { ConfidenceBucket };
