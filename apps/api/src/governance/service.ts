import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { AuthTokenPayload } from '../auth/jwt';
import { writeAudit, readAuditTrail, AuditTrailEntry } from '../db/audit';
import { readAllAnalysisCache } from '../db/analysisCache';
import { DirectorOnlyError, FhirReadService, PatientDemographics } from '../fhir/client';

// Re-exported so routes/governance.ts doesn't need a second import path for
// the same Director-only error population/service.ts's router also maps to
// a 403 — one error type, not two parallel ones (same convention
// population/service.ts itself follows for fhir/client.ts's DirectorOnlyError).
export { DirectorOnlyError };

/**
 * Director-only gate, mirroring population/service.ts's own `assertDirector`
 * exactly (role check, denial audit, throw DirectorOnlyError). NOT imported
 * from population/service.ts: that function is private to that module (only
 * `DirectorOnlyError` itself is exported from there), so this is a deliberate,
 * minimal duplicate of the same rule rather than a divergence from it — see
 * fhir/client.ts's DirectorOnlyError doc for why this is the one shared
 * "role above domain" error type across both modules.
 */
function assertDirector(actor: AuthTokenPayload, db: Database.Database, resource: string): void {
  if (actor.role !== 'director') {
    writeAudit(db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'denied' });
    throw new DirectorOnlyError(actor.role, 'access governance aggregates');
  }
  // No success audit here, same reasoning as population/service.ts's
  // assertDirector: getAuditTrail below reads the audit_log table itself
  // (not a FHIR resource), so there is no underlying FHIR read to audit —
  // recording "Director viewed the audit trail" as its own audit-worthy FHIR
  // access would conflate the two. getParityMetrics' HAPI demographics read
  // audits itself via FhirReadService.getPatientDemographics, exactly like
  // every other FhirReadService method.
}

const DEFAULT_AUDIT_LIMIT = 50;

export interface AuditTrailResult {
  entries: AuditTrailEntry[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * S8 A1 — Director-only, paged read of the S1 `audit_log` table (existing
 * storage only — see readAuditTrail's doc for the most-recent-first
 * ordering rule).
 */
export function getAuditTrail(
  actor: AuthTokenPayload,
  db: Database.Database,
  limit: number = DEFAULT_AUDIT_LIMIT,
  offset = 0
): AuditTrailResult {
  assertDirector(actor, db, 'Governance/audit');
  const { entries, total } = readAuditTrail(db, limit, offset);
  return { entries, total, limit, offset };
}

// --- A2: model performance + confidence distribution --------------------

export interface AnalysisVersionEntry {
  patientId: string;
  modelVersion: string;
  createdTs: string;
}

export interface ConfidenceBucket {
  range: string;
  count: number;
}

export interface ModelPerformanceResult {
  analyses: AnalysisVersionEntry[];
  confidenceDistribution: ConfidenceBucket[];
}

/**
 * Deviation note (S8 A2): `AgentFlag` (agents/citationValidator.ts) and the
 * anonymous careGap/sdoh finding shapes in `AnalysisResultJson`
 * (routes/analysis.ts) carry no `confidence` field today — none of the three
 * agent tool schemas (riskAgent.ts/careGapAgent.ts/sdohAgent.ts) ask the
 * model to report one. The plan's acceptance criteria nonetheless call for a
 * "confidence distribution derived from actual outputs," and the S1 ponytail
 * rule for this slice forbids fabricating numbers. Resolution: `analysis_cache.
 * result_json` is stored (and read back) as loosely-typed JSON, not
 * constrained by AgentFlag's TS shape at the DB layer (see
 * db/analysisCache.test.ts, which already round-trips shapes AgentFlag
 * doesn't describe) — so this reads an *optional* `confidence: number` off
 * each finding at runtime. Today's live-produced cache rows contribute zero
 * data to every bucket (an honest reflection of what the agents currently
 * report, not a missing feature masked as zero); the moment an agent starts
 * emitting per-finding confidence, this endpoint picks it up with no
 * migration. This was treated as an engineering resolution of a type/runtime
 * mismatch, not a guess at an undocumented domain rule.
 */

// Clinically-meaningful confidence bands (S8 A2): <0.5 is treated as
// unreliable and unfit to act on without human review; 0.5-0.7 is low-
// moderate (usable with caution); 0.7-0.85 is moderate-high (generally
// actionable); 0.85-1.0 is high confidence. This also lines up with the W06
// mockup's "below 60% confidence — auto-flagged" framing at the low end,
// while giving finer resolution at the high end where most real findings are
// expected to land.
const CONFIDENCE_BUCKETS: { range: string; min: number; max: number }[] = [
  { range: '0-0.5', min: 0, max: 0.5 },
  { range: '0.5-0.7', min: 0.5, max: 0.7 },
  { range: '0.7-0.85', min: 0.7, max: 0.85 },
  { range: '0.85-1.0', min: 0.85, max: 1.0 },
];

// Exported for direct unit testing (boundary cases — a confidence value
// landing exactly on 0.5/0.7/0.85 — are awkward to pin precisely through the
// HTTP-level fixtures in routes/governance.test.ts). Same convention
// population/service.ts uses for projectedCostAvoidance.
export function bucketFor(confidence: number): string | undefined {
  for (const bucket of CONFIDENCE_BUCKETS) {
    const isTopBucket = bucket.max === 1.0;
    if (confidence >= bucket.min && (isTopBucket ? confidence <= bucket.max : confidence < bucket.max)) {
      return bucket.range;
    }
  }
  return undefined;
}

// Runtime-only shape (see this section's deviation note above) — deliberately
// not `AgentFlag[]` etc., since the field being read isn't declared there.
// Exported for direct unit testing.
export function extractConfidences(resultJson: unknown): number[] {
  const result = resultJson as
    | { risk?: { findings?: { confidence?: unknown }[] }; careGap?: { findings?: { confidence?: unknown }[] }; sdoh?: { findings?: { confidence?: unknown }[] } }
    | null
    | undefined;

  const findingArrays = [result?.risk?.findings, result?.careGap?.findings, result?.sdoh?.findings];
  const confidences: number[] = [];
  for (const findings of findingArrays) {
    if (!Array.isArray(findings)) continue;
    for (const finding of findings) {
      if (finding && typeof finding.confidence === 'number') confidences.push(finding.confidence);
    }
  }
  return confidences;
}

/**
 * S8 A2 — Director-only model version/timestamp per cached analysis, plus a
 * confidence distribution bucketed from whatever per-finding `confidence`
 * values are actually present in the cached agent outputs (see the deviation
 * note above for why that's "whatever is present," not a guaranteed field).
 */
export function getModelPerformance(actor: AuthTokenPayload, db: Database.Database): ModelPerformanceResult {
  assertDirector(actor, db, 'Governance/model');

  const rows = readAllAnalysisCache(db);
  const analyses: AnalysisVersionEntry[] = rows.map((row) => ({
    patientId: row.patientId,
    modelVersion: row.modelVersion,
    createdTs: row.createdTs,
  }));

  const counts = new Map<string, number>(CONFIDENCE_BUCKETS.map((b) => [b.range, 0]));
  for (const row of rows) {
    for (const confidence of extractConfidences(row.resultJson)) {
      const bucket = bucketFor(confidence);
      if (bucket) counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
  }
  const confidenceDistribution: ConfidenceBucket[] = CONFIDENCE_BUCKETS.map((b) => ({
    range: b.range,
    count: counts.get(b.range) ?? 0,
  }));

  return { analyses, confidenceDistribution };
}

// --- A3: demographic parity (GD12 — computed from real Synthea demographics) ---

export interface ParityGroupStat {
  group: string;
  patientCount: number;
  avgRiskScore: number;
}

// S19 Thread B — when the parity aggregate surfaces a concerning delta
// between demographic groups, or any group has too few members to support
// statistical inference, this flag surfaces the concern. The Governance
// page renders a "Mitigation Recommended" tile when the array is non-empty;
// the API also writes a single `parity-mitigation-recommended` audit row
// per call. See `prd-s19.md §Thread B` for the design rationale
// (escalation, not intervention, at POC scope).
export type ParityDimension = 'byAgeBand' | 'bySex' | 'byRace' | 'byEthnicity';
export type ParitySeverity = 'amber' | 'red';
export type ParityRecommendedAction =
  | 'audit rubric for that group'
  | 'insufficient sample';

export interface MitigationFlag {
  dimension: ParityDimension;
  severity: ParitySeverity;
  evidence: string;
  recommendedAction: ParityRecommendedAction;
}

export interface ParityResult {
  byAgeBand: ParityGroupStat[];
  bySex: ParityGroupStat[];
  byRace: ParityGroupStat[];
  byEthnicity: ParityGroupStat[];
  // S19 Thread B — empty array when no concern is detected. The Governance
  // page hides the "Mitigation Recommended" tile in that case. The
  // getParityMetrics caller also writes a `parity-mitigation-recommended`
  // audit row when this array is non-empty.
  mitigation: MitigationFlag[];
}

// S19 Thread B — replaceable constant. The threshold is the absolute risk-
// score delta between max-avg and min-avg group on a single dimension that
// triggers a 'red' flag. At POC scale with a 500-patient procedural cohort
// and a 0-100 riskScore scale, a delta of 15 is large enough to be
// noticeable but not so small that normal seed-derived variance flags
// everything. The `parityMitigationFlags` function exports this constant
// via re-export for direct unit testing.
export const PARITY_DELTA_THRESHOLD = 15;

// S19 Thread B — small-sample threshold. When any single demographic group
// has fewer than this many patients, statistical inference on the
// group-level avgRiskScore is unreliable. Exported for direct unit testing.
export const PARITY_SMALL_SAMPLE_THRESHOLD = 3;

// Common clinical/demographic age bands (S8 A3) — the same <18/18-34/35-49/
// 50-64/65+ split the plan text itself suggests, coarse enough that even
// this POC's small cached-analysis cohort populates more than one band.
const AGE_BANDS: { label: string; min: number; max: number }[] = [
  { label: '<18', min: -Infinity, max: 17 },
  { label: '18-34', min: 18, max: 34 },
  { label: '35-49', min: 35, max: 49 },
  { label: '50-64', min: 50, max: 64 },
  { label: '65+', min: 65, max: Infinity },
];

// Exported for direct unit testing (the "hasn't had this year's birthday
// yet" boundary — `now` landing exactly on, one day before, and one day
// after the birthday's month/day — is awkward to pin through a live-HAPI
// fixture, since `now` there is real wall-clock time).
export function ageFromBirthDate(birthDate: string | undefined, now: Date): number | undefined {
  if (!birthDate) return undefined;
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return undefined;

  let age = now.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age--;
  return age;
}

function ageBandFor(age: number | undefined): string | undefined {
  if (age === undefined) return undefined;
  return AGE_BANDS.find((band) => age >= band.min && age <= band.max)?.label;
}

// Groups by `group` (skipping patients whose demographic value for this
// dimension is unknown — a patient missing a race extension, say, shouldn't
// silently join an "undefined" bucket) and averages riskScore per group.
// Rounded to one decimal place — enough precision to see a real disparity,
// not so much that it implies false precision over a handful of patients.
// Exported for direct unit testing (the "skip an undefined group rather than
// join an 'undefined' bucket" rule, in particular).
export function stratify(rows: { group: string | undefined; riskScore: number }[]): ParityGroupStat[] {
  const scoresByGroup = new Map<string, number[]>();
  for (const row of rows) {
    if (row.group === undefined) continue;
    const scores = scoresByGroup.get(row.group) ?? [];
    scores.push(row.riskScore);
    scoresByGroup.set(row.group, scores);
  }

  return Array.from(scoresByGroup.entries()).map(([group, scores]) => ({
    group,
    patientCount: scores.length,
    avgRiskScore: Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10,
  }));
}

/**
 * S19 Thread B — pure function: inspects a `ParityResult` and returns the
 * list of mitigation flags the Governance page + audit trail should surface.
 *
 * Two trigger conditions per dimension (`byAgeBand`, `bySex`, `byRace`,
 * `byEthnicity`):
 *
 *   1. **Disparity**: |max(group.avgRiskScore) − min(group.avgRiskScore)|
 *      > `PARITY_DELTA_THRESHOLD` (15). Severity `'red'`. The evidence
 *      string names both endpoints and the delta; the recommended action
 *      is `'audit rubric for that group'` because a >15-point delta on a
 *      0–100 riskScore scale is large enough to suggest a rubric bias.
 *
 *   2. **Small sample**: any group has `patientCount < PARITY_SMALL_SAMPLE_THRESHOLD`
 *      (3). Severity `'amber'`. The evidence string names the group + n;
 *      the recommended action is `'insufficient sample'` because a delta
 *      computed over <3 patients is statistically unreliable regardless of
 *      the magnitude.
 *
 * Dimensions with no groups (e.g., `byRace: []`) produce no flags. Empty
 * input returns `[]` (the tile stays hidden in the UI).
 *
 * Pure: no I/O, no LLM, no global state. Exported for direct unit testing
 * (boundary cases at the threshold itself, multi-dimensional flag lists,
 * and the order independence of flag emission).
 */
export function parityMitigationFlags(parity: ParityResult): MitigationFlag[] {
  const flags: MitigationFlag[] = [];
  const dimensions: ParityDimension[] = ['byAgeBand', 'bySex', 'byRace', 'byEthnicity'];

  for (const dimension of dimensions) {
    const groups = parity[dimension];
    if (!groups || groups.length === 0) continue;

    // Small-sample flags first (amber) — surface data-quality issues before
    // the disparity interpretation. Order within a dimension is deterministic
    // (stratify preserves insertion order) but a single small-sample group is
    // named explicitly regardless of position.
    //
    // S19 review note: implementation-plan-s19.md §Thread B documents the
    // trigger as "avgRiskScore < 0 AND n < 3". The first conjunct is latent
    // because `stratify` clamps avgRiskScore into [0, 100] — the trigger
    // reduces to `n < 3` in practice. We retain the structural form
    // (numerator check + sample-size check) so a future change that lifts
    // the [0, 100] clamp (e.g., a normalized -1..+1 risk scale) would
    // automatically start surfacing the amber flag for out-of-range
    // groups without code changes.
    for (const g of groups) {
      if (g.avgRiskScore < 0 || g.patientCount < PARITY_SMALL_SAMPLE_THRESHOLD) {
        flags.push({
          dimension,
          severity: 'amber',
          evidence: `group "${g.group}" has n=${g.patientCount} (< ${PARITY_SMALL_SAMPLE_THRESHOLD}) — too few for reliable inference`,
          recommendedAction: 'insufficient sample',
        });
      }
    }

    // Disparity flag: only meaningful when there are at least 2 groups
    // AND at least one group has enough patients to be representative
    // (otherwise small-sample would have flagged it already).
    if (groups.length >= 2) {
      const scores = groups.map((g) => g.avgRiskScore);
      const max = Math.max(...scores);
      const min = Math.min(...scores);
      const delta = Math.abs(max - min);
      if (delta > PARITY_DELTA_THRESHOLD) {
        const maxGroup = groups.find((g) => g.avgRiskScore === max)!;
        const minGroup = groups.find((g) => g.avgRiskScore === min)!;
        flags.push({
          dimension,
          severity: 'red',
          evidence: `${dimension}: max "${maxGroup.group}" avg ${max} vs min "${minGroup.group}" avg ${min} — delta ${delta.toFixed(1)}`,
          recommendedAction: 'audit rubric for that group',
        });
      }
    }
  }

  return flags;
}

/**
 * S8 A3 — Director-only demographic parity (GD12): joins every cached
 * analysis's risk score (`resultJson.risk.complete.riskScore`, the same
 * shape A2 reads) to that patient's REAL HAPI demographics (age computed
 * from `Patient.birthDate`, sex from `Patient.gender`, race/ethnicity from
 * the US Core extensions — see `FhirReadService.getPatientDemographics`),
 * then stratifies risk by each dimension independently. A plain aggregate
 * over data already in hand — no fairness/ML library, per this slice's
 * ponytail pass.
 */
export async function getParityMetrics(
  actor: AuthTokenPayload,
  fhirService: FhirReadService,
  db: Database.Database
): Promise<ParityResult> {
  assertDirector(actor, db, 'Governance/parity');

  const rows = readAllAnalysisCache(db);
  const riskScoreByPatientId = new Map<string, number>();
  for (const row of rows) {
    const riskScore = (row.resultJson as { risk?: { complete?: { riskScore?: unknown } } } | null | undefined)?.risk
      ?.complete?.riskScore;
    if (typeof riskScore === 'number') riskScoreByPatientId.set(row.patientId, riskScore);
  }

  const patientIds = Array.from(riskScoreByPatientId.keys());
  const demographics = await fhirService.getPatientDemographics(actor, patientIds);
  const demographicsByPatientId = new Map<string, PatientDemographics>(demographics.map((d) => [d.patientId, d]));

  const now = new Date();
  const joined = patientIds.map((patientId) => ({
    riskScore: riskScoreByPatientId.get(patientId)!,
    demo: demographicsByPatientId.get(patientId),
  }));

  const result: ParityResult = {
    byAgeBand: stratify(joined.map((j) => ({ group: ageBandFor(ageFromBirthDate(j.demo?.birthDate, now)), riskScore: j.riskScore }))),
    bySex: stratify(joined.map((j) => ({ group: j.demo?.sex, riskScore: j.riskScore }))),
    byRace: stratify(joined.map((j) => ({ group: j.demo?.race, riskScore: j.riskScore }))),
    byEthnicity: stratify(joined.map((j) => ({ group: j.demo?.ethnicity, riskScore: j.riskScore }))),
    mitigation: [], // populated below
  };
  result.mitigation = parityMitigationFlags(result);

  // S19 Thread B — write a single audit row when any flag fires. The
  // `fhirResource` field carries the structured flag list (the audit_log
  // schema has no `details` column; encoding in `fhir_resource` keeps the
  // 4-field contract and stays within the `writeAudit` signature). The
  // detail is encoded as a JSON-suffixed path:
  //   `Governance/parity/<dim>:<severity>:<recommendedAction>`
  // joined with `;`. One row per call (not per flag) — multiple flags
  // collapse to a single audit entry to avoid noise on the audit trail.
  if (result.mitigation.length > 0) {
    const summary = result.mitigation
      .map((f) => `${f.dimension}:${f.severity}:${f.recommendedAction}`)
      .join(';');
    writeAudit(db, {
      actor: 'system',
      action: 'parity-mitigation-recommended',
      fhirResource: `Governance/parity/${summary}`,
      outcome: 'flagged',
    });
  }

  return result;
}

// --- B — S9 eval headline tile -------------------------------------------

// S8 B — exact path the B2 eval tile reads. S9 (the `npm run eval` harness)
// doesn't exist yet on this branch; this constant documents the contract it
// must honor: write its JSON summary to this repo-root path and the tile
// picks it up with no further wiring. Resolved from `__dirname` (not
// `process.cwd()`, which varies with the invoking workspace script) — both
// `src/governance` (tsx/ts-jest) and the built `dist/governance` sit 4
// directories below the repo root, so the same relative walk-up resolves
// correctly either way.
export const EVAL_REPORT_PATH = path.resolve(__dirname, '../../../../docs/eval-report.json');

export interface EvalSummaryResult {
  available: boolean;
  summary?: unknown;
}

/**
 * S8 B2 — Director-only, stateless read of the S9 evaluation report JSON.
 * Never throws and never fabricates: a missing file (S9 hasn't shipped yet)
 * or one that fails to parse both collapse to the same honest
 * `{ available: false }` the eval tile renders as a graceful empty state.
 */
export function getEvalSummary(actor: AuthTokenPayload, db: Database.Database): EvalSummaryResult {
  assertDirector(actor, db, 'Governance/eval');
  try {
    if (!fs.existsSync(EVAL_REPORT_PATH)) return { available: false };
    const summary = JSON.parse(fs.readFileSync(EVAL_REPORT_PATH, 'utf-8'));
    return { available: true, summary };
  } catch {
    return { available: false };
  }
}
