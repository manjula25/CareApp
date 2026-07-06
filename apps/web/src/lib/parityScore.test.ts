import { describe, it, expect } from 'vitest';
import { computeDimensionParity, buildParityAxes } from './parityScore';
import type { ParityGroupStat, ParityResult } from '../api/client';

const group = (group: string, avgRiskScore: number): ParityGroupStat => ({ group, patientCount: 1, avgRiskScore });

describe('computeDimensionParity — derived 0-1 parity value over real avgRiskScore spread', () => {
  it('is 1.0 (perfect parity) when there are 0 populated groups', () => {
    expect(computeDimensionParity([])).toBe(1);
  });

  it('is 1.0 (nothing to compare) when there is exactly 1 populated group', () => {
    expect(computeDimensionParity([group('65+', 87)])).toBe(1);
  });

  it('is 1.0 when every group has the identical avgRiskScore', () => {
    expect(computeDimensionParity([group('a', 50), group('b', 50), group('c', 50)])).toBe(1);
  });

  it('is 1.0 (not NaN) when every group has an avgRiskScore of 0', () => {
    expect(computeDimensionParity([group('a', 0), group('b', 0)])).toBe(1);
  });

  it('computes 1 - (max-min)/max for a real spread', () => {
    // max=100, min=50 -> 1 - 50/100 = 0.5
    expect(computeDimensionParity([group('a', 100), group('b', 50)])).toBeCloseTo(0.5);
  });

  it('clamps to [0,1] and never goes negative or above 1', () => {
    const result = computeDimensionParity([group('a', 100), group('b', 0)]);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe('buildParityAxes — 4 real axes (age band/sex/race/ethnicity), no fabricated payer/geography/language', () => {
  const PARITY: ParityResult = {
    byAgeBand: [group('65+', 90), group('18-34', 30)],
    bySex: [group('female', 60), group('male', 60)],
    byRace: [group('Black or African American', 92), group('White', 20)],
    byEthnicity: [group('Not Hispanic or Latino', 55)],
  };

  it('produces exactly 4 axes labeled Age Band / Sex / Race / Ethnicity', () => {
    const axes = buildParityAxes(PARITY);
    expect(axes.map((a) => a.label)).toEqual(['Age Band', 'Sex', 'Race', 'Ethnicity']);
  });

  it('derives each axis value from computeDimensionParity over that dimension\'s real groups', () => {
    const axes = buildParityAxes(PARITY);
    const byLabel = Object.fromEntries(axes.map((a) => [a.label, a.value]));
    expect(byLabel['Sex']).toBe(1); // identical avgRiskScore
    expect(byLabel['Ethnicity']).toBe(1); // single populated group
    expect(byLabel['Age Band']).toBeCloseTo(computeDimensionParity(PARITY.byAgeBand));
    expect(byLabel['Race']).toBeCloseTo(computeDimensionParity(PARITY.byRace));
  });
});
