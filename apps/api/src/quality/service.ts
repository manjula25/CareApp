import Database from 'better-sqlite3';
import { AuthTokenPayload } from '../auth/jwt';
import { writeAudit } from '../db/audit';
import { DirectorOnlyError, FhirReadService } from '../fhir/client';

export { DirectorOnlyError };

/**
 * Director-only gate, mirroring governance/service.ts's own `assertDirector`
 * exactly (role check, denial audit, throw DirectorOnlyError) — a deliberate,
 * minimal duplicate of the same rule rather than an import, matching how
 * governance/service.ts itself duplicates population/service.ts's version
 * (see that module's doc for why: the function is private to each module).
 */
function assertDirector(actor: AuthTokenPayload, db: Database.Database, resource: string): void {
  if (actor.role !== 'director') {
    writeAudit(db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'denied' });
    throw new DirectorOnlyError(actor.role, 'access quality/HEDIS aggregates');
  }
}

// S11 A2 — the two fixed FHIR codes this measure is built from. Both are
// verified-live against the running HAPI server + seed data (see this
// module's test suite and fhir/client.test.ts's getResourceCountByCode
// suite): the diabetes Condition code is common (hundreds of matches), the
// HbA1c Observation code is rare (a handful), which is itself the honest
// "care gap" story this measure exists to surface — not a bug to fix.
const DIABETES_CONDITION_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm';
const DIABETES_CONDITION_CODE = 'E11.9'; // Type 2 diabetes mellitus without complications
const HBA1C_OBSERVATION_SYSTEM = 'http://loinc.org';
const HBA1C_OBSERVATION_CODE = '4548-4'; // Hemoglobin A1c/Hemoglobin.total in Blood

// Illustrative HEDIS quality-bonus assumption for this POC demo, not a real
// payer contract value — see this module's QualityMeasureResult doc and
// Quality.tsx's UI label, both of which must call this out as an estimate,
// never a real financial figure (CLAUDE.md gate G4 / this repo's honest-
// staging discipline, same as governance/service.ts's deviation notes).
export const ILLUSTRATIVE_DOLLARS_PER_CLOSED_GAP = 5000;

export interface QualityMeasureResult {
  measureId: string;
  measureName: string;
  numerator: number;
  denominator: number;
  rate: number;
  gapPatients: number;
  illustrativeIncentiveDollars: number;
}

/**
 * S11 A2 — the ONE real HEDIS-style measure this POC computes end to end:
 * "Comprehensive Diabetes Care: HbA1c Testing". Numerator = patients with an
 * HbA1c Observation on file (LOINC 4548-4); denominator = patients with a
 * Type 2 Diabetes Condition on file (ICD-10-CM E11.9). Both counts come from
 * `FhirReadService.getResourceCountByCode`'s bulk `_summary=count` search —
 * the actual FHIR I/O lives there, this function is a thin "gate → read →
 * transform" aggregate, matching governance/service.ts's shape.
 *
 * Director-only (`assertDirector` above), matching Population's and
 * Governance's own aggregates — both call `assertDirector`/an equivalent
 * role check end-to-end (population/service.ts's `getPopulationScatter`/
 * `getPopulationSummary`, governance/service.ts's every aggregate), so a W05/
 * W07 cross-patient measure aggregate follows the same precedent, not a
 * looser one. The frontend route (`App.tsx`'s `/quality`) is already
 * Director-only to match.
 *
 * Deliberately does NOT compute a second (e.g. depression-screening) measure,
 * a trend-over-time series, or any cost-avoidance/ROI figure beyond the one
 * illustrative-and-labeled dollar estimate below — see Quality.tsx's doc
 * comment for the full list of mockup content dropped for lack of real
 * backing data.
 */
export async function getDiabetesHba1cMeasure(
  actor: AuthTokenPayload,
  fhirService: FhirReadService,
  db: Database.Database
): Promise<QualityMeasureResult> {
  assertDirector(actor, db, 'Population/quality-measures');

  const [denominator, numerator] = await Promise.all([
    fhirService.getResourceCountByCode(actor, 'Condition', DIABETES_CONDITION_SYSTEM, DIABETES_CONDITION_CODE),
    fhirService.getResourceCountByCode(actor, 'Observation', HBA1C_OBSERVATION_SYSTEM, HBA1C_OBSERVATION_CODE),
  ]);

  const rate = denominator > 0 ? numerator / denominator : 0;
  const gapPatients = denominator - numerator;
  const illustrativeIncentiveDollars = gapPatients * ILLUSTRATIVE_DOLLARS_PER_CLOSED_GAP;

  return {
    measureId: 'diabetes-hba1c-testing',
    measureName: 'Comprehensive Diabetes Care: HbA1c Testing',
    numerator,
    denominator,
    rate,
    gapPatients,
    illustrativeIncentiveDollars,
  };
}
