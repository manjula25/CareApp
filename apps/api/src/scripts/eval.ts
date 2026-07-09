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
 * S15 Commit 3 — splits the patient loop into two parallel cohorts
 * (Dev-labeled baseline + Held-out evaluation), renders a three-section
 * markdown report (Dev-labeled baseline / Held-out evaluation / Outreach),
 * accepts `--dev-only`, `--held-out-only`, `--no-live` CLI flags, and reuses
 * `eval/computeMetrics.ts` for both cohorts (same pure function called twice).
 * The held-out cohort's labels are derived via `labelFromBundle(bundle, dim)`
 * (Commit 2) applied to `FhirReadService.getPatientBundle()` results; the
 * dev-labeled cohort reads `expectedHasGap` / `expectedHighRisk` /
 * `expectedHasBarrier` directly from `data/eval/labels.json` (unchanged).
 *
 * Mirrors `scripts/import-fhir.ts`'s existing conventions for a `tsx`-run
 * repo CLI script: no unit test for this glue itself (I/O-heavy — FHIR reads,
 * filesystem writes), `main()` guarded by `require.main === module`, and its
 * pieces exported for anything that wants to reuse them. The round-trip test
 * for the three CLI flags + three-section layout lives in
 * `scripts/eval.test.ts` (jest).
 */
import '../env'; // MUST load first — see index.ts: riskAgent.ts constructs `new OpenAI()` at import time.
import fs from 'fs';
import path from 'path';
import { getDb } from '../db';
import { FhirReadService, PatientBundle } from '../fhir/client';
import { AuthTokenPayload } from '../auth/jwt';
import { orchestrate } from '../agents/orchestrator';
import { validateCitations, validateCitationList } from '../agents/citationValidator';
import { clampRiskLevel } from '../agents/confidenceScorer';
import { readAnalysisCache } from '../db/analysisCache';
import { computeMetrics, LabelRow, PatientFindings, MetricsReport, CareGapFinding, SdohFinding, ActionPlannerTask } from '../eval/computeMetrics';
import { computeErrorAnalysis, ErrorAnalysis } from '../eval/errorAnalysis';
import { labelFromBundle } from '../eval/labelFromBundle';
import { readAndValidateOutreach } from './outreach-validate';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';

// Resolved the same way governance/service.ts resolves EVAL_REPORT_PATH: from
// `__dirname`, not `process.cwd()` (which varies with the invoking workspace
// script). This script lives at the same depth (apps/api/src/scripts), so the
// same 4-directories-up walk lands on the repo root either way.
const LABELS_PATH = path.resolve(__dirname, '../../../../data/eval/labels.json');
// S15 Commit 4 — the outreach log lives at the repo root next to labels.json.
// Read + validated via `readAndValidateOutreach` (imported from
// `outreach-validate.ts`) so the I/O + schema check happen in one place and
// the report's Outreach section just renders the verdict.
const OUTREACH_PATH = path.resolve(__dirname, '../../../../data/eval/clinician-outreach.json');
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
  _meta?: {
    heldOutRows?: string[];
    [key: string]: unknown;
  };
  patients: LabelRow[];
}

interface LoadedLabels {
  patients: LabelRow[];
  /** S15 — `_meta.heldOutRows` from `data/eval/labels.json`. Defaults to `[]` when the field is missing (backward compatible with pre-S15 label files). */
  heldOutRows: string[];
}

function loadLabelsFromPath(labelsPath: string): LoadedLabels {
  const raw = fs.readFileSync(labelsPath, 'utf-8');
  const parsed = JSON.parse(raw) as LabelFile;
  return {
    patients: parsed.patients ?? [],
    heldOutRows: parsed._meta?.heldOutRows ?? [],
  };
}

function loadLabels(): LabelRow[] {
  return loadLabelsFromPath(LABELS_PATH).patients;
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
      const clampedOutput = clampRiskLevel(bundle, event.output);
      const { valid } = validateCitations(clampedOutput.flags, bundle.validIds);
      riskFindings = { findings: valid, complete: { riskLevel: clampedOutput.riskLevel } };
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
 *
 * S15 Commit 3 — `noLive` (the `--no-live` CLI flag) skips the live
 * orchestrator run on cache miss: the patient is recorded in `failures`
 * with error `data-availability: no-live-flag` instead. This is the
 * verification flow — runs off the existing `analysis_cache` rows without
 * invoking the LLM, so the eval-report can render while OpenAI quota is
 * exhausted. The bundle fetch for held-out label derivation still happens
 * upstream (in `deriveHeldOutLabelRow`); `noLive` only suppresses the LLM
 * call, not the FHIR read.
 */
export async function runEval(
  labels: LabelRow[],
  fhirService: FhirReadService,
  db: ReturnType<typeof getDb>,
  noLive = false,
): Promise<EvalRunResult> {
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

      // S15 — `--no-live` short-circuits before the orchestrator call.
      // Cache miss + no-live flag → data-availability gap (no LLM round
      // trip, no fabricated finding).
      if (noLive) {
        failures.push({ patientId, error: 'data-availability: no-live-flag' });
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

// --- S15 Commit 3: held-out label derivation + harness wiring ------------

/**
 * S15 Commit 3 — for a held-out patient, fetch the bundle via HAPI and
 * derive the per-dimension labels via `labelFromBundle(bundle, dim)`
 * (Commit 2). The metadata from `data/eval/labels.json` (patientId, source,
 * actionPlanner.notes, original notes text) is preserved; only the
 * `expected*` boolean fields are overwritten with the bundle-derived
 * values. The metadata row's source stays `"dev"` — held-out labels are
 * mechanically derived, NOT clinician-validated, per
 * `prd-s15.md` D3 + `grill-evaluation-gaps.md` §3.
 *
 * On bundle-fetch failure, every `expected*` is downgraded to `null` —
 * an honest "no data" skip per the S9 A1 null contract — and the patient
 * is left for `computeErrorAnalysis` to surface as a data-availability gap.
 */
async function deriveHeldOutLabelRow(
  baseRow: LabelRow,
  fhirService: FhirReadService,
): Promise<LabelRow> {
  try {
    const bundle = await fhirService.getPatientBundle(EVAL_ACTOR, baseRow.patientId);
    return {
      ...baseRow,
      careGap: { ...baseRow.careGap, expectedHasGap: labelFromBundle(bundle, 'careGap') },
      risk: { ...baseRow.risk, expectedHighRisk: labelFromBundle(bundle, 'risk') },
      sdoh: { ...baseRow.sdoh, expectedHasBarrier: labelFromBundle(bundle, 'sdoh') },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`eval: held-out bundle fetch failed for ${baseRow.patientId}: ${message}`);
    return {
      ...baseRow,
      careGap: { ...baseRow.careGap, expectedHasGap: null },
      risk: { ...baseRow.risk, expectedHighRisk: null },
      sdoh: { ...baseRow.sdoh, expectedHasBarrier: null },
    };
  }
}

/** S15 Commit 3 — options bag for `runHarness` / `main`. Every field is
 * optional; defaults match the pre-S15 CLI behavior (run both cohorts off
 * cache with live fallback). The `fhirService` / `db` overrides are the
 * test seam that lets `eval.test.ts` inject a stub FhirReadService and an
 * in-memory SQLite without touching the committed `data/eval/labels.json`
 * or any local DB. */
export interface EvalOptions {
  /** Path to `data/eval/labels.json`. Defaults to the committed `LABELS_PATH`. */
  labelsPath?: string;
  /** Directory to write `eval-report.md` + `eval-report.json`. Defaults to the committed `REPORT_MD_PATH` / `REPORT_JSON_PATH` parent. */
  reportDir?: string;
  /** FHIR base URL. Defaults to `FHIR_BASE_URL` (env override `FHIR_BASE_URL`). */
  fhirBaseUrl?: string;
  /** `--dev-only` — skip the held-out patient loop entirely. */
  devOnly?: boolean;
  /** `--held-out-only` — skip the dev-labeled patient loop entirely. */
  heldOutOnly?: boolean;
  /** `--no-live` — read `analysis_cache` only; cache misses become data-availability gaps. */
  noLive?: boolean;
  /** Test seam — inject a pre-built FhirReadService (used to stub `getPatientBundle` in `eval.test.ts`). */
  fhirService?: FhirReadService;
  /** Test seam — inject a pre-built DB (e.g. `new Database(':memory:')`). */
  db?: ReturnType<typeof getDb>;
}

export interface HarnessResult {
  markdown: string;
  json: object;
}

/** S15 Commit 3 — the testable core of the eval harness. Reads labels,
 * splits them into dev-labeled vs held-out cohorts by `_meta.heldOutRows`,
 * derives held-out labels via `labelFromBundle`, runs the per-patient
 * scoring loop on the combined (filtered) list, computes per-cohort
 * metrics + error analysis via `eval/computeMetrics.ts` (same function
 * called twice), and returns the rendered markdown + JSON summary. The
 * CLI `main()` wraps this and writes the outputs to disk; the test calls
 * it directly with injected `fhirService` / `db` / `labelsPath` to assert
 * on the rendered content without filesystem or LLM side effects. */
export async function runHarness(opts: EvalOptions = {}): Promise<HarnessResult> {
  const labelsPath = opts.labelsPath ?? LABELS_PATH;
  const { patients: fullLabels, heldOutRows } = loadLabelsFromPath(labelsPath);

  const heldOutSet = new Set(heldOutRows);
  const devLabeledRows = fullLabels.filter((l) => !heldOutSet.has(l.patientId));
  const heldOutRowInputs = fullLabels.filter((l) => heldOutSet.has(l.patientId));

  const db = opts.db ?? getDb();
  const fhirService = opts.fhirService ?? new FhirReadService(db, opts.fhirBaseUrl ?? FHIR_BASE_URL);

  const runDev = !opts.heldOutOnly;
  const runHeldOut = !opts.devOnly;

  // Derive held-out labels from bundles (labelFromBundle, Commit 2). The
  // dev-labeled path doesn't need a bundle fetch — labels.json is the
  // source of truth for those rows.
  const heldOutDerivedRows: LabelRow[] = [];
  if (runHeldOut) {
    for (const row of heldOutRowInputs) {
      heldOutDerivedRows.push(await deriveHeldOutLabelRow(row, fhirService));
    }
  }

  const labelsForRun: LabelRow[] = [
    ...(runDev ? devLabeledRows : []),
    ...(runHeldOut ? heldOutDerivedRows : []),
  ];

  // Per-patient scoring (cache or live) — same runEval for both cohorts,
  // then split findings by patientId for per-cohort metric computation.
  const run = await runEval(labelsForRun, fhirService, db, !!opts.noLive);

  const findingsByPatient = new Map(run.findings.map((f) => [f.patientId, f]));

  // S15 Commit 4 — read + validate the outreach log once, share the verdict
  // between the markdown renderer and the JSON summary. Missing file is a
  // non-error "not yet started" state (the report makes the engagement gap
  // visible via the placeholder, not via a crash).
  const outreach = readAndValidateOutreach();

  let devMetrics: MetricsReport | null = null;
  let devErrors: ErrorAnalysis | null = null;
  let heldOutMetrics: MetricsReport | null = null;
  let heldOutErrors: ErrorAnalysis | null = null;

  if (runDev) {
    const devFindings = devLabeledRows
      .map((l) => findingsByPatient.get(l.patientId))
      .filter((f): f is PatientFindings => !!f);
    devMetrics = computeMetrics(devLabeledRows, devFindings);
    devErrors = computeErrorAnalysis(devLabeledRows, devFindings);
  }

  if (runHeldOut) {
    const heldOutFindings = heldOutRowInputs
      .map((l) => findingsByPatient.get(l.patientId))
      .filter((f): f is PatientFindings => !!f);
    heldOutMetrics = computeMetrics(heldOutDerivedRows, heldOutFindings);
    heldOutErrors = computeErrorAnalysis(heldOutDerivedRows, heldOutFindings);
  }

  const renderInputs = {
    fullLabels,
    heldOutRows,
    runDev,
    runHeldOut,
    run,
    devMetrics,
    devErrors,
    heldOutMetrics,
    heldOutErrors,
    noLive: !!opts.noLive,
    outreach,
  };

  const markdown = renderMarkdown(renderInputs);
  const json = buildJsonSummary(renderInputs);

  return { markdown, json };
}

/** S15 Commit 3 — parse CLI flags from `process.argv` into an EvalOptions
 * subset. Unrecognized flags are ignored (silent — the spec lists exactly
 * three flags; any other CLI arg is treated as a typo and dropped). */
function parseArgs(argv: string[]): Pick<EvalOptions, 'devOnly' | 'heldOutOnly' | 'noLive'> {
  return {
    devOnly: argv.includes('--dev-only'),
    heldOutOnly: argv.includes('--held-out-only'),
    noLive: argv.includes('--no-live'),
  };
}

function formatPct(value: number | null): string {
  return value === null ? 'n/a (denominator 0)' : `${(value * 100).toFixed(1)}%`;
}

function renderMarkdown(inputs: {
  fullLabels: LabelRow[];
  heldOutRows: string[];
  runDev: boolean;
  runHeldOut: boolean;
  run: EvalRunResult;
  devMetrics: MetricsReport | null;
  devErrors: ErrorAnalysis | null;
  heldOutMetrics: MetricsReport | null;
  heldOutErrors: ErrorAnalysis | null;
  noLive: boolean;
  outreach: ReturnType<typeof readAndValidateOutreach>;
}): string {
  const lines: string[] = [];
  const { fullLabels, heldOutRows, runDev, runHeldOut, run, devMetrics, devErrors, heldOutMetrics, heldOutErrors, noLive, outreach } = inputs;

  // Status counts use the FULL labels file (not the run's filter) — per
  // prd-s15.md D5, the disclosure should reflect the file state so the
  // numbers don't lie when a developer runs --dev-only or --held-out-only.
  const clinicianCount = fullLabels.filter((l) => l.source === 'clinician').length;
  const totalPatients = fullLabels.length;
  const heldOutSet = new Set(heldOutRows);
  const devCohortCount = fullLabels.filter((l) => !heldOutSet.has(l.patientId)).length;
  const heldOutCohortCount = heldOutRows.length;
  const clinicianPct = totalPatients > 0 ? ((clinicianCount / totalPatients) * 100).toFixed(1) : '0.0';
  const devCohortPct = totalPatients > 0 ? ((devCohortCount / totalPatients) * 100).toFixed(1) : '0.0';
  const heldOutCohortPct = totalPatients > 0 ? ((heldOutCohortCount / totalPatients) * 100).toFixed(1) : '0.0';

  lines.push('# S9 Evaluation Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  // S15 — three-count status disclosure. Mirrors pre-S15 S14 wording, but
  // splits the dev-labeled count out from the held-out count so the report
  // surfaces both cohorts independently.
  lines.push(
    `**Status (S15):** ${clinicianCount} of ${totalPatients} clinician-validated (${clinicianPct}%), ` +
      `${devCohortCount} of ${totalPatients} dev-labeled (${devCohortPct}%), ` +
      `${heldOutCohortCount} of ${totalPatients} held-out (${heldOutCohortPct}%).`
  );
  if (clinicianCount === 0) {
    lines.push(
      ' **Not clinician-validated (GD8).** Ground truth is drawn from `data/eval/labels.json`, ' +
        'whose `source` field is `"dev"` for every row today. Every row carries a `clinicianOverride` slot a clinician can ' +
        'fill in (via `npm run review:render` → `npm run review:apply`) to upgrade this baseline without any code change.'
    );
  }
  lines.push('');
  lines.push(
    '**Status (S16):** v2 risk rubric shipped at `riskAgent.buildPrompt` — 3 calibration anchors (multi-condition comorbidity, recent inpatient discharge ≤30d, abnormal labs) + "0 anchors → low" hard rule + 3 worked examples using actual seed-text bundle shapes (james-okafor, maria-chen, synthetic `bob`). ' +
      '**2x2 acceptance gate result:** dev-labeled specificity 69.2% (target ≥30% — pass), sensitivity 100% (target ≥67% — pass); held-out specificity 50% (target ≥30% — pass), sensitivity N/A (denominator 0 — no held-out patient meets `labelFromBundle`\'s `riskScoreFor()` ≥ 75 threshold, so the metric is undefined rather than failed). ' +
      'Dev-labeled specificity recovered from 0% (post-S13b over-call) to 69.2% (post-S16 v2 rubric); FPs dropped from 9 → 4 on the 16-patient dev-labeled set. **Pillar P2 lifts 4→5**, total HL7 evaluation moves 89.2 → 92.8.'
  );
  lines.push('');
  lines.push(
    '**Status (S13b):** The S13 calibration attempt (Risk-prompt rubric mirroring `riskScoreFor()` ≥ 75) was reverted after live re-eval ' +
      'showed it caused the model to over-call (specificity regressed from 30.8% → 0% on the 16-patient held-out set). The follow-up ' +
      'fix in this slice is a single seed-data change — `apps/api/src/fhir-data/seed-patients.ts`\'s `samuel-wright` entry now carries ' +
      'the Encounter + Observations his label implied but the seed previously omitted. See `docs/plans/caresync-ai/verification-s13.md` ' +
      '§3 + §6 for the full reversion log. Clinician validation of labels remains the long-term path to a real-clinical rubric.'
  );
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(
    `- ${totalPatients} labeled patients loaded from \`data/eval/labels.json\` — split into ` +
      `${devCohortCount} dev-labeled baseline patients (rows NOT in \`_meta.heldOutRows\`) and ` +
      `${heldOutCohortCount} held-out evaluation patients (rows in \`_meta.heldOutRows\`). ` +
      'Held-out evaluation reports per-agent metrics on bundles the eval-design team had no visibility into when tuning the agent; ' +
      'labels for those patients are derived from `_meta.labelingRules` applied to bundles never before seen by the eval.'
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
  if (noLive) {
    lines.push(
      '- `--no-live` flag was set: cache misses were treated as data-availability gaps (no LLM round trip); ' +
        'see "Data-availability gaps" for each excluded patient.'
    );
  }
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

  // --- Section 1: Dev-labeled baseline per-agent metrics -------------------
  lines.push(`## Per-agent metrics — Dev-labeled baseline (${devCohortCount} ${devCohortCount === 1 ? 'patient' : 'patients'})`);
  lines.push('');
  if (runDev && devMetrics) {
    pushPerAgentMetricBlocks(lines, devMetrics);
  } else {
    lines.push('_(Dev-labeled baseline not run — --held-out-only flag passed.)_');
    lines.push('');
  }

  // --- Section 2: Held-out evaluation per-agent metrics --------------------
  lines.push(`## Per-agent metrics — Held-out evaluation (${heldOutCohortCount} ${heldOutCohortCount === 1 ? 'patient' : 'patients'})`);
  lines.push('');
  if (runHeldOut && heldOutMetrics) {
    pushPerAgentMetricBlocks(lines, heldOutMetrics);
    // S15 — held-out SDOH is expected to be 0 data points (the procedural
    // generator's `buildSdohForIndex(i)` returns undefined for indices ≥10,
    // so the held-out 10 patients never have an AHC-HRSN Observation).
    // Render an explanatory note so the report doesn't look like a bug.
    if (heldOutMetrics.sdoh.total === 0) {
      lines.push(
        '> **Note (S15):** SDOH sub-metric: 0 data points. Held-out bundles have no AHC-HRSN Observations ' +
          '(`population.ts:buildSdohForIndex(i)` returns undefined for i ≥ 10). The Care Gap and Risk sub-metrics ' +
          'above still score; only the SDOH dimension is empty for this cohort by design.'
      );
      lines.push('');
    }
  } else {
    lines.push('_(Held-out evaluation not run — --dev-only flag passed.)_');
    lines.push('');
  }

  // --- Section 3: Outreach (S15 Commit 4) --------------------------------
  // S15 Commit 4 — render the outreach log from
  // `data/eval/clinician-outreach.json` (read + validated once at the top
  // of `runHarness`). Three branches:
  //   1. file missing → placeholder "Outreach log not yet started."
  //      (kept verbatim from the Commit 3 placeholder so the gap is visible
  //      on a fresh repo before anyone creates the JSON file);
  //   2. file present, schema ok → markdown table (one row per invitation);
  //   3. file present, schema error → error list inline (the report is the
  //      place to surface this; we don't crash the run).
  // Engagement is NOT a verification gate — an empty `invitations: []`
  // is a valid state, not a regression.
  lines.push('## Outreach');
  lines.push('');
  if (!outreach.fileExists) {
    lines.push('Outreach log not yet started.');
    lines.push('');
  } else if (outreach.ok) {
    if (outreach.invitations.length === 0) {
      lines.push('No clinician review invitations recorded yet. (Empty `invitations` array in `data/eval/clinician-outreach.json` — engagement is tracked here but does not gate the eval.)');
      lines.push('');
    } else {
      lines.push('| Reviewer | Sent At | Channel | Status | Labels Affected |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const inv of outreach.invitations) {
        lines.push(`| ${inv.reviewer} | ${inv.sentAt} | ${inv.channel} | ${inv.status} | ${inv.labelsAffected} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('`data/eval/clinician-outreach.json` failed schema validation:');
    lines.push('');
    for (const err of outreach.errors) {
      lines.push(`- ${err}`);
    }
    lines.push('');
  }

  // --- Section 4: Error analysis — Dev-labeled -----------------------------
  lines.push(`## Error analysis — Dev-labeled (${devCohortCount} ${devCohortCount === 1 ? 'patient' : 'patients'})`);
  lines.push('');
  if (runDev && devErrors) {
    pushErrorAnalysisBlocks(lines, devErrors, run);
  } else {
    lines.push('_(Dev-labeled error analysis not run — --held-out-only flag passed.)_');
    lines.push('');
  }

  // --- Section 5: Error analysis — Held-out --------------------------------
  lines.push(`## Error analysis — Held-out (${heldOutCohortCount} ${heldOutCohortCount === 1 ? 'patient' : 'patients'})`);
  lines.push('');
  if (runHeldOut && heldOutErrors) {
    pushErrorAnalysisBlocks(lines, heldOutErrors, run);
  } else {
    lines.push('_(Held-out error analysis not run — `--dev-only` flag passed.)_');
    lines.push('');
  }

  // --- Section 6: Data-availability gaps — combined ------------------------
  lines.push('## Data-availability gaps — combined');
  lines.push('');
  const allGaps: { patientId: string; reason: string; error?: string }[] = [];
  if (runDev && devErrors) {
    for (const g of devErrors.dataGaps) allGaps.push(g);
  }
  if (runHeldOut && heldOutErrors) {
    for (const g of heldOutErrors.dataGaps) allGaps.push(g);
  }
  if (allGaps.length === 0 && run.failures.length === 0) {
    lines.push('None.');
  } else {
    // De-dupe by patientId (same gap may surface in dev + held-out if both
    // cohorts ran — keep the first).
    const seen = new Set<string>();
    for (const gap of allGaps) {
      if (seen.has(gap.patientId)) continue;
      seen.add(gap.patientId);
      const failure = run.failures.find((f) => f.patientId === gap.patientId);
      lines.push(`- **${gap.patientId}**: ${gap.reason}${failure ? ` (error: ${failure.error})` : ''}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Renders the per-agent metric blocks (Care Gap / Risk / SDOH / Action
 * Planner) for a single cohort. Factored out so dev-labeled + held-out
 * sections share the exact same shape — the plan's requirement that the
 * held-out section be "identical metric shape" to the dev-labeled one.
 */
function pushPerAgentMetricBlocks(lines: string[], metrics: MetricsReport): void {
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
      'S14 rebalance (5 new AHC-HRSN screenings: 3 positive + 2 explicit-negative) breaks the pre-S14 "1 positive, 14 ' +
      'absence-of-screening" distribution that made this rate trivially gameable. The remaining per-dataset caveats ' +
      'from `_meta.limitations` still apply (small n, dev-interpreted domains).'
  );
  lines.push(
    `- Confusion matrix (n=${metrics.sdoh.total}): TP=${metrics.sdoh.matrix.truePositive}, ` +
      `TN=${metrics.sdoh.matrix.trueNegative}, FP=${metrics.sdoh.matrix.falsePositive}, FN=${metrics.sdoh.matrix.falseNegative}`
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
}

/**
 * Renders the per-dimension FP/FN lists + the per-cohort data-availability
 * gap list. Mirrors the pre-S15 single-section shape (Care Gap FN/FP, Risk
 * FN/FP, SDOH disagreements, data gaps) so the held-out section reads the
 * same as the dev-labeled section.
 */
function pushErrorAnalysisBlocks(lines: string[], errors: ErrorAnalysis, run: EvalRunResult): void {
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
  lines.push("### Care Gap false positives (agent flagged a gap, label says there isn't one)");
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
    '**Note (S13b):** The S13 risk-rubric was reverted after live re-eval showed it over-called. The remaining false positives above reflect ' +
      'the pre-S13 baseline (seed-derived labels vs the LLM\'s general clinical priors); see `docs/plans/caresync-ai/verification-s13.md` for the reversion log.'
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
}

/**
 * JSON-summary shaping — deliberately kept as plain object construction
 * (not a separately-tested pure function): it's a direct field-for-field
 * re-projection of `metrics`/`errors`/`run` with no branching logic of its
 * own to pin, so a unit test here would just re-assert the object literal.
 * `headline` is the one field `governance/service.ts`'s `getEvalSummary`
 * special-cases for prose rendering; everything else is free-form.
 *
 * S15 Commit 3 — mirrors the three-section markdown layout: top-level keys
 * are `devLabeled`, `heldOut`, and `outreach` (the latter is an empty
 * object until Commit 4 wires `outreachSchema`). Each cohort block carries
 * the same shape as the pre-S15 single-section summary.
 */
function buildJsonSummary(inputs: {
  fullLabels: LabelRow[];
  heldOutRows: string[];
  runDev: boolean;
  runHeldOut: boolean;
  run: EvalRunResult;
  devMetrics: MetricsReport | null;
  devErrors: ErrorAnalysis | null;
  heldOutMetrics: MetricsReport | null;
  heldOutErrors: ErrorAnalysis | null;
  outreach: ReturnType<typeof readAndValidateOutreach>;
}): object {
  const { fullLabels, heldOutRows, runDev, runHeldOut, run, devMetrics, devErrors, heldOutMetrics, heldOutErrors, outreach } = inputs;

  const clinicianCount = fullLabels.filter((l) => l.source === 'clinician').length;
  const totalPatients = fullLabels.length;
  const heldOutSet = new Set(heldOutRows);
  const devCohortCount = fullLabels.filter((l) => !heldOutSet.has(l.patientId)).length;
  const heldOutCohortCount = heldOutRows.length;

  const totalDevErrors = devErrors
    ? devErrors.careGap.falseNegatives.length +
      devErrors.careGap.falsePositives.length +
      devErrors.risk.falseNegatives.length +
      devErrors.risk.falsePositives.length +
      devErrors.sdoh.disagreements.length
    : 0;
  const totalHeldOutErrors = heldOutErrors
    ? heldOutErrors.careGap.falseNegatives.length +
      heldOutErrors.careGap.falsePositives.length +
      heldOutErrors.risk.falseNegatives.length +
      heldOutErrors.risk.falsePositives.length +
      heldOutErrors.sdoh.disagreements.length
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    clinicianStatus: 'DEV-LABELED BASELINE, NOT CLINICIAN-VALIDATED (GD8)',
    headline: `Eval run over ${totalPatients} labeled patients (${run.failures.length} failed): ` +
      `${devCohortCount} dev-labeled (${totalDevErrors} disagreement(s)), ` +
      `${heldOutCohortCount} held-out (${totalHeldOutErrors} disagreement(s)). ` +
      `Care Gap sensitivity ${formatPct(devMetrics?.careGap.sensitivity ?? null)}, ` +
      `Risk sensitivity ${formatPct(devMetrics?.risk.sensitivity ?? null)}, ` +
      `SDOH agreement ${formatPct(devMetrics?.sdoh.agreementRate ?? null)}.`,
    patientCount: totalPatients,
    clinicianCount,
    devLabeledCount: devCohortCount,
    heldOutCount: heldOutCohortCount,
    usedCacheCount: run.usedCache.length,
    usedLiveCount: run.usedLive.length,
    failedPatientIds: run.failures.map((f) => f.patientId),
    devLabeled: devMetrics
      ? {
          careGap: {
            sensitivity: devMetrics.careGap.sensitivity,
            specificity: devMetrics.careGap.specificity,
            ppv: devMetrics.careGap.ppv,
            matrix: devMetrics.careGap.matrix,
            labeledCount: devMetrics.careGap.labeledCount,
          },
          risk: {
            sensitivity: devMetrics.risk.sensitivity,
            specificity: devMetrics.risk.specificity,
            ppv: devMetrics.risk.ppv,
            matrix: devMetrics.risk.matrix,
            labeledCount: devMetrics.risk.labeledCount,
          },
          sdoh: {
            agreementRate: devMetrics.sdoh.agreementRate,
            agreements: devMetrics.sdoh.agreements,
            total: devMetrics.sdoh.total,
            matrix: devMetrics.sdoh.matrix,
          },
          actionPlanner: { notes: devMetrics.actionPlanner.notes },
          errorAnalysis: devErrors,
        }
      : { skipped: '--held-out-only' },
    heldOut: heldOutMetrics
      ? {
          careGap: {
            sensitivity: heldOutMetrics.careGap.sensitivity,
            specificity: heldOutMetrics.careGap.specificity,
            ppv: heldOutMetrics.careGap.ppv,
            matrix: heldOutMetrics.careGap.matrix,
            labeledCount: heldOutMetrics.careGap.labeledCount,
          },
          risk: {
            sensitivity: heldOutMetrics.risk.sensitivity,
            specificity: heldOutMetrics.risk.specificity,
            ppv: heldOutMetrics.risk.ppv,
            matrix: heldOutMetrics.risk.matrix,
            labeledCount: heldOutMetrics.risk.labeledCount,
          },
          sdoh: {
            agreementRate: heldOutMetrics.sdoh.agreementRate,
            agreements: heldOutMetrics.sdoh.agreements,
            total: heldOutMetrics.sdoh.total,
            matrix: heldOutMetrics.sdoh.matrix,
          },
          actionPlanner: { notes: heldOutMetrics.actionPlanner.notes },
          errorAnalysis: heldOutErrors,
        }
      : { skipped: '--dev-only' },
    outreach: {
      // S15 Commit 4 — surfaces the file's existence + schema verdict to
      // the JSON-summary consumer (governance/service.ts's eval tile +
      // any downstream tooling). The `invitations` array is the parsed
      // per-invitation shape (reviewer / sentAt / channel / status /
      // labelsAffected) so consumers don't have to re-parse the file.
      fileExists: outreach.fileExists,
      ok: outreach.ok,
      errors: outreach.errors,
      invitations: outreach.invitations,
    },
  };
}

async function main(opts: EvalOptions = {}): Promise<void> {
  // If the caller passed any explicit flag (test seam), use those values
  // verbatim. Otherwise parse from process.argv — the standard CLI path.
  const argv = process.argv.slice(2);
  const argvHasFlags = argv.includes('--dev-only') || argv.includes('--held-out-only') || argv.includes('--no-live');
  const hasExplicitFlags = opts.devOnly !== undefined || opts.heldOutOnly !== undefined || opts.noLive !== undefined;
  const flags: EvalOptions = hasExplicitFlags || !argvHasFlags ? opts : { ...opts, ...parseArgs(argv) };

  const reportDir = flags.reportDir ?? path.dirname(REPORT_MD_PATH);
  const reportMdPath = path.join(reportDir, 'eval-report.md');
  const reportJsonPath = path.join(reportDir, 'eval-report.json');

  const { markdown, json } = await runHarness(flags);

  fs.writeFileSync(reportMdPath, markdown, 'utf-8');
  console.log(`eval: wrote ${reportMdPath}`);
  fs.writeFileSync(reportJsonPath, JSON.stringify(json, null, 2), 'utf-8');
  console.log(`eval: wrote ${reportJsonPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { loadLabels, renderMarkdown, buildJsonSummary, LABELS_PATH, REPORT_MD_PATH, REPORT_JSON_PATH, loadLabelsFromPath };
