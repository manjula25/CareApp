import { runActionPlannerAgent } from './actionPlannerAgent';
import { ActionPlannerOutput, AgentEvent, CareGapOutput, RiskOutput, SdohOutput } from './agent';

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

describe('runActionPlannerAgent (mocked OpenAI client, no live call)', () => {
  const risk: RiskOutput = {
    riskScore: 82,
    riskLevel: 'high',
    flags: [{ text: 'Recent CHF exacerbation', fhirResourceId: 'Condition/chf-1', confidence: 0.5 }],
    readmissionProbability: 0.4,
  };
  const careGap: CareGapOutput = {
    gaps: [
      {
        gapType: 'screening',
        description: 'Overdue A1c check',
        urgency: 'high',
        fhirResourceId: 'Observation/a1c-1',
        confidence: 0.5,
      },
    ],
  };
  const sdoh: SdohOutput = {
    barriers: [{ domain: 'housing', finding: 'Housing instability', severity: 'high', fhirResourceId: 'QuestionnaireResponse/ahc-hrsn-1', confidence: 0.5 }],
    referralsNeeded: ['Housing assistance program'],
  };
  const inputs = { risk, careGap, sdoh };

  const unionOfCitedIds = new Set(['Condition/chf-1', 'Observation/a1c-1', 'QuestionnaireResponse/ahc-hrsn-1']);

  it('yields token events (self-tagged agentId:actionPlanner), then a final result event with the parsed ActionPlannerOutput whose fhirResources are a subset of the union of the three inputs cited ids', async () => {
    const output: ActionPlannerOutput = {
      tasks: [
        {
          title: 'Schedule A1c recheck',
          description: 'Order and schedule overdue A1c lab.',
          priority: 'high',
          domain: 'clinical',
          assignTo: 'care coordinator',
          dueInDays: 7,
          fhirResources: ['Observation/a1c-1'],
          confidence: 0.5,
        },
        {
          title: 'Coordinate housing referral',
          description: 'Refer to housing assistance program given reported instability.',
          priority: 'critical',
          domain: 'sdoh',
          fhirResources: ['QuestionnaireResponse/ahc-hrsn-1', 'Condition/chf-1'],
          confidence: 0.5,
        },
      ],
    };
    const createFn = jest.fn().mockResolvedValue(
      fakeStream(
        ['Synthesizing risk, care gap,', ' and SDOH findings...'],
        [{ type: 'function_call', call_id: 'call_1', name: 'plan_tasks', arguments: JSON.stringify(output) }]
      )
    );
    const fakeClient = { responses: { create: createFn } } as any;

    const events: AgentEvent[] = [];
    for await (const event of runActionPlannerAgent(inputs, fakeClient)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'token', agentId: 'actionPlanner', text: 'Synthesizing risk, care gap,' },
      { type: 'token', agentId: 'actionPlanner', text: ' and SDOH findings...' },
      { type: 'result', agentId: 'actionPlanner', output },
    ]);

    const result = events[events.length - 1] as { type: 'result'; agentId: 'actionPlanner'; output: ActionPlannerOutput };
    const allCitedIds = result.output.tasks.flatMap((t) => t.fhirResources);
    const isSubset = allCitedIds.every((id) => unionOfCitedIds.has(id));
    expect(isSubset).toBe(true);
    expect(allCitedIds.length).toBeGreaterThan(0);
  });

  it('calls the client with gpt-5.5, streaming, and a plan_tasks tool, with the prompt built entirely from the three structured inputs (not a bundle)', async () => {
    const createFn = jest.fn().mockResolvedValue(
      fakeStream([], [{ type: 'function_call', call_id: 'call_1', name: 'plan_tasks', arguments: JSON.stringify({ tasks: [] }) }])
    );
    const fakeClient = { responses: { create: createFn } } as any;

    for await (const _event of runActionPlannerAgent(inputs, fakeClient)) {
      // drain
    }

    expect(createFn).toHaveBeenCalledTimes(1);
    const params = createFn.mock.calls[0][0];
    expect(params.model).toBe('gpt-5.5');
    expect(params.stream).toBe(true);
    expect(params.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function', name: 'plan_tasks' })]));

    // The prompt must be built from the three structured inputs, proving no
    // bundle is read: it should contain the risk score and each input's cited
    // fhirResourceId.
    expect(params.input).toContain(String(risk.riskScore));
    expect(params.input).toContain('Condition/chf-1');
    expect(params.input).toContain('Observation/a1c-1');
    expect(params.input).toContain('QuestionnaireResponse/ahc-hrsn-1');
  });

  it('throws if the model never calls plan_tasks', async () => {
    const createFn = jest.fn().mockResolvedValue(fakeStream(['no tool use here'], []));
    const fakeClient = { responses: { create: createFn } } as any;

    await expect(async () => {
      for await (const _event of runActionPlannerAgent(inputs, fakeClient)) {
        // drain
      }
    }).rejects.toThrow();
  });
});

// S20 — fallback path. Action Planner is downstream of the other three; it
// doesn't read the FHIR bundle directly. In fallback, the citation chain is
// transitive: tasks should cite the upstream agents' first flag, which the
// new `streamMock*` agents now derive from real bundle resources, so tasks
// pass the citation validator transitively.
describe('runActionPlannerAgent (S20 — fallback, OPENAI_API_KEY unset)', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it('S20 — fallback tasks cite first upstream finding from each of risk/careGap/sdoh (transitive real citations)', async () => {
    delete process.env.OPENAI_API_KEY;
    let freshRunActionPlannerAgent!: typeof runActionPlannerAgent;
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./actionPlannerAgent');
      freshRunActionPlannerAgent = fresh.runActionPlannerAgent;
    });

    // Bundle ids that the upstream streamMock* agents would now cite.
    const bundleValidIds = new Set([
      'Condition/chf-1',
      'Observation/a1c-1',
      'QuestionnaireResponse/ahc-hrsn-1',
    ]);

    const fallInputs = {
      risk: {
        riskScore: 82,
        riskLevel: 'high' as const,
        flags: [{ text: 'Recent CHF exacerbation', fhirResourceId: 'Condition/chf-1', confidence: 0.5 }],
        readmissionProbability: 0.4,
      },
      careGap: {
        gaps: [
          {
            gapType: 'screening',
            description: 'Overdue A1c check',
            urgency: 'high',
            fhirResourceId: 'Observation/a1c-1',
            confidence: 0.5,
          },
        ],
      },
      sdoh: {
        barriers: [
          {
            domain: 'housing',
            finding: 'Housing instability',
            severity: 'high' as const,
            fhirResourceId: 'QuestionnaireResponse/ahc-hrsn-1',
            confidence: 0.5,
          },
        ],
        referralsNeeded: [],
      },
    };

    const events: AgentEvent[] = [];
    for await (const event of freshRunActionPlannerAgent(fallInputs)) {
      events.push(event);
    }

    const result = events.find((e) => e.type === 'result') as Extract<
      AgentEvent,
      { type: 'result'; agentId: 'actionPlanner' }
    >;
    expect(result.output.tasks.length).toBeGreaterThan(0);
    const allCited = result.output.tasks.flatMap((t) => t.fhirResources);
    for (const id of allCited) {
      expect(bundleValidIds.has(id)).toBe(true);
    }
    // Domain tagging preserves the risk=clinical / careGap=clinical /
    // sdoh=sdoh split the live model emits.
    const domains = new Set(result.output.tasks.map((t) => t.domain));
    expect(domains.has('clinical')).toBe(true);
    expect(domains.has('sdoh')).toBe(true);
  });

  it('S20 — fallback with all empty upstream inputs emits zero tasks (honest demo)', async () => {
    delete process.env.OPENAI_API_KEY;
    let freshRunActionPlannerAgent!: typeof runActionPlannerAgent;
    await jest.isolateModulesAsync(async () => {
      const fresh = await import('./actionPlannerAgent');
      freshRunActionPlannerAgent = fresh.runActionPlannerAgent;
    });

    const emptyInputs = {
      risk: { riskScore: 0, riskLevel: 'low' as const, flags: [], readmissionProbability: 0 },
      careGap: { gaps: [] },
      sdoh: { barriers: [], referralsNeeded: [] },
    };

    const events: AgentEvent[] = [];
    for await (const event of freshRunActionPlannerAgent(emptyInputs)) {
      events.push(event);
    }

    const result = events.find((e) => e.type === 'result') as Extract<
      AgentEvent,
      { type: 'result'; agentId: 'actionPlanner' }
    >;
    expect(result.output.tasks).toEqual([]);
  });
});
