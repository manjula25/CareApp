import { PatientBundle } from '../fhir/client';
import {
  scoreRiskFlag,
  scoreCareGap,
  scoreSdohBarrier,
  deriveActionPlannerTaskConfidence,
  clampRiskLevel,
} from './confidenceScorer';
import { RiskOutput } from './agent';

/**
 * S14 Commit 3 — TDD for the per-finding confidence scorer.
 *
 * Why heuristic, not model self-report: the model is already biased on Risk
 * (see verification-s13.md §4 LLM variance). A heuristic score is auditable,
 * deterministic, and reproducible — and the model can't bias it.
 *
 * These tests use fixture `PatientBundle` objects (no HAPI I/O). The bundle's
 * `resources` field is the heterogeneous array returned by `getPatientBundle`
 * (each item has `resourceType` and `id` at minimum, plus type-specific fields
 * like `valueQuantity` for Observations, `period` for Encounters). TS structural
 * typing means fixtures can be plain objects — no real FHIR resource shape
 * required beyond the fields the scorer actually reads.
 */

function emptyBundle(): PatientBundle {
  return { resources: [] as any[], validIds: new Set<string>() };
}

function resourceInBundle(bundle: PatientBundle, ref: string) {
  return bundle.validIds.has(ref);
}

describe('confidenceScorer — per-finding bundle-evidence heuristic (S14 Commit 3)', () => {
  describe('scoreRiskFlag (formula: min(0.9, 0.3 + 0.2×citationCount + 0.2×hasAbnormalLab + 0.2×recentEncounter))', () => {
    it('bundle with 1 cited resource + 1 abnormal lab + 0 recent encounters → 0.7 (under cap)', () => {
      // formula: 0.3 + 0.2*1 + 0.2*1 + 0.2*0 = 0.7
      const bundle: PatientBundle = {
        resources: [
          { resourceType: 'Condition', id: 'maria-chen-chf' },
          {
            resourceType: 'Observation',
            id: 'maria-chen-hba1c',
            code: { coding: [{ system: 'http://loinc.org', code: '4548-4' }] },
            valueQuantity: { value: 10.2, unit: '%' },
          },
        ],
        validIds: new Set(['Condition/maria-chen-chf', 'Observation/maria-chen-hba1c']),
      };
      const flag = { fhirResourceId: 'Condition/maria-chen-chf' };

      expect(scoreRiskFlag(flag, bundle)).toBe(0.7);
    });

    it('bundle with 0 cited resources, no abnormal labs, no recent encounters → 0.3 (floor)', () => {
      // formula: 0.3 + 0.2*0 + 0.2*0 + 0.2*0 = 0.3
      const bundle = emptyBundle();
      const flag = { fhirResourceId: 'Condition/does-not-exist' };

      expect(scoreRiskFlag(flag, bundle)).toBe(0.3);
    });
  });

  describe('scoreCareGap (0.9 if cited Condition in bundle AND matching Observation absent; 0.4 if only one present; 0.2 if neither)', () => {
    it('cites a Condition in the bundle with the matching Observation absent → 0.9', () => {
      // Diabetes (E11.9) condition present, but no HbA1c Observation in bundle.
      // Per data/eval/labels.json _meta.labelingRules.careGap, the matching
      // LOINC for E11.9 is 4548-4. Gap is "real and explicit" → 0.9.
      const bundle: PatientBundle = {
        resources: [
          {
            resourceType: 'Condition',
            id: 'patient-x-e11.9',
            code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9' }] },
          },
        ],
        validIds: new Set(['Condition/patient-x-e11.9']),
      };
      const gap = { fhirResourceId: 'Condition/patient-x-e11.9' };

      expect(scoreCareGap(gap, bundle)).toBe(0.9);
    });
  });

  describe('scoreSdohBarrier (0.9 if cited resource is AHC-HRSN Observation with positive screening; 0.4 if cited but wrong type; 0.2 if not in bundle)', () => {
    it('cites an AHC-HRSN Observation (LOINC 71802-3) whose valueString does NOT match /no barriers/i → 0.9', () => {
      // SDOH positive screening: a real AHC-HRSN Observation with positive
      // finding text. Confident → 0.9.
      const bundle: PatientBundle = {
        resources: [
          {
            resourceType: 'Observation',
            id: 'maria-chen-sdoh',
            code: { coding: [{ system: 'http://loinc.org', code: '71802-3' }] },
            valueString: 'Transportation barriers; financial barriers',
          },
        ],
        validIds: new Set(['Observation/maria-chen-sdoh']),
      };
      const barrier = { fhirResourceId: 'Observation/maria-chen-sdoh' };

      expect(scoreSdohBarrier(barrier, bundle)).toBe(0.9);
    });

    it('cites an AHC-HRSN Observation whose valueString says "no social barriers identified" → 0.4 (explicit-negative screening)', () => {
      // Pre-S16 latent bug: the regex was `/no barriers/i` which does NOT
      // match "no social barriers identified" (the actual seed text in
      // `seed-patients.ts:robert-kim-sdoh` and `population.ts:pop-0005-sdoh`).
      // Pin the fix to the same wording the S15 `labelFromBundle.ts` test
      // uses, so the two codepaths stay in sync.
      const bundle: PatientBundle = {
        resources: [
          {
            resourceType: 'Observation',
            id: 'robert-kim-sdoh',
            code: { coding: [{ system: 'http://loinc.org', code: '71802-3' }] },
            valueString: 'AHC-HRSN screening: no social barriers identified',
          },
        ],
        validIds: new Set(['Observation/robert-kim-sdoh']),
      };
      const barrier = { fhirResourceId: 'Observation/robert-kim-sdoh' };

      expect(scoreSdohBarrier(barrier, bundle)).toBe(0.4);
    });
  });

  describe('deriveActionPlannerTaskConfidence (task.confidence = min of contributing findings, floor 0.2)', () => {
    it('task with 2 contributing findings at confidences 0.7 and 0.4 → 0.4 (min)', () => {
      // The synthesized task inherits the minimum of its supporting findings'
      // confidence — a task can't claim more confidence than its weakest
      // citation.
      const tasks = [
        {
          fhirResources: ['Condition/maria-chen-chf', 'Observation/maria-chen-bnp'],
        },
      ];
      const findings = [
        { fhirResourceId: 'Condition/maria-chen-chf', confidence: 0.7 },
        { fhirResourceId: 'Observation/maria-chen-bnp', confidence: 0.4 },
      ];

      expect(deriveActionPlannerTaskConfidence(tasks, findings)).toEqual([0.4]);
    });
  });

  // Helper sanity: the empty-bundle resourceInBundle check is used by other
  // tests in this file; pin the contract here so a refactor of fixture shape
  // is regression-caught.
  it('fixture helper: resourceInBundle is false on empty bundle', () => {
    expect(resourceInBundle(emptyBundle(), 'Anything/whatever')).toBe(false);
  });
});

describe('clampRiskLevel (S17 — deterministic post-hoc risk-level clamp)', () => {
  const highOutput: RiskOutput = {
    riskScore: 80,
    riskLevel: 'high',
    flags: [],
    readmissionProbability: 0.7,
  };

  it('clamps 2-anchor-without-labs FP to moderate (pop-0004 pattern: diabetes+CHF, recent encounter, no Observations)', () => {
    const bundle: PatientBundle = {
      resources: [
        { resourceType: 'Condition', id: 'cond-diabetes', code: { coding: [{ code: 'E11.9' }] } },
        { resourceType: 'Condition', id: 'cond-chf', code: { coding: [{ code: 'I50.9' }] } },
        { resourceType: 'Encounter', id: 'enc-1', period: { end: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() } },
      ],
      validIds: new Set(['Condition/cond-diabetes', 'Condition/cond-chf', 'Encounter/enc-1']),
    };

    const result = clampRiskLevel(bundle, highOutput);
    expect(result.riskLevel).toBe('moderate');
    expect(result.riskScore).toBe(80); // score preserved
  });

  it('clamps 0-anchor FP to moderate (james-okafor pattern: COPD only, no encounter, no labs)', () => {
    const bundle: PatientBundle = {
      resources: [
        { resourceType: 'Condition', id: 'cond-copd', code: { coding: [{ code: 'J44.9' }] } },
      ],
      validIds: new Set(['Condition/cond-copd']),
    };

    const result = clampRiskLevel(bundle, highOutput);
    expect(result.riskLevel).toBe('moderate');
  });

  it('preserves high for abnormal-lab + recent-encounter override (samuel-wright pattern: CHF + BNP 380 + 36h discharge)', () => {
    const bundle: PatientBundle = {
      resources: [
        { resourceType: 'Condition', id: 'cond-chf', code: { coding: [{ code: 'I50.9' }] } },
        {
          resourceType: 'Observation',
          id: 'obs-bnp',
          code: { coding: [{ system: 'http://loinc.org', code: '30934-4' }] },
          valueQuantity: { value: 380, unit: 'pg/mL' },
        },
        { resourceType: 'Encounter', id: 'enc-1', period: { end: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString() } },
      ],
      validIds: new Set(['Condition/cond-chf', 'Observation/obs-bnp', 'Encounter/enc-1']),
    };

    const result = clampRiskLevel(bundle, highOutput);
    expect(result.riskLevel).toBe('high');
  });

  it('preserves high when deterministic score ≥ 75 (maria-chen pattern: 3 conditions + recent encounter)', () => {
    const bundle: PatientBundle = {
      resources: [
        { resourceType: 'Condition', id: 'cond-diabetes', code: { coding: [{ code: 'E11.9' }] } },
        { resourceType: 'Condition', id: 'cond-chf', code: { coding: [{ code: 'I50.9' }] } },
        { resourceType: 'Condition', id: 'cond-depression', code: { coding: [{ code: 'F33.1' }] } },
        { resourceType: 'Encounter', id: 'enc-1', period: { end: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() } },
      ],
      validIds: new Set(['Condition/cond-diabetes', 'Condition/cond-chf', 'Condition/cond-depression', 'Encounter/enc-1']),
    };

    const result = clampRiskLevel(bundle, highOutput);
    expect(result.riskLevel).toBe('high');
  });

  it('does not clamp low or moderate levels', () => {
    const bundle = emptyBundle();
    const lowOutput: RiskOutput = { ...highOutput, riskLevel: 'low' };
    const modOutput: RiskOutput = { ...highOutput, riskLevel: 'moderate' };

    expect(clampRiskLevel(bundle, lowOutput).riskLevel).toBe('low');
    expect(clampRiskLevel(bundle, modOutput).riskLevel).toBe('moderate');
  });
});

// S19 Thread D — safety-net transparency. The clamp's behavior is
// unchanged from S17 (logic preserved exactly). The change is the
// `_safetyNetApplied` sentinel on the returned object: when the clamp
// downgrades, the sentinel describes the intervention. When the clamp
// is a no-op (preserves or is non-applicable), no sentinel is attached.
describe('clampRiskLevel — _safetyNetApplied sentinel (S19 Thread D)', () => {
  const highOutput: RiskOutput = {
    riskScore: 80,
    riskLevel: 'high',
    flags: [],
    readmissionProbability: 0.7,
  };

  it('attaches _safetyNetApplied when downgrading high → moderate on a 2-anchor-without-labs bundle', () => {
    const bundle: PatientBundle = {
      resources: [
        { resourceType: 'Condition', id: 'cond-diabetes', code: { coding: [{ code: 'E11.9' }] } },
        { resourceType: 'Condition', id: 'cond-chf', code: { coding: [{ code: 'I50.9' }] } },
        { resourceType: 'Encounter', id: 'enc-1', period: { end: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() } },
      ],
      validIds: new Set(['Condition/cond-diabetes', 'Condition/cond-chf', 'Encounter/enc-1']),
    };

    const result = clampRiskLevel(bundle, highOutput);
    expect(result.riskLevel).toBe('moderate');
    expect(result._safetyNetApplied).toBeDefined();
    expect(result._safetyNetApplied!.kind).toBe('risk-level-clamped');
    expect(result._safetyNetApplied!.from).toBe('high');
    expect(result._safetyNetApplied!.to).toBe('moderate');
    expect(result._safetyNetApplied!.conditionCount).toBe(2);
    // Recency: 8 days ≈ 192h. riskScoreFor(2, 192): 168 < 192 ≤ 720 →
    // recency bonus = 0.04. 0.10 + 0.36 + 0.04 + 0 (no 3-condition
    // bonus for 2-condition mix) = 0.50 → 50.
    expect(result._safetyNetApplied!.recencyHours).toBeCloseTo(192, -1);
    expect(result._safetyNetApplied!.deterministicScore).toBe(50);
  });

  it('attaches _safetyNetApplied when downgrading critical → moderate (pop-0007 fixture pattern)', () => {
    // pop-0007-style bundle: 3-condition comorbidity, 24h recent
    // discharge, NO Observations. Per the v3 rubric Rule 2, the agent's
    // call would be 'high' or 'critical' based on Anchor A + B; the
    // clamp downgrades because deterministicScore depends on the recency
    // (here: 24h → bonus +0.20 → 0.10+0.54+0.20+0.08 = 0.92 → 92). At
    // 92, deterministicScore >= 75 → FIRST preservation fires → output
    // preserved. So pop-0007 (i=6) with recency=24h actually does NOT
    // trigger the clamp. The realistic pop-0007-clamp scenario is when
    // the recency is past the 720h bonus but the LLM still called
    // 'high'. Build that bundle here.
    const bundle: PatientBundle = {
      resources: [
        { resourceType: 'Condition', id: 'cond-1', code: { coding: [{ code: 'E11.9' }] } },
        { resourceType: 'Condition', id: 'cond-2', code: { coding: [{ code: 'I50.9' }] } },
        { resourceType: 'Condition', id: 'cond-3', code: { coding: [{ code: 'F33.1' }] } },
        // Encounter 800h ago (~33 days ago) — past the 720h bonus,
        // recency bonus = 0. deterministicScore = 0.10+0.54+0+0.08 = 0.72 → 72 < 75.
        { resourceType: 'Encounter', id: 'enc-1', period: { end: new Date(Date.now() - 800 * 60 * 60 * 1000).toISOString() } },
      ],
      validIds: new Set(['Condition/cond-1', 'Condition/cond-2', 'Condition/cond-3', 'Encounter/enc-1']),
    };
    const criticalOutput: RiskOutput = { ...highOutput, riskLevel: 'critical' };

    const result = clampRiskLevel(bundle, criticalOutput);
    expect(result.riskLevel).toBe('moderate');
    expect(result._safetyNetApplied).toBeDefined();
    expect(result._safetyNetApplied!.kind).toBe('risk-level-clamped');
    expect(result._safetyNetApplied!.from).toBe('critical');
    expect(result._safetyNetApplied!.to).toBe('moderate');
    expect(result._safetyNetApplied!.conditionCount).toBe(3);
    expect(result._safetyNetApplied!.deterministicScore).toBe(72);
  });

  it('does NOT attach _safetyNetApplied when the clamp is a no-op (preserves high on samuel-wright pattern)', () => {
    const bundle: PatientBundle = {
      resources: [
        { resourceType: 'Condition', id: 'cond-chf', code: { coding: [{ code: 'I50.9' }] } },
        {
          resourceType: 'Observation',
          id: 'obs-bnp',
          code: { coding: [{ system: 'http://loinc.org', code: '30934-4' }] },
          valueQuantity: { value: 380, unit: 'pg/mL' },
        },
        { resourceType: 'Encounter', id: 'enc-1', period: { end: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString() } },
      ],
      validIds: new Set(['Condition/cond-chf', 'Observation/obs-bnp', 'Encounter/enc-1']),
    };

    const result = clampRiskLevel(bundle, highOutput);
    expect(result.riskLevel).toBe('high');
    expect(result._safetyNetApplied).toBeUndefined();
  });

  it('does NOT attach _safetyNetApplied for low or moderate inputs (clamp is non-applicable)', () => {
    const bundle = emptyBundle();
    const lowOutput: RiskOutput = { ...highOutput, riskLevel: 'low' };
    const modOutput: RiskOutput = { ...highOutput, riskLevel: 'moderate' };

    expect(clampRiskLevel(bundle, lowOutput)._safetyNetApplied).toBeUndefined();
    expect(clampRiskLevel(bundle, modOutput)._safetyNetApplied).toBeUndefined();
  });

  it('preserves riskScore through the clamp (only riskLevel changes)', () => {
    // The clamp's design rule (S17 §3): "The score is preserved regardless
    // of the level change — only the label is corrected." The sentinel
    // records the deterministic score separately; the original output's
    // riskScore is unchanged.
    const bundle: PatientBundle = {
      resources: [
        { resourceType: 'Condition', id: 'cond-copd', code: { coding: [{ code: 'J44.9' }] } },
      ],
      validIds: new Set(['Condition/cond-copd']),
    };
    const result = clampRiskLevel(bundle, { ...highOutput, riskScore: 88 });
    expect(result.riskScore).toBe(88); // preserved
    expect(result.riskLevel).toBe('moderate'); // downgraded
    expect(result._safetyNetApplied).toBeDefined();
  });
});
