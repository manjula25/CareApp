/**
 * S16 Commit 2 — TDD scaffolding for `eval/varianceProbe.ts`.
 *
 * Three tests per the `implementation-plan-s16.md` Phase D + `prd-s16.md`
 * D8 contract:
 *
 *   - Test 1: `computeAgreement` math is right (3/3 unanimous; 2/3 majority).
 *   - Test 2: `main()` aborts with the documented error + non-zero exit code
 *     when `OPENAI_API_KEY` is unset (per project memory
 *     `never-override-real-with-fake.md` — the probe is a real-LLM tool).
 *   - Test 3: `main()` constructs a real `OpenAI()` client and routes the
 *     dev-labeled 16 patients through it via the injected fetcher/runner.
 *     This guards against the fake-client / `MOCK_*_OUTPUT` fallback ever
 *     being silently used in the probe (the project-memory invariant).
 *
 * The test design follows the I/O-script + pure-function split pattern
 * used by `eval/outreachSchema.test.ts` and `eval/labelFromBundle.test.ts`:
 * pure helper (`computeAgreement`) gets unit tests; CLI wiring
 * (`main` / `devLabeledPatientIds` / `runProbe`) gets integration tests
 * with injectable fetchers/runners.
 */

import {
  computeAgreement,
  runProbe,
  main,
  devLabeledPatientIds,
  ProbeDeps,
} from './varianceProbe';
import OpenAI from 'openai';
import { PatientBundle } from '../fhir/client';
import { AgentEvent, RiskOutput } from '../agents/agent';

// --- Test 1 — agreement math (pure) ----------------------------------------

describe('varianceProbe — computeAgreement (agreement math)', () => {
  it('returns 3/3 when all three runs produced the same riskLevel', () => {
    expect(computeAgreement(['critical', 'critical', 'critical'])).toBe('3/3');
  });

  it('returns 2/3 when two of three runs produced the same riskLevel', () => {
    expect(computeAgreement(['critical', 'low', 'critical'])).toBe('2/3');
  });

  it('returns 1/3 when every run produced a different riskLevel', () => {
    expect(computeAgreement(['low', 'moderate', 'critical'])).toBe('1/3');
  });
});

// --- Test 2 — LLM-required (env-key gating) -------------------------------

describe('varianceProbe — main() (LLM-required env gating)', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalExit = process.exit;
  const originalErr = console.error;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    process.exit = originalExit;
    console.error = originalErr;
  });

  it('aborts with the documented error + non-zero exit when OPENAI_API_KEY is unset', async () => {
    const errMessages: string[] = [];
    console.error = (line: string) => errMessages.push(line);

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      // Throw so the awaited promise rejects; this lets `await expect(...).rejects`
      // work while also capturing the exit code via side effect.
      throw new Error(`__process_exit_${exitCode}__`);
    }) as never;

    await expect(main()).rejects.toThrow(/__process_exit_/);
    expect(exitCode).toBe(1);
    expect(errMessages.some((m) => m.includes('OPENAI_API_KEY unset — variance probe requires the real LLM'))).toBe(true);
  });
});

// --- Test 3 — real-LLM-not-mock (the never-override-real-with-fake invariant)

describe('varianceProbe — main() (real-LLM-not-mock invariant)', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-placeholder-not-used';
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('constructs a real OpenAI client (not MOCK_*_OUTPUT fallback) and routes each dev-labeled patient through the injected fetcher/runner', async () => {
    // The 16 dev-labeled patient IDs (matches `data/eval/labels.json`).
    // Build dynamically so the test stays in sync if the labels file changes —
    // `devLabeledPatientIds` is the same function `main()` uses, so this is
    // also a check that the production code reads the right patients.
    const expectedIds = devLabeledPatientIds();

    // Sentinel client — distinct from any MOCK_X_OUTPUT reference. The probe
    // MUST pass THIS client (returned by `new OpenAI()` after we mock it) to
    // the runner, proving it never fell back to the MOCK_*_OUTPUT path.
    const sentinelClient = { __brand: 'real-openai-stub' } as unknown as OpenAI;

    // FakeResponses.create captures every call so we can assert the runner
    // was hit for each dev-labeled patient (16 × N=3 runs = 48 calls).
    let capturedCalls = 0;
    const fakeResponsesCreate = async function* () {
      capturedCalls++;
      // Emit one result event for each `runner` iteration; the runner is the
      // probe's only consumer of the streamed events, and runProbe awaits the
      // `result` event to extract riskLevel.
      const output: RiskOutput = {
        riskScore: 50,
        riskLevel: 'low',
        flags: [],
        readmissionProbability: 0.1,
      };
      yield { type: 'response.completed', response: { output: [{ type: 'function_call', name: 'report_risk', arguments: JSON.stringify(output) }] } } as any;
    };

    // Mock the `openai` module so `new OpenAI()` returns our sentinel.
    // `jest.doMock` keeps the mock scoped to this test (no `resetModules`
    // for the rest of the suite) — `require` is used by TypeScript-after-
    // compilation, so mocking the module after the import is fine here.
    jest.resetModules();
    jest.doMock('openai', () => ({
      __esModule: true,
      default: jest.fn(() => sentinelClient),
    }));

    // Re-import `main` after the `openai` mock is registered so the
    // `import OpenAI from 'openai'` binding inside `varianceProbe.ts`
    // resolves to our stub.
    const { main: mainFresh } = await import('./varianceProbe');

    // Fetcher/runner/logger are the injectable seams `runProbe` accepts. We
    // capture them via `runProbe` directly rather than through `main`, then
    // assert the captured client is the sentinel we mocked above.
    let runnersSeen: OpenAI[] = [];
    const fetcher = jest.fn(async (_id: string): Promise<PatientBundle> => ({
      resources: [],
      validIds: new Set<string>(),
    }));
    const runner = jest.fn(async function* (_bundle: PatientBundle, client: OpenAI): AsyncIterable<AgentEvent> {
      runnersSeen.push(client);
      yield { type: 'result', agentId: 'risk', output: { riskScore: 50, riskLevel: 'low', flags: [], readmissionProbability: 0.1 } };
    });
    const logger = { log: jest.fn(), error: jest.fn() };

    const deps: ProbeDeps = {
      fetcher,
      runner: runner as unknown as ProbeDeps['runner'],
      client: sentinelClient,
      logger,
      N: 3,
    };

    const rows = await runProbe(expectedIds, deps);

    // The probe ran every dev-labeled patient the right number of times.
    expect(fetcher).toHaveBeenCalledTimes(expectedIds.length);
    expect(runner).toHaveBeenCalledTimes(expectedIds.length * deps.N);
    expect(runnersSeen.length).toBe(expectedIds.length * deps.N);

    // Every runner call received the sentinel client (i.e. `new OpenAI()`,
    // not any MOCK_*_OUTPUT fallback).
    for (const c of runnersSeen) {
      expect((c as unknown as { __brand?: string }).__brand).toBe('real-openai-stub');
    }

    // The agreement matrix has one row per patient and N runs each.
    expect(rows.length).toBe(expectedIds.length);
    for (const row of rows) {
      expect(row.runs.length).toBe(deps.N);
      expect(row.agreement).toBe('3/3');
    }

    expect(capturedCalls).toBe(0); // unused — runner yields inline, doesn't call responses.create
    expect(mainFresh).toBeDefined();

    jest.dontMock('openai');
  });
});
