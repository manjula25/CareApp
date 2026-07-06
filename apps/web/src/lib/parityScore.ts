import type { ParityGroupStat, ParityResult } from '../api/client';

/**
 * S8 B — derived per-dimension "parity" value in [0,1] for one demographic
 * stratification (e.g. `byRace`). This is a computed statistic over data
 * already in hand (`ParityGroupStat[]`, real HAPI-demographics-joined risk
 * scores from `GET /api/governance/parity`) — NOT a fabricated number, same
 * category as `apps/api/src/population/service.ts`'s `projectedCostAvoidance`
 * doc comment.
 *
 * Formula: `1 - (max(avgRiskScore) - min(avgRiskScore)) / max(avgRiskScore)`
 * — the relative spread between the highest- and lowest-average-risk group
 * in this dimension, subtracted from perfect parity (1.0). A dimension where
 * every group's average risk score is identical scores 1.0; one where the
 * highest group's average risk is double the lowest's scores 0.5. Clamped to
 * [0,1] as a defensive bound, not because today's inputs can exceed it.
 *
 * A dimension with 0 or 1 populated groups has nothing to compare — treated
 * as perfect parity (1.0), not NaN/undefined. The same 1.0 fallback applies
 * when every populated group's avgRiskScore is 0 (max === 0): there is no
 * risk signal to be unequal about, so this is an honest "nothing to see"
 * result rather than a divide-by-zero NaN.
 */
export function computeDimensionParity(groups: Pick<ParityGroupStat, 'avgRiskScore'>[]): number {
  if (groups.length <= 1) return 1;

  const scores = groups.map((g) => g.avgRiskScore);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  if (max === 0) return 1;

  const raw = 1 - (max - min) / max;
  return Math.min(1, Math.max(0, raw));
}

export interface ParityAxis {
  label: string;
  value: number;
}

/**
 * The 4 real axes for the W06 demographic equity radar (S8 B1) — age band,
 * sex, race, ethnicity, each backed by `GET /api/governance/parity`'s real
 * stratified groups. Deliberately does NOT include the mockup's "Payer
 * Type," "Geography," or "Language" axes: no backing data for any of those
 * three exists anywhere in this system (no payer, geography, or
 * language-preference field is captured by S1-S8), so fabricating a score
 * for them would be exactly the dishonest-chrome problem this slice's
 * `CLAUDE.md` rule and `html-mockup-fidelity` skill both call out. Race and
 * Ethnicity are kept as two separate axes (not the mockup's single combined
 * "Race/Ethnicity") since the API returns two independent real
 * stratifications for them.
 */
export function buildParityAxes(parity: ParityResult): ParityAxis[] {
  return [
    { label: 'Age Band', value: computeDimensionParity(parity.byAgeBand) },
    { label: 'Sex', value: computeDimensionParity(parity.bySex) },
    { label: 'Race', value: computeDimensionParity(parity.byRace) },
    { label: 'Ethnicity', value: computeDimensionParity(parity.byEthnicity) },
  ];
}
