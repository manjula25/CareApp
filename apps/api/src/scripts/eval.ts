/**
 * S9 B1 — `npm run eval`. Loads the committed ground-truth label file
 * (`data/eval/labels.json`), runs the four agents (preferring the S4
 * `analysis_cache`, falling back to a live orchestrator run) over every
 * labeled patient, scores the result against Phase A's pure `computeMetrics`
 * (Seam 4) + the colocated `computeErrorAnalysis` helper, and writes:
 *   - `docs/eval-report.md`   — human-readable methodology + error analysis.
 *   - `docs/eval-report.json` — machine summary the S8 governance eval tile
 *     reads from `governance/service.ts`'s `EVAL_REPORT_PATH` (must resolve
 *     to the exact same file).
 *
 * Mirrors `scripts/import-fhir.ts`'s existing conventions for a `tsx`-run
 * repo CLI script: no unit test for this glue itself (I/O-heavy — FHIR reads,
 * filesystem writes), `main()` guarded by `require.main === module`, and its
 * pieces exported for anything that wants to reuse them.
 */
import '../env'; // MUST load first — see index.ts: riskAgent.ts constructs `new OpenAI()` at import time.
import fs from 'fs';
import path from 'path';
import { getDb } from '../db';
import { FhirReadService, PatientBundle } from '../fhir/client';
import { AuthTokenPayload } from '../auth/jwt';
import { orchestrate } from '../agents/orchestrator';
import { validateCitations, validateCitationList } from '../agents/citationValidator';
import { readAnalysisCache } from '../db/analysisCache';
import { computeMetrics, LabelRow, PatientFindings, MetricsReport, CareGapFinding, SdohFinding, ActionPlannerTask } from '../eval/computeMetrics';
import { computeErrorAnalysis, ErrorAnalysis } from '../eval/errorAnalysis';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';

// Resolved the same way governance/service.ts resolves EVAL_REPORT_PATH: from
// `__dirname`, not `process.cwd()` (which varies with the invoking workspace
// script). This script lives at the same depth (apps/api/src/scripts), so the
// same 4-directories-up walk lands on the repo root either way.
const LABELS_PATH = path.resolve(__dirname, '../../../../data/eval/labels.json');
const REPORT_MD_PATH = path.resolve(__dirname, '../../../../docs/eval-report.md');
// MUST equal governance/service.ts's EVAL_REPORT_PATH exactly — that's the
// one hard, load-bearing contract this script has with the S8 eval tile.
//
// Ordering hazard: `routes/governance.test.ts`'s eval-endpoint suite writes
// and `rmSync`s this exact path in its `afterEach` (pre-existing S8 test
// behavior, not this script's doing). Running `apps/api`'s Jest suite after
// `npm run eval` deletes this file. It is committed to the repo specifically
// so that hazard is harmless locally (`git checkout -- docs/eval-report.json`
// restores it) — re-run `npm run eval` (or check out the committed copy)
// before relying on the file's presence if you've just run the full suite.
const REPORT_JSON_PATH = path.resolve(__dirname, '../../../../docs/eval-report.json');

// The eval harness runs as a script, not behind an HTTP login — there is no
// real logged-in user to attribute FHIR reads/audit rows to. `director` is
// the only role with 'clinical' scope AND is the role governance/service.ts
// itself uses to gate the summary this script produces, so it's the natural
// synthetic actor for both halves of this pipeline.
const EVAL_ACTOR: AuthTokenPayload = { id: 'eval-harness', name: 'S9 Eval Harness', role: 'director' };

interface LabelFile {
  patients: LabelRow[];
}

function loadLabels(): LabelRow[] {
  const raw = fs.readFileSync(LABELS_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as LabelFile;
  return parsed.patients;
}

/**
 * Assembles the same shape `computeMetrics` scores against (the
 * post-`validateCitations` findings `AnalysisResultJson` surfaces to
 * clinicians — see routes/analysis.ts) from a live orchestrator run, WITHOUT
 * replaying that route's SSE/narration bookkeeping (narration text plays no
 * role in scoring) and WITHOUT calling `replacePatientTasks` (which deletes +
 * recreates real FHIR Tasks — a mutating side effect this read-only,
 * repeatable-by-design harness deliberately avoids; `computeMetrics`'s
 * Action Planner dimension is qualitative pass-through and only reads
 * `id`/`title`/`description`/`priority`/`fhirResources`, none of which
 * require a real HAPI-assigned Task id). A synthetic `eval-{patientId}-{n}`
 * id stands in instead.
 */
async function runLive(bundle: PatientBundle, patientId: string): Promise<PatientFindings> {
  let riskFindings: PatientFindings['risk'];
  let careGapFindings: PatientFindings['careGap'];
  let sdohFindings: PatientFindings['sdoh'];
  let actionPlannerFindings: PatientFindings['actionPlanner'];

  for await (const event of orchestrate(bundle)) {
    if (event.type !== 'result') continue;

    if (event.agentId === 'risk') {
      const { valid } = validateCitations(event.output.flags, bundle.validIds);
      riskFindings = { findings: valid, complete: { riskLevel: event.output.riskLevel } };
    } else if (event.agentId === 'careGap') {
      const { valid } = validateCitations(event.output.gaps, bundle.validIds);
      careGapFindings = { findings: valid };
    } else if (event.agentId === 'sdoh') {
      const { valid } = validateCitations(event.output.barriers, bundle.validIds);
      sdohFindings = { findings: valid };
    } else {
      const { valid } = validateCitationList(
        event.output.tasks,
        (task) => task.fhirResources,
        (task, ids) => ({ ...task, fhirResources: ids }),
        bundle.validIds
      );
      actionPlannerFindings = {
        tasks: valid.map((task, i) => ({
          id: `eval-${patientId}-${i}`,
          title: task.title,
          description: task.description,
          priority: task.priority,
          fhirResources: task.fhirResources,
        })),
      };
    }
  }

  return { patientId, careGap: careGapFindings, risk: riskFindings, sdoh: sdohFindings, actionPlanner: actionPlannerFindings };
}

/** Maps a cached `AnalysisResultJson`-shaped row onto the `PatientFindings` shape `computeMetrics` scores against. */
function fromCache(patientId: string, resultJson: unknown): PatientFindings {
  const result = resultJson as {
    careGap?: { findings: CareGapFinding[] };
    risk?: { complete?: { riskLevel: string } };
    sdoh?: { findings: SdohFinding[] };
    actionPlanner?: { tasks: ActionPlannerTask[] };
  };
  return {
    patientId,
    careGap: result.careGap ? { findings: result.careGap.findings } : undefined,
    risk: result.risk?.complete ? { findings: [], complete: { riskLevel: result.risk.complete.riskLevel } } : undefined,
    sdoh: result.sdoh ? { findings: result.sdoh.findings } : undefined,
    actionPlanner: result.actionPlanner ? { tasks: result.actionPlanner.tasks } : undefined,
  };
}

export interface EvalRunResult {
  findings: PatientFindings[];
  /** Patients whose bundle/agent run failed outright this cycle (HAPI read error, etc.) — distinct from computeErrorAnalysis's dataGaps, which this feeds. */
  failures: { patientId: string; error: string }[];
  usedCache: string[];
  usedLive: string[];
}

/**
 * Runs the harness pass: for each labeled patient, prefer the S4
 * `analysis_cache` row (fast, no HAPI/LLM round trip) and fall back to a live
 * orchestrator run on a cache miss. A per-patient failure (HAPI read error,
 * agent error) is caught, logged, and excluded from `findings` — never
 * crashes the whole run — and recorded in `failures` so the report's
 * error-analysis section can name it as a data-availability gap rather than
 * silently dropping it.
 */
export async function runEval(labels: LabelRow[], fhirService: FhirReadService, db: ReturnType<typeof getDb>): Promise<EvalRunResult> {
  const findings: PatientFindings[] = [];
  const failures: { patientId: string; error: string }[] = [];
  const usedCache: string[] = [];
  const usedLive: string[] = [];

  for (const label of labels) {
    const patientId = label.patientId;
    try {
      const cached = readAnalysisCache(db, patientId);
      if (cached) {
        findings.push(fromCache(patientId, cached.resultJson));
        usedCache.push(patientId);
        continue;
      }

      const bundle = await fhirService.getPatientBundle(EVAL_ACTOR, patientId);
      findings.push(await runLive(bundle, patientId));
      usedLive.push(patientId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`eval: patient ${patientId} failed (excluded this run): ${message}`);
      failures.push({ patientId, error: message });
    }
  }

  return { findings, failures, usedCache, usedLive };
}

function formatPct(value: number | null): string {
  return value === null ? 'n/a (denominator 0)' : `${(value * 100).toFixed(1)}%`;
}

function renderMarkdown(labels: LabelRow[], run: EvalRunResult, metrics: MetricsReport, errors: ErrorAnalysis): string {
  const lines: string[] = [];
  lines.push('# S9 Evaluation Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    '**Status: DEV-LABELED BASELINE, NOT CLINICIAN-VALIDATED (GD8).** Ground truth is drawn from `data/eval/labels.json`, ' +
      'whose `source` field is `"dev"` for every row today. Every row carries a `clinicianOverride` slot a clinician can ' +
      'fill in later to upgrade this baseline without any code change. Do not present these numbers as clinician-reviewed.'
  );
  lines.push('');
  lines.push(
    '**Status (S13):** Risk-agent prompts now include an explicit clinical rubric (≥2 of {multi-condition comorbidity, recent inpatient ' +
      'discharge ≤30d, abnormal labs: BNP>200, HbA1c>9.0, eGFR<30}) that mirrors `fhir-data/population.ts:127-134` `riskScoreFor()` ≥ 75. ' +
      'The Risk-specificity and PPV numbers below reflect that alignment with the synthetic ground truth, not with a real clinical ' +
      'reference standard. See `docs/plans/caresync-ai/design-risk-calibration.md` §2 D3 / §3 for the calibration rationale. Clinician ' +
      'validation of labels remains the long-term path to a real-clinical rubric — this calibration is the conservative interim step.'
  );
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(
    `- ${labels.length} labeled patients loaded from \`data/eval/labels.json\` (6 curated hero/panel patients + ` +
      `10 deterministic \`pop-XXXX\` procedural patients — the plan's "~5 curated hero + ~10 Synthea" with the disclosed ` +
      'S5 substitution: no real Synthea/Java in this repo).'
  );
  lines.push(
    `- ${run.usedCache.length} patient(s) scored from the existing S4 \`analysis_cache\` (no live agent/LLM call this run): ` +
      (run.usedCache.length > 0 ? run.usedCache.join(', ') : 'none') + '.'
  );
  lines.push(
    `- ${run.usedLive.length} patient(s) scored from a live orchestrator run (cache miss): ` +
      (run.usedLive.length > 0 ? run.usedLive.join(', ') : 'none') + '.'
  );
  lines.push(
    `- ${run.failures.length} patient(s) failed outright this run (HAPI read error or agent error) and were excluded — ` +
      'see Error Analysis below for detail on each.'
  );
  lines.push(
    '- Findings are scored post-`validateCitations` (GD11) — the same citation-gated shape the product actually shows ' +
      'clinicians, not raw/unvalidated agent output.'
  );
  lines.push(
    '- The Action Planner\'s created tasks are read (via the citation gate) but never written to HAPI by this harness ' +
      '(`replacePatientTasks` is deliberately not called) — a read-only, repeatable eval run should not mutate the ' +
      'demo Task list on every invocation.'
  );
  lines.push('');

  lines.push('## Per-agent metrics');
  lines.push('');
  lines.push('### Care Gap (binary: has a monitoring gap)');
  lines.push('');
  lines.push(`- Sensitivity: ${formatPct(metrics.careGap.sensitivity)}`);
  lines.push(`- Specificity: ${formatPct(metrics.careGap.specificity)}`);
  lines.push(`- PPV: ${formatPct(metrics.careGap.ppv)}`);
  lines.push(
    `- Confusion matrix (n=${metrics.careGap.labeledCount}): TP=${metrics.careGap.matrix.truePositive}, ` +
      `TN=${metrics.careGap.matrix.trueNegative}, FP=${metrics.careGap.matrix.falsePositive}, FN=${metrics.careGap.matrix.falseNegative}`
  );
  lines.push('');
  lines.push('### Risk (binary: high/critical readmission risk)');
  lines.push('');
  lines.push(`- Sensitivity: ${formatPct(metrics.risk.sensitivity)}`);
  lines.push(`- Specificity: ${formatPct(metrics.risk.specificity)}`);
  lines.push(`- PPV: ${formatPct(metrics.risk.ppv)}`);
  lines.push(
    `- Confusion matrix (n=${metrics.risk.labeledCount}): TP=${metrics.risk.matrix.truePositive}, ` +
      `TN=${metrics.risk.matrix.trueNegative}, FP=${metrics.risk.matrix.falsePositive}, FN=${metrics.risk.matrix.falseNegative}`
  );
  lines.push('');
  lines.push('### SDOH (agreement rate: has an actionable barrier)');
  lines.push('');
  lines.push(
    `- Agreement rate: ${formatPct(metrics.sdoh.agreementRate)} (${metrics.sdoh.agreements}/${metrics.sdoh.total}). ` +
      'Read alongside the SDOH limitation noted in `data/eval/labels.json` `_meta.limitations` — only one positive ' +
      'example (maria-chen) exists in this dataset, so this rate is easy to game with an always-negative predictor.'
  );
  lines.push('');
  lines.push('### Action Planner (qualitative — synthesis, not classification)');
  lines.push('');
  if (metrics.actionPlanner.notes.length === 0) {
    lines.push('No patients produced an Action Planner result this run.');
  } else {
    for (const note of metrics.actionPlanner.notes) {
      lines.push(`- **${note.patientId}**: ${note.taskCount} task(s) created — ${note.taskTitles.join('; ') || '(none)'}`);
    }
  }
  lines.push('');

  lines.push('## Error analysis (mandatory — GD8, the P6 4→5 lever)');
  lines.push('');
  lines.push('### Care Gap misses (false negatives — agent said no gap, label says there is one)');
  lines.push('');
  if (errors.careGap.falseNegatives.length === 0) {
    lines.push('None.');
  } else {
    for (const e of errors.careGap.falseNegatives) {
      lines.push(`- **${e.patientId}**: expected a gap, agent found none. Label rationale: ${e.labelNotes}`);
    }
  }
  lines.push('');
  lines.push('### Care Gap false positives (agent flagged a gap, label says there isn\'t one)');
  lines.push('');
  if (errors.careGap.falsePositives.length === 0) {
    lines.push('None.');
  } else {
    for (const e of errors.careGap.falsePositives) {
      lines.push(`- **${e.patientId}**: agent flagged a gap, label expects none. Label rationale: ${e.labelNotes}`);
    }
  }
  lines.push('');
  lines.push('### Risk misses (false negatives — agent under-called risk)');
  lines.push('');
  if (errors.risk.falseNegatives.length === 0) {
    lines.push('None.');
  } else {
    for (const e of errors.risk.falseNegatives) {
      lines.push(`- **${e.patientId}**: expected high/critical risk, agent predicted "${e.predictedRiskLevel}". Label rationale: ${e.labelNotes}`);
    }
  }
  lines.push('');
  lines.push('### Risk false positives (agent over-called risk)');
  lines.push('');
  lines.push(
    '**Note (S13):** The Risk agent\'s prompt rubric was authored to mirror the synthetic seed heuristic. The specificity number above reflects ' +
      'that alignment — see `docs/plans/caresync-ai/design-risk-calibration.md` for the calibration rationale.'
  );
  lines.push('');
  if (errors.risk.falsePositives.length === 0) {
    lines.push('None.');
  } else {
    for (const e of errors.risk.falsePositives) {
      lines.push(`- **${e.patientId}**: expected low/moderate risk, agent predicted "${e.predictedRiskLevel}". Label rationale: ${e.labelNotes}`);
    }
  }
  lines.push('');
  lines.push('### SDOH disagreements');
  lines.push('');
  if (errors.sdoh.disagreements.length === 0) {
    lines.push('None.');
  } else {
    for (const e of errors.sdoh.disagreements) {
      lines.push(
        `- **${e.patientId}**: expected ${e.expected ? 'a barrier' : 'no barrier'}, agent predicted ${e.predicted ? 'a barrier' : 'no barrier'}. Label rationale: ${e.labelNotes}`
      );
    }
  }
  lines.push('');
  lines.push('### Data-availability gaps (patient excluded from every dimension this run)');
  lines.push('');
  if (errors.dataGaps.length === 0 && run.failures.length === 0) {
    lines.push('None.');
  } else {
    for (const gap of errors.dataGaps) {
      const failure = run.failures.find((f) => f.patientId === gap.patientId);
      lines.push(`- **${gap.patientId}**: ${gap.reason}${failure ? ` (error: ${failure.error})` : ''}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * JSON-summary shaping — deliberately kept as plain object construction
 * (not a separately-tested pure function): it's a direct field-for-field
 * re-projection of `metrics`/`errors`/`run` with no branching logic of its
 * own to pin, so a unit test here would just re-assert the object literal.
 * `headline` is the one field `governance/service.ts`'s `getEvalSummary`
 * special-cases for prose rendering; everything else is free-form.
 */
function buildJsonSummary(labels: LabelRow[], run: EvalRunResult, metrics: MetricsReport, errors: ErrorAnalysis) {
  const totalErrors =
    errors.careGap.falseNegatives.length +
    errors.careGap.falsePositives.length +
    errors.risk.falseNegatives.length +
    errors.risk.falsePositives.length +
    errors.sdoh.disagreements.length;

  return {
    generatedAt: new Date().toISOString(),
    clinicianStatus: 'DEV-LABELED BASELINE, NOT CLINICIAN-VALIDATED (GD8)',
    headline: `Eval run over ${labels.length} labeled patients (${run.failures.length} failed): Care Gap sensitivity ${formatPct(
      metrics.careGap.sensitivity
    )}, Risk sensitivity ${formatPct(metrics.risk.sensitivity)}, SDOH agreement ${formatPct(
      metrics.sdoh.agreementRate
    )}, ${totalErrors} labeled disagreement(s) found.`,
    patientCount: labels.length,
    usedCacheCount: run.usedCache.length,
    usedLiveCount: run.usedLive.length,
    failedPatientIds: run.failures.map((f) => f.patientId),
    careGap: {
      sensitivity: metrics.careGap.sensitivity,
      specificity: metrics.careGap.specificity,
      ppv: metrics.careGap.ppv,
      matrix: metrics.careGap.matrix,
      labeledCount: metrics.careGap.labeledCount,
    },
    risk: {
      sensitivity: metrics.risk.sensitivity,
      specificity: metrics.risk.specificity,
      ppv: metrics.risk.ppv,
      matrix: metrics.risk.matrix,
      labeledCount: metrics.risk.labeledCount,
    },
    sdoh: {
      agreementRate: metrics.sdoh.agreementRate,
      agreements: metrics.sdoh.agreements,
      total: metrics.sdoh.total,
    },
    actionPlanner: {
      notes: metrics.actionPlanner.notes,
    },
    errorAnalysis: errors,
  };
}

async function main(): Promise<void> {
  const labels = loadLabels();
  const db = getDb();
  const fhirService = new FhirReadService(db, FHIR_BASE_URL);

  console.log(`eval: scoring ${labels.length} labeled patients against ${FHIR_BASE_URL}...`);
  const run = await runEval(labels, fhirService, db);

  const metrics = computeMetrics(labels, run.findings);
  const errors = computeErrorAnalysis(labels, run.findings);

  const markdown = renderMarkdown(labels, run, metrics, errors);
  fs.writeFileSync(REPORT_MD_PATH, markdown, 'utf-8');
  console.log(`eval: wrote ${REPORT_MD_PATH}`);

  const jsonSummary = buildJsonSummary(labels, run, metrics, errors);
  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(jsonSummary, null, 2), 'utf-8');
  console.log(`eval: wrote ${REPORT_JSON_PATH}`);

  console.log(`eval: done. ${run.findings.length}/${labels.length} patients scored, ${run.failures.length} failed.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { loadLabels, renderMarkdown, buildJsonSummary, LABELS_PATH, REPORT_MD_PATH, REPORT_JSON_PATH };
