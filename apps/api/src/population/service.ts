import Database from 'better-sqlite3';
import { AuthTokenPayload } from '../auth/jwt';
import { writeAudit } from '../db/audit';
import { CRITICAL_RISK_THRESHOLD } from '../fhir-data/population';
import { DirectorOnlyError, FhirReadService, PopulationRiskProfile } from '../fhir/client';

// Re-exported so existing importers (routes/population.ts) don't need to
// change their import path — `DirectorOnlyError` itself now lives in
// fhir/client.ts (S6 A1 reuses it for task-assignment's Director-only rule;
// see that file's class doc for why it isn't expressible via `hasScope`).
export { DirectorOnlyError };

function assertDirector(actor: AuthTokenPayload, db: Database.Database, resource: string): void {
  if (actor.role !== 'director') {
    writeAudit(db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'denied' });
    throw new DirectorOnlyError(actor.role, 'access population aggregates');
  }
  // No audit row here on the "allowed" branch — the actual population read
  // that follows (FhirReadService.getPopulationRiskProfile) writes its own
  // success audit once the live HAPI read completes. Writing one here too
  // would double-count an aggregate that, at this point, hasn't happened yet.
}

export interface ScatterPoint {
  id: string;
  riskScore: number;
  urgency: number;
  x: number;
  y: number;
}

export interface TeamKpis {
  criticalZonePatients: number;
  totalPatients: number;
}

export interface PopulationSummaryResult {
  criticalZoneCount: number;
  projectedCostAvoidance: number;
  teamKpis: TeamKpis;
}

// --- cost-avoidance math (pure, POC assumptions) --------------------------
//
// POC assumption #1: average cost of a 30-day hospital readmission. This is
// a documented stand-in figure (commonly-cited order-of-magnitude for U.S.
// readmission cost in care-coordination literature), not a live billing or
// claims figure — there is no billing system in this POC to source it from.
export const READMISSION_UNIT_COST_USD = 15_200;

// POC assumption #2: fraction of at-risk (probability-weighted) readmissions
// assumed avoidable through proactive care-coordination outreach (the kind
// of outreach this POC's Action Planner/task system exists to drive). Also a
// documented stand-in, not derived from a trial or real program outcome.
export const AVOIDED_READMISSION_RATE = 0.2;

/**
 * Pure function — no HAPI/db access — so it's unit-testable against a fixed
 * fixture. Formula ("risk-weighted avoided-readmission × unit cost", plan
 * wording):
 *
 *   expectedReadmissions = sum(riskScore / 100)     for every patient
 *   avoidedReadmissions  = expectedReadmissions * AVOIDED_READMISSION_RATE
 *   costAvoidance        = avoidedReadmissions * READMISSION_UNIT_COST_USD
 *
 * i.e. each patient's riskScore (0-100) is treated as their probability of a
 * 30-day readmission; summing those probabilities across the population
 * gives the number of readmissions "expected" without intervention; a fixed
 * fraction of those are assumed avoided by care-coordination outreach; each
 * avoided readmission is worth the fixed unit cost above.
 */
export function projectedCostAvoidance(riskScores: number[]): number {
  const expectedReadmissions = riskScores.reduce((sum, score) => sum + score / 100, 0);
  return Math.round(expectedReadmissions * AVOIDED_READMISSION_RATE * READMISSION_UNIT_COST_USD);
}

// --- urgency / scatter mapping ---------------------------------------------
//
// 30 days — the same window the population generator's own risk heuristic
// (fhir-data/population.ts, riskScoreFor's recency bonus) treats as "recent",
// so risk and urgency agree on what counts as a recent encounter. Urgency
// decays linearly from 100 (encounter just ended) to 0 (encounter >= 30 days
// ago); a patient with no Encounter on record gets urgency 0 — there is
// nothing recent to act on.
const URGENCY_DECAY_WINDOW_HOURS = 24 * 30;

function urgencyFor(hoursSinceEncounter: number | undefined): number {
  if (hoursSinceEncounter === undefined) return 0;
  const decayed = 100 - (hoursSinceEncounter / URGENCY_DECAY_WINDOW_HOURS) * 100;
  return Math.max(0, Math.min(100, Math.round(decayed)));
}

// Scatter mapping: x is riskScore, y is urgency — the W02 population scatter
// plots readmission risk against how recently/urgently a patient needs
// attention, both already 0-100 so no further scaling is needed.
function toScatterPoint(profile: PopulationRiskProfile): ScatterPoint {
  const urgency = urgencyFor(profile.hoursSinceEncounter);
  return { id: profile.patientId, riskScore: profile.riskScore, urgency, x: profile.riskScore, y: urgency };
}

export async function getPopulationScatter(
  actor: AuthTokenPayload,
  fhirService: FhirReadService,
  db: Database.Database
): Promise<ScatterPoint[]> {
  assertDirector(actor, db, 'Population/scatter');
  const profiles = await fhirService.getPopulationRiskProfile(actor);
  return profiles.map(toScatterPoint);
}

export async function getPopulationSummary(
  actor: AuthTokenPayload,
  fhirService: FhirReadService,
  db: Database.Database
): Promise<PopulationSummaryResult> {
  assertDirector(actor, db, 'Population/summary');
  const profiles = await fhirService.getPopulationRiskProfile(actor);
  const riskScores = profiles.map((p) => p.riskScore);
  const criticalZoneCount = riskScores.filter((score) => score >= CRITICAL_RISK_THRESHOLD).length;

  return {
    criticalZoneCount,
    projectedCostAvoidance: projectedCostAvoidance(riskScores),
    // Placeholder pending S6/S7: there is no care-team assignment/task-
    // ownership data yet, so no per-coordinator caseload/workload breakdown
    // can be computed honestly. These two counts are real (derived from the
    // live risk read above), just not sliced by team/coordinator.
    teamKpis: { criticalZonePatients: criticalZoneCount, totalPatients: profiles.length },
  };
}

// --- risk-distribution bucket ----------------------------------------------
//
// S12 A.3 — `GET /api/population/risk-distribution` returns one bucket per
// level (critical/high/medium/low) with the count of patients whose
// `riskScore` falls into that range. Critical threshold (75) is the same
// `CRITICAL_RISK_THRESHOLD` already used by PopulationSummary's
// criticalZoneCount and the population scatter's critical zone — the rest of
// the buckets are added here with deliberately non-overlapping cutoffs so a
// patient always lands in exactly one bucket.
const HIGH_RISK_THRESHOLD = 60;
const MEDIUM_RISK_THRESHOLD = 40;

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

export interface RiskDistributionBucket {
  level: RiskLevel;
  count: number;
}

function bucketFor(riskScore: number): RiskLevel {
  if (riskScore >= CRITICAL_RISK_THRESHOLD) return 'critical';
  if (riskScore >= HIGH_RISK_THRESHOLD) return 'high';
  if (riskScore >= MEDIUM_RISK_THRESHOLD) return 'medium';
  return 'low';
}

// Exported for the unit test in service.test.ts — the pure bucketing function
// is the only deterministic piece of the risk-distribution pipeline (the rest
// of it is a live HAPI read), so testing it standalone keeps the contract
// tight without a HAPI dependency.
export const _testing = { bucketFor };

export async function getRiskDistribution(
  actor: AuthTokenPayload,
  fhirService: FhirReadService,
  db: Database.Database
): Promise<RiskDistributionBucket[]> {
  assertDirector(actor, db, 'Population/risk-distribution');
  const profiles = await fhirService.getPopulationRiskProfile(actor);

  const counts: Record<RiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const profile of profiles) {
    counts[bucketFor(profile.riskScore)] += 1;
  }

  // Always return all four buckets, even when a level has zero patients, so
  // the bar chart renders a stable x-axis. Order matches critical→low so a
  // sorted chart doesn't need re-sorting client-side.
  return [
    { level: 'critical', count: counts.critical },
    { level: 'high', count: counts.high },
    { level: 'medium', count: counts.medium },
    { level: 'low', count: counts.low },
  ];
}
