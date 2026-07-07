import { describe, it, expect } from 'vitest';
import { computeGaugeLayout, gaugeColorForRate, QUALITY_GAUGE_PADDING } from './qualityChartGeometry';

describe('computeGaugeLayout — pure rate -> pixel-bar projection for the W05/W07 HEDIS gauge', () => {
  it('fills the track proportionally to rate', () => {
    const layout = computeGaugeLayout(0.5, 300, 60);
    const plotLeft = QUALITY_GAUGE_PADDING.left;
    const plotRight = 300 - QUALITY_GAUGE_PADDING.right;
    expect(layout.trackX).toBeCloseTo(plotLeft);
    expect(layout.trackWidth).toBeCloseTo(plotRight - plotLeft);
    expect(layout.fillWidth).toBeCloseTo((plotRight - plotLeft) * 0.5);
  });

  it('renders a zero-width fill for a 0 rate (the real, honest ~0.3% case rounds visually near-zero but never negative)', () => {
    const layout = computeGaugeLayout(0, 300, 60);
    expect(layout.fillWidth).toBe(0);
  });

  it('caps the fill at the full track width for a rate of 1', () => {
    const layout = computeGaugeLayout(1, 300, 60);
    expect(layout.fillWidth).toBeCloseTo(layout.trackWidth);
  });

  it('clamps an out-of-range rate into [0,1] rather than over/under-filling', () => {
    expect(computeGaugeLayout(1.5, 300, 60).fillWidth).toBeCloseTo(computeGaugeLayout(1, 300, 60).fillWidth);
    expect(computeGaugeLayout(-0.2, 300, 60).fillWidth).toBe(0);
  });
});

describe('gaugeColorForRate — stark-care-gap color banding', () => {
  it('colors a very low rate (this systems real ~0.3%) as a critical-gap red', () => {
    expect(gaugeColorForRate(0.003)).toBe('#E84848');
  });

  it('colors a mid rate as amber and a high rate as emerald', () => {
    expect(gaugeColorForRate(0.6)).toBe('#F0970A');
    expect(gaugeColorForRate(0.9)).toBe('#0FC48A');
  });
});
