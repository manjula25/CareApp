/**
 * S12 follow-up — Demo fallback for `POST /api/patients/:id/analysis` when
 * the patient id isn't seeded in HAPI FHIR.
 *
 * For demo continuity, the UI ships with `MOCK_PATIENTS` / `MOCK_ANALYSIS`
 * fixtures (PatientDetail.fixtures.ts in the web app) so unknown routes like
 * `/patients/maria-chen-4829` still render. Without this fallback, clicking
 * "Run Analysis" on such a route would 404 — breaking the demo for any URL
 * pointing at the hero patient.
 *
 * This module ports the web's `maria-chen-4829` demo analysis into the
 * `AnalysisResultJson` shape the API's `replayCachedAnalysis` already
 * consumes, so the same SSE event sequence a real run emits is what the
 * client sees. New patient ids should be added to `MOCK_ANALYSIS_JSON` here
 * (not the web) so the API is the single source of truth for replay data.
 */
import type { AnalysisResultJson } from './analysis';

const MOCK_ANALYSIS_JSON: Record<string, AnalysisResultJson> = {
  'maria-chen-4829': {
    risk: {
      narration:
        'Maria Chen shows very high 30-day readmission risk driven by a recent heart-failure hospitalization, active CHF with elevated BNP, suboptimal diabetes control (HbA1c 8.9%), reduced kidney function, and recurrent moderate depression. Major social needs — housing instability and food insecurity — compound these clinical risks.',
      findings: [
        { text: 'HbA1c 8.9% exceeds target — elevated readmission risk', finding: 'HbA1c 8.9% exceeds target — elevated readmission risk', fhirResourceId: 'Observation/obs-hba1c-4829', severity: 'critical', confidence: 0.91 },
        { text: 'Missing ACE inhibitor despite CHF diagnosis', finding: 'Missing ACE inhibitor despite CHF diagnosis', fhirResourceId: 'Condition/chf-4829', severity: 'high', confidence: 0.87 },
      ],
      complete: { riskScore: 87, riskLevel: 'critical', readmissionProbability: 0.7, findingCount: 2, droppedCount: 0 },
    },
    careGap: {
      narration:
        'Maria is overdue for an annual diabetic eye exam by 14 months and lacks a documented seasonal flu vaccine. Both gaps are within the 30-day outreach window.',
      findings: [
        { gapType: 'screening_overdue', description: 'Annual diabetic eye exam overdue by 14 months', urgency: 'high', fhirResourceId: 'CarePlan/cp-4829', severity: 'high', confidence: 0.95 },
        { gapType: 'immunization_missing', description: 'Flu vaccine not documented this season', urgency: 'medium', fhirResourceId: 'Immunization/imm-4829', severity: 'medium', confidence: 0.88 },
      ],
      complete: { findingCount: 2, droppedCount: 0 },
    },
    sdoh: {
      narration:
        'AHC-HRSN screening flagged transportation and food insecurity as major adherence barriers. Maria lives alone and reports both domains as "often true".',
      findings: [
        { domain: 'transportation', finding: 'Transportation barrier to appointments — lives alone', severity: 'high', fhirResourceId: 'QuestionnaireResponse/ahc-4829', confidence: 0.94 },
        { domain: 'food_security', finding: 'Food insecurity: "often true" — affects medication adherence', severity: 'high', fhirResourceId: 'QuestionnaireResponse/ahc-4829', confidence: 0.89 },
      ],
      complete: { findingCount: 2, droppedCount: 0, referralsNeeded: ['Meals on Wheels', 'Transportation assistance'] },
    },
    actionPlanner: {
      narration: 'Synthesizing the risk, care-gap, and SDOH findings into a prioritized action plan.',
      tasks: [
        { id: 'mock-act-1', reference: 'Task/mock-act-1', title: 'Schedule 48h post-discharge follow-up call TODAY', description: 'Cardiology follow-up within 72h — BNP elevation at 420 pg/mL', priority: 'critical', assignTo: 'coordinator', dueInDays: 0, fhirResources: ['Encounter/enc-discharge-4829'] },
        { id: 'mock-act-2', reference: 'Task/mock-act-2', title: 'Refer to Meals on Wheels', description: 'Food insecurity + transportation gap — coordinate community resources', priority: 'high', domain: 'sdoh', assignTo: 'social_worker', dueInDays: 3, fhirResources: ['QuestionnaireResponse/ahc-4829'] },
        { id: 'mock-act-3', reference: 'Task/mock-act-3', title: 'Coordinate diabetic eye exam referral', description: 'Annual diabetic eye exam overdue by 14 months', priority: 'high', assignTo: 'coordinator', dueInDays: 30, fhirResources: ['CarePlan/cp-4829'] },
      ],
      complete: { findingCount: 3, droppedCount: 0 },
    },
  },
};

/** Returns the demo analysis for a patient id, or null if no demo exists.
 *  Used as a final fallback in the analysis route when HAPI 404s. */
export function getMockAnalysis(patientId: string): AnalysisResultJson | null {
  return MOCK_ANALYSIS_JSON[patientId] ?? null;
}