import type { Patient } from '../types';

/**
 * Demo insurance for `Population.tsx` — extracted from
 * `hl7-competition-caresyncai/apps/web/src/pages/director/PopulationDashboard.tsx`
 * during the S12 + UI-betterment Phase 2 port.
 *
 * The lead project renders entirely against this hardcoded list (their FHIR
 * client is a 21-line stub). My project renders against real
 * `getPopulationScatter()` + `getPopulationSummary()` data, but if BOTH
 * APIs reject (HAPI down + DB unreachable), `Population.tsx` falls through to
 * this 8-patient list so the demo always shows something.
 *
 * Mock-only fields the lead carried that my real data path can't back (and
 * therefore never renders in real mode): `dob`, `sex`, `mrn`, `conditions[]`,
 * `daysSinceContact`, `assignedTo`. The real-data list view exposes only
 * what `ScatterPoint` carries: `id`, `riskScore`, `urgency`. Falling back to
 * this list restores the richer row shape (risk badge + name + conditions +
 * days chip) for offline demos.
 */

export const MOCK_PATIENTS: Patient[] = [
  {
    id: 'maria-chen-4829',
    mrn: '4829-FHIR',
    name: 'Maria Chen',
    age: 68,
    sex: 'F',
    dob: '1957-03-14',
    conditions: ['CHF', 'T2DM', 'Depression'],
    riskScore: 87,
    riskLevel: 'critical',
    daysSinceContact: 2,
    assignedTo: 'coordinator@caresync.demo',
  },
  {
    id: 'p2',
    mrn: '2341-FHIR',
    name: 'Robert Torres',
    age: 72,
    sex: 'M',
    dob: '1953-06-22',
    conditions: ['COPD', 'Hypertension'],
    riskScore: 76,
    riskLevel: 'critical',
    daysSinceContact: 5,
  },
  {
    id: 'p3',
    mrn: '5567-FHIR',
    name: 'Dorothy Williams',
    age: 65,
    sex: 'F',
    dob: '1960-11-08',
    conditions: ['T2DM', 'CKD'],
    riskScore: 68,
    riskLevel: 'high',
    daysSinceContact: 12,
  },
  {
    id: 'p4',
    mrn: '8823-FHIR',
    name: 'James Anderson',
    age: 78,
    sex: 'M',
    dob: '1947-04-15',
    conditions: ['CHF', 'A-Fib'],
    riskScore: 71,
    riskLevel: 'high',
    daysSinceContact: 8,
  },
  {
    id: 'p5',
    mrn: '3391-FHIR',
    name: 'Linda Martinez',
    age: 61,
    sex: 'F',
    dob: '1964-09-30',
    conditions: ['Hypertension', 'Anxiety'],
    riskScore: 42,
    riskLevel: 'medium',
    daysSinceContact: 21,
  },
  {
    id: 'p6',
    mrn: '7721-FHIR',
    name: 'Charles Brown',
    age: 55,
    sex: 'M',
    dob: '1970-02-14',
    conditions: ['Depression', 'T2DM'],
    riskScore: 38,
    riskLevel: 'low',
    daysSinceContact: 35,
  },
  {
    id: 'p7',
    mrn: '4492-FHIR',
    name: 'Patricia Davis',
    age: 70,
    sex: 'F',
    dob: '1955-07-19',
    conditions: ['CHF', 'CKD', 'Anemia'],
    riskScore: 82,
    riskLevel: 'critical',
    daysSinceContact: 1,
  },
  {
    id: 'p8',
    mrn: '6634-FHIR',
    name: 'Michael Johnson',
    age: 63,
    sex: 'M',
    dob: '1962-12-03',
    conditions: ['COPD', 'Depression'],
    riskScore: 55,
    riskLevel: 'high',
    daysSinceContact: 18,
  },
];

/** Risk threshold used both by the canvas chart's dashed "Critical" line and
 *  the left-rail "Critical" filter tab. Mirrors `apps/api/src/population/service.ts`'s
 *  `CRITICAL_RISK_THRESHOLD`. */
export const CRITICAL_RISK_THRESHOLD = 75;

/** Threshold below the critical line used for the "High Risk" filter tab. */
export const HIGH_RISK_THRESHOLD = 60;