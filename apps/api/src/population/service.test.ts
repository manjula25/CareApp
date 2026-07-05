import { projectedCostAvoidance, READMISSION_UNIT_COST_USD, AVOIDED_READMISSION_RATE } from './service';

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
