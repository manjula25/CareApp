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
  // agent falls back to `MOCK_RISK_OUTPUT` rather than throwing. Demo-resilience
  // contract: the SSE stream must emit the right event shape regardless of
  // whether the OpenAI key is available.
  it('falls back to MOCK_RISK_OUTPUT when OPENAI_API_KEY is unset (no client injected)', async () => {
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
      flags: [{ text: 'Elevated BNP consistent with CHF exacerbation', fhirResourceId: 'Observation/maria-chen-bnp' }],
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
// "patient X gets riskLevel=high" — but it CAN pin that the prompt carries
// the calibration rubric (D3), the citation requirement (GD11, regression
// guard), and the bundle's resource grounding (regression guard). These
// are the load-bearing properties — if any silently regress, the
// calibration breaks without a test failure.
//
// Fixture bundle mirrors `riskScoreFor()`'s evidence: 2 chronic conditions,
// a recent inpatient encounter (enc-<id> class would be inpatient in real
// data; not modeled here at the schema level, but the Encounter resource
// line is included so the prompt's recency anchor has grounded text to
// find), and 3 Observations.
describe('buildPrompt (S13 — Risk rubric calibration)', () => {
  const rubricFixtureBundle = {
    resources: [
      { resourceType: 'Condition', id: 'fixture-cond-1' },
      { resourceType: 'Condition', id: 'fixture-cond-2' },
      { resourceType: 'Encounter', id: 'fixture-enc-1' },
      { resourceType: 'Observation', id: 'fixture-obs-1' },
      { resourceType: 'Observation', id: 'fixture-obs-2' },
      { resourceType: 'Observation', id: 'fixture-obs-3' },
    ],
    validIds: new Set([
      'Condition/fixture-cond-1',
      'Condition/fixture-cond-2',
      'Encounter/fixture-enc-1',
      'Observation/fixture-obs-1',
      'Observation/fixture-obs-2',
      'Observation/fixture-obs-3',
    ]),
  };

  // A2.1 — D3 rubric's three evidence anchors must all be present.
  it('buildPrompt includes the rubric anchors (multi-condition comorbidity, recent inpatient discharge, abnormal labs)', () => {
    const prompt = buildPrompt(rubricFixtureBundle);
    expect(prompt.toLowerCase()).toContain('multi-condition comorbidity');
    expect(prompt.toLowerCase()).toContain('recent inpatient discharge');
    expect(prompt.toLowerCase()).toContain('abnormal labs');
    // Lab thresholds: BNP >200, HbA1c >9.0, eGFR <30 — the calibration
    // target that mirrors `riskScoreFor()` ≥ 75.
    expect(prompt).toContain('BNP');
    expect(prompt).toContain('200');
    expect(prompt).toContain('HbA1c');
    expect(prompt).toContain('9.0');
    expect(prompt).toContain('eGFR');
    expect(prompt).toContain('30');
  });

  // A2.2 — the four risk-level tiers must be named explicitly in the rubric
  // and a count threshold must appear (so the model can't be ambiguous about
  // which bucket a patient falls into).
  it('buildPrompt includes the threshold text and all four risk-level tiers', () => {
    const prompt = buildPrompt(rubricFixtureBundle);
    expect(prompt).toContain('low');
    expect(prompt).toContain('moderate');
    expect(prompt).toContain('high');
    expect(prompt).toContain('critical');
    expect(prompt.toLowerCase()).toMatch(/at least 2|two or more|≥2/);
    expect(prompt).toContain('30 days');
  });

  // A2.3 — GD11 regression guard. The calibration must NOT displace the
  // citation requirement (Risk agent's core architectural innovation — see
  // `P4 Trust/Safety` evidence in `HL7-Challenge-Evaluation.md`).
  it('buildPrompt preserves the citation requirement (GD11 regression guard)', () => {
    const prompt = buildPrompt(rubricFixtureBundle);
    expect(prompt).toContain('fhirResourceId');
    expect(prompt.toLowerCase()).toContain('fabricated citations');
  });

  // A2.4 — grounding regression guard. The rubric must NOT displace the
  // bundle's resources; the agent still has to reason from the actual FHIR
  // data, not from training-data priors.
  it('buildPrompt embeds the bundle resources (grounding regression guard)', () => {
    const prompt = buildPrompt(rubricFixtureBundle);
    expect(prompt).toContain('Condition/fixture-cond-1');
    expect(prompt).toContain('Condition/fixture-cond-2');
    expect(prompt).toContain('Encounter/fixture-enc-1');
    // And one Observation by id to confirm the prompt is iterating
    // through the bundle rather than hardcoding a list.
    expect(prompt).toContain('Observation/fixture-obs-2');
  });
});
