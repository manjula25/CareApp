import { useEffect, useRef } from 'react';
import { computeGaugeLayout, QUALITY_GAUGE_PADDING } from '../lib/qualityChartGeometry';

/**
 * Native Canvas 2D render of the S11 A2 W05/W07 real HEDIS diabetes/HbA1c
 * measure, replacing the mockup's `#hedisChart` multi-measure bar list with a
 * single horizontal gauge — this system only ever computes ONE real measure
 * (see `quality/service.ts`'s doc), so a multi-bar chart would either
 * fabricate additional bars or mislead by implying more measures exist. No
 * chart library (GD10) — plain `CanvasRenderingContext2D` calls, same seam
 * shape as `ConfidenceChart.tsx`.
 *
 * Static snapshot render, not an animated reveal — same convention
 * `ConfidenceChart.tsx`/`PopulationScatterChart.tsx` document for their own
 * departure from the mockup's intro animations.
 */
export interface QualityGaugeData {
  rate: number;
  numerator: number;
  denominator: number;
  gapPatients: number;
}

export type QualityGaugeChartProps = QualityGaugeData;

const TRACK_COLOR = '#1A3450';
const LABEL_COLOR = '#C8E6F5';
const GAP_LABEL_COLOR = '#5A8FAA';

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, r: number): void {
  const radius = Math.min(r, height / 2, Math.max(width, 0) / 2);
  ctx.beginPath();
  if (width <= 0) return;
  ctx.moveTo(x, y + height);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height);
  ctx.closePath();
  ctx.fill();
}

/**
 * Paints exactly one frame of the HEDIS measure gauge. Pure with respect to
 * the DOM (only touches the passed `ctx`) — exercised directly in tests with
 * a stub 2D context, same pattern as `ConfidenceChart.tsx`'s
 * `paintConfidenceFrame`.
 */
export function paintQualityGaugeFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  data: QualityGaugeData
): void {
  ctx.clearRect(0, 0, W, H);

  const layout = computeGaugeLayout(data.rate, W, H);

  /* track (the full denominator population) */
  ctx.fillStyle = TRACK_COLOR;
  roundedRect(ctx, layout.trackX, layout.trackY, layout.trackWidth, layout.trackHeight, 4);

  /* fill (the real, honestly-computed rate) */
  ctx.fillStyle = layout.color;
  roundedRect(ctx, layout.trackX, layout.trackY, layout.fillWidth, layout.trackHeight, 4);

  /* numerator/denominator label above the track */
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = "700 12px 'SF Mono', Menlo, monospace";
  ctx.textAlign = 'left';
  ctx.fillText(`${data.numerator} of ${data.denominator} tested`, layout.trackX, QUALITY_GAUGE_PADDING.top - 8);

  /* gap-patient-count label below the track */
  ctx.fillStyle = GAP_LABEL_COLOR;
  ctx.font = "11px -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText(`${data.gapPatients} patients with no HbA1c test on file`, layout.trackX, H - QUALITY_GAUGE_PADDING.bottom + 14);
}

export function QualityGaugeChart(props: QualityGaugeChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dataRef = useRef(props);
  dataRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return; // SSR / detached-ref guard.
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported-canvas guard.

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintQualityGaugeFrame(ctx!, w, h, dataRef.current);
    }

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
    // Static snapshot, not an animation loop — repaint on data/resize only,
    // same convention as ConfidenceChart.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.rate, props.numerator, props.denominator, props.gapPatients]);

  return <canvas ref={canvasRef} className="block w-full h-full" />;
}
