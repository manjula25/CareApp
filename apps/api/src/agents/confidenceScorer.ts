import { PatientBundle } from '../fhir/client';
import { riskScoreFor, CRITICAL_RISK_THRESHOLD } from '../fhir-data/population';
import { RiskOutput, SafetyNetApplication } from './agent';

/**
 * S14 Commit 3 — per-finding confidence via a deterministic, auditable
 * bundle-evidence heuristic.
 *
 * Why heuristic, not model self-report: the model is already biased on Risk
 * (see `docs/plans/caresync-ai/verification-s13.md §4 LLM variance`). A
 * deterministic score that the model cannot influence is auditable,
 * reproducible, and immune to the same LLM-side behavioral shifts that
 * surfaced in S13. The score is a property of the bundle + finding, not the
 * finding's prose; the model never sees the number, only the schema slot.
 *
 * Pure functions — no I/O, no LLM call, no Date.now() at module scope. All
 * time-sensitive inputs (the `recentEncounter` 30-day window) are computed
 * inside the function so the same bundle + finding pair produces the same
 * score every call (deterministic to within a single `new Date()` read at
 * call time).
 */

// --- LOINC codes the Risk scorer's "abnormal lab" check recognizes. ---
// Source of truth: import-fhir.ts's `observationResource` shape + the risk
// rubric population.ts already uses. HbA1c (4548-4), BNP (30934-4), eGFR
// (62238-1) — same three LOINC codes that appear in the seed data and that
// the existing risk agent is calibrated against.
const HBA1C_LOINC = '4548-4';
const BNP_LOINC = '30934-4';
const EGFR_LOINC = '62238-1';

// Clinical thresholds above which a lab is "abnormal" for the purpose of
// supporting a risk flag. Mirrors the rubric population.ts uses; documented
// inline to keep the scorer self-contained.
const HBA1C_ABNORMAL_THRESHOLD = 9.0; // % (HbA1c > 9.0%)
const BNP_ABNORMAL_THRESHOLD = 200; // pg/mL (BNP > 200)
const EGFR_ABNORMAL_THRESHOLD = 30; // mL/min/1.73m2 (eGFR < 30 — low clearance)

// SDOH AHC-HRSN screening LOINC (HL7's standard "social determinants of
// health" screening panel code).
const SDOH_AHC_HRSN_LOINC = '71802-3';

// Care Gap matching: per data/eval/labels.json _meta.labelingRules.careGap,
// each of the three condition codes this rubric already covers maps to the
// LOINC of the monitoring Observation that would close the gap. Encoded as
// a small table here so the scorer is self-contained (no cross-module lookups).
const CONDITION_TO_REQUIRED_LOINC: Record<string, string> = {
  'E11.9': HBA1C_LOINC, // Diabetes → HbA1c
  'I50.9': BNP_LOINC, // CHF → BNP
  'N18.3': EGFR_LOINC, // CKD → eGFR
};

const DAYS_MS = 24 * 60 * 60 * 1000;
const RECENT_ENCOUNTER_DAYS = 30;

/** Pulls a `ResourceType/id` reference for an arbitrary FHIR resource. The
 * shape is heterogeneous so we read defensively — any field actually missing
 * in the resource just returns undefined and the scorer treats the resource
 * as not-present-in-bundle. */
function refOf(resource: any): string | undefined {
  if (!resource) return undefined;
  if (typeof resource.resourceType !== 'string' || typeof resource.id !== 'string') return undefined;
  return `${resource.resourceType}/${resource.id}`;
}

/** Finds any matching resource in the bundle — by structural equality on
 * (resourceType, id) of the resource referenced — and returns the full
 * resource object, or undefined if absent. */
function findResource(bundle: PatientBundle, ref: string): any | undefined {
  if (!bundle || !ref) return undefined;
  if (bundle.validIds && bundle.validIds.has(ref)) {
    return (bundle.resources ?? []).find((r: any) => refOf(r) === ref);
  }
  return undefined;
}

/** Reads an Observation's value, supporting both the `valueQuantity.value`
 * shape (the canonical FHIR R4 shape this codebase seeds via
 * import-fhir.ts:80-92 `observationResource`) and a flat `value` field as a
 * fallback for tests/fixtures that pass shorter shapes. Returns undefined if
 * the value is missing or non-numeric — caller treats undefined as
 * "non-abnormal" rather than crashing on NaN. */
function observationValue(obs: any): number | undefined {
  const q = obs?.valueQuantity?.value;
  if (typeof q === 'number' && Number.isFinite(q)) return q;
  if (typeof obs?.value === 'number' && Number.isFinite(obs.value)) return obs.value;
  return undefined;
}

/** Returns true iff `r` is an Observation whose coded LOINC value matches
 * `loincCode`. Walks the standard `code.coding[]` shape; no extension
 * traversal — every Observation in this codebase writes codes via
 * import-fhir.ts's `code.coding[]` exactly. */
function isObservationWithLoinc(r: any, loincCode: string): boolean {
  if (!r || r.resourceType !== 'Observation') return false;
  const codings = r.code?.coding ?? [];
  return codings.some((c: any) => c.system === 'http://loinc.org' && c.code === loincCode);
}

/** Returns true iff the bundle has any Observation whose LOINC code +
 * clinical value crosses the "abnormal" threshold for that code, per the
 * thresholds documented at the top of this module. */
function bundleHasAbnormalLab(bundle: PatientBundle): boolean {
  if (!bundle?.resources) return false;
  for (const r of bundle.resources) {
    const v = observationValue(r);
    if (v === undefined) continue;
    if (isObservationWithLoinc(r, HBA1C_LOINC) && v > HBA1C_ABNORMAL_THRESHOLD) return true;
    if (isObservationWithLoinc(r, BNP_LOINC) && v > BNP_ABNORMAL_THRESHOLD) return true;
    if (isObservationWithLoinc(r, EGFR_LOINC) && v < EGFR_ABNORMAL_THRESHOLD) return true;
  }
  return false;
}

/** Returns true iff the bundle contains any Encounter whose `period.end`
 * (with `period.start` as fallback) falls within the last 30 days from
 * `new Date()`. Uses Date.now() arithmetic rather than ISO string compares
 * to dodge timezone weirdness. */
function bundleHasRecentEncounter(bundle: PatientBundle): boolean {
  if (!bundle?.resources) return false;
  const cutoff = Date.now() - RECENT_ENCOUNTER_DAYS * DAYS_MS;
  for (const r of bundle.resources) {
    if (r?.resourceType !== 'Encounter') continue;
    const end = r?.period?.end ?? r?.period?.start;
    if (!end) continue;
    const t = new Date(end).getTime();
    if (Number.isFinite(t) && t >= cutoff) return true;
  }
  return false;
}

/**
 * Risk flag confidence:
 * `min(0.9, 0.3 + 0.2 * citationCount + 0.2 * (hasAbnormalLab ? 1 : 0) + 0.2 * (recentEncounter ? 1 : 0))`.
 *
 * `citationCount` is 1 if the cited resource exists in the bundle, 0 otherwise —
 * a fabricated citation (already dropped by `validateCitations`) scores the
 * floor at most, which is the right outcome because the validator already
 * removed it. The other two terms add corroborating bundle evidence: an
 * abnormal lab supports the flag's clinical claim; a recent encounter
 * supports the timing claim.
 */
export function scoreRiskFlag(flag: { fhirResourceId: string }, bundle: PatientBundle): number {
  const citationCount = findResource(bundle, flag?.fhirResourceId) ? 1 : 0;
  const hasAbnormalLab = bundleHasAbnormalLab(bundle) ? 1 : 0;
  const recentEncounter = bundleHasRecentEncounter(bundle) ? 1 : 0;
  return Math.min(0.9, 0.3 + 0.2 * citationCount + 0.2 * hasAbnormalLab + 0.2 * recentEncounter);
}

/**
 * Care Gap confidence:
 *  - 0.9 if the cited Condition is in the bundle AND the matching LOINC
 *    Observation is absent (the gap is real and explicit — the record shows
 *    the test was never done).
 *  - 0.4 if only one of the two signals is in the bundle.
 *  - 0.2 if neither signal is in the bundle (the gap is "synthesized from
 *    absence of other evidence," not defensible).
 *
 * The condition → required LOINC mapping mirrors
 * `data/eval/labels.json._meta.labelingRules.careGap` (the same source of
 * truth the eval harness uses).
 */
export function scoreCareGap(gap: { fhirResourceId: string }, bundle: PatientBundle): number {
  const condition = findResource(bundle, gap?.fhirResourceId);
  if (!condition) return 0.2;

  // Read the cited Condition's coded ICD-10. If the code isn't in the
  // known-mapping table, the gap has no LOINC convention — degrade to 0.4
  // (only the Condition is present; no matching-Observation rule applies).
  const conditionCode: string | undefined = condition?.code?.coding?.[0]?.code;
  const requiredLoinc = conditionCode ? CONDITION_TO_REQUIRED_LOINC[conditionCode] : undefined;

  if (!requiredLoinc) {
    // Only the Condition is in the bundle; no Observation rule exists for
    // this condition code. Per spec, "only one signal present" → 0.4.
    return 0.4;
  }

  const matchingObsPresent = (bundle.resources ?? []).some((r: any) =>
    isObservationWithLoinc(r, requiredLoinc)
  );

  if (matchingObsPresent) {
    // Both signals present — the gap is not explicit, the record shows
    // both. Per spec, "only one signal present" → 0.4 (the agent would be
    // over-calling here).
    return 0.4;
  }
  // Condition present, matching Observation absent → strongest case.
  return 0.9;
}

/**
 * SDOH barrier confidence:
 *  - 0.9 if the cited resource is an AHC-HRSN Observation (LOINC 71802-3)
 *    whose `valueString` does NOT match the explicit-negative pattern
 *    `/\bno\s+\w+\s+barriers?\b/i` — the screening is real and the
 *    finding is positive.
 *  - 0.4 if the cited resource is in the bundle but is NOT an AHC-HRSN
 *    Observation (e.g., the agent cites a Patient or a different
 *    Observation — the screening itself is weak).
 *  - 0.2 if the cited resource is not in the bundle at all (a fabricated
 *    citation; the validator already dropped it).
 *
 * The explicit-negative pattern tolerates an optional word between "no" and
 * "barriers" because the actual seed text in this repo is
 * "AHC-HRSN screening: no social barriers identified"
 * (see `seed-patients.ts:robert-kim-sdoh` and
 * `population.ts:pop-0005-sdoh`). Mirrors the pattern in
 * `eval/labelFromBundle.ts:SDOH_NEGATIVE_SCREENING`.
 */
export function scoreSdohBarrier(barrier: { fhirResourceId: string }, bundle: PatientBundle): number {
  const resource = findResource(bundle, barrier?.fhirResourceId);
  if (!resource) return 0.2;

  if (!isObservationWithLoinc(resource, SDOH_AHC_HRSN_LOINC)) {
    return 0.4;
  }

  const valueString = typeof resource.valueString === 'string' ? resource.valueString : '';
  if (/\bno\s+\w+\s+barriers?\b/i.test(valueString)) {
    // Cited an AHC-HRSN screening, but it explicitly says "no ... barriers".
    // The barrier claim is not supported — 0.4 (cited, wrong content).
    return 0.4;
  }
  return 0.9;
}

/** Shape consumed by the Action Planner derivation: an upstream finding from
 * any of the three classifier agents (Risk / Care Gap / SDOH), already
 * carrying its scored `confidence`. */
export interface FindingWithConfidence {
  fhirResourceId: string;
  confidence: number;
}

/** Shape consumed by the Action Planner derivation: the agent's emitted
 * task — characterized for the scorer only by the FHIR resources it cites.
 * The full shape carries other fields (title, priority, etc.) but the scorer
 * only needs `fhirResources`. */
export interface TaskForScoring {
  fhirResources: string[];
}

/**
 * Action Planner task confidence:
 * `min(findings.filter(f => task.fhirResources.includes(f.fhirResourceId)).map(f => f.confidence)) || 0.2`.
 *
 * A task can't claim more confidence than its weakest supporting citation —
 * the synthesis step should not invent confidence the upstream findings
 * don't support. The `0.2` floor catches the "task cites no upstream
 * findings" / "no upstream findings match" edge cases, which are the
 * "synthesized without direct evidence" cases the rubric explicitly
 * down-weights.
 */
export function deriveActionPlannerTaskConfidence(
  tasks: TaskForScoring[],
  findings: FindingWithConfidence[]
): number[] {
  return (tasks ?? []).map((task) => {
    if (!task || !Array.isArray(task.fhirResources) || task.fhirResources.length === 0) {
      return 0.2;
    }
    const matching = (findings ?? []).filter((f) => task.fhirResources.includes(f.fhirResourceId));
    if (matching.length === 0) return 0.2;
    const minConf = Math.min(...matching.map((f) => f.confidence));
    return Number.isFinite(minConf) ? minConf : 0.2;
  });
}

/** Counts Condition resources in the bundle. */
function countConditions(bundle: PatientBundle): number {
  if (!bundle?.resources) return 0;
  return bundle.resources.filter((r: any) => r?.resourceType === 'Condition').length;
}

/** Returns hours since the most recent Encounter, or Infinity if none. */
function mostRecentEncounterHours(bundle: PatientBundle): number {
  if (!bundle?.resources) return Infinity;
  let mostRecent = 0;
  for (const r of bundle.resources) {
    if (r?.resourceType !== 'Encounter') continue;
    const end = r?.period?.end ?? r?.period?.start;
    if (!end) continue;
    const t = new Date(end).getTime();
    if (Number.isFinite(t) && t > mostRecent) {
      mostRecent = t;
    }
  }
  if (mostRecent === 0) return Infinity;
  return (Date.now() - mostRecent) / (60 * 60 * 1000);
}

/**
 * S17 — deterministic post-hoc risk-level clamp. Downgrades LLM
 * false-positive 'high' and 'critical' ratings to 'moderate' when the
 * bundle doesn't have enough evidence to support them.
 *
 * A 'high' rating is preserved iff ANY of:
 * - The deterministic score (riskScoreFor) ≥ CRITICAL_RISK_THRESHOLD (75),
 *   which requires 3+ conditions + a recent encounter.
 * - The bundle has an abnormal lab AND a recent encounter (the clinical
 *   override — a single condition with a critically abnormal lab value
 *   and a recent discharge genuinely warrants 'high').
 *
 * Otherwise the LLM's 'high' is clamped to 'moderate' — the model
 * over-called the risk level without sufficient bundle evidence.
 *
 * 'low' and 'moderate' levels are never clamped. The score is preserved
 * regardless of the level change — only the label is corrected.
 *
 * S19 Thread D — on downgrade, the returned object carries an
 * `_safetyNetApplied` sentinel describing the intervention. The eval
 * harness reads this field to render `## Safety-net activity` in
 * `docs/eval-report.md`. When the LLM's rating is preserved (no
 * intervention), no sentinel is attached — the absence is itself a
 * signal that the clamp was a no-op for that bundle.
 */
export function clampRiskLevel(bundle: PatientBundle, output: RiskOutput): RiskOutput {
  if (output.riskLevel !== 'high' && output.riskLevel !== 'critical') {
    return output;
  }

  const conditionCount = countConditions(bundle);
  const recencyHours = mostRecentEncounterHours(bundle);
  const deterministicScore = riskScoreFor(conditionCount, recencyHours);

  if (deterministicScore >= CRITICAL_RISK_THRESHOLD) {
    return output;
  }

  if (bundleHasAbnormalLab(bundle) && bundleHasRecentEncounter(bundle)) {
    return output;
  }

  // Downgrade path. Attach the sentinel so downstream consumers can
  // observe the clamp's behavior. The shape mirrors the inputs the
  // clamp computed internally — no re-derivation needed at read time.
  const sentinel: SafetyNetApplication = {
    kind: 'risk-level-clamped',
    from: output.riskLevel,
    to: 'moderate',
    deterministicScore,
    conditionCount,
    recencyHours,
  };
  return { ...output, riskLevel: 'moderate', _safetyNetApplied: sentinel };
}
