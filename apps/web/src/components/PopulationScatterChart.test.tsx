import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PopulationScatterChart, paintScatterFrame } from './PopulationScatterChart';
import type { ScatterPoint } from '../api/client';

const POINTS: ScatterPoint[] = [
  { id: 'p1', riskScore: 87, urgency: 90, x: 87, y: 90 },
  { id: 'p2', riskScore: 30, urgency: 10, x: 30, y: 10 },
];

/**
 * Minimal hand-rolled 2D context stub — same pattern as
 * `AgentGraph.test.tsx`'s `makeStubCtx`: jsdom's `getContext('2d')` returns
 * `null`, so without a stub the component early-returns at its null-ctx
 * guard and `paintScatterFrame` never runs.
 */
function makeStubCtx() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: '' as string,
    strokeStyle: '' as string,
    lineWidth: 0,
    font: '' as string,
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
  };
}

describe('paintScatterFrame — pure-ish draw seam (direct, no React)', () => {
  it('clears the frame and draws one dot pair (outer+inner circle) per point', () => {
    const ctx = makeStubCtx();
    paintScatterFrame(ctx as unknown as CanvasRenderingContext2D, 300, 200, POINTS);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 300, 200);
    // 2 points x 2 circles (outer soft + inner solid) = 4 arcs, plus whatever
    // gridline ticks add on top — just assert at least the 4 dot arcs ran.
    expect(ctx.arc.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('draws nothing point-wise for an empty population', () => {
    const ctx = makeStubCtx();
    expect(() => paintScatterFrame(ctx as unknown as CanvasRenderingContext2D, 300, 200, [])).not.toThrow();
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 300, 200);
  });
});

describe('PopulationScatterChart — mount/unmount guard (no real canvas context in jsdom)', () => {
  it('mounts and unmounts cleanly with no real canvas context', () => {
    const { unmount, container } = render(<PopulationScatterChart points={POINTS} />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });
});

describe('PopulationScatterChart — receives points from the caller and paints them (real draw path via stub ctx)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('paints on mount using the points prop it was given', () => {
    const ctx = makeStubCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    render(<PopulationScatterChart points={POINTS} />);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.arc.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('repaints with fewer arcs when given fewer points, proving the prop (not a fixture) drives what is drawn', () => {
    const ctx = makeStubCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    render(<PopulationScatterChart points={[POINTS[0]]} />);
    const arcCallsForOnePoint = ctx.arc.mock.calls.length;

    cleanup();
    const ctx2 = makeStubCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2 as unknown as CanvasRenderingContext2D);
    render(<PopulationScatterChart points={POINTS} />);
    const arcCallsForTwoPoints = ctx2.arc.mock.calls.length;

    expect(arcCallsForTwoPoints).toBeGreaterThan(arcCallsForOnePoint);
  });
});
