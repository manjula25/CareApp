import { useEffect, useRef } from 'react';
import type { ParityAxis } from '../lib/parityScore';
import { radiusForValue, axisColor, axisPoint, RADAR_RINGS, RADAR_THRESHOLD, RADAR_MARGIN } from '../lib/parityRadarGeometry';

/**
 * Native Canvas 2D render of the W06 `#radarChart` demographic equity radar
 * (S8 B1), ported from
 * `reference-materials/caresync-governance.html`'s `drawRadar()` — see
 * `parityRadarGeometry.ts`/`parityScore.ts` for the extracted pure math and
 * the 4-real-axis departure from the mockup's 6 hardcoded axes. No chart
 * library (GD10) — plain `CanvasRenderingContext2D` calls, same seam shape
 * as `PopulationScatterChart.tsx`.
 *
 * Deliberately dropped from the mockup: the polygon-grow-from-center intro
 * animation — this is a static snapshot render (the polygon always draws at
 * its final radius), matching `PopulationScatterChart.tsx`'s and
 * `ConfidenceChart.tsx`'s "static snapshot, not an animated intro"
 * convention for this task.
 */
export interface ParityRadarChartProps {
  axes: ParityAxis[];
}

const BORDER = '#1A3450';
const BORDER_LIGHT = '#244A6A';
const MUTED = '#5A8FAA';
const EMERALD = '#0FC48A';
const COLOR_HEX: Record<string, string> = { emerald: EMERALD, amber: '#F0970A', red: '#E84848' };

/**
 * Paints exactly one frame of the demographic equity radar. Pure with
 * respect to the DOM (only touches the passed `ctx`) — exercised directly in
 * tests with a stub 2D context, same pattern as
 * `PopulationScatterChart.tsx`'s `paintScatterFrame`.
 */
export function paintParityFrame(ctx: CanvasRenderingContext2D, W: number, H: number, axes: ParityAxis[]): void {
  ctx.clearRect(0, 0, W, H);
  const n = axes.length;
  if (n === 0) return;

  const cx = W / 2;
  const cy = H / 2 + 2;
  const R = Math.min(W, H) / 2 - RADAR_MARGIN;

  function ring(r: number) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const p = axisPoint(i % n, n, r, cx, cy);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
  }

  /* grid rings */
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  RADAR_RINGS.forEach((v) => {
    ring(radiusForValue(v, R));
    ctx.stroke();
  });

  /* spokes */
  for (let i = 0; i < n; i++) {
    const p = axisPoint(i, n, R, cx, cy);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = BORDER;
    ctx.stroke();
  }

  /* dashed threshold ring */
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(240,151,10,.55)';
  ctx.lineWidth = 1;
  ring(radiusForValue(RADAR_THRESHOLD, R));
  ctx.stroke();
  ctx.restore();

  /* ideal-parity outer ring (1.0) */
  ctx.strokeStyle = BORDER_LIGHT;
  ctx.lineWidth = 1.4;
  ring(R);
  ctx.stroke();

  /* actual polygon */
  ctx.beginPath();
  for (let j = 0; j <= n; j++) {
    const k = j % n;
    const p = axisPoint(k, n, radiusForValue(axes[k].value, R), cx, cy);
    if (j === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(15,196,138,.13)';
  ctx.fill();
  ctx.strokeStyle = EMERALD;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  /* vertex dots + labels */
  ctx.font = "9px -apple-system, 'Segoe UI', sans-serif";
  axes.forEach((axis, i) => {
    const color = COLOR_HEX[axisColor(axis.value)];
    const vp = axisPoint(i, n, radiusForValue(axis.value, R), cx, cy);
    ctx.beginPath();
    ctx.arc(vp.x, vp.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    const lp = axisPoint(i, n, R + 13, cx, cy);
    ctx.textAlign = Math.abs(lp.x - cx) < 6 ? 'center' : lp.x > cx ? 'left' : 'right';
    ctx.fillStyle = MUTED;
    ctx.fillText(axis.label, lp.x, lp.y - 1);
    ctx.fillStyle = color;
    ctx.font = "700 9px 'SF Mono', Menlo, monospace";
    ctx.fillText(axis.value.toFixed(2), lp.x, lp.y + 10);
    ctx.font = "9px -apple-system, 'Segoe UI', sans-serif";
  });
}

export function ParityRadarChart({ axes }: ParityRadarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const axesRef = useRef(axes);
  axesRef.current = axes;

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
      paintParityFrame(ctx!, w, h, axesRef.current);
    }

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
    // Static snapshot, not an animation loop — repaint on data/resize only,
    // same convention as PopulationScatterChart.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axes]);

  return <canvas ref={canvasRef} className="block w-full h-full" />;
}
