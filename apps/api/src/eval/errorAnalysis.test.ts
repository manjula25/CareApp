import { computeErrorAnalysis } from './errorAnalysis';
import { LabelRow, PatientFindings } from './computeMetrics';

// Hand-built fixture (S9 B1 — TDD), deliberately separate from
// computeMetrics.test.ts's fixture: this pins the *specific patient-level*
// extraction (which patient, expected vs. predicted, and the data-gap case)
// that computeMetrics' aggregated confusion matrix intentionally discards.
//
// p1: careGap expected true, agent predicts false -> careGap false negative (miss).
// p2: careGap expected false, agent predicts true -> careGap false positive.
// p3: risk expected true, agent predicts 'moderate' (not high/critical) -> risk false negative.
// p4: risk expected false, agent predicts 'critical' -> risk false positive.
// p5: sdoh expected true, agent predicts no barrier -> sdoh disagreement.
// p6: agrees everywhere on every dimension -> contributes nothing to any list.
// p7: has a label row but NO findings entry at all -> reported once as a data gap,
//     excluded from every other list (mirrors computeMetrics' "no run, no comparison" rule).
const labels: LabelRow[] = [
  {
    patientId: 'p1',
    source: 'dev',
    clinicianOverride: null,
    careGap: { expectedHasGap: true, notes: 'p1 careGap notes' },
    risk: { expectedHighRisk: null, notes: 'p1 risk unlabeled' },
    sdoh: { expectedHasBarrier: null, notes: 'p1 sdoh unlabeled' },
  },
  {
    patientId: 'p2',
    source: 'dev',
    clinicianOverride: null,
    careGap: { expectedHasGap: false, notes: 'p2 careGap notes' },
    risk: { expectedHighRisk: null, notes: 'p2 risk unlabeled' },
    sdoh: { expectedHasBarrier: null, notes: 'p2 sdoh unlabeled' },
  },
  {
    patientId: 'p3',
    source: 'dev',
    clinicianOverride: null,
    careGap: { expectedHasGap: null, notes: 'p3 careGap unlabeled' },
    risk: { expectedHighRisk: true, notes: 'p3 risk notes' },
    sdoh: { expectedHasBarrier: null, notes: 'p3 sdoh unlabeled' },
  },
  {
    patientId: 'p4',
    source: 'dev',
    clinicianOverride: null,
    careGap: { expectedHasGap: null, notes: 'p4 careGap unlabeled' },
    risk: { expectedHighRisk: false, notes: 'p4 risk notes' },
    sdoh: { expectedHasBarrier: null, notes: 'p4 sdoh unlabeled' },
  },
  {
    patientId: 'p5',
    source: 'dev',
    clinicianOverride: null,
    careGap: { expectedHasGap: null, notes: 'p5 careGap unlabeled' },
    risk: { expectedHighRisk: null, notes: 'p5 risk unlabeled' },
    sdoh: { expectedHasBarrier: true, notes: 'p5 sdoh notes' },
  },
  {
    patientId: 'p6',
    source: 'dev',
    clinicianOverride: null,
    careGap: { expectedHasGap: true, notes: 'p6 careGap notes' },
    risk: { expectedHighRisk: true, notes: 'p6 risk notes' },
    sdoh: { expectedHasBarrier: false, notes: 'p6 sdoh notes' },
  },
  {
    patientId: 'p7',
    source: 'dev',
    clinicianOverride: null,
    careGap: { expectedHasGap: true, notes: 'p7 careGap notes' },
    risk: { expectedHighRisk: true, notes: 'p7 risk notes' },
    sdoh: { expectedHasBarrier: true, notes: 'p7 sdoh notes' },
  },
];

const findings: PatientFindings[] = [
  {
    patientId: 'p1',
    careGap: { findings: [] },
    risk: { findings: [], complete: { riskLevel: 'low' } },
    sdoh: { findings: [] },
  },
  {
    patientId: 'p2',
    careGap: { findings: [{ gapType: 'HbA1c monitoring', description: 'x', urgency: 'high', fhirResourceId: 'Condition/2' }] },
    risk: { findings: [], complete: { riskLevel: 'low' } },
    sdoh: { findings: [] },
  },
  {
    patientId: 'p3',
    careGap: { findings: [] },
    risk: { findings: [], complete: { riskLevel: 'moderate' } },
    sdoh: { findings: [] },
  },
  {
    patientId: 'p4',
    careGap: { findings: [] },
    risk: { findings: [], complete: { riskLevel: 'critical' } },
    sdoh: { findings: [] },
  },
  {
    patientId: 'p5',
    careGap: { findings: [] },
    risk: { findings: [], complete: { riskLevel: 'low' } },
    sdoh: { findings: [] },
  },
  {
    patientId: 'p6',
    careGap: { findings: [{ gapType: 'BNP monitoring', description: 'x', urgency: 'high', fhirResourceId: 'Condition/6' }] },
    risk: { findings: [], complete: { riskLevel: 'high' } },
    sdoh: { findings: [] },
  },
  // p7 intentionally absent — the harness produced no findings for it this cycle.
];

describe('computeErrorAnalysis (S9 B1 — pure extraction, TDD)', () => {
  it('extracts the specific care-gap false negative (p1) and false positive (p2)', () => {
    const result = computeErrorAnalysis(labels, findings);
    expect(result.careGap.falseNegatives).toEqual([
      { patientId: 'p1', expected: true, predicted: false, labelNotes: 'p1 careGap notes' },
    ]);
    expect(result.careGap.falsePositives).toEqual([
      { patientId: 'p2', expected: false, predicted: true, labelNotes: 'p2 careGap notes' },
    ]);
  });

  it('extracts the specific risk false negative (p3) and false positive (p4)', () => {
    const result = computeErrorAnalysis(labels, findings);
    expect(result.risk.falseNegatives).toEqual([
      { patientId: 'p3', expected: true, predictedRiskLevel: 'moderate', labelNotes: 'p3 risk notes' },
    ]);
    expect(result.risk.falsePositives).toEqual([
      { patientId: 'p4', expected: false, predictedRiskLevel: 'critical', labelNotes: 'p4 risk notes' },
    ]);
  });

  it('extracts the specific sdoh disagreement (p5)', () => {
    const result = computeErrorAnalysis(labels, findings);
    expect(result.sdoh.disagreements).toEqual([
      { patientId: 'p5', expected: true, predicted: false, labelNotes: 'p5 sdoh notes' },
    ]);
  });

  it('reports p7 once as a data gap and excludes it from every other list', () => {
    const result = computeErrorAnalysis(labels, findings);
    expect(result.dataGaps).toEqual([
      { patientId: 'p7', reason: expect.any(String) },
    ]);
    const mentionsP7 = [
      ...result.careGap.falseNegatives,
      ...result.careGap.falsePositives,
      ...result.risk.falseNegatives,
      ...result.risk.falsePositives,
      ...result.sdoh.disagreements,
    ].some((entry) => entry.patientId === 'p7');
    expect(mentionsP7).toBe(false);
  });

  it('contributes nothing to any list for a patient that agrees on every labeled dimension (p6)', () => {
    const result = computeErrorAnalysis(labels, findings);
    const mentionsP6 = [
      ...result.careGap.falseNegatives,
      ...result.careGap.falsePositives,
      ...result.risk.falseNegatives,
      ...result.risk.falsePositives,
      ...result.sdoh.disagreements,
      ...result.dataGaps,
    ].some((entry) => entry.patientId === 'p6');
    expect(mentionsP6).toBe(false);
  });
});
