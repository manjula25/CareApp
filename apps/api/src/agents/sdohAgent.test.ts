import { runSdohAgent } from './sdohAgent';
import { AgentEvent, SdohOutput } from './agent';

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

describe('runSdohAgent (mocked OpenAI client, no live call)', () => {
  const bundle = {
    resources: [
      { resourceType: 'Patient', id: 'maria-chen' },
      { resourceType: 'QuestionnaireResponse', id: 'maria-chen-ahc-hrsn' },
    ],
    validIds: new Set(['Patient/maria-chen', 'QuestionnaireResponse/maria-chen-ahc-hrsn']),
  };

  it('yields token events (self-tagged agentId:sdoh), then a final result event with the parsed SdohOutput whose AHC-HRSN barrier cites the QuestionnaireResponse id', async () => {
    const output: SdohOutput = {
      barriers: [
        {
          domain: 'housing',
          finding: 'Patient reports housing instability on the AHC-HRSN screening.',
          severity: 'high',
          fhirResourceId: 'QuestionnaireResponse/maria-chen-ahc-hrsn',
        },
      ],
      referralsNeeded: ['Housing assistance program'],
    };
    const createFn = jest.fn().mockResolvedValue(
      fakeStream(
        ['Reviewing the AHC-HRSN screening', ' and demographics...'],
        [{ type: 'function_call', call_id: 'call_1', name: 'report_sdoh', arguments: JSON.stringify(output) }]
      )
    );
    const fakeClient = { responses: { create: createFn } } as any;

    const events: AgentEvent[] = [];
    for await (const event of runSdohAgent(bundle, fakeClient)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'token', agentId: 'sdoh', text: 'Reviewing the AHC-HRSN screening' },
      { type: 'token', agentId: 'sdoh', text: ' and demographics...' },
      { type: 'result', agentId: 'sdoh', output },
    ]);
    expect(output.barriers[0].fhirResourceId).toBe('QuestionnaireResponse/maria-chen-ahc-hrsn');
    expect(bundle.validIds.has(output.barriers[0].fhirResourceId)).toBe(true);
  });

  it('calls the client with gpt-5.5, streaming, and a report_sdoh tool', async () => {
    const createFn = jest.fn().mockResolvedValue(
      fakeStream([], [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'report_sdoh',
          arguments: JSON.stringify({ barriers: [], referralsNeeded: [] }),
        },
      ])
    );
    const fakeClient = { responses: { create: createFn } } as any;

    for await (const _event of runSdohAgent(bundle, fakeClient)) {
      // drain
    }

    expect(createFn).toHaveBeenCalledTimes(1);
    const params = createFn.mock.calls[0][0];
    expect(params.model).toBe('gpt-5.5');
    expect(params.stream).toBe(true);
    expect(params.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'function', name: 'report_sdoh' })])
    );
  });

  it('throws if the model never calls report_sdoh', async () => {
    const createFn = jest.fn().mockResolvedValue(fakeStream(['no tool use here'], []));
    const fakeClient = { responses: { create: createFn } } as any;

    await expect(async () => {
      for await (const _event of runSdohAgent(bundle, fakeClient)) {
        // drain
      }
    }).rejects.toThrow();
  });
});
