import { AnalysisResultJson } from './analysis';

export interface CdsCard {
  summary: string;
  indicator: 'info' | 'warning' | 'critical';
  detail: string;
  source: { label: string };
}

// CDS Hooks spec recommends `summary` stay short enough for a one-line EHR
// banner (~140 chars); findings/descriptions are free text an agent wrote
// with no length budget, so this is the one shaping step card mapping does.
const SUMMARY_MAX_LENGTH = 140;

function truncateSummary(text: string): string {
  if (text.length <= SUMMARY_MAX_LENGTH) return text;
  return `${text.slice(0, SUMMARY_MAX_LENGTH - 1)}…`;
}

function riskIndicator(riskLevel: string): CdsCard['indicator'] {
  if (riskLevel === 'critical') return 'critical';
  if (riskLevel === 'high' || riskLevel === 'moderate') return 'warning';
  return 'info'; // 'low'
}

function careGapIndicator(urgency: string): CdsCard['indicator'] {
  if (urgency === 'high') return 'critical';
  if (urgency === 'medium') return 'warning';
  return 'info'; // 'low'
}

function sdohIndicator(severity: string): CdsCard['indicator'] {
  if (severity === 'high') return 'critical';
  if (severity === 'moderate') return 'warning';
  return 'info'; // 'low'
}

/**
 * S10 A2 — pure mapping from a cached (already citation-validated, GD11)
 * `AnalysisResultJson` to CDS Hooks cards. No I/O: the route layer owns
 * reading the cache; this only shapes what it found. Deliberately does NOT
 * map `result.actionPlanner` — Tasks are actions, not clinical findings, and
 * are out of scope for a patient-view card feed (S10 plan-review note).
 */
export function mapAnalysisResultToCards(result: AnalysisResultJson): CdsCard[] {
  const riskCards: CdsCard[] = result.risk.findings.map((finding) => ({
    summary: truncateSummary(finding.text),
    indicator: riskIndicator(result.risk.complete.riskLevel),
    detail: `${finding.text} (FHIR: ${finding.fhirResourceId})`,
    source: { label: 'CareSync AI — Risk' },
  }));

  const careGapCards: CdsCard[] = result.careGap.findings.map((finding) => ({
    summary: truncateSummary(finding.description),
    indicator: careGapIndicator(finding.urgency),
    detail: `${finding.description} (FHIR: ${finding.fhirResourceId})`,
    source: { label: 'CareSync AI — Care Gap' },
  }));

  const sdohCards: CdsCard[] = result.sdoh.findings.map((finding) => ({
    summary: truncateSummary(finding.finding),
    indicator: sdohIndicator(finding.severity),
    detail: `${finding.finding} (FHIR: ${finding.fhirResourceId})`,
    source: { label: 'CareSync AI — SDOH' },
  }));

  return [...riskCards, ...careGapCards, ...sdohCards];
}
