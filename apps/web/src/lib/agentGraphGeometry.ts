import type { AgentId } from '../api/client';
import type { GraphState, NodeStatus } from './analysisGraph';

/**
 * Pure geometry/timing math for the `AgentGraph` canvas (Task B2), extracted
 * from `reference-materials/caresync-ai.html`'s canvas JS (search for the
 * "Canvas setup" comment in that file) so it can be unit tested without a
 * real `CanvasRenderingContext2D` (jsdom has none). The
 * `AgentGraph` React component owns all actual `ctx.*` drawing calls and
 * imports these helpers/constants.
 *
 * One deliberate departure from the mockup: the mockup drives its whole
 * timeline off a single fake elapsed-time clock (`runStart`/`getState`).
 * There is no such clock here — every function below takes either the
 * *global* animation clock (`tSec`, seconds since the component mounted,
 * used for continuous breathing/oscillation that doesn't care when a state
 * was entered) or the *elapsed-since-transition* clock (`elapsedSec`, seconds
 * since the relevant state/status was entered, used for one-shot
 * fade/burst/settle animations) — mirroring exactly which of the two the
 * mockup used for each animation, just sourced from real state transitions
 * instead of a fake timer.
 */

/** Exact hex values from the mockup's `COL` object — match this repo's Tailwind color tokens 1:1 (apps/web/tailwind.config.js). */
export const COL = {
  cyan: '#00C8FF',
  red: '#E84848',
  violet: '#8661D4',
  emerald: '#0FC48A',
  amber: '#F0970A',
  bg: '#07111E',
  inner: '#0C1829',
  textMuted: '#5A8FAA',
  text: '#C8E6F5',
} as const;

export type LabelSide = 'above' | 'right' | 'below' | 'left';

export interface AgentNodeGeometry {
  agentId: AgentId;
  name: string;
  color: string;
  dx: number;
  dy: number;
  label: LabelSide;
}

/** Fixed radial layout — exact `dx`/`dy` offsets from the mockup's `AGENTS` array, order preserved (also the real phased-completion order: risk -> careGap -> sdoh -> actionPlanner). */
export const AGENTS: AgentNodeGeometry[] = [
  { agentId: 'risk', name: 'Risk Agent', color: COL.red, dx: 0, dy: -130, label: 'above' },
  { agentId: 'careGap', name: 'Care Gap', color: COL.violet, dx: 160, dy: 0, label: 'right' },
  { agentId: 'sdoh', name: 'SDOH', color: COL.emerald, dx: 0, dy: 130, label: 'below' },
  { agentId: 'actionPlanner', name: 'Action Planner', color: COL.amber, dx: -160, dy: 0, label: 'left' },
];

/** `OR`/`AR` in the mockup: orchestrator radius and per-agent node radius. */
export const ORCHESTRATOR_RADIUS = 36;
export const AGENT_RADIUS = 26;

export interface Point {
  x: number;
  y: number;
}

/** `hexToRgba` from the mockup, unchanged. */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** `bez` from the mockup, unchanged: quadratic bezier point at parameter `t`. */
export function bez(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

export interface EdgeGeometry {
  p0: Point;
  c: Point;
  p1: Point;
}

/** `edgeGeom` from the mockup, unchanged: orchestrator-center -> agent edge with a 38px perpendicular control-point bow. */
export function edgeGeom(cx: number, cy: number, agent: AgentNodeGeometry): EdgeGeometry {
  const p0 = { x: cx, y: cy };
  const p1 = { x: cx + agent.dx, y: cy + agent.dy };
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const vx = p1.x - p0.x;
  const vy = p1.y - p0.y;
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  const c = { x: mx + (-vy / len) * 38, y: my + (vx / len) * 38 };
  return { p0, c, p1 };
}

/** DISPATCH particle burst: outbound points at `elapsedSec` and (once past 0.25s) a trailing second point — same shape as the mockup's `st.t`/`st.t - 0.25`, clamped to [0,1]. */
export function dispatchParticleT(elapsedSec: number): number[] {
  const pts = [Math.min(1, elapsedSec)];
  if (elapsedSec > 0.25) pts.push(Math.min(1, elapsedSec - 0.25));
  return pts;
}

/** SYNTHESIZING particle converge: inbound points counting down from 1, same shape as the mockup. */
export function synthesizingParticleT(elapsedSec: number): number[] {
  const pts = [Math.max(0, 1 - elapsedSec)];
  if (elapsedSec > 0.2) pts.push(Math.max(0, 1 - (elapsedSec - 0.2)));
  return pts;
}

/** ANALYZING particle oscillation: driven by the *global* animation clock (`tSec`), phase-shifted per agent index — matches the mockup's use of `t` (not `st.t`) for this one. */
export function analyzingParticleT(tSec: number, phaseIndex: number): number[] {
  return [
    0.5 + 0.5 * Math.sin(tSec * 2.4 + phaseIndex * 1.7),
    0.5 + 0.5 * Math.sin(tSec * 2.4 + phaseIndex * 1.7 + Math.PI),
  ];
}

export interface NodeVisual {
  alpha: number;
  scale: number;
  glow: boolean;
  ringAlpha: number;
}

const RING_FADE_SEC = 0.5;

/**
 * Per-agent-node visual, driven by that node's own `NodeStatus` (not the
 * graph-level state) — the mockup's single `agentsActive` flag applied to
 * all 4 nodes at once, but here each node computes its own appearance since
 * real phased execution lets one agent be `complete` while another is still
 * `analyzing` (impossible in the mockup's single fake timeline).
 *
 * - `pending`: dim, matching the mockup's default (0.4 alpha), slightly
 *   brighter (0.65) during the graph's `dispatch` window — the mockup's
 *   fade-in-before-active look.
 * - `analyzing`: full alpha + glow + a per-agent breathing scale driven by
 *   the *global* clock (`tSec`), matching the mockup's ANALYZING branch.
 * - `complete`: full alpha, no glow (mockup: `glow = name !== 'COMPLETE'`),
 *   with a completion ring that fades in over `RING_FADE_SEC` since *this*
 *   node completed (`completeElapsedSec`, null if unknown/not yet complete).
 */
export function agentNodeVisual(
  status: NodeStatus,
  graphState: GraphState,
  tSec: number,
  phaseIndex: number,
  completeElapsedSec: number | null
): NodeVisual {
  if (status === 'pending') {
    return { alpha: graphState === 'dispatch' ? 0.65 : 0.4, scale: 1, glow: false, ringAlpha: 0 };
  }
  if (status === 'analyzing') {
    const scale = 1 + 0.06 * Math.sin(tSec * (3.2 + phaseIndex * 0.55) + phaseIndex * 1.3);
    return { alpha: 1, scale, glow: true, ringAlpha: 0 };
  }
  // complete
  const ringAlpha = completeElapsedSec === null ? 0 : Math.min(1, completeElapsedSec / RING_FADE_SEC);
  return { alpha: 1, scale: 1, glow: false, ringAlpha };
}

export interface OrchestratorVisual {
  scale: number;
  glow: boolean;
  ringAlpha: number;
}

const SETTLE_SEC = 0.8;

/**
 * Orchestrator pulse per graph state — ports the mockup's `oScale`/`oGlow`
 * switch verbatim, with `elapsedSec` (seconds since `graphState` was
 * entered) substituting for the mockup's `st.t` in the `complete` branch,
 * and the completion ring fading in over `RING_FADE_SEC` of that same clock.
 */
export function orchestratorVisual(graphState: GraphState, tSec: number, elapsedSec: number): OrchestratorVisual {
  if (graphState === 'init') {
    return { scale: 1 + 0.09 * Math.sin(tSec * 7), glow: true, ringAlpha: 0 };
  }
  if (graphState === 'dispatch' || graphState === 'synthesizing') {
    return { scale: 1 + 0.05 * Math.sin(tSec * 5), glow: true, ringAlpha: 0 };
  }
  if (graphState === 'analyzing') {
    return { scale: 1 + 0.03 * Math.sin(tSec * 2.2), glow: true, ringAlpha: 0 };
  }
  if (graphState === 'complete') {
    const ringAlpha = Math.min(1, elapsedSec / RING_FADE_SEC);
    if (elapsedSec < SETTLE_SEC) {
      const scale = 1 + 0.18 * (1 - elapsedSec / SETTLE_SEC) * Math.abs(Math.sin(elapsedSec * 6));
      return { scale, glow: true, ringAlpha };
    }
    return { scale: 1 + 0.02 * Math.sin(tSec * 1.4), glow: false, ringAlpha };
  }
  // idle
  return { scale: 1 + 0.035 * Math.sin(tSec * 1.6), glow: false, ringAlpha: 0 };
}

export interface FloatingText {
  alpha: number;
  yOffset: number;
}

const INIT_TEXT_WINDOW_SEC = 2;

/**
 * INIT's floating "Analyzing patient…" text — the mockup normalizes its own
 * `st.t` to 0..1 over a fixed 2s INIT bucket; here `elapsedSec` (real seconds
 * since the graph entered `init`) is normalized against the same 2s window
 * and clamped, so the text fades in/out on the same curve even though the
 * real `init` state's true duration is whatever the network takes.
 */
export function initFloatingText(elapsedSec: number): FloatingText {
  const t = Math.min(1, Math.max(0, elapsedSec / INIT_TEXT_WINDOW_SEC));
  const fa = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
  return { alpha: Math.max(0, Math.min(1, fa)), yOffset: -t * 8 };
}

/** COMPLETE's "✓ Analysis complete" text: hidden for the first 0.5s, then fades in over the next 0.5s — same shape as the mockup's checkmark hint. */
export function checkmarkAlpha(elapsedSec: number): number {
  if (elapsedSec <= 0.5) return 0;
  return Math.min(1, (elapsedSec - 0.5) / 0.5);
}
