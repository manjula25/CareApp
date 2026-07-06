import { describe, it, expect } from 'vitest';
import { radiusForValue, axisColor, axisPoint, RADAR_VMIN, RADAR_RINGS, RADAR_THRESHOLD } from './parityRadarGeometry';

describe('radiusForValue — radial scale floor (ported from the mockup so small gaps read)', () => {
  it('exposes the same VMIN floor as the mockup (0.75)', () => {
    expect(RADAR_VMIN).toBe(0.75);
  });

  it('maps the floor value to radius 0', () => {
    expect(radiusForValue(RADAR_VMIN, 100)).toBe(0);
  });

  it('maps 1.0 (perfect parity) to the full radius', () => {
    expect(radiusForValue(1, 100)).toBeCloseTo(100);
  });

  it('clamps below the floor to radius 0 rather than a negative radius', () => {
    expect(radiusForValue(0, 100)).toBe(0);
  });
});

describe('axisColor — same emerald/amber/red thresholds as the mockup', () => {
  it('is emerald at/above 0.90', () => {
    expect(axisColor(0.9)).toBe('emerald');
    expect(axisColor(1)).toBe('emerald');
  });

  it('is amber between 0.885 and 0.90', () => {
    expect(axisColor(0.885)).toBe('amber');
    expect(axisColor(0.89)).toBe('amber');
  });

  it('is red below 0.885', () => {
    expect(axisColor(0.5)).toBe('red');
    expect(axisColor(0)).toBe('red');
  });
});

describe('axisPoint — evenly-spaced axis positions around a center, starting at 12 oclock', () => {
  it('places the first axis straight up from center', () => {
    const p = axisPoint(0, 4, 100, 50, 50);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(-50);
  });

  it('places 4 axes 90 degrees apart', () => {
    const top = axisPoint(0, 4, 100, 0, 0);
    const right = axisPoint(1, 4, 100, 0, 0);
    expect(top.x).toBeCloseTo(0);
    expect(right.x).toBeCloseTo(100);
    expect(right.y).toBeCloseTo(0);
  });
});

describe('RADAR_RINGS / RADAR_THRESHOLD — visual structure ported from the mockup', () => {
  it('keeps the mockups grid ring values and 0.90 dashed threshold', () => {
    expect(RADAR_RINGS).toEqual([0.8, 0.85, 0.95]);
    expect(RADAR_THRESHOLD).toBe(0.9);
  });
});
