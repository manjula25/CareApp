import { runRiskAgent, buildPrompt, AgentEvent, RiskOutput } from './riskAgent';

describe('OpenAI client construction is lazy (boot-time safety)', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it('importing the module does not throw when OPENAI_API_KEY is unset', async () => {
    delete process.env.OPENAI_API_KEY;
    // If this constructs the OpenAI client eagerly at import time, it throws
    // here and fails the test — no assertion needed beyond letting it run.
    await jest.isolateModulesAsync(async () => {
      await import('./riskAgent');
    });
  });

  // S12 B.1 — when OPENAI_API_KEY is unset AND no client is injected, the
  // agent falls back to a deterministic offline `RiskOutput` rather than
  // throwing. Demo-resilience contract: the SSE stream must emit the right
  // event shape regardless of whether the OpenAI key is available.
  it('falls back to a deterministic RiskOutput when OPENAI_API_KEY is unset (no client injected)', async () => {
    delete process.env.OPENAI_API_KEY;
    let freshRunRiskAgent!: typeof runRiskAgent;
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./riskAgent');
      freshRunRiskAgent = fresh.runRiskAgent;
    });

    const bundle = { resources: [], validIds: new Set<string>() };
    const events: AgentEvent[] = [];
    for await (const event of freshRunRiskAgent(bundle)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('token');
    expect(events[0].agentId).toBe('risk');
    expect(events[1].type).toBe('result');
    expect((events[1] as Extract<AgentEvent, { type: 'result' }>).output).toMatchObject({
      riskScore: expect.any(Number),
      riskLevel: expect.stringMatching(/low|moderate|high|critical/),
      flags: expect.any(Array),
      readmissionProbability: expect.any(Number),
    });
  });

  // S20 — fallback emits flags citing real bundle resources so the citation
  // gate (routes/analysis.ts:333) keeps them. With an empty bundle there is
  // nothing to cite, so flags must be honest-empty (not the old MOCK list
  // with fabricated ids that all get dropped).
  it('S20 — fallback flags cite real bundle Condition/Observation ids (no fabricated citations)', async () => {
    delete process.env.OPENAI_API_KEY;
    let freshRunRiskAgent!: typeof runRiskAgent;
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./riskAgent');
      freshRunRiskAgent = fresh.runRiskAgent;
    });

    const bundle = {
      resources: [
        { resourceType: 'Condition', id: 'maria-chen-chf', code: { text: 'Heart failure, unspecified' } },
        { resourceType: 'Observation', id: 'maria-chen-bnp', code: { text: 'BNP' } },
        { resourceType: 'Patient', id: 'maria-chen' },
      ],
      validIds: new Set(['Condition/maria-chen-chf', 'Observation/maria-chen-bnp', 'Patient/maria-chen']),
    };

    const events: AgentEvent[] = [];
    for await (const event of freshRunRiskAgent(bundle)) {
      events.push(event);
    }

    const result = events.find((e) => e.type === 'result') as Extract<
      AgentEvent,
      { type: 'result'; agentId: 'risk' }
    >;
    const flags = result.output.flags;
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(bundle.validIds.has(flag.fhirResourceId)).toBe(true);
    }
    // Posture fields still come from MOCK_RISK_OUTPUT — demo narrative stable.
    expect(result.output.riskScore).toBeGreaterThan(0);
    expect(['low', 'moderate', 'high', 'critical']).toContain(result.output.riskLevel);
  });

  // S20 — empty bundle → honest empty flags (not fabricated ones).
  it('S20 — fallback with empty bundle emits zero flags (honest demo, not fabricated citations)', async () => {
    delete process.env.OPENAI_API_KEY;
    let freshRunRiskAgent!: typeof runRiskAgent;
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./riskAgent');
      freshRunRiskAgent = fresh.runRiskAgent;
    });

    const bundle = { resources: [], validIds: new Set<string>() };
    const events: AgentEvent[] = [];
    for await (const event of freshRunRiskAgent(bundle)) {
      events.push(event);
    }

    const result = events.find((e) => e.type === 'result') as Extract<
      AgentEvent,
      { type: 'result'; agentId: 'risk' }
    >;
    expect(result.output.flags).toEqual([]);
  });
});

// Fake OpenAI client — no network. Mimics the real SDK's `responses.create()`
// contract closely enough to unit-test the agent: a `stream: true` call
// returns an object that is async-iterable over typed Responses API events,
// narration via `response.output_text.delta` and the structured result via
// the final `response.completed` event's `.response.output` array.
function fakeStream(textDeltas: string[], finalOutput: any[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const text of textDeltas) {
        yield { type: 'response.output_text.delta', delta: text };
      }
      yield { type: 'response.completed', response: { output: finalOutput } };
    },
  };
}

describe('runRiskAgent (B1 revised — mocked OpenAI client, no live call)', () => {
  const bundle = {
    resources: [
      { resourceType: 'Condition', id: 'maria-chen-chf' },
      { resourceType: 'Observation', id: 'maria-chen-bnp' },
    ],
    validIds: new Set(['Condition/maria-chen-chf', 'Observation/maria-chen-bnp']),
  };

  it('yields token events (self-tagged agentId:risk) for streamed text, then a final result event with the parsed RiskOutput', async () => {
    const output: RiskOutput = {
      riskScore: 87,
      riskLevel: 'critical',
      flags: [{ text: 'Elevated BNP consistent with CHF exacerbation', fhirResourceId: 'Observation/maria-chen-bnp', confidence: 0.5 }],
      readmissionProbability: 0.62,
    };
    const createFn = jest.fn().mockResolvedValue(
      fakeStream(
        ['Analyzing recent labs', ' and active conditions...'],
        [{ type: 'function_call', call_id: 'call_1', name: 'report_risk', arguments: JSON.stringify(output) }]
      )
    );
    const fakeClient = { responses: { create: createFn } } as any;

    const events: AgentEvent[] = [];
    for await (const event of runRiskAgent(bundle, fakeClient)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'token', agentId: 'risk', text: 'Analyzing recent labs' },
      { type: 'token', agentId: 'risk', text: ' and active conditions...' },
      { type: 'result', agentId: 'risk', output },
    ]);
  });

  it('calls the client with gpt-5.5, streaming, and a report_risk tool', async () => {
    const createFn = jest.fn().mockResolvedValue(
      fakeStream([], [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'report_risk',
          arguments: JSON.stringify({ riskScore: 10, riskLevel: 'low', flags: [], readmissionProbability: 0.1 }),
        },
      ])
    );
    const fakeClient = { responses: { create: createFn } } as any;

    for await (const _event of runRiskAgent(bundle, fakeClient)) {
      // drain
    }

    expect(createFn).toHaveBeenCalledTimes(1);
    const params = createFn.mock.calls[0][0];
    expect(params.model).toBe('gpt-5.5');
    expect(params.stream).toBe(true);
    expect(params.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'function', name: 'report_risk' })])
    );
  });

  it('throws if the model never calls report_risk', async () => {
    const createFn = jest.fn().mockResolvedValue(fakeStream(['no tool use here'], []));
    const fakeClient = { responses: { create: createFn } } as any;

    await expect(async () => {
      for await (const _event of runRiskAgent(bundle, fakeClient)) {
        // drain
      }
    }).rejects.toThrow();
  });
});

// S13 A2 — TDD pins on `buildPrompt`'s structural properties. The agent's
// classification comes from the LLM (non-deterministic), so TDD can't pin
// "patient X gets riskLevel=high" — but it CAN pin that the prompt preserves
// the citation requirement (GD11 regression guard) and the bundle's
// resource grounding (regression guard). These are the load-bearing
// properties — if any silently regress, the agent falls back to training-
// data priors or hallucinates citations, breaking G3 / G4.
//
// History note (S13b): this `describe` block previously pinned a 3-anchor
// rubric that mirrored `riskScoreFor()` ≥ 75. Live re-eval showed the
// rubric caused the model to over-call (every patient including no-evidence
// ones got `riskLevel: 'critical'` — specificity 30.8% → 0%). The rubric
// was reverted. The two survival tests below are the load-bearing
// properties the prompt MUST keep, regardless of future calibration work.
describe('buildPrompt (S13 — structural surface)', () => {
  const fixtureBundle = {
    resources: [
      { resourceType: 'Condition', id: 'fixture-cond-1' },
      { resourceType: 'Encounter', id: 'fixture-enc-1' },
      { resourceType: 'Observation', id: 'fixture-obs-1' },
    ],
    validIds: new Set([
      'Condition/fixture-cond-1',
      'Encounter/fixture-enc-1',
      'Observation/fixture-obs-1',
    ]),
  };

  // A2.1 (formerly rubric-anchors) — REMOVED. The rubric itself was reverted
  // after live re-eval showed it caused the model to over-call. See the
  // JSDoc on `buildPrompt` and verification-s13.md §3.

  // A2.2 (formerly threshold text) — REMOVED. Same reason as A2.1.

  // A2.3 — GD11 regression guard. The prompt must keep the citation
  // requirement intact (Risk agent's core architectural innovation — see
  // `P4 Trust/Safety` evidence in `HL7-Challenge-Evaluation.md`). If this
  // test fails, a future edit to `buildPrompt` has dropped the citation
  // contract and the eval's confusion matrix can no longer be trusted.
  it('buildPrompt preserves the citation requirement (GD11 regression guard)', () => {
    const prompt = buildPrompt(fixtureBundle);
    expect(prompt).toContain('fhirResourceId');
    expect(prompt.toLowerCase()).toContain('fabricated citations');
  });

  // A2.4 — grounding regression guard. The prompt must keep embedding the
  // bundle's resources. If a future edit drops or hardcodes the resource
  // list, the agent stops reasoning from the actual FHIR data and falls
  // back to priors — same over-calling failure mode that the S13 rubric
  // hit, but at the data layer instead.
  it('buildPrompt embeds the bundle resources (grounding regression guard)', () => {
    const prompt = buildPrompt(fixtureBundle);
    expect(prompt).toContain('Condition/fixture-cond-1');
    expect(prompt).toContain('Encounter/fixture-enc-1');
    expect(prompt).toContain('Observation/fixture-obs-1');
  });

  // S16 Commit 3 + S17 — v3 rubric structure (updated TDD pins).
  // The 3 anchors + Rule 1 (0 anchors → low) + Rule 2 (anchor-to-level
  // mapping) + 5 worked examples are the load-bearing v3 structure. If
  // any future edit silently drops one of these, the rubric regresses to
  // either the S13b 1-paragraph form or a partial v2/v3 — either way,
  // the S13 over-call failure mode returns.
  it('buildPrompt lists the 3 calibration anchors verbatim (S16 commit 3)', () => {
    const prompt = buildPrompt(fixtureBundle);
    expect(prompt).toContain('Anchor A: Multi-condition comorbidity');
    expect(prompt).toContain('Anchor B: Recent inpatient discharge');
    expect(prompt).toContain('Anchor C: Abnormal labs');
  });

  it('buildPrompt enforces the "0 anchors → low" hard rule (S16 commit 3)', () => {
    const prompt = buildPrompt(fixtureBundle);
    expect(prompt).toContain("0 anchors met is ALWAYS riskLevel='low'");
  });

  it('buildPrompt enforces the anchor-to-level mapping Rule 2 (S17)', () => {
    const prompt = buildPrompt(fixtureBundle);
    expect(prompt).toContain("Rule 2: Anchor-to-level mapping");
    expect(prompt).toContain("1 anchor met  → ALWAYS 'moderate'");
    expect(prompt).toContain("2 anchors met → 'high' ONLY if Anchor C");
    expect(prompt).toContain("3 anchors met → 'critical'");
  });

  it('buildPrompt includes 5 worked examples using actual seed-text bundle shapes (S17)', () => {
    const prompt = buildPrompt(fixtureBundle);
    expect(prompt).toContain('Example 1 (0 anchors, non-anchor condition');
    expect(prompt).toContain('Example 2 (0 anchors, single anchor-set condition');
    expect(prompt).toContain('Example 3 (1 anchor → moderate)');
    expect(prompt).toContain('Example 4 (3 anchors → critical)');
    expect(prompt).toContain('Example 5 (2 anchors WITHOUT abnormal labs');
    // Seed-text patient IDs the v3 worked examples reference:
    // Example 1 = james-okafor (COPD only, not in anchor set)
    // Example 2 = linda-torres (CKD only, single anchor-set condition)
    // Example 3 = maria-chen (CHF + elevated BNP, 1 anchor)
    // Example 4 = synthetic bob (3 anchors → critical)
    // Example 5 = pop-0004 (2 anchors without labs → moderate)
    expect(prompt).toContain('james-okafor');
    expect(prompt).toContain('linda-torres');
    expect(prompt).toContain('maria-chen');
    expect(prompt).toContain('pop-0004');
  });
});
