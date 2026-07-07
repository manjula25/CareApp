/**
 * Pure geometry/color math for the S11 A2 W05/W07 HEDIS measure gauge
 * (`QualityGaugeChart.tsx`), extracted the same way `confidenceChartGeometry.ts`
 * extracts `ConfidenceChart.tsx`'s bar math — unit-testable without a real
 * `CanvasRenderingContext2D` (jsdom has none).
 *
 * This is deliberately a single-bar gauge, not the mockup's multi-measure
 * `#hedisChart` bar list: the real `GET /api/quality/measures` endpoint
 * (`quality/service.ts`) computes exactly ONE real HEDIS measure (diabetes/
 * HbA1c care-gap), so there is only ever one rate to plot — see Quality.tsx's
 * doc comment for the full list of mockup content this departs from.
 */

export interface GaugePadding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Padding for the gauge's track — leaves room for a numerator/denominator label above and a gap-count label below. */
export const QUALITY_GAUGE_PADDING: GaugePadding = { left: 4, right: 4, top: 22, bottom: 20 };

/** Track thickness in px, vertically centered within the plot area. */
const TRACK_HEIGHT = 22;

export interface GaugeLayout {
  trackX: number;
  trackY: number;
  trackWidth: number;
  trackHeight: number;
  fillWidth: number;
  color: string;
}

/** Clamps a rate into the valid [0,1] range — a rate can never be negative or exceed 1 by construction (numerator/denominator), but this guards the paint math against any drift (e.g. a future denominator=0 edge case) rather than silently over/under-filling. */
function clampRate(rate: number): number {
  return Math.max(0, Math.min(1, rate));
}

/**
 * Projects a single 0-1 rate to a horizontal track + proportional fill inside
 * a `width` x `height` chart area.
 */
export function computeGaugeLayout(
  rate: number,
  width: number,
  height: number,
  padding: GaugePadding = QUALITY_GAUGE_PADDING
): GaugeLayout {
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;
  const trackWidth = plotRight - plotLeft;
  const trackY = plotTop + (plotBottom - plotTop - TRACK_HEIGHT) / 2;

  const clamped = clampRate(rate);
  return {
    trackX: plotLeft,
    trackY,
    trackWidth,
    trackHeight: TRACK_HEIGHT,
    fillWidth: trackWidth * clamped,
    color: gaugeColorForRate(clamped),
  };
}

// Same clinical-meaning color banding convention as confidenceChartGeometry's
// BUCKET_COLOR: a HEDIS measure rate this low is a real, stark care gap (red),
// not yet at a moderate rate (amber), let alone a well-performing one
// (emerald). Thresholds are illustrative banding for this POC's visual
// language, not a HEDIS-defined star-rating cutoff.
export function gaugeColorForRate(rate: number): string {
  if (rate < 0.5) return '#E84848';
  if (rate < 0.8) return '#F0970A';
  return '#0FC48A';
}
