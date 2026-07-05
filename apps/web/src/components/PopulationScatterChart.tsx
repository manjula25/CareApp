import { useEffect, useRef } from 'react';
import type { ScatterPoint } from '../api/client';
import {
  projectPoint,
  scatterDotRadius,
  scatterPointColor,
  pixelToQuadrant,
  SCATTER_COLOR_RGB,
  SCATTER_PADDING,
  SCATTER_TICKS,
  type Quadrant,
} from '../lib/populationScatterGeometry';

/**
 * Native Canvas 2D render of the W02 population scatter (Task B2), ported
 * from `reference-materials/caresync-population.html`'s `#scatter` canvas —
 * see `populationScatterGeometry.ts` for the extracted pure math and the
 * risk(x)/urgency(y) domain departure from the mockup. No chart library
 * (GD10) — plain `CanvasRenderingContext2D` calls, same seam shape as
 * `AgentGraph.tsx`/`paintFrame`.
 *
 * Presentational only: takes `points` from the caller (the `Population` page,
 * fed by `getPopulationScatter()`) and paints them. Click-to-drill-in (Task
 * B3) is wired via the optional `onQuadrantClick` prop — this component only
 * detects which risk/urgency quadrant a click landed in (via
 * `pixelToQuadrant`, `../lib/populationScatterGeometry.ts`); filtering the
 * population and navigating is the caller's job (`Population.tsx`).
 *
 * Deliberately dropped from the mockup for this task:
 * - the pulsing `.glow-layer` overlay on critical-risk dots and the hover
 *   tooltip — both are DOM-overlay flourishes the mockup implements outside
 *   the canvas, and neither is required by this task's acceptance bar
 *   (native Canvas scatter rendering real aggregates).
 * - the dashed quadrant divider lines and their four labels ("CRITICAL — ACT
 *   NOW" / "MONITOR — TRENDING UP" / "STABLE — ROUTINE" / "WATCH — OVERDUE
 *   CONTACT", mockup lines ~522-539) — the mockup's quadrant split assumes a
 *   specific risk/urgency threshold pairing that hasn't been decided for the
 *   API's actual risk(x)/urgency(y) domain; adding it well means picking real
 *   thresholds, not just porting pixel math. Left for a follow-up pass rather
 *   than guessed here.
 * Both are documented deviations, not oversights.
 */
export interface PopulationScatterChartProps {
  points: ScatterPoint[];
  /** Fired with the risk/urgency band a click landed in (Task B3 drill-in). */
  onQuadrantClick?: (quadrant: Quadrant) => void;
}

const GRID_STROKE = 'rgba(26,52,80,.45)';
const FRAME_STROKE = '#1A3450';
const TICK_LABEL = '#5A8FAA';
const AXIS_TITLE = '#5A8FAA';

/**
 * Paints exactly one frame of the population scatter. Pure with respect to
 * the DOM (it only touches the passed `ctx`) — exercised directly in tests
 * with a stub 2D context, same pattern as `AgentGraph.tsx`'s `paintFrame`.
 */
export function paintScatterFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  points: ScatterPoint[]
): void {
  ctx.clearRect(0, 0, W, H);

  const { left: x0Pad, right, top, bottom } = SCATTER_PADDING;
  const x0 = x0Pad;
  const x1 = W - right;
  const y0 = H - bottom;
  const y1 = top;

  /* frame */
  ctx.strokeStyle = FRAME_STROKE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y1 + 0.5, x1 - x0 - 1, y0 - y1 - 1);

  /* gridlines + tick labels (shared 0-100 domain on both axes) */
  ctx.font = "10px 'SF Mono', Menlo, monospace";
  SCATTER_TICKS.forEach((t) => {
    const { x } = projectPoint({ x: t, y: 0 }, W, H);
    ctx.fillStyle = TICK_LABEL;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(t), x, y0 + 6);
    ctx.strokeStyle = GRID_STROKE;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y1);
    ctx.lineTo(x + 0.5, y0);
    ctx.stroke();
  });
  SCATTER_TICKS.forEach((t) => {
    const { y } = projectPoint({ x: 0, y: t }, W, H);
    ctx.fillStyle = TICK_LABEL;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(t), x0 - 7, y);
    ctx.strokeStyle = GRID_STROKE;
    ctx.beginPath();
    ctx.moveTo(x0, y + 0.5);
    ctx.lineTo(x1, y + 0.5);
    ctx.stroke();
  });

  /* axis titles — "RISK SCORE"(x) / "URGENCY"(y), relabeled from the mockup's
     "DAYS SINCE LAST CONTACT"/"RISK SCORE" to match the real S5 axes. */
  ctx.fillStyle = AXIS_TITLE;
  ctx.font = "10px -apple-system, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('RISK SCORE', (x0 + x1) / 2, H - 6);
  ctx.save();
  ctx.translate(11, (y0 + y1) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('URGENCY', 0, 0);
  ctx.restore();

  /* dots */
  points.forEach((point) => {
    const { x, y } = projectPoint(point, W, H);
    const r = scatterDotRadius(point);
    const rgb = SCATTER_COLOR_RGB[scatterPointColor(point)];

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgb},.5)`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgb},.9)`;
    ctx.fill();
  });
}

export function PopulationScatterChart({ points, onQuadrantClick }: PopulationScatterChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;

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
      paintScatterFrame(ctx!, w, h, pointsRef.current);
    }

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
    // Re-run whenever `points` changes so a fresh fetch repaints immediately
    // (there is no animation loop here, unlike AgentGraph — the scatter is a
    // static snapshot of the population, redrawn on data/resize only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  /**
   * Click hit-testing uses the canvas's own CSS-pixel size (`clientWidth`/
   * `clientHeight` — the same values `draw()` above passes to
   * `paintScatterFrame`/`projectPoint`) and the click's `offsetX`/`offsetY`
   * (canvas-relative CSS pixels, matching the coordinate space `draw()`
   * paints in — no devicePixelRatio scaling needed since neither is in
   * backing-store pixels). `pixelToQuadrant` inverts the same projection
   * `paintScatterFrame` uses, so the hit-test can't drift from the paint.
   */
  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!onQuadrantClick) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { offsetX, offsetY } = event.nativeEvent;
    const quadrant = pixelToQuadrant({ x: offsetX, y: offsetY }, canvas.clientWidth, canvas.clientHeight);
    onQuadrantClick(quadrant);
  }

  return <canvas ref={canvasRef} onClick={handleClick} className="block w-full h-full" />;
}
