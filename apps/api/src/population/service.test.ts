import { projectedCostAvoidance, READMISSION_UNIT_COST_USD, AVOIDED_READMISSION_RATE, _testing } from './service';

describe('projectedCostAvoidance', () => {
  // Deterministic fixture — no HAPI involved. Documents the exact formula:
  //   expectedReadmissions = sum(riskScore / 100)   (risk-weighted readmission count)
  //   avoidedReadmissions  = expectedReadmissions * AVOIDED_READMISSION_RATE
  //   cost avoidance       = avoidedReadmissions * READMISSION_UNIT_COST_USD
  it('computes risk-weighted avoided-readmission cost avoidance from a fixed fixture', () => {
    const riskScores = [80, 60, 40]; // expectedReadmissions = 0.8 + 0.6 + 0.4 = 1.8
    const expected = Math.round(1.8 * AVOIDED_READMISSION_RATE * READMISSION_UNIT_COST_USD);

    expect(projectedCostAvoidance(riskScores)).toBe(expected);
    // Pin the exact number too, so a silent constant change is caught even
    // if someone "fixes" the formula derivation above to match it.
    expect(projectedCostAvoidance(riskScores)).toBe(5472);
  });

  it('returns 0 for an empty population', () => {
    expect(projectedCostAvoidance([])).toBe(0);
  });

  it('scales linearly with risk score magnitude', () => {
    expect(projectedCostAvoidance([100])).toBe(Math.round(1 * AVOIDED_READMISSION_RATE * READMISSION_UNIT_COST_USD));
  });
});

// S12 A.3 — pure bucketing for the risk-distribution bar chart. Boundary
// tests pin each threshold exactly: a score of 75 must land in `critical`
// (>= CRITICAL_RISK_THRESHOLD), 74 must drop to `high`, etc. Keeping these
// tests next to the formula makes the contract auditable.
describe('bucketFor (risk-distribution)', () => {
  const { bucketFor } = _testing;

  it('classifies >=75 as critical', () => {
    expect(bucketFor(75)).toBe('critical');
    expect(bucketFor(100)).toBe('critical');
  });

  it('classifies 60-74 as high (boundary at 74)', () => {
    expect(bucketFor(74)).toBe('high');
    expect(bucketFor(60)).toBe('high');
  });

  it('classifies 40-59 as medium (boundary at 59)', () => {
    expect(bucketFor(59)).toBe('medium');
    expect(bucketFor(40)).toBe('medium');
  });

  it('classifies <40 as low (boundary at 0)', () => {
    expect(bucketFor(39)).toBe('low');
    expect(bucketFor(0)).toBe('low');
  });
});
