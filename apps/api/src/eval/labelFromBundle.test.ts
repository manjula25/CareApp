/**
 * S15 Commit 2 — TDD scaffolding for `labelFromBundle.ts`.
 *
 * Pin the factoring of `data/eval/labels.json:_meta.labelingRules` into a
 * single pure function so both the dev-labeled 16 rows and the held-out 10
 * rows score against the same code. Pure = no I/O, no LLM, no global state,
 * deterministic to within the stubbed `riskScoreFor` for the Risk branch.
 *
 * Test fixture shape mirrors the FHIR resources `import-fhir.ts` produces
 * (Condition: `code.coding[].system === 'http://hl7.org/fhir/sid/icd-10-cm'`;
 * Observation: `code.coding[].system === 'http://loinc.org'`; SDOH
 * Observation: LOINC 71802-3 + `valueString` carrying the screening
 * narrative). See `agents/confidenceScorer.ts` for the same shape usage.
 *
 * The Risk branch mocks the `riskScoreFor` import rather than constructing
 * a bundle that deterministically yields a particular score — bundles in
 * the real system have variable Encounter + Condition shapes, so a stub
 * keeps these tests focused on labelFromBundle's own contract (does it
 * read the right resources and apply the >= 75 threshold correctly?).
 */

// `riskScoreFor` is mocked at the module boundary. The stub returns a
// configurable number from each test so the bundle-shape concerns stay
// out of the labeling-function's contract.
jest.mock('../fhir-data/population', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  riskScoreFor: jest.fn(),
}));
import { riskScoreFor } from '../fhir-data/population';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const riskScoreForMock = riskScoreFor as jest.Mock;

import { PatientBundle } from '../fhir/client';
import { labelFromBundle } from './labelFromBundle';

// --- FHIR-resource fixture builders ----------------------------------------
// These build the *exact* resource shapes import-fhir.ts produces for the
// seeded patients, so we're not testing against a hypothetical shape.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function conditionResource(id: string, icd10: string): any {
  return {
    resourceType: 'Condition',
    id,
    clinicalStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
    },
    code: {
      coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: icd10, display: icd10 }],
      text: icd10,
    },
    subject: { reference: 'Patient/test' },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function observationResource(id: string, loincCode: string): any {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: {
      coding: [{ system: 'http://loinc.org', code: loincCode, display: loincCode }],
      text: loincCode,
    },
    subject: { reference: 'Patient/test' },
    effectiveDateTime: new Date().toISOString(),
    valueQuantity: { value: 0, unit: 'unit' },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ahcHrsnObservation(id: string, valueString: string): any {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [
      { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'sdoh' }] },
    ],
    code: {
      coding: [{ system: 'http://loinc.org', code: '71802-3', display: 'AHC-HRSN Screening' }],
      text: 'AHC-HRSN Screening',
    },
    subject: { reference: 'Patient/test' },
    effectiveDateTime: new Date().toISOString(),
    valueString,
  };
}

function emptyBundle(): PatientBundle {
  return { resources: [], validIds: new Set<string>() };
}

function bundleWith(...resources: object[]): PatientBundle {
  // validIds includes all the resources' "Type/id" refs so confidenceScorer-style
  // helpers in the same ecosystem keep working, but labelFromBundle itself only
  // reads resources[]. Leaving validIds empty would also be valid — set it
  // consistently because some peer modules consult it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const validIds = new Set<string>(resources.map((r: any) => `${r.resourceType}/${r.id}`));
  return { resources, validIds };
}

// --- careGap ---------------------------------------------------------------

describe('labelFromBundle — careGap (data/eval/labels.json:_meta.labelingRules.careGap)', () => {
  it('returns true when a qualifying Condition (E11.9) is present but its required LOINC Observation (4548-4) is missing', () => {
    const bundle = bundleWith(conditionResource('p-cond-1', 'E11.9'));
    expect(labelFromBundle(bundle, 'careGap')).toBe(true);
  });

  it('returns false when the qualifying Condition (E11.9) AND its required Observation (4548-4) are both present', () => {
    const bundle = bundleWith(
      conditionResource('p-cond-1', 'E11.9'),
      observationResource('p-hba1c', '4548-4'),
    );
    expect(labelFromBundle(bundle, 'careGap')).toBe(false);
  });

  it('returns null when the Condition has no established LOINC convention in this codebase (F33.1, depression)', () => {
    // F33.1 has no LOINC/required-Observation mapping; per
    // _meta.labelingRules.careGap, conditions without an established
    // convention are "left UNLABELED ... rather than guessing".
    const bundle = bundleWith(conditionResource('p-cond-1', 'F33.1'));
    expect(labelFromBundle(bundle, 'careGap')).toBeNull();
  });
});

// --- risk ------------------------------------------------------------------

describe('labelFromBundle — risk (_meta.labelingRules.risk: riskScoreFor >= 75)', () => {
  beforeEach(() => {
    riskScoreForMock.mockReset();
  });

  it('returns true when the underlying riskScoreFor returns 87 (>= 75 critical-zone threshold)', () => {
    riskScoreForMock.mockReturnValue(87);
    // Bundle carries one Encounter so the global "no resources → null"
    // short-circuit doesn't kick in; the mocked riskScoreFor returns 87
    // regardless of args, so bundle shape doesn't need to be realistic.
    const bundle = bundleWith({ resourceType: 'Encounter', id: 'p-enc', period: { end: new Date().toISOString() } });
    expect(labelFromBundle(bundle, 'risk')).toBe(true);
    expect(riskScoreForMock).toHaveBeenCalledTimes(1);
  });

  it('returns false when the underlying riskScoreFor returns 50 (< 75 critical-zone threshold)', () => {
    riskScoreForMock.mockReturnValue(50);
    const bundle = bundleWith({ resourceType: 'Encounter', id: 'p-enc', period: { end: new Date().toISOString() } });
    expect(labelFromBundle(bundle, 'risk')).toBe(false);
    expect(riskScoreForMock).toHaveBeenCalledTimes(1);
  });
});

// --- sdoh ------------------------------------------------------------------

describe('labelFromBundle — sdoh (_meta.labelingRules.sdoh: AHC-HRSN positive/negative/absent)', () => {
  it('returns true when an AHC-HRSN Observation is present with a positive-screening valueString', () => {
    const bundle = bundleWith(
      ahcHrsnObservation('p-sdoh', 'AHC-HRSN screening positive: housing instability'),
    );
    expect(labelFromBundle(bundle, 'sdoh')).toBe(true);
  });

  it('returns false when an AHC-HRSN Observation is present with a valueString matching the "no ... barriers?" negative-screening pattern', () => {
    // Wording mirrors the actual seed text used in
    // `seed-patients.ts:robert-kim-sdoh` and `population.ts:pop-0005-sdoh`:
    // "AHC-HRSN screening: no social barriers identified". The regex is
    // `\bno\s+\w+\s+barriers?\b` so it tolerates the optional word ("social",
    // or anything) between "no" and "barriers". Pin this against the
    // actual data, not a hypothetical re-phrasing of the seed.
    const bundle = bundleWith(
      ahcHrsnObservation('p-sdoh', 'AHC-HRSN screening: no social barriers identified'),
    );
    expect(labelFromBundle(bundle, 'sdoh')).toBe(false);
  });

  it('returns null when no AHC-HRSN Observation (LOINC 71802-3) is in the bundle at all', () => {
    const bundle = bundleWith(observationResource('p-bnp', '30934-4'));
    expect(labelFromBundle(bundle, 'sdoh')).toBeNull();
  });
});

// --- cross-cutting contracts ----------------------------------------------

describe('labelFromBundle — contracts', () => {
  it('is deterministic: calling twice with the same inputs returns the identical label', () => {
    riskScoreForMock.mockReturnValue(87);
    const bundle = bundleWith(
      conditionResource('p-cond-1', 'E11.9'),
      ahcHrsnObservation('p-sdoh', 'AHC-HRSN screening positive: transportation barriers'),
    );
    const first = {
      careGap: labelFromBundle(bundle, 'careGap'),
      risk: labelFromBundle(bundle, 'risk'),
      sdoh: labelFromBundle(bundle, 'sdoh'),
    };
    const second = {
      careGap: labelFromBundle(bundle, 'careGap'),
      risk: labelFromBundle(bundle, 'risk'),
      sdoh: labelFromBundle(bundle, 'sdoh'),
    };
    expect(second).toEqual(first);
    // the only `===` identity contract worth pinning: a plain object identity
    // comparison would catch accidental new-object creation per call, which
    // is the most plausible way to make the same inputs produce different
    // outputs in a pure function.
    expect(second.careGap).toBe(first.careGap);
    expect(second.risk).toBe(first.risk);
    expect(second.sdoh).toBe(first.sdoh);
  });

  it('returns null for every dimension when the bundle has no resources at all', () => {
    riskScoreForMock.mockReturnValue(0); // riskScoreFor not really exercised, but mock keeps it from throwing.
    const bundle = emptyBundle();
    expect(labelFromBundle(bundle, 'careGap')).toBeNull();
    expect(labelFromBundle(bundle, 'risk')).toBeNull();
    expect(labelFromBundle(bundle, 'sdoh')).toBeNull();
  });
});
