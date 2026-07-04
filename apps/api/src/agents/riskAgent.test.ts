import { runRiskAgent, AgentEvent, RiskOutput } from './riskAgent';

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

  it('only throws once the agent is actually invoked without an explicit client', async () => {
    delete process.env.OPENAI_API_KEY;
    let freshRunRiskAgent!: typeof runRiskAgent;
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./riskAgent');
      freshRunRiskAgent = fresh.runRiskAgent;
    });

    const bundle = { resources: [], validIds: new Set<string>() };
    await expect(async () => {
      for await (const _event of freshRunRiskAgent(bundle)) {
        // drain
      }
    }).rejects.toThrow();
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

  it('yields token events for streamed text, then a final result event with the parsed RiskOutput', async () => {
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
      { type: 'token', text: 'Analyzing recent labs' },
      { type: 'token', text: ' and active conditions...' },
      { type: 'result', output },
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
