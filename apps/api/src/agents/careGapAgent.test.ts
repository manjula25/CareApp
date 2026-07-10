import { runCareGapAgent } from './careGapAgent';
import { AgentEvent, CareGapOutput } from './agent';

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

describe('runCareGapAgent (mocked OpenAI client, no live call)', () => {
  const bundle = {
    resources: [
      { resourceType: 'CarePlan', id: 'maria-chen-dm-plan' },
      { resourceType: 'Observation', id: 'maria-chen-a1c' },
    ],
    validIds: new Set(['CarePlan/maria-chen-dm-plan', 'Observation/maria-chen-a1c']),
  };

  it('yields token events (self-tagged agentId:careGap), then a final result event with the parsed CareGapOutput citing a bundle resource', async () => {
    const output: CareGapOutput = {
      gaps: [
        {
          gapType: 'HbA1c monitoring',
          description: 'No HbA1c recorded in the past 6 months for a diabetic patient.',
          lastDone: '2025-11-01',
          dueDate: '2026-05-01',
          urgency: 'high',
          fhirResourceId: 'Observation/maria-chen-a1c',
          confidence: 0.5,
        },
      ],
    };
    const createFn = jest.fn().mockResolvedValue(
      fakeStream(
        ['Reviewing care plan', ' and recent labs...'],
        [{ type: 'function_call', call_id: 'call_1', name: 'report_care_gaps', arguments: JSON.stringify(output) }]
      )
    );
    const fakeClient = { responses: { create: createFn } } as any;

    const events: AgentEvent[] = [];
    for await (const event of runCareGapAgent(bundle, fakeClient)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'token', agentId: 'careGap', text: 'Reviewing care plan' },
      { type: 'token', agentId: 'careGap', text: ' and recent labs...' },
      { type: 'result', agentId: 'careGap', output },
    ]);
    expect(bundle.validIds.has(output.gaps[0].fhirResourceId)).toBe(true);
  });

  it('calls the client with gpt-5.5, streaming, and a report_care_gaps tool', async () => {
    const createFn = jest.fn().mockResolvedValue(
      fakeStream([], [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'report_care_gaps',
          arguments: JSON.stringify({ gaps: [] }),
        },
      ])
    );
    const fakeClient = { responses: { create: createFn } } as any;

    for await (const _event of runCareGapAgent(bundle, fakeClient)) {
      // drain
    }

    expect(createFn).toHaveBeenCalledTimes(1);
    const params = createFn.mock.calls[0][0];
    expect(params.model).toBe('gpt-5.5');
    expect(params.stream).toBe(true);
    expect(params.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'function', name: 'report_care_gaps' })])
    );
  });

  it('throws if the model never calls report_care_gaps', async () => {
    const createFn = jest.fn().mockResolvedValue(fakeStream(['no tool use here'], []));
    const fakeClient = { responses: { create: createFn } } as any;

    await expect(async () => {
      for await (const _event of runCareGapAgent(bundle, fakeClient)) {
        // drain
      }
    }).rejects.toThrow();
  });
});

// S20 — fallback path. Mirrors the S20 risk-agent test: the citation gate
// (routes/analysis.ts:358) requires every `gaps[].fhirResourceId` to be in
// `bundle.validIds`, so the demo fallback must derive gaps from real bundle
// Conditions instead of MOCK_CARE_GAP_OUTPUT's hard-coded ids.
describe('runCareGapAgent (S20 — fallback, OPENAI_API_KEY unset)', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it('S20 — fallback gaps cite real bundle Condition ids', async () => {
    delete process.env.OPENAI_API_KEY;
    let freshRunCareGapAgent!: typeof runCareGapAgent;
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./careGapAgent');
      freshRunCareGapAgent = fresh.runCareGapAgent;
    });

    const testBundle = {
      resources: [
        { resourceType: 'Condition', id: 'maria-chen-chf', code: { text: 'Heart failure, unspecified' } },
        { resourceType: 'Condition', id: 'maria-chen-t2dm', code: { text: 'Type 2 diabetes mellitus' } },
      ],
      validIds: new Set(['Condition/maria-chen-chf', 'Condition/maria-chen-t2dm']),
    };

    const events: AgentEvent[] = [];
    for await (const event of freshRunCareGapAgent(testBundle)) {
      events.push(event);
    }

    const result = events.find((e) => e.type === 'result') as Extract<
      AgentEvent,
      { type: 'result'; agentId: 'careGap' }
    >;
    expect(result.output.gaps.length).toBeGreaterThan(0);
    for (const gap of result.output.gaps) {
      expect(testBundle.validIds.has(gap.fhirResourceId)).toBe(true);
    }
  });

  it('S20 — fallback with empty bundle emits zero gaps (honest demo)', async () => {
    delete process.env.OPENAI_API_KEY;
    let freshRunCareGapAgent!: typeof runCareGapAgent;
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./careGapAgent');
      freshRunCareGapAgent = fresh.runCareGapAgent;
    });

    const events: AgentEvent[] = [];
    for await (const event of freshRunCareGapAgent({ resources: [], validIds: new Set<string>() })) {
      events.push(event);
    }

    const result = events.find((e) => e.type === 'result') as Extract<
      AgentEvent,
      { type: 'result'; agentId: 'careGap' }
    >;
    expect(result.output.gaps).toEqual([]);
  });
});
