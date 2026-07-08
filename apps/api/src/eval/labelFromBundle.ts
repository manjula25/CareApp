/**
 * S15 Commit 2 — factored labeling function for the held-out eval set.
 *
 * Mirrors `data/eval/labels.json:_meta.labelingRules` exactly so both the
 * dev-labeled 16 rows and the held-out 10 rows score against the same
 * deterministic, pure code. The function:
 *
 *   - reads `bundle.resources` only (no I/O, no LLM, no global state);
 *   - is *deterministic to within a single `Date.now()` read on call time*
 *     for the Risk branch, matching `agents/confidenceScorer.ts`'s purity
 *     model (so the same input bundle at the same call time always produces
 *     the same label);
 *   - returns `null` for any dimension where there is no confident ground
 *     truth — an honest "no data" skip, mirroring the S9 A1 contract
 *     (`computeMetrics.ts` and `labels.json` use the same null semantics).
 *
 * Both branches that compare a deterministic 0/1 boolean to the rule's
 * threshold (Risk) or to a substring regex (SDOH) catch any exception
 * thrown by the underlying bundle parsing and downgrade to `null` — a
 * defensive path for held-out bundles with unexpected shapes.
 */

import { PatientBundle } from '../fhir/client';
import { riskScoreFor } from '../fhir-data/population';

export type LabelDim = 'careGap' | 'risk' | 'sdoh';

/** Single source of truth for the LOINC conventions the eval labels against.
 * Mirrors `_meta.labelingRules.careGap` textually; if either side changes,
 * they change together. Same shape `confidenceScorer.ts` uses internally
 * (Record<string, string>); kept as an array here so the code that walks
 * it can also recover the ICD-10 → "qualifying Condition" mapping cleanly. */
const CARE_GAP_LOINC_CONVENTIONS: ReadonlyArray<{ icd10: string; loinc: string }> = [
  { icd10: 'E11.9', loinc: '4548-4' }, // diabetes → HbA1c
  { icd10: 'I50.9', loinc: '30934-4' }, // CHF → BNP
  { icd10: 'N18.3', loinc: '62238-1' }, // CKD → eGFR
];

const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm';
const LOINC_SYSTEM = 'http://loinc.org';
const SDOH_AHC_HRSN_LOINC = '71802-3';
const CRITICAL_RISK_THRESHOLD = 75;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function icd10Code(resource: any): string | undefined {
  const codings = resource?.code?.coding;
  if (!Array.isArray(codings)) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = codings.find((c: any) => c?.system === ICD10_SYSTEM);
  return typeof found?.code === 'string' ? found.code : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isObservationWithLoinc(resource: any, loincCode: string): boolean {
  if (!resource || resource.resourceType !== 'Observation') return false;
  const codings = resource?.code?.coding;
  if (!Array.isArray(codings)) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return codings.some((c: any) => c?.system === LOINC_SYSTEM && c?.code === loincCode);
}

/** Returns the valueString of the bundle's AHC-HRSN Observation (LOINC
 * 71802-3), or undefined if none. Mirrors the import-fhir.ts:94-113 shape. */
function ahcHrsnValueString(bundle: PatientBundle): string | undefined {
  for (const r of bundle.resources ?? []) {
    if (!isObservationWithLoinc(r, SDOH_AHC_HRSN_LOINC)) continue;
    return typeof r?.valueString === 'string' ? r.valueString : '';
  }
  return undefined;
}

/** Counts Condition resources in the bundle. Used to derive the
 * `conditionCount` arg the existing `riskScoreFor(count, hours)` expects. */
function conditionCount(bundle: PatientBundle): number {
  let n = 0;
  for (const r of bundle.resources ?? []) {
    if (r?.resourceType === 'Condition') n++;
  }
  return n;
}

/** Derives recencyHours from the most-recent Encounter.period.end
 * (`Date.now() - end`) in whole hours. Mirrors the `RECENCY_HOURS_OPTIONS`
 * the procedural generator uses (population.ts:87) to keep the riskScore
 * distribution stable. Returns 0 (worst-case = "discharged this hour") if
 * the bundle has no Encounters; `riskScoreFor`'s recency band gives that
 * value the maximum recency bonus (0.20) — a conservative choice that
 * matches the existing seed-data distribution. */
function recencyHoursFromBundle(bundle: PatientBundle): number {
  const HOUR_MS = 60 * 60 * 1000;
  const now = Date.now();
  let mostRecentHours = Number.POSITIVE_INFINITY;
  let found = false;
  for (const r of bundle.resources ?? []) {
    if (r?.resourceType !== 'Encounter') continue;
    const end = r?.period?.end;
    if (typeof end !== 'string') continue;
    const t = new Date(end).getTime();
    if (Number.isFinite(t)) {
      const hours = Math.floor((now - t) / HOUR_MS);
      if (hours < mostRecentHours) {
        mostRecentHours = hours;
        found = true;
      }
    }
  }
  return found ? Math.max(0, mostRecentHours) : 0;
}

/** Care Gap label per `_meta.labelingRules.careGap`:
 *   - null   if no qualifying Condition (E11.9 / I50.9 / N18.3) is present;
 *   - true   if any qualifying Condition is present AND its matching LOINC
 *            Observation is missing (a real, defensible monitoring gap);
 *   - false  if every qualifying Condition has its matching Observation on
 *            file.
 * Conditions without an established convention (F33.1, J44.9, I10, etc.)
 * intentionally stay unlabeled — same logic the rule text encodes.
 */
function careGapLabel(bundle: PatientBundle): boolean | null {
  const qualifyingCodes: string[] = [];
  for (const r of bundle.resources ?? []) {
    if (r?.resourceType !== 'Condition') continue;
    const code = icd10Code(r);
    if (!code) continue;
    if (CARE_GAP_LOINC_CONVENTIONS.some((c) => c.icd10 === code)) {
      qualifyingCodes.push(code);
    }
  }
  if (qualifyingCodes.length === 0) return null;

  // Any qualifying Condition that lacks its required Observation → gap.
  for (const code of qualifyingCodes) {
    const convention = CARE_GAP_LOINC_CONVENTIONS.find((c) => c.icd10 === code);
    if (!convention) continue;
    const requiredPresent = (bundle.resources ?? []).some((r) =>
      isObservationWithLoinc(r, convention.loinc),
    );
    if (!requiredPresent) return true;
  }
  return false;
}

/** SDOH label per `_meta.labelingRules.sdoh`:
 *   - null   if no AHC-HRSN Observation (LOINC 71802-3) is in the bundle;
 *   - false  if the screening Observation's valueString matches the
 *            "no ... barriers?" pattern (an explicit negative screening —
 *            the actual seed text in this repo is "no social barriers
 *            identified" so the pattern tolerates an optional word between
 *            "no" and "barriers"; this is the same wording the S14 SDOH
 *            rebalance uses in `seed-patients.ts:robert-kim-sdoh` and
 *            `population.ts:pop-0005-sdoh`);
 *   - true   otherwise (positive screening — barriers present).
 */
const SDOH_NEGATIVE_SCREENING = /\bno\s+\w+\s+barriers?\b/i;
function sdohLabel(bundle: PatientBundle): boolean | null {
  const value = ahcHrsnValueString(bundle);
  if (value === undefined) return null;
  return SDOH_NEGATIVE_SCREENING.test(value) ? false : true;
}

/** Risk label per `_meta.labelingRules.risk`: `riskScoreFor(bundle) >= 75`
 * is true iff the patient is in the procedural-generator's "critical zone"
 * (population.ts's CRITICAL_RISK_THRESHOLD). Defensive try/catch around the
 * underlying function — `riskScoreFor` is pure, but held-out bundles can
 * have unexpected shapes (Encounter.period.end as a non-string, etc.) and
 * the spec calls for a `null` downgrade on any error. */
function riskLabel(bundle: PatientBundle): boolean | null {
  try {
    const score = riskScoreFor(conditionCount(bundle), recencyHoursFromBundle(bundle));
    return score >= CRITICAL_RISK_THRESHOLD;
  } catch {
    return null;
  }
}

/**
 * Pure-derived label for one patient bundle and one eval dimension.
 * Both the dev-labeled 16 and the held-out 10 score against this single
 * function — `data/eval/labels.json` is the source of truth that pointers
 * the row is a held-out one; the label itself comes from here.
 */
export function labelFromBundle(bundle: PatientBundle, dim: LabelDim): boolean | null {
  // Bundle with no resources is "no data" → no label, for every dim.
  // Mirrors the S9 A1 null contract (`expectedHasGap: null` etc. exclude a
  // patient from that dimension's confusion matrix — honest "no ground
  // truth," not a fabricated guess).
  if (!bundle || !Array.isArray(bundle.resources) || bundle.resources.length === 0) {
    return null;
  }
  if (dim === 'careGap') return careGapLabel(bundle);
  if (dim === 'risk') return riskLabel(bundle);
  return sdohLabel(bundle);
}
