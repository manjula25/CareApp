import { describe, it, expect } from 'vitest';
import {
  projectPoint,
  scatterDotRadius,
  scatterPointColor,
  SCATTER_PADDING,
  SCATTER_TICKS,
} from './populationScatterGeometry';
import type { ScatterPoint } from '../api/client';

describe('projectPoint — pure risk(x) x urgency(y) -> pixel projection', () => {
  it('projects a known point to the expected pixel inside a 300x200 chart with default padding', () => {
    // width=300,height=200, padding {left:38,right:14,top:16,bottom:34}
    // x0=38, x1=286, y0=166, y1=16
    expect(projectPoint({ x: 0, y: 0 }, 300, 200)).toEqual({ x: 38, y: 166 });
    expect(projectPoint({ x: 100, y: 100 }, 300, 200)).toEqual({ x: 286, y: 16 });
    expect(projectPoint({ x: 50, y: 50 }, 300, 200)).toEqual({ x: 162, y: 91 });
  });

  it('honors a custom padding argument', () => {
    const padding = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(projectPoint({ x: 0, y: 0 }, 100, 100, padding)).toEqual({ x: 0, y: 100 });
    expect(projectPoint({ x: 100, y: 100 }, 100, 100, padding)).toEqual({ x: 100, y: 0 });
  });

  it('exposes the shared axis ticks and padding used by both axes', () => {
    expect(SCATTER_TICKS).toEqual([0, 25, 50, 75, 100]);
    expect(SCATTER_PADDING).toEqual({ left: 38, right: 14, top: 16, bottom: 34 });
  });
});

describe('scatterDotRadius — deterministic 5-7px radius', () => {
  it('is stable for the same point and varies only with position', () => {
    const a = scatterDotRadius({ x: 87, y: 2 });
    const b = scatterDotRadius({ x: 87, y: 2 });
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(5);
    expect(a).toBeLessThanOrEqual(7);
  });
});

describe('scatterPointColor — reuses lib/patient.ts riskDotColor thresholds', () => {
  const point = (riskScore: number): ScatterPoint => ({ id: 'p1', riskScore, urgency: 0, x: riskScore, y: 0 });

  it('buckets riskScore into the same 4 colors as the patient panel risk dot', () => {
    expect(scatterPointColor(point(87))).toBe('red');
    expect(scatterPointColor(point(65))).toBe('amber');
    expect(scatterPointColor(point(45))).toBe('violet');
    expect(scatterPointColor(point(10))).toBe('emerald');
  });
});
