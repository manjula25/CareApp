// S12 B.2 — demo-fallback constants. Used as TanStack Query `placeholderData`
// AND as the fallback value when the API errors out, so the UI never blanks
// out during a judge walkthrough if HAPI or the API is down. Shapes match the
// real API responses exactly (see `apps/web/src/api/client.ts`) so consumers
// can't tell the difference except via the `DemoFallbackBadge` indicator.
//
// HONEST-STAGING NOTE: these constants are SHOWN, never persisted. The eval
// harness reads `FhirReadService.getPatientBundle` (live HAPI) — these
// fallbacks cannot leak into `docs/eval-report.json`.

import type {
  AuditTrailEntry,
  AuditTrailResult,
  CommunityResource,
  ConfidenceBucket,
  ModelPerformanceResult,
  ParityResult,
  PopulationSummary,
  QualityMeasureResult,
  ScatterPoint,
  TaskListEntry,
  TeamPerformanceResult,
} from '../api/client';

// --- Population dashboard (W02) --------------------------------------------

export const MOCK_POPULATION_SUMMARY: PopulationSummary = {
  criticalZoneCount: 23,
  projectedCostAvoidance: 247_400,
  teamKpis: { criticalZonePatients: 23, totalPatients: 500 },
};

// Deterministic scatter (no `Math.random()`): the fallback must look identical
// across page reloads and test runs, otherwise a snapshot taken during a real
// failure would differ from one taken five minutes later — undermining the
// "honest staging" guarantee. The simple LCG below produces the same 50 points
// every time the module is imported.
const MOCK_FALLBACK_SCATTER: ScatterPoint[] = Array.from({ length: 50 }, (_, i) => {
  // Park-Miller LCG, seeded with i+1 so each row gets a distinct but stable
  // pseudo-random value in [0, 1). Multiplier 16807, modulus 2^31-1 (2147483647).
  const seed = i + 1;
  const lcg = (seed * 16807) % 2147483647;
  const lcg2 = (lcg * 16807) % 2147483647;
  const riskScore = 40 + Math.floor((lcg / 2147483647) * 60);
  const urgency = 20 + Math.floor((lcg2 / 2147483647) * 70);
  return {
    id: `demo-${i + 1}`,
    riskScore,
    urgency,
    x: riskScore,
    y: urgency,
  };
});

export const MOCK_POPULATION_SCATTER: ScatterPoint[] = MOCK_FALLBACK_SCATTER;

// --- Tasks (M02) -----------------------------------------------------------

export const MOCK_TASKS: TaskListEntry[] = [
  { id: 'demo-t1', patientId: 'demo-p1', patientName: 'Maria Chen', title: '48h post-discharge follow-up call', priority: 'critical', due: '2026-07-08', status: 'requested', conditionTag: 'CHF' },
  { id: 'demo-t2', patientId: 'demo-p2', patientName: 'Robert Torres', title: 'Transportation referral', priority: 'high', due: '2026-07-10', status: 'requested', conditionTag: 'COPD' },
  { id: 'demo-t3', patientId: 'demo-p3', patientName: 'Dorothy Williams', title: 'Diabetic eye exam referral', priority: 'high', due: '2026-07-12', status: 'in-progress', conditionTag: 'T2DM' },
  { id: 'demo-t4', patientId: 'demo-p4', patientName: 'James Anderson', title: 'Medication reconciliation review', priority: 'medium', due: '2026-07-15', status: 'requested' },
];

// --- Governance audit trail (W06) ------------------------------------------

const MOCK_AUDIT_ENTRIES: AuditTrailEntry[] = [
  { ts: '2026-07-07T14:25:00Z', actor: 'demo-director', action: 'read', resource: 'Patient/maria-chen', outcome: 'success' },
  { ts: '2026-07-07T14:24:00Z', actor: 'demo-coordinator', action: 'create', resource: 'Task/maria-chen-task-1', outcome: 'success' },
  { ts: '2026-07-07T14:23:00Z', actor: 'demo-social-worker', action: 'create', resource: 'ServiceRequest/maria-chen-sr-1', outcome: 'success' },
  { ts: '2026-07-07T14:22:00Z', actor: 'demo-coordinator', action: 'read', resource: 'QuestionnaireResponse/qr-sdoh-6601', outcome: 'denied' },
];

export const MOCK_AUDIT_TRAIL: AuditTrailResult = {
  entries: MOCK_AUDIT_ENTRIES,
  total: MOCK_AUDIT_ENTRIES.length,
  limit: 50,
  offset: 0,
};

const MOCK_CONFIDENCE_BANDS: ConfidenceBucket[] = [
  { range: '0-20%', count: 0 },
  { range: '20-40%', count: 0 },
  { range: '40-60%', count: 0 },
  { range: '60-80%', count: 0 },
  { range: '80-100%', count: 0 },
];

export const MOCK_MODEL_PERFORMANCE: ModelPerformanceResult = {
  analyses: [],
  confidenceDistribution: MOCK_CONFIDENCE_BANDS,
};

export const MOCK_PARITY: ParityResult = {
  byAgeBand: [],
  bySex: [],
  byRace: [],
  byEthnicity: [],
};

// --- Quality / HEDIS (W05) -------------------------------------------------

export const MOCK_QUALITY: QualityMeasureResult = {
  measureId: 'diabetes-hba1c-testing',
  measureName: 'Comprehensive Diabetes Care: HbA1c Testing',
  numerator: 1,
  denominator: 287,
  rate: 0.35,
  gapPatients: 286,
  illustrativeIncentiveDollars: 1_430_000,
};

// --- Team performance (W04) ------------------------------------------------

export const MOCK_TEAM: TeamPerformanceResult = {
  coordinators: [
    { coordinatorId: 'demo-c1', name: 'Cara Coordinator', assignedCount: 7, completedCount: 2, completionRate: 0.286 },
  ],
  unassignedCount: 7,
  totalTasks: 7,
  overallCompletionRate: 0.286,
};

// --- SDOH resources (M05) --------------------------------------------------

export const MOCK_SDOH_RESOURCES: CommunityResource[] = [
  {
    id: 'demo-r1',
    name: 'Springfield Rides',
    category: 'transportation',
    description: 'Medical transport to appointments (demo data)',
    coverage: 'Free for Medicaid',
    phone: '555-0100',
  },
  {
    id: 'demo-r2',
    name: 'Meals on Wheels Springfield',
    category: 'food',
    description: 'Home-delivered meals for homebound adults (demo data)',
    coverage: 'Adults 60+ or disabled',
    phone: '555-0200',
  },
  {
    id: 'demo-r3',
    name: 'Baystate Behavioral Health',
    category: 'mental_health',
    description: 'Outpatient mental health services (demo data)',
    coverage: 'All ages, sliding scale',
    phone: '555-0300',
  },
];