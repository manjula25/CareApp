/**
 * Seam 4 — S9 A2 (GD8). Pure evaluation-metric computation: no FHIR/HAPI/LLM
 * I/O. Takes the committed ground-truth label rows (`data/eval/labels.json`,
 * shape `LabelRow[]`) and the per-patient, already-VALIDATED agent findings
 * (the same post-`validateCitations` shape the product surfaces to
 * clinicians — see `routes/analysis.ts`'s `AnalysisResultJson`, not the raw
 * orchestrator output; comparing against unvalidated findings would score the
 * agents against citations the product never actually shows anyone) and
 * computes sensitivity/specificity/PPV for Care Gap + Risk, an agreement rate
 * for SDOH, and a qualitative pass-through for Action Planner.
 *
 * Domain rule: a label dimension of `null` means "no confident ground truth"
 * (S9 A1 — an honest skip, not a fabricated guess) and that patient is
 * excluded from that dimension's confusion matrix / agreement tally, but can
 * still contribute to the other dimensions. A patient with no findings entry
 * at all (the harness didn't run over them this cycle) is excluded from
 * every dimension the same way, for the same reason — no run, no comparison.
 */

// --- label side (data/eval/labels.json row shape) ------------------------

export interface CareGapLabel {
  /** null = no confident ground truth for this patient (S9 A1 — honest skip). */
  expectedHasGap: boolean | null;
  notes: string;
}

export interface RiskLabel {
  expectedHighRisk: boolean | null;
  /** The seed/generator's own deterministic riskScore (0-100) this label was derived from, where applicable. */
  seedRiskScore?: number;
  notes: string;
}

export interface SdohLabel {
  expectedHasBarrier: boolean | null;
  expectedDomains?: string[];
  notes: string;
}

export interface LabelRow {
  patientId: string;
  /** GD8: "dev" until a clinician reviews/overrides a row. */
  source: 'dev' | 'clinician';
  /** GD8 override slot — reserved for a future clinician-supplied correction; not read by computeMetrics today. */
  clinicianOverride?: unknown;
  careGap: CareGapLabel;
  risk: RiskLabel;
  sdoh: SdohLabel;
  actionPlanner?: { notes?: string };
}

// --- findings side (post-validateCitations shapes, matching AnalysisResultJson) ---

export interface CareGapFinding {
  gapType: string;
  description: string;
  lastDone?: string;
  dueDate?: string;
  urgency: string;
  fhirResourceId: string;
}

export interface SdohFinding {
  domain: string;
  finding: string;
  severity: string;
  fhirResourceId: string;
}

export interface ActionPlannerTask {
  id: string;
  title: string;
  description: string;
  priority: string;
  fhirResources: string[];
}

export interface PatientFindings {
  patientId: string;
  /** Absent = the Care Gap agent didn't run (or produce a result) for this patient this cycle. */
  careGap?: { findings: CareGapFinding[] };
  /** Absent = the Risk agent didn't run for this patient this cycle. */
  risk?: { findings: unknown[]; complete: { riskLevel: string } };
  /** Absent = the SDOH agent didn't run for this patient this cycle. */
  sdoh?: { findings: SdohFinding[] };
  /** Absent = the Action Planner didn't run (or created no tasks) for this patient this cycle. */
  actionPlanner?: { tasks: ActionPlannerTask[] };
}

// --- metric shapes ---------------------------------------------------------

export interface ConfusionMatrix {
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
}

export interface ClassificationMetrics {
  /** null (not NaN/0) when the metric's denominator is zero — an honest "not computable," never a fabricated number. */
  sensitivity: number | null;
  specificity: number | null;
  ppv: number | null;
  matrix: ConfusionMatrix;
  /** Number of patients that contributed to this matrix (i.e. had both a non-null label and a findings entry for this dimension). */
  labeledCount: number;
}

export interface AgreementMetrics {
  agreementRate: number | null;
  agreements: number;
  total: number;
}

export interface ActionPlannerNote {
  patientId: string;
  taskCount: number;
  taskTitles: string[];
}

export interface MetricsReport {
  careGap: ClassificationMetrics;
  risk: ClassificationMetrics;
  sdoh: AgreementMetrics;
  actionPlanner: { notes: ActionPlannerNote[] };
}

// Risk agent's riskLevel enum values (riskAgent.ts's REPORT_RISK_TOOL schema)
// treated as "high risk" for the binary classification this eval performs.
// Exported so errorAnalysis.ts shares this single definition of "high risk"
// rather than re-deriving it — a threshold change (e.g. adding 'severe')
// only needs to happen here.
export const HIGH_RISK_LEVELS = new Set(['high', 'critical']);

/**
 * Tallies expected/predicted boolean pairs into a confusion matrix. Exported
 * for direct unit testing (governance/service.ts's convention for
 * otherwise-private pure helpers): the TP/TN/FP/FN branching is easy to pin
 * exactly here, independent of computeMetrics' label/findings wiring.
 */
export function tallyConfusionMatrix(pairs: { expected: boolean; predicted: boolean }[]): ConfusionMatrix {
  const matrix: ConfusionMatrix = { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
  for (const { expected, predicted } of pairs) {
    if (expected && predicted) matrix.truePositive++;
    else if (!expected && !predicted) matrix.trueNegative++;
    else if (!expected && predicted) matrix.falsePositive++;
    else matrix.falseNegative++;
  }
  return matrix;
}

/**
 * Derives sensitivity/specificity/PPV from a confusion matrix. Exported for
 * direct unit testing, same rationale as {@link tallyConfusionMatrix} — in
 * particular the zero-denominator -> null behavior (never NaN, never a
 * fabricated 0), which is awkward to pin through computeMetrics' full wiring.
 */
export function classificationMetricsFromMatrix(
  matrix: ConfusionMatrix
): { sensitivity: number | null; specificity: number | null; ppv: number | null } {
  const { truePositive, trueNegative, falsePositive, falseNegative } = matrix;
  const sensitivityDenom = truePositive + falseNegative;
  const specificityDenom = trueNegative + falsePositive;
  const ppvDenom = truePositive + falsePositive;
  return {
    sensitivity: sensitivityDenom > 0 ? truePositive / sensitivityDenom : null,
    specificity: specificityDenom > 0 ? trueNegative / specificityDenom : null,
    ppv: ppvDenom > 0 ? truePositive / ppvDenom : null,
  };
}

/**
 * Seam 4 (S9 A2) — pure. See module doc comment for the full contract.
 */
export function computeMetrics(labels: LabelRow[], findings: PatientFindings[]): MetricsReport {
  const findingsByPatientId = new Map(findings.map((f) => [f.patientId, f]));

  const careGapPairs: { expected: boolean; predicted: boolean }[] = [];
  const riskPairs: { expected: boolean; predicted: boolean }[] = [];
  let sdohAgreements = 0;
  let sdohTotal = 0;
  const actionPlannerNotes: ActionPlannerNote[] = [];

  for (const label of labels) {
    const patientFindings = findingsByPatientId.get(label.patientId);

    if (label.careGap.expectedHasGap !== null && patientFindings?.careGap) {
      careGapPairs.push({
        expected: label.careGap.expectedHasGap,
        predicted: patientFindings.careGap.findings.length > 0,
      });
    }

    if (label.risk.expectedHighRisk !== null && patientFindings?.risk) {
      riskPairs.push({
        expected: label.risk.expectedHighRisk,
        predicted: HIGH_RISK_LEVELS.has(patientFindings.risk.complete.riskLevel),
      });
    }

    if (label.sdoh.expectedHasBarrier !== null && patientFindings?.sdoh) {
      const predicted = patientFindings.sdoh.findings.length > 0;
      sdohTotal++;
      if (predicted === label.sdoh.expectedHasBarrier) sdohAgreements++;
    }

    if (patientFindings?.actionPlanner) {
      actionPlannerNotes.push({
        patientId: label.patientId,
        taskCount: patientFindings.actionPlanner.tasks.length,
        taskTitles: patientFindings.actionPlanner.tasks.map((t) => t.title),
      });
    }
  }

  const careGapMatrix = tallyConfusionMatrix(careGapPairs);
  const riskMatrix = tallyConfusionMatrix(riskPairs);

  return {
    careGap: { ...classificationMetricsFromMatrix(careGapMatrix), matrix: careGapMatrix, labeledCount: careGapPairs.length },
    risk: { ...classificationMetricsFromMatrix(riskMatrix), matrix: riskMatrix, labeledCount: riskPairs.length },
    sdoh: { agreementRate: sdohTotal > 0 ? sdohAgreements / sdohTotal : null, agreements: sdohAgreements, total: sdohTotal },
    actionPlanner: { notes: actionPlannerNotes },
  };
}
