import { bucketFor, extractConfidences, ageFromBirthDate, stratify } from './service';

// Direct unit tests for governance/service.ts's pure helpers — boundary
// cases that are awkward to pin precisely through the HTTP-level fixtures in
// routes/governance.test.ts (which already cover the happy-path shape).
// Same convention population/service.ts uses for projectedCostAvoidance.

describe('bucketFor', () => {
  it('places a value exactly on the 0.5 boundary in the 0.5-0.7 bucket, not 0-0.5', () => {
    expect(bucketFor(0.5)).toBe('0.5-0.7');
  });

  it('places a value exactly on the 0.7 boundary in the 0.7-0.85 bucket, not 0.5-0.7', () => {
    expect(bucketFor(0.7)).toBe('0.7-0.85');
  });

  it('places a value exactly on the 0.85 boundary in the 0.85-1.0 bucket, not 0.7-0.85', () => {
    expect(bucketFor(0.85)).toBe('0.85-1.0');
  });

  it('includes the top bucket upper bound (1.0), unlike the other buckets\' exclusive upper bound', () => {
    expect(bucketFor(1.0)).toBe('0.85-1.0');
  });

  it('places 0 in the lowest bucket', () => {
    expect(bucketFor(0)).toBe('0-0.5');
  });
});

describe('extractConfidences', () => {
  it('collects confidence values across risk/careGap/sdoh finding arrays', () => {
    const resultJson = {
      risk: { findings: [{ confidence: 0.9 }, { confidence: 0.4 }] },
      careGap: { findings: [{ confidence: 0.6 }] },
      sdoh: { findings: [{ confidence: 0.8 }] },
    };
    expect(extractConfidences(resultJson)).toEqual([0.9, 0.4, 0.6, 0.8]);
  });

  it('skips findings with no confidence field, rather than treating it as 0', () => {
    const resultJson = { risk: { findings: [{ text: 'no confidence field' }, { confidence: 0.5 }] } };
    expect(extractConfidences(resultJson)).toEqual([0.5]);
  });

  it('returns an empty array for null/undefined/malformed input', () => {
    expect(extractConfidences(null)).toEqual([]);
    expect(extractConfidences(undefined)).toEqual([]);
    expect(extractConfidences({})).toEqual([]);
    expect(extractConfidences({ risk: { findings: 'not-an-array' } })).toEqual([]);
  });
});

describe('ageFromBirthDate', () => {
  it("returns age unchanged when today is exactly this year's birthday", () => {
    expect(ageFromBirthDate('2000-06-15', new Date('2026-06-15'))).toBe(26);
  });

  it("has not yet incremented the day before this year's birthday", () => {
    expect(ageFromBirthDate('2000-06-15', new Date('2026-06-14'))).toBe(25);
  });

  it("has incremented the day after this year's birthday", () => {
    expect(ageFromBirthDate('2000-06-15', new Date('2026-06-16'))).toBe(26);
  });

  it('returns undefined for a missing or unparseable birthDate', () => {
    expect(ageFromBirthDate(undefined, new Date('2026-06-15'))).toBeUndefined();
    expect(ageFromBirthDate('not-a-date', new Date('2026-06-15'))).toBeUndefined();
  });
});

describe('stratify', () => {
  it('averages riskScore per group and rounds to one decimal place', () => {
    const result = stratify([
      { group: 'A', riskScore: 90 },
      { group: 'A', riskScore: 81 },
      { group: 'B', riskScore: 50 },
    ]);
    expect(result).toEqual(
      expect.arrayContaining([
        { group: 'A', patientCount: 2, avgRiskScore: 85.5 },
        { group: 'B', patientCount: 1, avgRiskScore: 50 },
      ])
    );
  });

  it('skips rows with an undefined group rather than joining an "undefined" bucket', () => {
    const result = stratify([
      { group: 'A', riskScore: 90 },
      { group: undefined, riskScore: 10 },
    ]);
    expect(result).toEqual([{ group: 'A', patientCount: 1, avgRiskScore: 90 }]);
  });

  it('returns an empty array for no rows', () => {
    expect(stratify([])).toEqual([]);
  });
});
