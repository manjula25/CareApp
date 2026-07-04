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
