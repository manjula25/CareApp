import Database from 'better-sqlite3';
import { AuthTokenPayload } from '../auth/jwt';
import { writeAudit } from '../db/audit';
import { CRITICAL_RISK_THRESHOLD } from '../fhir-data/population';
import { FhirReadService, PopulationRiskProfile } from '../fhir/client';

/**
 * `hasScope` (auth/scopes.ts) does not gate this: both director AND
 * coordinator hold clinical+demographic scope, since both need patient-level
 * clinical reads for their own screens. The population *aggregate* view is a
 * separate, role-level rule — Director only — so it's enforced here rather
 * than in `hasScope`, with its own denial audit. Mirrors `ScopeDeniedError`
 * (fhir/client.ts) → 403 pattern used by the other routes.
 */
export class DirectorOnlyError extends Error {
  constructor(role: string) {
    super(`Role '${role}' cannot access population aggregates (Director-only)`);
    this.name = 'DirectorOnlyError';
  }
}

function assertDirector(actor: AuthTokenPayload, db: Database.Database, resource: string): void {
  if (actor.role !== 'director') {
    writeAudit(db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'denied' });
    throw new DirectorOnlyError(actor.role);
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
