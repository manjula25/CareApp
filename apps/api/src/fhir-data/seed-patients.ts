/**
 * Hand-authored FHIR R4 seed data for S1 (GD3). Maria Chen is the hero patient
 * with deterministic clinical values the Risk Agent will analyze in S2. The
 * other five are lightweight panel patients giving the Coordinator's My
 * Patient Panel (W12) variety. All resources use client-assigned ids (PUT) so
 * re-running the import is idempotent.
 */

export interface SeedPatient {
  id: string;
  name: { given: string[]; family: string };
  gender: 'male' | 'female';
  birthDate: string;
  conditions: Array<{ id: string; system: 'ICD-10'; code: string; display: string; onsetDateTime?: string }>;
  observations?: Array<{
    id: string;
    loincCode: string;
    display: string;
    value: number;
    unit: string;
    system?: string;
  }>;
  sdohPositive?: { id: string; note: string };
  encounter?: { id: string; conditionId: string; dischargedHoursAgo: number };
  riskScore: number;
  tasks: Array<{ id: string; description: string; priority: 'critical' | 'high' | 'medium'; dueInDays: number }>;
}

const HOUR_MS = 60 * 60 * 1000;
const now = () => new Date().toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR_MS).toISOString();

export const MARIA_CHEN: SeedPatient = {
  id: 'maria-chen',
  name: { given: ['Maria'], family: 'Chen' },
  gender: 'female',
  birthDate: '1958-04-12',
  conditions: [
    { id: 'maria-chen-diabetes', system: 'ICD-10', code: 'E11.9', display: 'Type 2 diabetes mellitus without complications' },
    { id: 'maria-chen-chf', system: 'ICD-10', code: 'I50.9', display: 'Heart failure, unspecified', onsetDateTime: hoursAgo(96) },
    { id: 'maria-chen-depression', system: 'ICD-10', code: 'F33.1', display: 'Major depressive disorder, recurrent, moderate' },
  ],
  observations: [
    { id: 'maria-chen-hba1c', loincCode: '4548-4', display: 'Hemoglobin A1c', value: 8.9, unit: '%' },
    { id: 'maria-chen-bnp', loincCode: '30934-4', display: 'Natriuretic peptide B', value: 340, unit: 'pg/mL' },
    { id: 'maria-chen-egfr', loincCode: '62238-1', display: 'eGFR', value: 52, unit: 'mL/min/1.73m2' },
    { id: 'maria-chen-potassium', loincCode: '2823-3', display: 'Potassium', value: 3.4, unit: 'mmol/L' },
  ],
  sdohPositive: { id: 'maria-chen-sdoh', note: 'AHC-HRSN screening positive: housing instability, food insecurity' },
  encounter: { id: 'maria-chen-chf-admit', conditionId: 'maria-chen-chf', dischargedHoursAgo: 48 },
  riskScore: 87,
  tasks: [
    { id: 'maria-chen-task-housing', description: 'SDOH referral: housing navigator', priority: 'medium', dueInDays: 2 },
    { id: 'maria-chen-task-medrec', description: 'Medication reconciliation follow-up', priority: 'high', dueInDays: 0 },
  ],
};

export const PANEL_PATIENTS: SeedPatient[] = [
  {
    id: 'james-okafor',
    name: { given: ['James'], family: 'Okafor' },
    gender: 'male',
    birthDate: '1962-11-03',
    conditions: [{ id: 'james-okafor-copd', system: 'ICD-10', code: 'J44.9', display: 'Chronic obstructive pulmonary disease, unspecified' }],
    riskScore: 62,
    tasks: [{ id: 'james-okafor-task-followup', description: 'Pulmonology follow-up scheduling', priority: 'high', dueInDays: 1 }],
  },
  {
    id: 'linda-torres',
    name: { given: ['Linda'], family: 'Torres' },
    gender: 'female',
    birthDate: '1970-02-19',
    conditions: [{ id: 'linda-torres-ckd', system: 'ICD-10', code: 'N18.3', display: 'Chronic kidney disease, stage 3' }],
    riskScore: 71,
    tasks: [{ id: 'linda-torres-task-labs', description: 'Repeat basic metabolic panel', priority: 'medium', dueInDays: 3 }],
  },
  {
    id: 'robert-kim',
    name: { given: ['Robert'], family: 'Kim' },
    gender: 'male',
    birthDate: '1948-07-25',
    conditions: [{ id: 'robert-kim-hipfx', system: 'ICD-10', code: 'S72.001A', display: 'Fracture of unspecified part of neck of right femur, initial encounter' }],
    riskScore: 45,
    tasks: [],
  },
  {
    id: 'angela-diaz',
    name: { given: ['Angela'], family: 'Diaz' },
    gender: 'female',
    birthDate: '1975-09-08',
    conditions: [
      { id: 'angela-diaz-htn', system: 'ICD-10', code: 'I10', display: 'Essential (primary) hypertension' },
      { id: 'angela-diaz-depression', system: 'ICD-10', code: 'F33.1', display: 'Major depressive disorder, recurrent, moderate' },
    ],
    riskScore: 58,
    tasks: [{ id: 'angela-diaz-task-bp', description: 'Blood pressure recheck in 2 weeks', priority: 'medium', dueInDays: 14 }],
  },
  {
    id: 'samuel-wright',
    name: { given: ['Samuel'], family: 'Wright' },
    gender: 'male',
    birthDate: '1955-01-30',
    conditions: [{ id: 'samuel-wright-chf', system: 'ICD-10', code: 'I50.9', display: 'Heart failure, unspecified' }],
    riskScore: 79,
    tasks: [
      { id: 'samuel-wright-task-weight', description: 'Daily weight monitoring check-in', priority: 'high', dueInDays: 0 },
      { id: 'samuel-wright-task-diet', description: 'Sodium-restricted diet education', priority: 'medium', dueInDays: 5 },
    ],
  },
];

export const ALL_PATIENTS: SeedPatient[] = [MARIA_CHEN, ...PANEL_PATIENTS];

export const COORDINATOR_PANEL_GROUP_ID = 'coordinator-demo-panel';
export const IMPORT_TIMESTAMP = now;
