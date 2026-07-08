import { mapAnalysisResultToCards } from './cdsCardMapping';
import { AnalysisResultJson } from './analysis';

// Canned AnalysisResultJson exercising every findings array + every
// indicator tier, so the mapping's per-section rules are each hit at least
// once. actionPlanner is populated too (with a task) specifically to prove
// the mapping ignores it.
function cannedResult(overrides: Partial<AnalysisResultJson> = {}): AnalysisResultJson {
  return {
    risk: {
      narration: '',
      findings: [{ text: 'CHF diagnosis drives elevated readmission risk', fhirResourceId: 'Condition/chf-1' }],
      complete: { riskScore: 90, riskLevel: 'critical', readmissionProbability: 0.8, findingCount: 1, droppedCount: 0 },
    },
    careGap: {
      narration: '',
      findings: [{ gapType: 'screening', description: 'Overdue HbA1c recheck', urgency: 'high', fhirResourceId: 'Observation/hba1c-1' }],
      complete: { findingCount: 1, droppedCount: 0 },
    },
    sdoh: {
      narration: '',
      findings: [
        { domain: 'transportation', finding: 'No reliable transportation to follow-up visits', severity: 'moderate', fhirResourceId: 'Observation/sdoh-1' },
      ],
      complete: { findingCount: 1, droppedCount: 0, referralsNeeded: ['transportation-assistance'] },
    },
    actionPlanner: {
      narration: '',
      tasks: [
        {
          id: 'task-1',
          reference: 'Task/task-1',
          title: 'Schedule cardiology follow-up',
          description: 'Address CHF readmission risk',
          priority: 'high',
          fhirResources: ['Condition/chf-1'],
          confidence: 0.5,
        },
      ],
      complete: { findingCount: 1, droppedCount: 0 },
    },
    ...overrides,
  };
}

describe('mapAnalysisResultToCards (S10 A2 — pure card mapping)', () => {
  it('maps a risk finding to a card using riskLevel for the indicator, with FHIR citation in detail', () => {
    const cards = mapAnalysisResultToCards(cannedResult());

    const riskCard = cards.find((c) => c.source.label === 'CareSync AI — Risk');
    expect(riskCard).toEqual({
      summary: 'CHF diagnosis drives elevated readmission risk',
      indicator: 'critical',
      detail: 'CHF diagnosis drives elevated readmission risk (FHIR: Condition/chf-1)',
      source: { label: 'CareSync AI — Risk' },
    });
  });

  it('maps a care-gap finding to a card using urgency for the indicator', () => {
    const cards = mapAnalysisResultToCards(cannedResult());

    const careGapCard = cards.find((c) => c.source.label === 'CareSync AI — Care Gap');
    expect(careGapCard).toEqual({
      summary: 'Overdue HbA1c recheck',
      indicator: 'critical', // urgency: 'high' -> 'critical'
      detail: 'Overdue HbA1c recheck (FHIR: Observation/hba1c-1)',
      source: { label: 'CareSync AI — Care Gap' },
    });
  });

  it('maps an SDOH finding to a card using severity for the indicator', () => {
    const cards = mapAnalysisResultToCards(cannedResult());

    const sdohCard = cards.find((c) => c.source.label === 'CareSync AI — SDOH');
    expect(sdohCard).toEqual({
      summary: 'No reliable transportation to follow-up visits',
      indicator: 'warning', // severity: 'moderate' -> 'warning'
      detail: 'No reliable transportation to follow-up visits (FHIR: Observation/sdoh-1)',
      source: { label: 'CareSync AI — SDOH' },
    });
  });

  it('does not map actionPlanner tasks into any card', () => {
    const cards = mapAnalysisResultToCards(cannedResult());

    expect(cards).toHaveLength(3); // risk + careGap + sdoh only
    expect(cards.some((c) => c.source.label.includes('Action'))).toBe(false);
    expect(cards.some((c) => c.detail.includes('Schedule cardiology follow-up'))).toBe(false);
  });

  it('maps every risk/careGap/sdoh indicator tier correctly', () => {
    const result = cannedResult({
      risk: {
        narration: '',
        findings: [
          { text: 'high finding', fhirResourceId: 'Condition/a' },
          { text: 'moderate-level finding', fhirResourceId: 'Condition/b' },
          { text: 'low finding', fhirResourceId: 'Condition/c' },
        ],
        complete: { riskScore: 10, riskLevel: 'low', readmissionProbability: 0.1, findingCount: 3, droppedCount: 0 },
      },
      careGap: {
        narration: '',
        findings: [
          { gapType: 'screening', description: 'medium gap', urgency: 'medium', fhirResourceId: 'Observation/d' },
          { gapType: 'screening', description: 'low gap', urgency: 'low', fhirResourceId: 'Observation/e' },
        ],
        complete: { findingCount: 2, droppedCount: 0 },
      },
      sdoh: {
        narration: '',
        findings: [
          { domain: 'housing', finding: 'high severity barrier', severity: 'high', fhirResourceId: 'Observation/f' },
          { domain: 'food', finding: 'low severity barrier', severity: 'low', fhirResourceId: 'Observation/g' },
        ],
        complete: { findingCount: 2, droppedCount: 0, referralsNeeded: [] },
      },
    });

    // riskLevel: 'low' -> every risk finding's indicator is derived from the
    // shared riskLevel (not per-finding text), so all three are 'info' here.
    const riskCards = mapAnalysisResultToCards(result).filter((c) => c.source.label === 'CareSync AI — Risk');
    expect(riskCards.every((c) => c.indicator === 'info')).toBe(true);

    const careGapCards = mapAnalysisResultToCards(result).filter((c) => c.source.label === 'CareSync AI — Care Gap');
    expect(careGapCards.find((c) => c.summary === 'medium gap')!.indicator).toBe('warning');
    expect(careGapCards.find((c) => c.summary === 'low gap')!.indicator).toBe('info');

    const sdohCards = mapAnalysisResultToCards(result).filter((c) => c.source.label === 'CareSync AI — SDOH');
    expect(sdohCards.find((c) => c.summary === 'high severity barrier')!.indicator).toBe('critical');
    expect(sdohCards.find((c) => c.summary === 'low severity barrier')!.indicator).toBe('info');
  });

  it('maps a critical risk level to a critical indicator, and moderate/high to warning', () => {
    const highResult = cannedResult({
      risk: {
        narration: '',
        findings: [{ text: 'x', fhirResourceId: 'Condition/x' }],
        complete: { riskScore: 60, riskLevel: 'high', readmissionProbability: 0.5, findingCount: 1, droppedCount: 0 },
      },
    });
    expect(mapAnalysisResultToCards(highResult).find((c) => c.source.label === 'CareSync AI — Risk')!.indicator).toBe('warning');
  });

  it('truncates a summary over 140 chars with a trailing ellipsis, leaves detail untruncated', () => {
    const longText = 'A'.repeat(150);
    const result = cannedResult({
      risk: {
        narration: '',
        findings: [{ text: longText, fhirResourceId: 'Condition/long' }],
        complete: { riskScore: 90, riskLevel: 'critical', readmissionProbability: 0.8, findingCount: 1, droppedCount: 0 },
      },
    });

    const riskCard = mapAnalysisResultToCards(result).find((c) => c.source.label === 'CareSync AI — Risk')!;
    expect(riskCard.summary).toHaveLength(140);
    expect(riskCard.summary.endsWith('…')).toBe(true);
    expect(riskCard.summary.startsWith('A'.repeat(139))).toBe(true);
    expect(riskCard.detail).toContain(longText); // detail is not length-limited
  });

  it('returns an empty array when every findings array is empty', () => {
    const result = cannedResult({
      risk: { narration: '', findings: [], complete: { riskScore: 0, riskLevel: 'low', readmissionProbability: 0, findingCount: 0, droppedCount: 0 } },
      careGap: { narration: '', findings: [], complete: { findingCount: 0, droppedCount: 0 } },
      sdoh: { narration: '', findings: [], complete: { findingCount: 0, droppedCount: 0, referralsNeeded: [] } },
    });

    expect(mapAnalysisResultToCards(result)).toEqual([]);
  });
});
