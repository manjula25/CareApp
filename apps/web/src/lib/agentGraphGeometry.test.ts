import { describe, it, expect } from 'vitest';
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
} from './agentGraphGeometry';

describe('AGENTS — fixed radial layout matching reference-materials/caresync-ai.html', () => {
  it('has exactly 4 agents in the mockup order (risk, careGap, sdoh, actionPlanner)', () => {
    expect(AGENTS.map((a) => a.agentId)).toEqual(['risk', 'careGap', 'sdoh', 'actionPlanner']);
  });

  it('places risk above, careGap right, sdoh below, actionPlanner left — with the mockup\'s exact offsets', () => {
    const byId = Object.fromEntries(AGENTS.map((a) => [a.agentId, a]));
    expect(byId.risk).toMatchObject({ dx: 0, dy: -130, label: 'above', color: COL.red });
    expect(byId.careGap).toMatchObject({ dx: 160, dy: 0, label: 'right', color: COL.violet });
    expect(byId.sdoh).toMatchObject({ dx: 0, dy: 130, label: 'below', color: COL.emerald });
    expect(byId.actionPlanner).toMatchObject({ dx: -160, dy: 0, label: 'left', color: COL.amber });
  });

  it('uses the mockup\'s exact orchestrator/agent radii and colors', () => {
    expect(ORCHESTRATOR_RADIUS).toBe(36);
    expect(AGENT_RADIUS).toBe(26);
    expect(COL).toMatchObject({
      cyan: '#00C8FF',
      red: '#E84848',
      violet: '#8661D4',
      emerald: '#0FC48A',
      amber: '#F0970A',
    });
  });
});

describe('bez — quadratic bezier point-at-t', () => {
  it('returns p0 at t=0, p1 at t=1, and the midpoint-weighted blend at t=0.5', () => {
    const p0 = { x: 0, y: 0 };
    const c = { x: 10, y: 20 };
    const p1 = { x: 20, y: 0 };
    expect(bez(p0, c, p1, 0)).toEqual({ x: 0, y: 0 });
    expect(bez(p0, c, p1, 1)).toEqual({ x: 20, y: 0 });
    // Quadratic bezier at t=0.5: 0.25*p0 + 0.5*c + 0.25*p1
    expect(bez(p0, c, p1, 0.5)).toEqual({ x: 10, y: 10 });
  });
});

describe('edgeGeom — control-point geometry for orchestrator→agent edges', () => {
  it('anchors p0 at the orchestrator center and p1 at the agent position', () => {
    const g = edgeGeom(100, 100, AGENTS[0]); // risk: dx 0, dy -130
    expect(g.p0).toEqual({ x: 100, y: 100 });
    expect(g.p1).toEqual({ x: 100, y: -30 });
  });

  it('offsets the control point perpendicular to the p0->p1 line by 38px, matching the mockup', () => {
    const g = edgeGeom(0, 0, AGENTS[1]); // careGap: dx 160, dy 0 (straight horizontal line)
    // For a horizontal line, the perpendicular offset is purely vertical.
    expect(g.c.x).toBeCloseTo(80);
    expect(Math.abs(g.c.y)).toBeCloseTo(38);
  });
});

describe('hexToRgba', () => {
  it('converts a hex color + alpha into an rgba() string', () => {
    expect(hexToRgba('#00C8FF', 0.5)).toBe('rgba(0,200,255,0.5)');
    expect(hexToRgba('#E84848', 1)).toBe('rgba(232,72,72,1)');
  });
});

describe('particle-t helpers — per-state elapsed-time-driven motion', () => {
  it('dispatchParticleT bursts outward starting at elapsed=0, second particle joining after 0.25s', () => {
    expect(dispatchParticleT(0)).toEqual([0]);
    expect(dispatchParticleT(0.25)).toEqual([0.25]);
    expect(dispatchParticleT(0.3)[0]).toBeCloseTo(0.3);
    expect(dispatchParticleT(0.3)[1]).toBeCloseTo(0.05);
    expect(dispatchParticleT(2)).toEqual([1, 1]); // clamped at 1
  });

  it('synthesizingParticleT converges home, starting full and counting down', () => {
    expect(synthesizingParticleT(0)).toEqual([1]);
    expect(synthesizingParticleT(0.2)).toEqual([0.8]);
    expect(synthesizingParticleT(0.3)).toEqual([0.7, 0.9]);
    expect(synthesizingParticleT(2)).toEqual([0, 0]); // clamped at 0
  });

  it('analyzingParticleT oscillates continuously off the global animation clock, phase-shifted per agent index', () => {
    const [a, b] = analyzingParticleT(0, 0);
    expect(a).toBeCloseTo(0.5);
    expect(b).toBeCloseTo(0.5);
    // Different phaseIndex produces a different phase.
    const [a2] = analyzingParticleT(0, 1);
    expect(a2).not.toBeCloseTo(a, 5);
  });
});

describe('agentNodeVisual — per-node status drives alpha/scale/glow/ring, independent of siblings', () => {
  it('pending nodes are dim and non-glowing, brighter during dispatch than idle/analyzing/synthesizing/complete', () => {
    const dispatchVisual = agentNodeVisual('pending', 'dispatch', 0, 0, null);
    const idleVisual = agentNodeVisual('pending', 'idle', 0, 0, null);
    expect(dispatchVisual.glow).toBe(false);
    expect(dispatchVisual.ringAlpha).toBe(0);
    expect(dispatchVisual.alpha).toBeGreaterThan(idleVisual.alpha);
  });

  it('analyzing nodes are fully opaque, glowing, and breathe via the global animation clock', () => {
    const v = agentNodeVisual('analyzing', 'analyzing', 1.23, 2, null);
    expect(v.alpha).toBe(1);
    expect(v.glow).toBe(true);
    expect(v.ringAlpha).toBe(0);
    expect(v.scale).not.toBe(1); // breathing sine is non-zero at t=1.23
  });

  it('complete nodes are fully opaque, non-glowing, and fade in a completion ring over 0.5s since that node completed', () => {
    const justCompleted = agentNodeVisual('complete', 'analyzing', 5, 0, 0);
    const halfSettled = agentNodeVisual('complete', 'analyzing', 5, 0, 0.25);
    const settled = agentNodeVisual('complete', 'analyzing', 5, 0, 1);
    expect(justCompleted.alpha).toBe(1);
    expect(justCompleted.glow).toBe(false);
    expect(justCompleted.ringAlpha).toBe(0);
    expect(halfSettled.ringAlpha).toBeCloseTo(0.5);
    expect(settled.ringAlpha).toBe(1);
  });
});

describe('orchestratorVisual — graph-level pulse per state', () => {
  it('breathes gently when idle', () => {
    const v = orchestratorVisual('idle', 0, 0);
    expect(v.glow).toBe(false);
  });

  it('pulses strongly and glows during init', () => {
    const v = orchestratorVisual('init', 0, 0);
    expect(v.glow).toBe(true);
  });

  it('glows during dispatch, analyzing, and synthesizing', () => {
    expect(orchestratorVisual('dispatch', 0, 0).glow).toBe(true);
    expect(orchestratorVisual('analyzing', 0, 0).glow).toBe(true);
    expect(orchestratorVisual('synthesizing', 0, 0).glow).toBe(true);
  });

  it('settles after 0.8s of being complete, dropping the glow', () => {
    expect(orchestratorVisual('complete', 0, 0.1).glow).toBe(true);
    expect(orchestratorVisual('complete', 0, 1).glow).toBe(false);
  });

  it('fades in a completion ring over the first 0.5s of the complete state', () => {
    expect(orchestratorVisual('complete', 0, 0).ringAlpha).toBe(0);
    expect(orchestratorVisual('complete', 0, 0.25).ringAlpha).toBeCloseTo(0.5);
    expect(orchestratorVisual('complete', 0, 1).ringAlpha).toBe(1);
  });

  it('has no ring outside the complete state', () => {
    expect(orchestratorVisual('analyzing', 0, 5).ringAlpha).toBe(0);
  });
});

describe('initFloatingText — "Analyzing patient…" fade-in/out during init', () => {
  it('fades in over the first 15% of the window and out over the last 15%', () => {
    expect(initFloatingText(0).alpha).toBe(0);
    expect(initFloatingText(1).alpha).toBeCloseTo(1);
    expect(initFloatingText(2).alpha).toBeCloseTo(0, 1);
  });

  it('drifts upward (more negative canvas y) as elapsed time increases', () => {
    expect(initFloatingText(0).yOffset).toBeCloseTo(0);
    expect(initFloatingText(1).yOffset).toBeLessThan(initFloatingText(0).yOffset);
  });
});

describe('checkmarkAlpha — "Analysis complete" text fade-in', () => {
  it('is hidden for the first 0.5s of complete, then fades in over the next 0.5s', () => {
    expect(checkmarkAlpha(0)).toBe(0);
    expect(checkmarkAlpha(0.5)).toBe(0);
    expect(checkmarkAlpha(0.75)).toBeCloseTo(0.5);
    expect(checkmarkAlpha(1)).toBe(1);
    expect(checkmarkAlpha(5)).toBe(1);
  });
});
