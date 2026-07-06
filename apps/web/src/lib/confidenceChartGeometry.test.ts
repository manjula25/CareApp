import { describe, it, expect } from 'vitest';
import {
  computeConfidenceBarLayout,
  confidenceBucketColor,
  formatConfidenceBandLabel,
  averageConfidence,
  CONFIDENCE_CHART_PADDING,
} from './confidenceChartGeometry';

describe('computeConfidenceBarLayout — pure bucket-count -> pixel-bar projection', () => {
  const buckets = [
    { range: '0-0.5', count: 2 },
    { range: '0.5-0.7', count: 1 },
    { range: '0.7-0.85', count: 1 },
    { range: '0.85-1.0', count: 4 },
  ];

  it('scales the tallest bar to the full plot height and others proportionally', () => {
    const layout = computeConfidenceBarLayout(buckets, 300, 200);
    expect(layout).toHaveLength(4);
    const tallest = layout.find((b) => b.range === '0.85-1.0')!;
    const plotTop = CONFIDENCE_CHART_PADDING.top;
    const plotBottom = 200 - CONFIDENCE_CHART_PADDING.bottom;
    expect(tallest.y).toBeCloseTo(plotTop);
    expect(tallest.height).toBeCloseTo(plotBottom - plotTop);

    const shortest = layout.find((b) => b.range === '0.5-0.7')!;
    expect(shortest.height).toBeCloseTo((1 / 4) * (plotBottom - plotTop));
  });

  it('lays bars out left-to-right in the given bucket order with equal widths', () => {
    const layout = computeConfidenceBarLayout(buckets, 300, 200);
    expect(layout[0].x).toBeLessThan(layout[1].x);
    expect(layout[1].x).toBeLessThan(layout[2].x);
    expect(layout[2].x).toBeLessThan(layout[3].x);
    expect(layout[0].width).toBeCloseTo(layout[1].width);
  });

  it('does not divide by zero when every bucket count is zero (todays honest all-zero state)', () => {
    const allZero = buckets.map((b) => ({ ...b, count: 0 }));
    const layout = computeConfidenceBarLayout(allZero, 300, 200);
    expect(layout).toHaveLength(4);
    layout.forEach((bar) => {
      expect(bar.height).toBe(0);
      expect(Number.isFinite(bar.y)).toBe(true);
    });
  });

  it('returns an empty layout for an empty bucket list, without throwing', () => {
    expect(() => computeConfidenceBarLayout([], 300, 200)).not.toThrow();
    expect(computeConfidenceBarLayout([], 300, 200)).toEqual([]);
  });
});

describe('confidenceBucketColor — clinical-meaning color mapping (matches governance/service.ts bands)', () => {
  it('maps each real bucket range to a distinct token color', () => {
    expect(confidenceBucketColor('0-0.5')).toBe('#E84848');
    expect(confidenceBucketColor('0.5-0.7')).toBe('#F0970A');
    expect(confidenceBucketColor('0.7-0.85')).toBe('#00C8FF');
    expect(confidenceBucketColor('0.85-1.0')).toBe('#0FC48A');
  });

  it('falls back to a default color for an unrecognized range rather than throwing', () => {
    expect(() => confidenceBucketColor('unexpected')).not.toThrow();
  });
});

describe('formatConfidenceBandLabel — human-readable band label below each bar', () => {
  it('formats a fractional range as a percent range', () => {
    expect(formatConfidenceBandLabel('0-0.5')).toBe('0–50%');
    expect(formatConfidenceBandLabel('0.85-1.0')).toBe('85–100%');
  });
});

describe('averageConfidence — bucket-midpoint approximation over real distribution counts', () => {
  it('returns undefined when every bucket is empty (no confidence values reported yet)', () => {
    const allZero = [
      { range: '0-0.5', count: 0 },
      { range: '0.5-0.7', count: 0 },
      { range: '0.7-0.85', count: 0 },
      { range: '0.85-1.0', count: 0 },
    ];
    expect(averageConfidence(allZero)).toBeUndefined();
  });

  it('computes a count-weighted average of bucket midpoints', () => {
    // All 4 in the top bucket (midpoint .925) -> average is exactly .925.
    const allTop = [
      { range: '0-0.5', count: 0 },
      { range: '0.5-0.7', count: 0 },
      { range: '0.7-0.85', count: 0 },
      { range: '0.85-1.0', count: 4 },
    ];
    expect(averageConfidence(allTop)).toBeCloseTo(0.925);
  });
});
