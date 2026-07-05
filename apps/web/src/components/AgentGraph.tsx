import { useEffect, useRef } from 'react';
import type { AnalysisGraphState, GraphState, NodeStatus } from '../lib/analysisGraph';
import type { AgentId } from '../api/client';
import {
  AGENTS,
  AGENT_RADIUS,
  ORCHESTRATOR_RADIUS,
  COL,
  bez,
  edgeGeom,
  hexToRgba,
  dispatchParticleT,
  synthesizingParticleT,
  analyzingParticleT,
  agentNodeVisual,
  orchestratorVisual,
  initFloatingText,
  checkmarkAlpha,
  type AgentNodeGeometry,
} from '../lib/agentGraphGeometry';

/**
 * Native Canvas 2D render of the 5-node agent graph (Orchestrator + 4
 * agents), ported from `reference-materials/caresync-ai.html`'s
 * `#agentGraph` canvas — see `agentGraphGeometry.ts` for the extracted pure
 * math and why it's split out this way.
 *
 * Presentational only: takes `state` from the caller's `useAnalysisGraph()`
 * (owned by `PatientDetail`, since a canvas shouldn't know whether its data
 * came from a live SSE stream or a cache replay) and paints it. No chart
 * library (GD10) — plain `CanvasRenderingContext2D` calls.
 */
export interface AgentGraphProps {
  state: AnalysisGraphState;
}

const AGENT_IDS: AgentId[] = AGENTS.map((a) => a.agentId);

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  opts: { alpha?: number; scale?: number; glow?: boolean; ringAlpha?: number }
) {
  const alpha = opts.alpha ?? 1;
  const scale = opts.scale ?? 1;
  const R = r * scale;

  ctx.save();
  if (opts.glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 26;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Inner darker circle.
  ctx.globalAlpha = 1;
  ctx.fillStyle = COL.inner;
  ctx.beginPath();
  ctx.arc(x, y, R * 0.66, 0, Math.PI * 2);
  ctx.fill();

  // Small colored core.
  ctx.fillStyle = hexToRgba(color, opts.glow ? 0.95 : 0.45 * alpha + 0.15);
  ctx.beginPath();
  ctx.arc(x, y, R * 0.24, 0, Math.PI * 2);
  ctx.fill();

  // Completion ring.
  const ringAlpha = opts.ringAlpha ?? 0;
  if (ringAlpha > 0) {
    ctx.globalAlpha = Math.min(1, ringAlpha);
    ctx.strokeStyle = COL.emerald;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, R + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  txt: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  color: string,
  size = 11
) {
  ctx.font = `${size}px -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(txt, x, y);
}

export function AgentGraph({ state }: AgentGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const mountedAtRef = useRef(performance.now());
  const graphStateEnteredAtRef = useRef(performance.now());
  const prevNodesRef = useRef(state.nodes);
  const completedAtRef = useRef<Partial<Record<AgentId, number>>>({});

  // Track "time since this graphState was entered" off a real transition
  // moment, instead of the mockup's fake single `runStart` clock.
  useEffect(() => {
    graphStateEnteredAtRef.current = performance.now();
  }, [state.graphState]);

  // Track "time since this node individually completed" — real phased
  // execution lets one agent finish while others are still analyzing, which
  // the mockup's single fake timeline never has to handle.
  useEffect(() => {
    const prev = prevNodesRef.current;
    for (const agentId of AGENT_IDS) {
      if (state.nodes[agentId] === 'complete' && prev[agentId] !== 'complete') {
        completedAtRef.current[agentId] = performance.now();
      }
    }
    prevNodesRef.current = state.nodes;
  }, [state.nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return; // SSR / detached-ref guard.
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported-canvas guard.

    let rafId: number | null = null;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    function paint() {
      const W = canvas!.clientWidth;
      const H = canvas!.clientHeight;
      const cur = stateRef.current;
      const graphState: GraphState = cur.graphState;
      const now = performance.now();
      const tSec = (now - mountedAtRef.current) / 1000;
      const elapsedInStateSec = (now - graphStateEnteredAtRef.current) / 1000;

      ctx!.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;

      /* --- radar rings (always on, very faint) --- */
      for (let k = 0; k < 3; k++) {
        const rr = (tSec * 22 + k * 40) % 120;
        const ra = 0.05 * (1 - rr / 120);
        if (ra > 0.002) {
          ctx!.strokeStyle = hexToRgba(COL.cyan, ra);
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.arc(cx, cy, ORCHESTRATOR_RADIUS + rr, 0, Math.PI * 2);
          ctx!.stroke();
        }
      }

      const graphActiveWindow = graphState === 'dispatch' || graphState === 'analyzing' || graphState === 'synthesizing';

      /* --- edges + particles --- */
      AGENTS.forEach((agent: AgentNodeGeometry, i: number) => {
        const nodeStatus: NodeStatus = cur.nodes[agent.agentId];
        const g = edgeGeom(cx, cy, agent);
        const edgeActive = graphActiveWindow && nodeStatus !== 'complete';

        ctx!.beginPath();
        ctx!.moveTo(g.p0.x, g.p0.y);
        ctx!.quadraticCurveTo(g.c.x, g.c.y, g.p1.x, g.p1.y);
        if (edgeActive) {
          ctx!.save();
          ctx!.shadowColor = agent.color;
          ctx!.shadowBlur = 10;
          ctx!.strokeStyle = hexToRgba(agent.color, 0.55);
          ctx!.lineWidth = 1.6;
          ctx!.stroke();
          ctx!.restore();
        } else {
          ctx!.strokeStyle = hexToRgba('#244A6A', graphState === 'complete' ? 0.55 : 0.4);
          ctx!.lineWidth = 1.2;
          ctx!.stroke();
        }

        let particleTs: number[] = [];
        if (edgeActive) {
          if (graphState === 'dispatch') particleTs = dispatchParticleT(elapsedInStateSec);
          else if (graphState === 'analyzing') particleTs = analyzingParticleT(tSec, i);
          else if (graphState === 'synthesizing') particleTs = synthesizingParticleT(elapsedInStateSec);
        }
        particleTs.forEach((pt) => {
          const p = bez(g.p0, g.c, g.p1, pt);
          ctx!.save();
          ctx!.shadowColor = agent.color;
          ctx!.shadowBlur = 12;
          ctx!.fillStyle = '#FFFFFF';
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.shadowBlur = 0;
          ctx!.fillStyle = hexToRgba(agent.color, 0.9);
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.restore();
        });
      });

      /* --- agent nodes --- */
      AGENTS.forEach((agent: AgentNodeGeometry, i: number) => {
        const x = cx + agent.dx;
        const y = cy + agent.dy;
        const nodeStatus: NodeStatus = cur.nodes[agent.agentId];
        const completedAt = completedAtRef.current[agent.agentId];
        const completeElapsedSec = completedAt != null ? (now - completedAt) / 1000 : null;
        const visual = agentNodeVisual(nodeStatus, graphState, tSec, i, completeElapsedSec);

        drawNode(ctx!, x, y, AGENT_RADIUS, agent.color, {
          alpha: visual.alpha,
          scale: visual.scale,
          glow: visual.glow,
          ringAlpha: visual.ringAlpha,
        });

        const lc = nodeStatus === 'pending' ? COL.textMuted : COL.text;
        if (agent.label === 'above') drawLabel(ctx!, agent.name, x, y - AGENT_RADIUS - 14, 'center', lc);
        if (agent.label === 'below') drawLabel(ctx!, agent.name, x, y + AGENT_RADIUS + 14, 'center', lc);
        if (agent.label === 'right') drawLabel(ctx!, agent.name, x + AGENT_RADIUS + 10, y, 'left', lc);
        if (agent.label === 'left') drawLabel(ctx!, agent.name, x - AGENT_RADIUS - 10, y, 'right', lc);
      });

      /* --- orchestrator node --- */
      const orchestrator = orchestratorVisual(graphState, tSec, elapsedInStateSec);
      drawNode(ctx!, cx, cy, ORCHESTRATOR_RADIUS, COL.cyan, {
        alpha: 1,
        scale: orchestrator.scale,
        glow: orchestrator.glow,
        ringAlpha: orchestrator.ringAlpha,
      });
      drawLabel(ctx!, 'Orchestrator', cx, cy + ORCHESTRATOR_RADIUS + 18, 'center', COL.text, 11.5);

      /* --- INIT floating text --- */
      if (graphState === 'init') {
        const { alpha, yOffset } = initFloatingText(elapsedInStateSec);
        ctx!.globalAlpha = alpha;
        drawLabel(ctx!, 'Analyzing patient…', cx, cy - ORCHESTRATOR_RADIUS - 22 + yOffset, 'center', COL.cyan, 12);
        ctx!.globalAlpha = 1;
      }

      /* --- COMPLETE checkmark hint --- */
      if (graphState === 'complete') {
        const alpha = checkmarkAlpha(elapsedInStateSec);
        if (alpha > 0) {
          ctx!.globalAlpha = alpha;
          drawLabel(ctx!, '✓ Analysis complete', cx, H - 14, 'center', COL.emerald, 11);
          ctx!.globalAlpha = 1;
        }
      }
    }

    if (prefersReducedMotion()) {
      // Static final-state frame only — no continuous rAF loop.
      paint();
    } else {
      const loop = () => {
        paint();
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      window.removeEventListener('resize', resize);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
    // Intentionally run once per mount: the rAF loop reads live state via
    // `stateRef`, so it doesn't need to restart on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-[340px] border-b border-border bg-bg">
      <canvas ref={canvasRef} className="block w-full h-[340px]" />
      {/* `.canvas-wrap::after` in the mockup — a faint CRT-style scanline overlay. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'repeating-linear-gradient(to bottom, rgba(200,230,245,0.035) 0 1px, transparent 1px 4px)',
        }}
        aria-hidden="true"
      />
    </div>
  );
}
