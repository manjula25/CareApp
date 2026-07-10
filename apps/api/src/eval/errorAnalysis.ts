import { LabelRow, PatientFindings, HIGH_RISK_LEVELS } from './computeMetrics';

/**
 * S9 B1 — pure extraction of the specific misses (false negatives) and false
 * positives that computeMetrics' aggregated confusion matrix (Seam 4)
 * intentionally collapses into a count. This is the data the eval report's
 * mandatory error-analysis section needs (GD8, the P6 4->5 lever): which
 * patient, what was expected, what the agent actually produced. Pure, no I/O
 * — takes the same `LabelRow[]` / `PatientFindings[]` shapes as computeMetrics
 * so both are driven off one shared harness pass over the same data.
 *
 * Domain rule: only a non-null label paired with a findings entry for that
 * dimension can produce a hit/miss/false-positive — same exclusion rule
 * computeMetrics documents (a `null` label is an honest "no ground truth"
 * skip, not a fabricated guess). A patient whose label row has no findings
 * entry AT ALL (the harness didn't run over them this cycle — e.g. a HAPI
 * read failure) is reported exactly ONCE as a data gap, not silently dropped
 * and not double-counted per dimension — "no run, no comparison," but the
 * report must still say why that patient contributed nothing.
 */

export interface CareGapErrorEntry {
  patientId: string;
  expected: boolean;
  predicted: boolean;
  labelNotes: string;
}

export interface RiskErrorEntry {
  patientId: string;
  expected: boolean;
  predictedRiskLevel: string;
  labelNotes: string;
}

export interface SdohDisagreementEntry {
  patientId: string;
  expected: boolean;
  predicted: boolean;
  labelNotes: string;
}

export interface DataGapEntry {
  patientId: string;
  reason: string;
}

// S19 Thread D — extracted from `RiskOutput._safetyNetApplied` (when the
// clamp downgraded an LLM-emitted 'high'/'critical' to 'moderate'). The
// eval-report's `## Safety-net activity` section renders one row per
// entry so a reviewer can audit how often the clamp intervened and on
// what bundle evidence.
export interface SafetyNetEntry {
  patientId: string;
  kind: 'risk-level-clamped';
  from: 'high' | 'critical';
  to: 'moderate';
  deterministicScore: number;
  conditionCount: number;
  recencyHours: number;
}

export interface ErrorAnalysis {
  careGap: { falseNegatives: CareGapErrorEntry[]; falsePositives: CareGapErrorEntry[] };
  risk: { falseNegatives: RiskErrorEntry[]; falsePositives: RiskErrorEntry[] };
  sdoh: { disagreements: SdohDisagreementEntry[] };
  dataGaps: DataGapEntry[];
  safetyNetActivity: SafetyNetEntry[];
}

/**
 * S9 B1 (Seam-style pure helper, TDD). See module doc comment for the full
 * contract.
 */
export function computeErrorAnalysis(labels: LabelRow[], findings: PatientFindings[]): ErrorAnalysis {
  const findingsByPatientId = new Map(findings.map((f) => [f.patientId, f]));

  const careGapFalseNegatives: CareGapErrorEntry[] = [];
  const careGapFalsePositives: CareGapErrorEntry[] = [];
  const riskFalseNegatives: RiskErrorEntry[] = [];
  const riskFalsePositives: RiskErrorEntry[] = [];
  const sdohDisagreements: SdohDisagreementEntry[] = [];
  const dataGaps: DataGapEntry[] = [];
  const safetyNetActivity: SafetyNetEntry[] = [];

  for (const label of labels) {
    const patientFindings = findingsByPatientId.get(label.patientId);
    if (!patientFindings) {
      dataGaps.push({
        patientId: label.patientId,
        reason:
          'No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped.',
      });
      continue;
    }

    // S19 Thread D — read `risk.complete.safetyNetApplied` if present.
    // The shape is `{kind, from, to, deterministicScore, conditionCount,
    // recencyHours}` per `SafetyNetApplication` (apps/api/src/agents/agent.ts).
    // The field is omitted when the clamp was a no-op; reading defensively
    // here keeps the extractor robust to that absence.
    const riskComplete = patientFindings.risk?.complete as
      | { safetyNetApplied?: { kind: string; from: 'high' | 'critical'; to: 'moderate'; deterministicScore: number; conditionCount: number; recencyHours: number } }
      | undefined;
    const safetyNet = riskComplete?.safetyNetApplied;
    if (safetyNet && safetyNet.kind === 'risk-level-clamped') {
      safetyNetActivity.push({
        patientId: label.patientId,
        kind: 'risk-level-clamped',
        from: safetyNet.from,
        to: safetyNet.to,
        deterministicScore: safetyNet.deterministicScore,
        conditionCount: safetyNet.conditionCount,
        recencyHours: safetyNet.recencyHours,
      });
    }

    if (label.careGap.expectedHasGap !== null && patientFindings.careGap) {
      const expected = label.careGap.expectedHasGap;
      const predicted = patientFindings.careGap.findings.length > 0;
      if (expected && !predicted) {
        careGapFalseNegatives.push({ patientId: label.patientId, expected, predicted, labelNotes: label.careGap.notes });
      } else if (!expected && predicted) {
        careGapFalsePositives.push({ patientId: label.patientId, expected, predicted, labelNotes: label.careGap.notes });
      }
    }

    if (label.risk.expectedHighRisk !== null && patientFindings.risk) {
      const expected = label.risk.expectedHighRisk;
      const predictedRiskLevel = patientFindings.risk.complete.riskLevel;
      const predictedHigh = HIGH_RISK_LEVELS.has(predictedRiskLevel);
      if (expected && !predictedHigh) {
        riskFalseNegatives.push({ patientId: label.patientId, expected, predictedRiskLevel, labelNotes: label.risk.notes });
      } else if (!expected && predictedHigh) {
        riskFalsePositives.push({ patientId: label.patientId, expected, predictedRiskLevel, labelNotes: label.risk.notes });
      }
    }

    if (label.sdoh.expectedHasBarrier !== null && patientFindings.sdoh) {
      const expected = label.sdoh.expectedHasBarrier;
      const predicted = patientFindings.sdoh.findings.length > 0;
      if (predicted !== expected) {
        sdohDisagreements.push({ patientId: label.patientId, expected, predicted, labelNotes: label.sdoh.notes });
      }
    }
  }

  return {
    careGap: { falseNegatives: careGapFalseNegatives, falsePositives: careGapFalsePositives },
    risk: { falseNegatives: riskFalseNegatives, falsePositives: riskFalsePositives },
    sdoh: { disagreements: sdohDisagreements },
    dataGaps,
    safetyNetActivity,
  };
}
