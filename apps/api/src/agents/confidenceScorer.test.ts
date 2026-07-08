import { PatientBundle } from '../fhir/client';
import {
  scoreRiskFlag,
  scoreCareGap,
  scoreSdohBarrier,
  deriveActionPlannerTaskConfidence,
} from './confidenceScorer';

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
