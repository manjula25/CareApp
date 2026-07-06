import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ConfidenceChart, paintConfidenceFrame } from './ConfidenceChart';
import type { ConfidenceBucket } from '../api/client';

const BUCKETS: ConfidenceBucket[] = [
  { range: '0-0.5', count: 2 },
  { range: '0.5-0.7', count: 1 },
  { range: '0.7-0.85', count: 1 },
  { range: '0.85-1.0', count: 4 },
];

/** Same hand-rolled 2D context stub pattern as `PopulationScatterChart.test.tsx`'s `makeStubCtx`. */
function makeStubCtx() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '' as string,
    strokeStyle: '' as string,
    lineWidth: 0,
    font: '' as string,
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
  };
}

describe('paintConfidenceFrame — pure-ish draw seam (direct, no React)', () => {
  it('clears the frame and draws one rounded-top bar per bucket', () => {
    const ctx = makeStubCtx();
    paintConfidenceFrame(ctx as unknown as CanvasRenderingContext2D, 300, 200, BUCKETS);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 300, 200);
    // 4 buckets -> 4 filled bar paths (each uses arcTo for its 2 rounded top corners).
    expect(ctx.arcTo.mock.calls.length).toBe(8);
    expect(ctx.fill.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('renders a count label above and a band label below each bar (fillText called at least twice per bucket)', () => {
    const ctx = makeStubCtx();
    paintConfidenceFrame(ctx as unknown as CanvasRenderingContext2D, 300, 200, BUCKETS);
    expect(ctx.fillText.mock.calls.length).toBeGreaterThanOrEqual(8);
    const texts = ctx.fillText.mock.calls.map((call) => call[0]);
    expect(texts).toContain('2'); // count label for the 0-0.5 bucket
    expect(texts).toContain('85–100%'); // band label for the 0.85-1.0 bucket
  });

  it('does not throw for an all-zero distribution (todays honest state)', () => {
    const ctx = makeStubCtx();
    const allZero = BUCKETS.map((b) => ({ ...b, count: 0 }));
    expect(() => paintConfidenceFrame(ctx as unknown as CanvasRenderingContext2D, 300, 200, allZero)).not.toThrow();
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 300, 200);
  });

  it('does not throw and draws nothing bucket-wise for an empty distribution', () => {
    const ctx = makeStubCtx();
    expect(() => paintConfidenceFrame(ctx as unknown as CanvasRenderingContext2D, 300, 200, [])).not.toThrow();
    expect(ctx.arcTo).not.toHaveBeenCalled();
  });
});

describe('ConfidenceChart — mount/unmount guard (no real canvas context in jsdom)', () => {
  afterEach(() => cleanup());

  it('mounts and unmounts cleanly with no real canvas context', () => {
    const { unmount, container } = render(<ConfidenceChart buckets={BUCKETS} />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });

  it('paints on mount using the buckets prop it was given', () => {
    const ctx = makeStubCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    render(<ConfidenceChart buckets={BUCKETS} />);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.arcTo.mock.calls.length).toBe(8);
    vi.restoreAllMocks();
  });
});
