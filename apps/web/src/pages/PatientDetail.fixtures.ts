/**
 * Demo insurance for `PatientDetail.tsx`.
 *
 * Extracted from `hl7-competition-caresyncai/apps/web/src/pages/director/PatientDetail.tsx`
 * during the S12 + UI-betterment Phase 1 port — the lead project renders against
 * hardcoded data, not a real backend, and we've kept that behavior as a *fallback*
 * path so the demo always shows something even when the API is down / OpenAI is
 * rate-limited / the OAuth dance hasn't completed.
 *
 * Two-tier fallback chain inside `PatientDetail.tsx`:
 *   1. Try `getPatient(id)` against the real FHIR backend.
 *   2. If that 404s or `id` isn't a seeded HAPI patient, use `MOCK_PATIENTS`
 *      (with `maria-chen-4829` as the always-renders-something default).
 *   3. On `Run Analysis`, try `streamAnalysis(id)` against my backend.
 *   4. If the stream errors or has no event in 3s, fall through to
 *      `runMockSim(MOCK_ANALYSIS[patientId] ?? MOCK_ANALYSIS['maria-chen-4829'])`
 *      which animates the four agents with staggered timeouts so the visual
 *      effect is preserved.
 */

import type { AgentFinding } from '../types';

export interface DisplayPatient {
  id: string;
  mrn: string;
  name: string;
  age: number;
  sex: string;
  conditions: string[];
  riskScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  daysSinceContact: number;
}

export interface DisplayAnalysisData {
  riskAgent: { status: string; findings: AgentFinding[] };
  careGapAgent: { status: string; findings: AgentFinding[] };
  sdohAgent: { status: string; findings: AgentFinding[] };
  actionPlanner: { status: string; findings: AgentFinding[] };
}

export const MOCK_PATIENTS: DisplayPatient[] = [
  { id: 'maria-chen-4829', mrn: '4829-FHIR', name: 'Maria Chen', age: 68, sex: 'F', conditions: ['CHF', 'T2DM', 'Depression'], riskScore: 87, riskLevel: 'critical', daysSinceContact: 2 },
  { id: 'p2', mrn: '2341-FHIR', name: 'Robert Torres', age: 72, sex: 'M', conditions: ['COPD', 'Hypertension'], riskScore: 76, riskLevel: 'critical', daysSinceContact: 5 },
  { id: 'p3', mrn: '5567-FHIR', name: 'Dorothy Williams', age: 65, sex: 'F', conditions: ['T2DM', 'CKD'], riskScore: 68, riskLevel: 'high', daysSinceContact: 12 },
  { id: 'p4', mrn: '8823-FHIR', name: 'James Anderson', age: 78, sex: 'M', conditions: ['CHF', 'A-Fib'], riskScore: 71, riskLevel: 'high', daysSinceContact: 8 },
  { id: 'p5', mrn: '3391-FHIR', name: 'Linda Martinez', age: 61, sex: 'F', conditions: ['Hypertension', 'Anxiety'], riskScore: 42, riskLevel: 'medium', daysSinceContact: 21 },
  { id: 'p6', mrn: '7721-FHIR', name: 'Charles Brown', age: 55, sex: 'M', conditions: ['Depression', 'T2DM'], riskScore: 38, riskLevel: 'low', daysSinceContact: 35 },
  { id: 'p7', mrn: '4492-FHIR', name: 'Patricia Davis', age: 70, sex: 'F', conditions: ['CHF', 'CKD', 'Anemia'], riskScore: 82, riskLevel: 'critical', daysSinceContact: 1 },
  { id: 'p8', mrn: '6634-FHIR', name: 'Michael Johnson', age: 63, sex: 'M', conditions: ['COPD', 'Depression'], riskScore: 55, riskLevel: 'high', daysSinceContact: 18 },
];

export const MOCK_ANALYSIS: Record<string, DisplayAnalysisData> = {
  'maria-chen-4829': {
    riskAgent: {
      status: 'complete',
      findings: [
        { type: 'readmission_risk', finding: 'HbA1c 8.9% exceeds target — elevated readmission risk', fhirResourceId: 'Observation/obs-hba1c-4829', severity: 'critical', confidence: 0.91 },
        { type: 'medication_gap', finding: 'Missing ACE inhibitor despite CHF diagnosis', fhirResourceId: 'Condition/chf-4829', severity: 'high', confidence: 0.87 },
      ],
    },
    careGapAgent: {
      status: 'complete',
      findings: [
        { type: 'care_gap', finding: 'Annual diabetic eye exam overdue by 14 months', fhirResourceId: 'CarePlan/cp-4829', severity: 'high', confidence: 0.95 },
        { type: 'care_gap', finding: 'Flu vaccine not documented this season', fhirResourceId: 'Immunization/imm-4829', severity: 'medium', confidence: 0.88 },
      ],
    },
    sdohAgent: {
      status: 'complete',
      findings: [
        { type: 'sdoh_barrier', finding: 'Transportation barrier to appointments — lives alone', fhirResourceId: 'QuestionnaireResponse/ahc-4829', severity: 'high', confidence: 0.94 },
        { type: 'sdoh_barrier', finding: 'Food insecurity: "often true" — affects medication adherence', fhirResourceId: 'QuestionnaireResponse/ahc-4829', severity: 'high', confidence: 0.89 },
      ],
    },
    actionPlanner: {
      status: 'complete',
      findings: [
        { type: 'action', finding: 'Schedule 48h post-discharge follow-up call TODAY', fhirResourceId: 'Encounter/enc-discharge-4829', severity: 'critical', confidence: 0.96 },
        { type: 'action', finding: 'Refer to Meals on Wheels — food insecurity + transportation gap', fhirResourceId: 'QuestionnaireResponse/ahc-4829', severity: 'high', confidence: 0.91 },
        { type: 'action', finding: 'Coordinate diabetic eye exam referral within 30 days', fhirResourceId: 'CarePlan/cp-4829', severity: 'high', confidence: 0.88 },
      ],
    },
  },
};

/** Hero patient's default vitals — shown in the left-rail `Key Vitals` block. */
export const DEFAULT_VITALS = [
  { label: 'HbA1c', value: '8.9%' },
  { label: 'BNP', value: '420 pg/mL' },
  { label: 'GFR', value: '52' },
  { label: 'K+', value: '4.1 mEq/L' },
];

/** Hardcoded orchestrator-mode right-rail task list — pure visual demo data; not
 * wired to the real `/api/tasks` list. The real task list surface is the
 * `Tasks` page (`routes/tasks`), not this orchestration overview. */
export const GRAPH_TASKS = [
  { priority: 'critical' as const, due: 'Today',    title: 'Cardiology follow-up',      desc: 'Schedule within 72h — BNP elevation at 420 pg/mL',         fhir: 'Observation/bnp-4829' },
  { priority: 'high'     as const, due: 'Today',    title: 'Medication reconciliation',  desc: 'Furosemide dose review — GFR 52, nephrology consult needed', fhir: 'MedicationRequest/furos-4829' },
  { priority: 'high'     as const, due: 'Tomorrow', title: 'Transportation arrangement', desc: 'Patient reported access barrier — lives alone, no car',      fhir: 'QuestionnaireResponse/ahc-4829' },
  { priority: 'medium'   as const, due: 'Fri',      title: 'Food assistance referral',   desc: 'AHC-HRSN positive — food insecurity affects adherence',      fhir: 'QuestionnaireResponse/ahc-4829' },
  { priority: 'medium'   as const, due: 'Fri',      title: 'PHQ-9 follow-up call',       desc: 'Depression screening score — 48h callback window',          fhir: 'Condition/dep-4829' },
];

/** Hardcoded FHIR bundle summary for the orchestrator-mode right rail — counts
 * only, no individual resource ids; matches the hero patient's expected bundle
 * shape when HAPI is fully seeded. */
export const FHIR_BUNDLE = [
  { type: 'Patient',           count: 1,  icon: '👤' },
  { type: 'Condition',         count: 3,  icon: '🏥' },
  { type: 'MedicationRequest', count: 4,  icon: '💊' },
  { type: 'Observation',       count: 12, icon: '🔬' },
  { type: 'CarePlan',          count: 1,  icon: '📋' },
];
