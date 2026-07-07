import type { PatientDetail } from '../api/client';

/**
 * Phase 3 — lead-port fixtures for `PatientProfile.tsx`.
 *
 * Lead: `hl7-competition-caresyncai/apps/web/src/pages/mobile/PatientProfile.tsx`
 *       (200 lines, mock-driven, 390px phone frame)
 *
 * Real API (`getPatient`) only returns `PatientDetail` =
 *   { patient: {id, name, gender, birthDate}, conditions: [{id, code, display}], tasks: TaskSummary[] }
 * — see `apps/web/src/api/client.ts` PatientDetail (lines 86-94). MRN, riskScore,
 * labs, medications, SDOH flags are all NOT exposed.
 *
 * Lead's screen hardcoded a richer 4-patient `MOCK_PATIENTS` list (Maria Chen,
 * Robert Torres, Dorothy Williams, Patricia Davis) with MRN/riskScore/labs/meds/
 * SDOH available ONLY for Maria. This file ports that list verbatim and adds the
 * helpers `PatientProfile.tsx` needs to render at real web size:
 *   - `MARIA_LABS`, `MARIA_MEDS`, `SDOH_FLAGS`, `MARIA_PHONE` — lead's Maria-only
 *     rich-detail fixtures (consumed by the page when the API is thin).
 *   - `conditionDotBgClass(i)` — converts the lead's `CONDITION_COLORS` text-color
 *     palette (`text-red`, etc.) into the matching bg-* for the conditions dot.
 *   - `RISK_BADGE_CLASS` — class map keyed by `RiskLevel` (matches `Population.tsx`).
 *   - `MARIA_GET_PATIENT_RESULT` and `buildMockGetPatientResult(p)` — synthesise a
 *     `PatientDetail` payload (matching the real API's shape) from a MockPatient
 *     row, for tests.
 */

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

/** Lead's per-patient row shape — exported as-is so tests can reuse it directly
 *  even though the page itself only consumes the rich-detail fragments (labs/meds/SDOH/phone). */
export interface MockPatient {
  id: string;
  mrn: string;
  name: string;
  age: number;
  sex: 'F' | 'M';
  conditions: string[];
  riskScore: number;
  riskLevel: RiskLevel;
  daysSinceContact: number;
}

export const MOCK_PATIENTS: MockPatient[] = [
  { id: 'maria-chen-4829', mrn: '4829-FHIR', name: 'Maria Chen',     age: 68, sex: 'F', conditions: ['CHF', 'T2DM', 'Depression'],                  riskScore: 87, riskLevel: 'critical', daysSinceContact: 2  },
  { id: 'p2',               mrn: '2341-FHIR', name: 'Robert Torres',   age: 72, sex: 'M', conditions: ['COPD', 'HTN'],                                  riskScore: 76, riskLevel: 'critical', daysSinceContact: 5  },
  { id: 'p3',               mrn: '5567-FHIR', name: 'Dorothy Williams', age: 65, sex: 'F', conditions: ['T2DM', 'CKD'],                                  riskScore: 68, riskLevel: 'high',     daysSinceContact: 12 },
  { id: 'p7',               mrn: '4492-FHIR', name: 'Patricia Davis',   age: 70, sex: 'F', conditions: ['CHF', 'CKD', 'Anemia'],                        riskScore: 82, riskLevel: 'critical', daysSinceContact: 1  },
];

/** Stable id for Maria — `PatientProfile.tsx`'s `isMaria` check gates the rich
 *  labs/meds/SDOH/phone branches on this exact id. Matches the real HAPI
 *  Patient seed id (`maria-chen`, see apps/api/src/db/seed.ts) so the rich
 *  detail is reachable from the running app when a real Task's
 *  Task.for.reference = "Patient/maria-chen" links into this view.
 *
 *  Lead's mockup had a different id (`maria-chen-4829`) — a pure-fixture id
 *  that never reached a real FHIR Patient. Using it here would make the
 *  rich-detail branch unreachable from any real navigation path; using
 *  `maria-chen` aligns the demo-data branch with the actual seeded patient
 *  and lets the e2e + dev-server flow exercise it. */
export const MARIA_ID = 'maria-chen';

/** Lead's Maria-only rich-detail fixtures (consumed by the page when the API
 *  is thin). Each entry is verbatim from the lead's `MARIA_LABS` constant. */
export const MARIA_LABS = [
  { name: 'HbA1c',     value: '8.9%',     status: 'H' as const, date: '2026-06-15' },
  { name: 'NT-proBNP', value: '340 pg/mL', status: 'H' as const, date: '2026-06-30' },
  { name: 'GFR',       value: '52 mL/min', status: 'L' as const, date: '2026-06-30' },
  { name: 'Potassium', value: '3.4 mEq/L', status: 'L' as const, date: '2026-06-30' },
];

/** Lead's Maria-only med list — verbatim from the lead's `MARIA_MEDS` constant. */
export const MARIA_MEDS = [
  'Metformin 1000mg BID',
  'Lisinopril 10mg daily',
  'Furosemide 40mg daily',
  'Sertraline 50mg daily',
];

/** Lead's Maria-only SDOH flags — verbatim from the lead's SDOH card markup. */
export const SDOH_FLAGS = [
  'Transportation barrier',
  'Food insecurity',
];

/** Lead's hardcoded Maria phone — reconciled with the real HAPI seed
 *  (`+1-555-0142`, see apps/api/src/fhir-data/seed-patients.ts) so the
 *  tel: link matches what `TaskDetail`'s Call link renders for the same
 *  patient. Lead originally had `555-0100`; switching to the real seed value
 *  avoids two different phone numbers for Maria depending on which surface
 *  the social worker clicks Call from. The fixture is the only source of a
 *  real `tel:` href on PatientProfile (the API's `PatientDetail` doesn't
 *  expose a phone), so the Call Patient button is rendered only when
 *  `isMaria` is true. */
export const MARIA_PHONE = '+1-555-0142';

/** Tailwind text-color palette for the per-condition dot — verbatim from the lead. */
export const CONDITION_COLORS = ['text-red', 'text-amber', 'text-violet', 'text-cyan', 'text-emerald'];

/** Background class for the matching dot — derived from `CONDITION_COLORS`
 *  by stripping the `text-` prefix and substituting `bg-`. */
export function conditionDotBgClass(i: number): string {
  return CONDITION_COLORS[i % CONDITION_COLORS.length].replace('text-', 'bg-');
}

/** Sample `PatientDetail` payload for Maria — used by tests as the default
 *  `getPatient` mock value. Matches my API's shape (NOT lead's: my conditions
 *  are FHIR-shaped `{id, code, display}`, lead's were plain strings). */
export const MARIA_GET_PATIENT_RESULT: PatientDetail = {
  patient: {
    id: MARIA_ID,
    name: 'Maria Chen',
    gender: 'female',
    birthDate: '1957-03-14',
  },
  conditions: [
    { id: 'cond-chf',  code: 'I50.9', display: 'CHF' },
    { id: 'cond-t2dm', code: 'E11.9', display: 'T2DM' },
    { id: 'cond-dep',  code: 'F32.9', display: 'Depression' },
  ],
  tasks: [],
};

/** Build a `PatientDetail` payload (matching the real API's `getPatient` shape)
 *  from any `MockPatient` row. Tests use this to seed non-Maria fixtures without
 *  hand-rolling the typing. */
export function buildMockGetPatientResult(p: MockPatient): PatientDetail {
  return {
    patient: {
      id: p.id,
      name: p.name,
      gender: p.sex === 'F' ? 'female' : 'male',
      // Birth date is a rough stand-in: lead's fixture carried `age` directly,
      // not a real DOB, so we synthesise a plausible date from the year only.
      // The page uses `ageSexLabel()` which tolerates any well-formed ISO date.
      birthDate: `${new Date().getFullYear() - p.age}-01-01`,
    },
    conditions: p.conditions.map((c, i) => ({
      id: `${p.id}-cond-${i}`,
      code: c,
      display: c,
    })),
    tasks: [],
  };
}
