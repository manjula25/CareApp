import type { TaskDetail } from '../api/client';

/**
 * Demo insurance for `TaskDetail.tsx` — extracted from
 * `hl7-competition-caresyncai/apps/web/src/pages/mobile/TaskDetail.tsx`
 * during the S12 + UI-betterment Phase 3 port.
 *
 * The lead project's mobile page renders entirely against hardcoded
 * `MOCK_TASKS` (their FHIR client is a 21-line stub). My project renders
 * against the real `getTaskDetail(id)` API — these fixtures exist purely so
 * tests have a stable, non-mock-API-shape reference for assertions. They're
 * NOT used as a runtime fallback (a Task that 404s returns an error to the
 * user, not a demo card — that decision matches the upstream page).
 *
 * Lead-only fields we deliberately drop on the fixture (the lead's Task type
 * carries them, but my real API doesn't return them):
 *   - description, fhirResourceId, assignedTo, createdAt
 *   See the `## Honest-staging` block in `TaskDetail.tsx` for the full
 *   skip list and rationale.
 */

/** A fully-loaded `TaskDetail`-shaped object with TWO citations + a phone —
 *  exercises every render branch (priority pill, status pill, title, patient
 *  context card, citations list, Call link, overdue label) in one fixture. */
export const MOCK_TASK: TaskDetail = {
  id: 't-d1',
  title: '48h post-discharge follow-up call',
  priority: 'critical',
  due: new Date().toISOString(),
  status: 'pending',
  patientId: 'maria-chen-4829',
  patientName: 'Maria Chen',
  conditionTag: 'CHF',
  citations: [
    { reference: 'Encounter/enc-discharge-4829', display: 'Discharge summary' },
    { reference: 'Observation/bnp-4829', display: 'BNP 420 pg/mL' },
  ],
  patientPhone: '+14155552671',
};

/** Variant with NO `patientPhone` so tests can verify the Call link is hidden
 *  — mirrors the lead's `p3` ("Robert Torres", `patientPhone` undefined). */
export const MOCK_TASK_NO_PHONE: TaskDetail = {
  id: 't-d2',
  title: 'Meals on Wheels referral',
  priority: 'high',
  due: new Date(Date.now() + 2 * 86400000).toISOString(),
  status: 'pending',
  patientId: 'p7',
  patientName: 'Patricia Davis',
  conditionTag: 'CHF',
  citations: [
    { reference: 'QuestionnaireResponse/ahc-p7', display: 'AHC-HRSN' },
  ],
  patientPhone: undefined,
};

/** Returns "YYYY-MM-DD" for an ISO date (or an ISO datetime) — local-tz-stable
 *  so test outputs match regardless of when the suite runs. */
export function isoDay(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" of `days` from today (positive = future, negative = past).
 *  Used by tests to build `due` strings for overdue / future / today cases. */
export function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDay(d);
}
