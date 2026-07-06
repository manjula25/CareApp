import { useEffect, useRef } from 'react';
import type { ConfidenceBucket } from '../api/client';
import { computeConfidenceBarLayout, formatConfidenceBandLabel, CONFIDENCE_CHART_PADDING } from '../lib/confidenceChartGeometry';

/**
 * Native Canvas 2D render of the W06 `#confChart` bar chart (S8 B1), ported
 * from `reference-materials/caresync-governance.html`'s `drawBars()` — see
 * `confidenceChartGeometry.ts` for the extracted pure math and the 4-real-
 * bucket departure from the mockup's 5 hardcoded bands. No chart library
 * (GD10) — plain `CanvasRenderingContext2D` calls, same seam shape as
 * `PopulationScatterChart.tsx`.
 *
 * Deliberately dropped from the mockup: the intro grow-from-zero animation
 * and the top-bucket glow (`shadowBlur`) — this is a static snapshot render
 * of whatever the API currently returns, not an animated reveal, matching
 * `PopulationScatterChart.tsx`'s own "static snapshot, not an animated
 * intro" convention.
 */
export interface ConfidenceChartProps {
  buckets: ConfidenceBucket[];
}

const GRID_STROKE = '#1A3450';
const COUNT_LABEL_COLOR = '#C8E6F5';
const BAND_LABEL_COLOR = '#5A8FAA';

/**
 * Paints exactly one frame of the confidence distribution bar chart. Pure
 * with respect to the DOM (only touches the passed `ctx`) — exercised
 * directly in tests with a stub 2D context, same pattern as
 * `PopulationScatterChart.tsx`'s `paintScatterFrame`.
 */
export function paintConfidenceFrame(ctx: CanvasRenderingContext2D, W: number, H: number, buckets: ConfidenceBucket[]): void {
  ctx.clearRect(0, 0, W, H);
  if (buckets.length === 0) return;

  const { left, right, top, bottom } = CONFIDENCE_CHART_PADDING;
  const plotTop = top;
  const plotBottom = H - bottom;

  /* faint grid lines at 0/50/100% of plot height, same as the mockup */
  ctx.strokeStyle = GRID_STROKE;
  ctx.lineWidth = 1;
  [0, 0.5, 1].forEach((f) => {
    const y = plotTop + (plotBottom - plotTop) * (1 - f) + 0.5;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(W - right, y);
    ctx.stroke();
  });

  const bars = computeConfidenceBarLayout(buckets, W, H);
  bars.forEach((bar) => {
    /* rounded-top bar, same corner-radius construction as the mockup */
    const r = Math.min(3, bar.height);
    ctx.fillStyle = bar.color;
    ctx.beginPath();
    ctx.moveTo(bar.x, bar.y + bar.height);
    ctx.lineTo(bar.x, bar.y + r);
    ctx.arcTo(bar.x, bar.y, bar.x + r, bar.y, r);
    ctx.lineTo(bar.x + bar.width - r, bar.y);
    ctx.arcTo(bar.x + bar.width, bar.y, bar.x + bar.width, bar.y + r, r);
    ctx.lineTo(bar.x + bar.width, bar.y + bar.height);
    ctx.closePath();
    ctx.fill();

    /* count label above the bar */
    ctx.fillStyle = COUNT_LABEL_COLOR;
    ctx.font = "700 10px 'SF Mono', Menlo, monospace";
    ctx.textAlign = 'center';
    ctx.fillText(String(bar.count), bar.x + bar.width / 2, bar.y - 4);

    /* band label below the bar */
    ctx.fillStyle = BAND_LABEL_COLOR;
    ctx.font = "9px -apple-system, 'Segoe UI', sans-serif";
    ctx.fillText(formatConfidenceBandLabel(bar.range), bar.x + bar.width / 2, H - 4);
  });
}

export function ConfidenceChart({ buckets }: ConfidenceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bucketsRef = useRef(buckets);
  bucketsRef.current = buckets;

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
      paintConfidenceFrame(ctx!, w, h, bucketsRef.current);
    }

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
    // Static snapshot, not an animation loop — repaint on data/resize only,
    // same convention as PopulationScatterChart.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets]);

  return <canvas ref={canvasRef} className="block w-full h-full" />;
}
