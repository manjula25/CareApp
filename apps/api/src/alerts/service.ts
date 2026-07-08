import type { Database } from 'better-sqlite3';
import { FhirReadService, ScopeDeniedError } from '../fhir/client';
import type { AuthTokenPayload } from '../auth/jwt';

/**
 * S12 B.2 — Clinical alerts derived from real FHIR data (replaces the
 * previously hardcoded `MOCK_ALERTS` in apps/web/src/pages/AlertsPage.tsx).
 *
 * Derivation:
 *   - Critical risk (>= 80)            → clinical/critical alert
 *   - High risk     (60–80)            → clinical/high alert
 *   - Stale encounter (> 720 h / 30 d) → gap/high alert
 *
 * Scope: requires 'clinical' (matches `getPopulationRiskProfile`'s own
 * guard). Social workers don't have clinical scope → their alert list
 * surfaces the underlying ScopeDeniedError; the front-end shows the
 * error message rather than fabricating rows.
 */

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AlertCategory = 'clinical' | 'medication' | 'sdoh' | 'gap';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  patientId: string;
  patientName: string;
  title: string;
  detail: string;
  fhirRef: string;
  /** "Xh ago" / "Xd ago" — hours since the underlying trigger event. */
  time: string;
  acknowledged: false; // future slice: persist ack state; for now all alerts are unacked
}

const CRITICAL_THRESHOLD = 80;
const HIGH_THRESHOLD = 60;
const STALE_ENCOUNTER_HOURS = 720;

function relativeTime(hoursSinceEvent: number): string {
  if (hoursSinceEvent < 1) return `${Math.round(hoursSinceEvent * 60)}m ago`;
  if (hoursSinceEvent < 24) return `${Math.round(hoursSinceEvent)}h ago`;
  return `${Math.round(hoursSinceEvent / 24)}d ago`;
}

/**
 * Pure transform — no I/O — so the route handler can be tested with a
 * synthetic risk profile without standing up HAPI.
 */
export function deriveAlerts(
  profiles: Array<{ patientId: string; riskScore: number; hoursSinceEncounter?: number; patientName?: string }>,
  patientNameLookup: (id: string) => string | undefined,
): Alert[] {
  const alerts: Alert[] = [];

  for (const profile of profiles) {
    const { patientId, riskScore, hoursSinceEncounter } = profile;
    const name = profile.patientName ?? patientNameLookup(patientId) ?? patientId;

    if (riskScore >= CRITICAL_THRESHOLD) {
      alerts.push({
        id: `risk-critical-${patientId}`,
        severity: 'critical',
        category: 'clinical',
        patientId,
        patientName: name,
        title: `Critical risk score (${riskScore}) — needs immediate review`,
        detail: `Patient is in the critical risk zone (score ${riskScore}/100). Open the patient record to review agents' findings and outstanding tasks.`,
        fhirRef: `RiskAssessment?subject=Patient/${patientId}`,
        time: hoursSinceEncounter !== undefined ? relativeTime(hoursSinceEncounter) : 'recent',
        acknowledged: false,
      });
    } else if (riskScore >= HIGH_THRESHOLD) {
      alerts.push({
        id: `risk-high-${patientId}`,
        severity: 'high',
        category: 'clinical',
        patientId,
        patientName: name,
        title: `Elevated risk score (${riskScore})`,
        detail: `Patient's risk score ${riskScore}/100 is in the high-risk band. Schedule proactive outreach before the next encounter.`,
        fhirRef: `RiskAssessment?subject=Patient/${patientId}`,
        time: hoursSinceEncounter !== undefined ? relativeTime(hoursSinceEncounter) : 'recent',
        acknowledged: false,
      });
    }

    if (hoursSinceEncounter !== undefined && hoursSinceEncounter > STALE_ENCOUNTER_HOURS) {
      alerts.push({
        id: `encounter-stale-${patientId}`,
        severity: 'high',
        category: 'gap',
        patientId,
        patientName: name,
        title: `No encounter in ${Math.round(hoursSinceEncounter / 24)} days`,
        detail: `Patient has not had an encounter for ${relativeTime(hoursSinceEncounter)}. Preventive-care cadence may be slipping; outreach recommended.`,
        fhirRef: `Encounter?subject=Patient/${patientId}`,
        time: relativeTime(hoursSinceEncounter),
        acknowledged: false,
      });
    }
  }

  // Newest + highest-severity first.
  const severityRank: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  alerts.sort((a, b) => {
    const rank = severityRank[a.severity] - severityRank[b.severity];
    return rank !== 0 ? rank : a.title.localeCompare(b.title);
  });

  return alerts;
}

/**
 * Fetch + derive in one call. The handler can then `await` and JSON-encode.
 * The route layer wraps this to translate ScopeDeniedError → 403.
 */
export async function listAlerts(
  actor: AuthTokenPayload,
  fhirService: FhirReadService,
  _db: Database,
): Promise<Alert[]> {
  // The risk profile requires clinical scope. Coordinator + director only.
  const profiles = await fhirService.getPopulationRiskProfile(actor);

  // Best-effort patient-name lookup. Each profile carries only patientId; we
  // fetch the Patient/$everything bundle to get a display name. Failures
  // here don't block alert generation — the alert falls back to patientId.
  const names = new Map<string, string>();
  await Promise.all(
    profiles.slice(0, 100).map(async (p) => {
      try {
        const patient = await fhirService.getPatient(actor, p.patientId);
        if (patient.name) names.set(p.patientId, patient.name);
      } catch {
        // ignore — alerts still render with patientId as the name
      }
    }),
  );

  return deriveAlerts(profiles, (id) => names.get(id));
}

export { ScopeDeniedError };