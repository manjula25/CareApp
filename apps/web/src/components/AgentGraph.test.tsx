import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AgentGraph, paintFrame, type FrameTiming } from './AgentGraph';
import { initialAnalysisGraphState, type AnalysisGraphState } from '../lib/analysisGraph';

const RUNNING: AnalysisGraphState = {
  graphState: 'analyzing',
  nodes: { risk: 'complete', careGap: 'analyzing', sdoh: 'pending', actionPlanner: 'pending' },
};

const COMPLETE: AnalysisGraphState = {
  graphState: 'complete',
  nodes: { risk: 'complete', careGap: 'complete', sdoh: 'complete', actionPlanner: 'complete' },
};

/**
 * Minimal hand-rolled 2D context stub — jsdom's `getContext('2d')` returns
 * `null` (no `canvas` npm package installed, and we deliberately don't add
 * one), so without this stub the component early-returns at its null-ctx
 * guard and `paintFrame` never runs, making any "it renders" test a false
 * positive. Every method `paintFrame`/`drawNode`/`drawLabel`/`resize` calls
 * is a spy; every prop they assign is a plain settable field.
 */
function makeStubCtx() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
    fillStyle: '' as string,
    strokeStyle: '' as string,
    lineWidth: 0,
    globalAlpha: 1,
    shadowColor: '' as string,
    shadowBlur: 0,
    font: '' as string,
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
  };
}

const SETTLED_TIMING: FrameTiming = {
  tSec: 0,
  elapsedInStateSec: 1000,
  completeElapsedByAgent: { risk: 1000, careGap: 1000, sdoh: 1000, actionPlanner: 1000 },
};

const ZERO_TIMING: FrameTiming = {
  tSec: 0,
  elapsedInStateSec: 0,
  completeElapsedByAgent: { risk: null, careGap: null, sdoh: null, actionPlanner: null },
};

describe('paintFrame — pure-ish draw seam (direct, no React)', () => {
  it('draws the "✓ Analysis complete" text for a settled complete frame, and omits it at elapsed≈0', () => {
    const settled = makeStubCtx();
    paintFrame(settled as unknown as CanvasRenderingContext2D, 340, 340, COMPLETE, SETTLED_TIMING);
    expect(settled.fillText).toHaveBeenCalledWith(
      expect.stringContaining('Analysis complete'),
      expect.any(Number),
      expect.any(Number)
    );

    const midSettle = makeStubCtx();
    paintFrame(midSettle as unknown as CanvasRenderingContext2D, 340, 340, COMPLETE, ZERO_TIMING);
    const drewCheckmark = midSettle.fillText.mock.calls.some(([txt]) => String(txt).includes('Analysis complete'));
    expect(drewCheckmark).toBe(false);
  });

  it('clears the frame and always labels the orchestrator', () => {
    const ctx = makeStubCtx();
    paintFrame(ctx as unknown as CanvasRenderingContext2D, 340, 340, initialAnalysisGraphState, ZERO_TIMING);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 340, 340);
    const drewOrchestrator = ctx.fillText.mock.calls.some(([txt]) => String(txt) === 'Orchestrator');
    expect(drewOrchestrator).toBe(true);
  });
});

describe('AgentGraph — mount/unmount guard (no real canvas context in jsdom)', () => {
  // These exercise the SSR / null-ctx guard: with jsdom's null `getContext`,
  // the component must mount and tear down cleanly without ever painting.
  it('mounts and unmounts cleanly for the idle state', () => {
    const { unmount } = render(<AgentGraph state={initialAnalysisGraphState} />);
    expect(() => unmount()).not.toThrow();
  });

  it('mounts and unmounts cleanly mid-run, with mixed per-node statuses', () => {
    const { unmount } = render(<AgentGraph state={RUNNING} />);
    expect(() => unmount()).not.toThrow();
  });

  it('mounts and unmounts cleanly once complete', () => {
    const { unmount } = render(<AgentGraph state={COMPLETE} />);
    expect(() => unmount()).not.toThrow();
  });

  it('renders a canvas element', () => {
    const { container } = render(<AgentGraph state={initialAnalysisGraphState} />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
    cleanup();
  });
});

describe('AgentGraph — reduced-motion static frame (real draw path via stub ctx)', () => {
  const originalMatchMedia = window.matchMedia;

  function stubReducedMotion() {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const ctx = makeStubCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    return ctx;
  }

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
    cleanup();
  });

  it('actually paints on mount (the draw path runs without throwing)', () => {
    const ctx = stubReducedMotion();
    render(<AgentGraph state={RUNNING} />);
    // If paintFrame never ran, clearRect would be untouched.
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it('repaints on a state change even though the rAF loop is skipped (guards the 3af3b56 fix)', () => {
    const ctx = stubReducedMotion();
    const { rerender } = render(<AgentGraph state={initialAnalysisGraphState} />);

    const paintsAfterMount = ctx.clearRect.mock.calls.length;
    expect(paintsAfterMount).toBeGreaterThan(0);

    rerender(
      <AgentGraph
        state={{
          graphState: 'analyzing',
          nodes: { risk: 'analyzing', careGap: 'pending', sdoh: 'pending', actionPlanner: 'pending' },
        }}
      />
    );

    // The repaint-on-state-change effect must fire an ADDITIONAL paint. Revert
    // that effect and this count stays flat — the assertion has teeth.
    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(paintsAfterMount);
  });

  it('renders the SETTLED final frame for `complete` — "✓ Analysis complete" text shown, not the elapsed≈0 mid-settle frame (guards Important-1 fix)', () => {
    const ctx = stubReducedMotion();
    render(<AgentGraph state={COMPLETE} />);
    // checkmarkAlpha is 0 at elapsed≈0 and 1 at the settled elapsed value, so
    // this text is only drawn if the static frame paints the resting state.
    expect(ctx.fillText).toHaveBeenCalledWith(
      expect.stringContaining('Analysis complete'),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('repaints on window resize so the canvas is not left blank (guards Minor-3 fix)', () => {
    const ctx = stubReducedMotion();
    render(<AgentGraph state={COMPLETE} />);
    const paintsBeforeResize = ctx.clearRect.mock.calls.length;

    window.dispatchEvent(new Event('resize'));

    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(paintsBeforeResize);
  });
});
