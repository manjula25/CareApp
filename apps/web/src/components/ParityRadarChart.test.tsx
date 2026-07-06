import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ParityRadarChart, paintParityFrame } from './ParityRadarChart';
import type { ParityAxis } from '../lib/parityScore';

const AXES: ParityAxis[] = [
  { label: 'Age Band', value: 0.92 },
  { label: 'Sex', value: 1.0 },
  { label: 'Race', value: 0.5 },
  { label: 'Ethnicity', value: 1.0 },
];

/** Same hand-rolled 2D context stub pattern as `PopulationScatterChart.test.tsx`'s `makeStubCtx`. */
function makeStubCtx() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
    setLineDash: vi.fn(),
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

describe('paintParityFrame — pure-ish draw seam (direct, no React)', () => {
  it('clears the frame and draws one vertex dot per axis', () => {
    const ctx = makeStubCtx();
    paintParityFrame(ctx as unknown as CanvasRenderingContext2D, 300, 200, AXES);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 300, 200);
    expect(ctx.arc.mock.calls.length).toBe(AXES.length);
  });

  it('draws a label and a formatted value for each axis', () => {
    const ctx = makeStubCtx();
    paintParityFrame(ctx as unknown as CanvasRenderingContext2D, 300, 200, AXES);
    const texts = ctx.fillText.mock.calls.map((call) => call[0]);
    expect(texts).toContain('Age Band');
    expect(texts).toContain('0.50');
    expect(texts).toContain('1.00');
  });

  it('draws the dashed threshold ring', () => {
    const ctx = makeStubCtx();
    paintParityFrame(ctx as unknown as CanvasRenderingContext2D, 300, 200, AXES);
    expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
  });

  it('does not throw for an empty axis list', () => {
    const ctx = makeStubCtx();
    expect(() => paintParityFrame(ctx as unknown as CanvasRenderingContext2D, 300, 200, [])).not.toThrow();
    expect(ctx.arc).not.toHaveBeenCalled();
  });
});

describe('ParityRadarChart — mount/unmount guard (no real canvas context in jsdom)', () => {
  afterEach(() => cleanup());

  it('mounts and unmounts cleanly with no real canvas context', () => {
    const { unmount, container } = render(<ParityRadarChart axes={AXES} />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });

  it('paints on mount using the axes prop it was given', () => {
    const ctx = makeStubCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    render(<ParityRadarChart axes={AXES} />);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.arc.mock.calls.length).toBe(AXES.length);
    vi.restoreAllMocks();
  });
});
