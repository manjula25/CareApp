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
import { runHarness, EvalOptions } from './eval';

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