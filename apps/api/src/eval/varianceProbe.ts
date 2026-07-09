/**
 * S16 Commit 2 — `apps/api/src/eval/varianceProbe.ts`.
 *
 * Runs the dev-labeled 16 patients (from `data/eval/labels.json`) through
 * the Risk agent N=3 times each (configurable via `ProbeDeps.N`) and
 * emits a per-patient `riskLevel` agreement matrix. The probe is a
 * **real-LLM tool** per `prd-s16.md D3` + project memory
 * `never-override-real-with-fake.md`:
 *
 *   - When `OPENAI_API_KEY` is unset, `main()` aborts with the documented
 *     error message + non-zero exit code. The probe never uses the
 *     `MOCK_RISK_OUTPUT` / `streamMockRisk` fallback — that path belongs
 *     to the agent's `OPENAI_API_KEY`-unset demo mode only.
 *
 *   - When `OPENAI_API_KEY` IS set, `main()` constructs a real `OpenAI()`
 *     client (no caching from the agent's lazy-construction pattern; the
 *     probe wants a fresh client for clarity), fetches each patient's
 *     bundle via `FhirReadService.getPatientBundle()` (the same FHIR read
 *     path the eval harness uses), and runs the Risk agent through it.
 *
 * Substrate check (per `prd-s16.md D9` signal #3): ≥80% per-patient
 * agreement across the 3 runs. Pre-pin baseline is
 * `verification-s13.md §4` (specificity 0%, per-patient agreement <30%).
 *
 * The testable core (`computeAgreement`, `runProbe`, `devLabeledPatientIds`)
 * is split from `main()` so `varianceProbe.test.ts` can pin the math + the
 * runner/client wiring without invoking the live FHIR or LLM paths.
 */

// MUST be the first import — same convention `scripts/eval.ts` and
// `apps/api/src/index.ts` follow. Without this, `new OpenAI()` throws on a
// fresh shell because Node's native loader doesn't auto-read `.env`.
import '../env';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { runRiskAgent } from '../agents/riskAgent';
import { AuthTokenPayload } from '../auth/jwt';
import { FhirReadService, PatientBundle } from '../fhir/client';
import { getDb } from '../db';
import { AgentEvent, RiskOutput } from '../agents/agent';

// Same path-resolution pattern as `scripts/eval.ts` — anchored at `__dirname`
// so the script works regardless of `process.cwd()`. The file lives at the
// repo root (4 levels up from `apps/api/src/eval/`); same depth as eval.ts.
const LABELS_PATH = path.resolve(__dirname, '../../../../data/eval/labels.json');
const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';
// Synthetic actor — no real user attribute. The probe is a script, not an
// authenticated request. `director` matches `scripts/eval.ts`'s convention.
const EVAL_ACTOR: AuthTokenPayload = { id: 'variance-probe', name: 'S16 Variance Probe', role: 'director' };

/** Per-patient row in the agreement matrix. Exported for the test surface. */
export interface AgreementRow {
  patientId: string;
  runs: string[];
  agreement: string;
}

/** Injectable dependencies for `runProbe` — kept as a seam so the test can
 * substitute a fake fetcher / runner / client without touching FHIR or LLM. */
export interface ProbeDeps {
  /** Fetches one patient's bundle. Defaults to `FhirReadService.getPatientBundle`. */
  fetcher: (patientId: string) => Promise<PatientBundle>;
  /** Runs the agent over a bundle, yielding events. Defaults to `runRiskAgent`. */
  runner: (bundle: PatientBundle, client: OpenAI) => AsyncIterable<AgentEvent>;
  /** The OpenAI client — held by `runProbe` and passed to `runner` per call. */
  client: OpenAI;
  /** Logger — `console.log` in production, captured in tests. */
  logger: { log: (line: string) => void; error: (line: string) => void };
  /** Number of runs per patient. Defaults to 3 in production (`runProbeWithDefaults`). */
  N: number;
}

/** Reads `data/eval/labels.json` and returns the patient ids whose `source`
 * is `dev` AND are NOT in `_meta.heldOutRows`. The probe iterates over
 * exactly this set — 16 patients today, deterministic from the labels file. */
export function devLabeledPatientIds(labelsPath: string = LABELS_PATH): string[] {
  const raw = fs.readFileSync(labelsPath, 'utf-8');
  const parsed = JSON.parse(raw) as {
    _meta?: { heldOutRows?: string[] };
    patients: Array<{ patientId: string; source: string }>;
  };
  const heldOutSet = new Set(parsed._meta?.heldOutRows ?? []);
  return parsed.patients
    .filter((p) => p.source === 'dev' && !heldOutSet.has(p.patientId))
    .map((p) => p.patientId);
}

/** Per-patient agreement = max-count of identical runs / total runs. Pure,
 * deterministic, exported for the test that pins the math. */
export function computeAgreement(runs: string[]): string {
  const counts = new Map<string, number>();
  for (const r of runs) counts.set(r, (counts.get(r) ?? 0) + 1);
  const max = Math.max(...counts.values());
  return `${max}/${runs.length}`;
}

/** Testable core of the probe. Iterates over `patientIds`, runs the agent
 * N times per patient, and returns one `AgreementRow` per patient. The
 * injected `deps` keep FHIR + LLM out of the unit-test surface. */
export async function runProbe(patientIds: string[], deps: ProbeDeps): Promise<AgreementRow[]> {
  const rows: AgreementRow[] = [];
  for (const id of patientIds) {
    const bundle = await deps.fetcher(id);
    const runs: string[] = [];
    for (let i = 0; i < deps.N; i++) {
      for await (const event of deps.runner(bundle, deps.client)) {
        if (event.type === 'result' && event.agentId === 'risk') {
          // The runner yields one terminal `result` event per call; the
          // output is the RiskOutput the agent returned via the report_risk
          // function tool. `computeAgreement` works off the `riskLevel`.
          const out = (event as Extract<AgentEvent, { type: 'result'; agentId: 'risk' }>).output as RiskOutput;
          runs.push(out.riskLevel);
        }
      }
    }
    rows.push({ patientId: id, runs, agreement: computeAgreement(runs) });
  }
  return rows;
}

/** Render the rows + the run-header as a markdown table — same shape
 * `verification-s13.md §4` and `prd-s16.md D9` reference. */
function formatMarkdown(rows: AgreementRow[], N: number): string {
  const lines: string[] = [];
  lines.push(`| patient | ${Array.from({ length: N }, (_, i) => `run${i + 1}`).join(' | ')} | agreement |`);
  lines.push(`|---------|${Array.from({ length: N + 1 }, () => '------').join('|')}|`);
  for (const row of rows) {
    lines.push(`| ${row.patientId} | ${row.runs.join(' | ')} | ${row.agreement} |`);
  }
  return lines.join('\n');
}

/** Production entry point. Wires the real FHIR fetcher + OpenAI client +
 * `runRiskAgent` runner, then delegates to `runProbe`. Refuses to run
 * without `OPENAI_API_KEY` (the real-LLM invariant). */
export async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY unset — variance probe requires the real LLM, aborting.');
    process.exit(1);
  }
  const patientIds = devLabeledPatientIds();
  const db = getDb();
  const fhir = new FhirReadService(db, FHIR_BASE_URL);
  const fetcher = async (id: string): Promise<PatientBundle> => fhir.getPatientBundle(EVAL_ACTOR, id);
  const client = new OpenAI();

  try {
    const rows = await runProbe(patientIds, {
      fetcher,
      runner: runRiskAgent as unknown as ProbeDeps['runner'],
      client,
      logger: console,
      N: 3,
    });
    console.log(formatMarkdown(rows, 3));
  } catch (err) {
    // Quota / rate-limit / API rejection — surface the error and exit 1 so
    // the operator sees what went wrong (per `implementation-plan-s16.md`
    // Phase F's documented failure-mode behavior).
    const message = err instanceof Error ? err.message : String(err);
    console.error(`varianceProbe: aborted: ${message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
