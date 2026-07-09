/**
 * S15 Commit 3 — round-trip tests for `apps/api/src/scripts/eval.ts`.
 *
 * Pins the three-section eval-report layout (Dev-labeled baseline /
 * Held-out evaluation / Outreach) and the three new CLI flags
 * (--dev-only / --held-out-only / --no-live) at the harness level.
 *
 * No live HAPI or LLM call anywhere in these tests:
 *   - bundles are stubbed via `FhirReadService.getPatientBundle` (the
 *     eval script calls this for held-out label derivation via
 *     `labelFromBundle(bundle, dim)` per Commit 2);
 *   - agent findings are pre-populated into the in-memory `analysis_cache`
 *     table so the `--no-live` flow has cache hits and never tries to
 *     invoke `orchestrate()` / the LLM.
 *
 * Mirrors the `apply-clinician-review.test.ts` round-trip pattern
 * (fs.mkdtempSync for fixture files, in-memory SQLite for the cache,
 * restore mocks + cleanup in afterEach) so the committed `data/eval/`
 * files and any local DB are never touched.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { migrate } from '../db';
import { writeAnalysisCache } from '../db/analysisCache';
import { FhirReadService, PatientBundle } from '../fhir/client';
import type { AgentId } from '../agents/agent';
import { runHarness, EvalOptions, computePatientCost, emitCostSidecar, renderCostSection, CostSummary } from './eval';

// --- Fixture helpers ------------------------------------------------------

interface FixturePatientRow {
  patientId: string;
  source: 'dev';
  clinicianOverride: null;
  careGap: { expectedHasGap: boolean | null; notes: string };
  risk: { expectedHighRisk: boolean | null; seedRiskScore?: number; notes: string };
  sdoh: { expectedHasBarrier: boolean | null; notes: string };
  actionPlanner: { notes: string };
}
interface FixtureLabels {
  _meta: {
    description: string;
    heldOutRows: string[];
    labelingRules?: unknown;
  };
  patients: FixturePatientRow[];
}

function fixtureLabels(): FixtureLabels {
  return {
    _meta: {
      description: 'eval.test.ts fixture',
      heldOutRows: ['held-out-1'],
    },
    patients: [
      {
        patientId: 'dev-1',
        source: 'dev',
        clinicianOverride: null,
        careGap: { expectedHasGap: true, notes: 'fixture careGap notes' },
        risk: { expectedHighRisk: false, seedRiskScore: 50, notes: 'fixture risk notes' },
        sdoh: { expectedHasBarrier: false, notes: 'fixture sdoh notes' },
        actionPlanner: { notes: 'fixture' },
      },
      {
        patientId: 'held-out-1',
        source: 'dev',
        clinicianOverride: null,
        careGap: { expectedHasGap: true, notes: 'held-out fixture careGap notes' },
        risk: { expectedHighRisk: false, seedRiskScore: 40, notes: 'held-out fixture risk notes' },
        sdoh: { expectedHasBarrier: false, notes: 'held-out fixture sdoh notes' },
        actionPlanner: { notes: 'held-out fixture' },
      },
    ],
  };
}

function writeJson(p: string, obj: unknown): void {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
}

/** Cache row shape that round-trips through readAnalysisCache / fromCache.
 * Matches the post-validateCitations `AnalysisResultJson` shape that
 * `fromCache()` reads in scripts/eval.ts. */
function fixtureCacheRow(patientId: string) {
  return {
    patientId,
    resultJson: {
      careGap: { findings: [] },
      risk: { complete: { riskLevel: 'moderate' } },
      sdoh: { findings: [] },
      actionPlanner: { tasks: [] },
    },
    modelVersion: 'test-fixture',
    createdTs: '2026-07-08T00:00:00.000Z',
  };
}

/** A bundle that produces a stable `labelFromBundle` result for the held-out
 * patient: E11.9 Condition present, no HbA1c Observation → careGap=true.
 * Risk/sdoh are null (no Encounter / no AHC-HRSN Obs). That's enough for
 * these structural tests; we only assert on section presence, not metrics. */
function stubHeldOutBundle(): PatientBundle {
  return {
    resources: [
      {
        resourceType: 'Condition',
        id: 'cond-fixture',
        code: {
          coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9' }],
          text: 'E11.9',
        },
        subject: { reference: 'Patient/held-out-1' },
      },
    ],
    validIds: new Set(['Condition/cond-fixture']),
  };
}

// --- Tests ---------------------------------------------------------------

describe('eval harness — S15 commit 3 (three-section layout + CLI flags)', () => {
  let tmpDir: string;
  let db: Database.Database;
  let fhirService: FhirReadService;
  let getPatientBundleMock: jest.Mock;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caresync-eval-'));
    db = new Database(':memory:');
    migrate(db);
    writeAnalysisCache(db, fixtureCacheRow('dev-1'));
    writeAnalysisCache(db, fixtureCacheRow('held-out-1'));

    // Real FhirReadService instance + spied getPatientBundle. The
    // fhirService constructor takes (db, baseUrl) — the baseUrl is never
    // hit because we mock the method before any fetch happens.
    fhirService = new FhirReadService(db, 'http://stub.invalid/fhir');
    getPatientBundleMock = jest.fn().mockResolvedValue(stubHeldOutBundle());
    jest.spyOn(fhirService, 'getPatientBundle').mockImplementation(getPatientBundleMock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeLabelsPath(): string {
    const labelsPath = path.join(tmpDir, 'labels.json');
    writeJson(labelsPath, fixtureLabels());
    return labelsPath;
  }

  function baseOpts(labelsPath: string, extra: Partial<EvalOptions> = {}): EvalOptions {
    return {
      labelsPath,
      db,
      fhirService,
      ...extra,
    };
  }

  it('--no-live --dev-only: renders dev-labeled baseline, renders held-out placeholder, skips held-out bundle fetch', async () => {
    const { markdown } = await runHarness(
      baseOpts(makeLabelsPath(), { noLive: true, devOnly: true })
    );

    // Dev-labeled section renders with real data.
    expect(markdown).toMatch(/Dev-labeled baseline/);
    // Held-out section header is present but its body is the
    // --dev-only placeholder (the implementation plan explicitly allows
    // this in the test contract — "does NOT contain 'Held-out evaluation'
    // header (or contains the 'not run' placeholder)").
    expect(markdown).toMatch(/--dev-only flag passed/);
    // The held-out loop is skipped entirely → no bundle fetch.
    expect(getPatientBundleMock).not.toHaveBeenCalled();
  });

  it('--no-live --held-out-only: renders held-out evaluation, renders dev-labeled placeholder, fetches bundle for labelFromBundle', async () => {
    const { markdown } = await runHarness(
      baseOpts(makeLabelsPath(), { noLive: true, heldOutOnly: true })
    );

    // Held-out section renders with real data.
    expect(markdown).toMatch(/Held-out evaluation/);
    // Dev-labeled section body is the --held-out-only placeholder.
    expect(markdown).toMatch(/--held-out-only flag passed/);
    // Held-out path requires bundle fetch for labelFromBundle → mock called.
    expect(getPatientBundleMock).toHaveBeenCalled();
  });

  it('--no-live (no cohort flags): renders both dev-labeled and held-out sections fully', async () => {
    const { markdown } = await runHarness(
      baseOpts(makeLabelsPath(), { noLive: true })
    );

    // Both sections render with real data.
    expect(markdown).toMatch(/Dev-labeled baseline/);
    expect(markdown).toMatch(/Held-out evaluation/);
    // Neither placeholder should appear when both cohorts ran.
    expect(markdown).not.toMatch(/--dev-only flag passed/);
    expect(markdown).not.toMatch(/--held-out-only flag passed/);
    // Held-out bundle was fetched for labelFromBundle.
    expect(getPatientBundleMock).toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------------
// S18 WSA — cost aggregation TDD pins
//
// `computePatientCost` + `emitCostSidecar` + `renderCostSection` are the
// three pure helpers that turn a Map<patientId, Map<agentId, UsageRecord>>
// into per-patient cost records, a sidecar JSON artifact, and a markdown
// Cost section. These tests pin the math + the null-handling contract
// (`null` cells render as `—`, never as fabricated `$0.00` per
// `never-override-real-with-fake.md`).
// -------------------------------------------------------------------------

describe('S18 WSA — cost aggregation (computePatientCost / emitCostSidecar / renderCostSection)', () => {
  it('computePatientCost returns per-agent cost + per-patient totals from a Map<agentId, UsageRecord>', () => {
    const agentMap = new Map<AgentId, { inputTokens: number; outputTokens: number; totalTokens: number }>();
    agentMap.set('risk',          { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 });
    agentMap.set('careGap',       { inputTokens: 1100, outputTokens: 180, totalTokens: 1280 });
    agentMap.set('sdoh',          { inputTokens: 900,  outputTokens: 220, totalTokens: 1120 });
    agentMap.set('actionPlanner', { inputTokens: 800,  outputTokens: 150, totalTokens: 950  });

    const result = computePatientCost('maria-chen', agentMap, 'gpt-5.5');

    expect(result.patientId).toBe('maria-chen');
    // risk: 1000/1000*0.025 + 200/1000*0.10 = 0.025 + 0.020 = 0.045
    expect(result.agents.find((a) => a.agentId === 'risk')!.costUsd).toBe(0.045);
    // careGap: 1100/1000*0.025 + 180/1000*0.10 = 0.0275 + 0.018 = 0.0455
    expect(result.agents.find((a) => a.agentId === 'careGap')!.costUsd).toBe(0.0455);
    // aggregate totals (sum of all 4 agents)
    expect(result.totalInputTokens).toBe(3800);
    expect(result.totalOutputTokens).toBe(750);
  });

  it('computePatientCost renders null cost for an unknown model (NOT fabricated $0.00)', () => {
    const agentMap = new Map();
    agentMap.set('risk', { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 });

    const result = computePatientCost('test-patient', agentMap, 'unknown-model-xyz');

    // The risk cell's costUsd is null (computeCostUsd returned null),
    // NOT 0. This is the never-override-real-with-fake invariant — when
    // we don't know the rate, we say so.
    expect(result.agents[0].costUsd).toBeNull();
  });

  it('emitCostSidecar writes a valid JSON artifact with aggregate totals', () => {
    const usages = new Map<string, Map<AgentId, { inputTokens: number; outputTokens: number; totalTokens: number }>>();
    const mariaMap = new Map<AgentId, { inputTokens: number; outputTokens: number; totalTokens: number }>();
    mariaMap.set('risk',    { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 });
    mariaMap.set('careGap', { inputTokens: 1100, outputTokens: 180, totalTokens: 1280 });
    mariaMap.set('sdoh',    { inputTokens: 900,  outputTokens: 220, totalTokens: 1120 });
    mariaMap.set('actionPlanner', { inputTokens: 800, outputTokens: 150, totalTokens: 950 });
    usages.set('maria-chen', mariaMap);

    const jamesMap = new Map<AgentId, { inputTokens: number; outputTokens: number; totalTokens: number }>();
    jamesMap.set('risk',    { inputTokens: 800, outputTokens: 100, totalTokens: 900 });
    jamesMap.set('careGap', { inputTokens: 900, outputTokens: 80,  totalTokens: 980 });
    jamesMap.set('sdoh',    { inputTokens: 700, outputTokens: 110, totalTokens: 810 });
    jamesMap.set('actionPlanner', { inputTokens: 600, outputTokens: 90,  totalTokens: 690 });
    usages.set('james-okafor', jamesMap);

    const tmpPath = path.join(os.tmpdir(), `caresync-cost-${Date.now()}.json`);
    const result = emitCostSidecar(usages, 'gpt-5.5', tmpPath);

    expect(fs.existsSync(tmpPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
    expect(written.model).toBe('gpt-5.5');
    expect(written.patients).toHaveLength(2);
    expect(written.patients[0].patientId).toBe('maria-chen');
    expect(written.patients[1].patientId).toBe('james-okafor');
    // aggregate is the sum of both patients' costs, divided by patient count
    expect(written.aggregate.costPerPatient).toBeGreaterThan(0);
    expect(result.totalCostUsd).toBeGreaterThan(0);

    fs.unlinkSync(tmpPath);
  });

  it('renderCostSection produces a markdown Cost section with per-agent lines and a cohort total', () => {
    const cost: CostSummary = {
      totalCostUsd: 0.18,
      costPerPatient: 0.09,
      patients: [
        {
          patientId: 'maria-chen',
          agents: [
            { agentId: 'risk',          usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 }, costUsd: 0.045 },
            { agentId: 'careGap',       usage: { inputTokens: 1100, outputTokens: 180, totalTokens: 1280 }, costUsd: 0.0455 },
          ],
          totalInputTokens: 2100, totalOutputTokens: 380,
        },
        {
          patientId: 'james-okafor',
          agents: [
            { agentId: 'risk',          usage: { inputTokens: 800, outputTokens: 100, totalTokens: 900 }, costUsd: 0.03 },
            { agentId: 'careGap',       usage: { inputTokens: 900, outputTokens: 80,  totalTokens: 980 }, costUsd: 0.0315 },
          ],
          totalInputTokens: 1700, totalOutputTokens: 180,
        },
      ],
    };

    const md = renderCostSection(cost, 'gpt-5.5');
    expect(md).toMatch(/## Cost per analysis \(gpt-5\.5\)/);
    expect(md).toMatch(/risk.*\$/);
    expect(md).toMatch(/careGap.*\$/);
    expect(md).toMatch(/Total: \$/);
    expect(md).toMatch(/1000-patient monthly cohort/);
  });

  it('renderCostSection omits agent rows with null costUsd (null-safety in markdown)', () => {
    // Unknown model → all cells are null. Section should still render a
    // header (so the section is present in the eval-report and the gap is
    // visible) but no per-agent rows with $ values.
    const cost: CostSummary = {
      totalCostUsd: 0,
      costPerPatient: 0,
      patients: [
        {
          patientId: 'test',
          agents: [
            { agentId: 'risk', usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 }, costUsd: null },
          ],
          totalInputTokens: 0, totalOutputTokens: 0,
        },
      ],
    };

    const md = renderCostSection(cost, 'unknown-model');
    expect(md).toMatch(/## Cost per analysis/);
    // No dollar amounts in the body when all costs are null.
    expect(md).not.toMatch(/Total: \$/);
  });
});