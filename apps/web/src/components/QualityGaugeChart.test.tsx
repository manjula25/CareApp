import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QualityGaugeChart, paintQualityGaugeFrame } from './QualityGaugeChart';

const DATA = { rate: 1 / 286, numerator: 1, denominator: 286, gapPatients: 285 };

/** Same hand-rolled 2D context stub pattern as `ConfidenceChart.test.tsx`'s `makeStubCtx`. */
function makeStubCtx() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
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

describe('paintQualityGaugeFrame — pure draw seam (direct, no React)', () => {
  it('clears the frame and draws a track + a proportional fill', () => {
    const ctx = makeStubCtx();
    paintQualityGaugeFrame(ctx as unknown as CanvasRenderingContext2D, 300, 60, DATA);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 300, 60);
    // 2 rounded rects (track + fill), each using arcTo for its 2 rounded top corners.
    expect(ctx.arcTo.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('labels numerator/denominator and the gap-patient count', () => {
    const ctx = makeStubCtx();
    paintQualityGaugeFrame(ctx as unknown as CanvasRenderingContext2D, 300, 60, DATA);
    const texts = ctx.fillText.mock.calls.map((call) => String(call[0]));
    expect(texts.some((t) => t.includes('1') && t.includes('286'))).toBe(true);
    expect(texts.some((t) => t.includes('285'))).toBe(true);
  });

  it('does not throw for a zero-denominator (no diagnosed patients) edge case', () => {
    const ctx = makeStubCtx();
    expect(() =>
      paintQualityGaugeFrame(ctx as unknown as CanvasRenderingContext2D, 300, 60, { rate: 0, numerator: 0, denominator: 0, gapPatients: 0 })
    ).not.toThrow();
  });
});

describe('QualityGaugeChart — mount/unmount guard (no real canvas context in jsdom)', () => {
  afterEach(() => cleanup());

  it('mounts and unmounts cleanly with no real canvas context', () => {
    const { unmount, container } = render(<QualityGaugeChart {...DATA} />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });

  it('paints on mount using the data props it was given', () => {
    const ctx = makeStubCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    render(<QualityGaugeChart {...DATA} />);
    expect(ctx.clearRect).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
