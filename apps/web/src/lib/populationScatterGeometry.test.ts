import { describe, it, expect } from 'vitest';
import {
  projectPoint,
  scatterDotRadius,
  scatterPointColor,
  scatterPointQuadrant,
  pixelToQuadrant,
  QUADRANT_RISK_THRESHOLD,
  QUADRANT_URGENCY_THRESHOLD,
  QUADRANT_LABEL,
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

describe('scatterPointQuadrant — risk(x) x urgency(y) quadrant split (Task B3 click semantic)', () => {
  it('exposes the chosen thresholds (60/60, reusing the amber risk-dot cutoff from lib/patient.ts)', () => {
    expect(QUADRANT_RISK_THRESHOLD).toBe(60);
    expect(QUADRANT_URGENCY_THRESHOLD).toBe(60);
  });

  it('buckets high risk + high urgency as critical', () => {
    expect(scatterPointQuadrant({ x: 87, y: 90 })).toBe('critical');
    expect(scatterPointQuadrant({ x: 60, y: 60 })).toBe('critical'); // boundary is inclusive
  });

  it('buckets low risk + high urgency as monitor', () => {
    expect(scatterPointQuadrant({ x: 30, y: 90 })).toBe('monitor');
  });

  it('buckets low risk + low urgency as stable', () => {
    expect(scatterPointQuadrant({ x: 20, y: 5 })).toBe('stable');
  });

  it('buckets high risk + low urgency as watch (overdue contact)', () => {
    expect(scatterPointQuadrant({ x: 87, y: 10 })).toBe('watch');
  });

  it('exposes the mockup quadrant label text for each band', () => {
    expect(QUADRANT_LABEL).toEqual({
      critical: 'Critical — Act Now',
      monitor: 'Monitor — Trending Up',
      stable: 'Stable — Routine',
      watch: 'Watch — Overdue Contact',
    });
  });
});

describe('pixelToQuadrant — click hit-testing, inverting the SAME projectPoint geometry paint uses', () => {
  // width=300,height=200, default padding -> x0=38,x1=286,y0=166,y1=16 (same
  // fixture as projectPoint's own describe block above). The (60,60) data
  // threshold projects to pixel (186.8, 76), so picking one click pixel per
  // side of that crosshair exercises all four bands without duplicating the
  // threshold math — this function inverts `projectPoint` instead of
  // re-deriving it.
  it('reports critical for a click right-and-above the threshold crosshair', () => {
    expect(pixelToQuadrant({ x: 250, y: 40 }, 300, 200)).toBe('critical');
  });

  it('reports monitor for a click left-and-above the threshold crosshair', () => {
    expect(pixelToQuadrant({ x: 50, y: 40 }, 300, 200)).toBe('monitor');
  });

  it('reports stable for a click left-and-below the threshold crosshair', () => {
    expect(pixelToQuadrant({ x: 50, y: 150 }, 300, 200)).toBe('stable');
  });

  it('reports watch for a click right-and-below the threshold crosshair', () => {
    expect(pixelToQuadrant({ x: 250, y: 150 }, 300, 200)).toBe('watch');
  });

  it('agrees with scatterPointQuadrant at the exact projected pixel of a data point', () => {
    const dataPoint = { x: 72, y: 81 };
    const pixel = projectPoint(dataPoint, 300, 200);
    expect(pixelToQuadrant(pixel, 300, 200)).toBe(scatterPointQuadrant(dataPoint));
  });
});
