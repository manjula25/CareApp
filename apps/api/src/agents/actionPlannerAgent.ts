import OpenAI from 'openai';
import { ActionPlannerOutput, AgentEvent, CareGapOutput, RiskOutput, SdohOutput } from './agent';

// Re-exported for parity with the other agents — the shared Agent contract owns
// these types (see ./agent.ts).
export type { ActionPlannerOutput, AgentEvent } from './agent';

// Agent model is OpenAI gpt-5.5 (GD13, revised 2026-07-04 — see plan.md).
export const MODEL = 'gpt-5.5';

// The SDK client is the abstraction (GD13 / plan A1 — no factory module).
// Built lazily, on first use, not at module import time: `new OpenAI()`
// throws synchronously if OPENAI_API_KEY is unset, and this module is
// imported unconditionally at API boot (via routes/analysis.ts) — an eager
// `const openai = new OpenAI()` would crash the whole process on startup
// whenever the key is missing, instead of failing only the one request that
// needs it (mirrors riskAgent/careGapAgent/sdohAgent's rationale).
let cachedClient: OpenAI | undefined;

function getOpenAiClient(): OpenAI {
  if (!cachedClient) {
    cachedClient = new OpenAI();
  }
  return cachedClient;
}

// Structured-output contract (GD11): the agent must report through this tool
// rather than free text, and every task's `fhirResources` must be drawn from
// the union of ids already cited by the three upstream agents (enforced
// downstream by the citation validator — this schema just shapes the model's
// output). Responses API function tools are flat (not nested under
// `function` like Chat Completions).
const PLAN_TASKS_TOOL = {
  type: 'function' as const,
  name: 'plan_tasks',
  description:
    'Report the prioritized worklist of care-coordination tasks synthesized from the Risk, Care Gap, and SDOH findings. Call this exactly once, after narrating your reasoning.',
  strict: false,
  parameters: {
    type: 'object' as const,
    properties: {
      tasks: {
        type: 'array',
        description: 'Prioritized care-coordination tasks synthesized from the three agents’ findings.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short task title.' },
            description: { type: 'string', description: 'What the assignee should do and why.' },
            priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            assignTo: { type: 'string', description: 'Optional role or person to assign this task to.' },
            dueInDays: { type: 'number', description: 'Optional number of days from now this task is due.' },
            fhirResources: {
              type: 'array',
              description:
                'The exact "ResourceType/id"s this task cites. Every id MUST be one of the ids listed in the prompt’s union of cited ids — never invent one.',
              items: { type: 'string' },
            },
          },
          required: ['title', 'description', 'priority', 'fhirResources'],
        },
      },
    },
    required: ['tasks'],
  },
};

/**
 * Collects every `fhirResourceId` already cited by the Risk, Care Gap, and
 * SDOH agents into one set (GD11: the Action Planner may only cite ids this
 * union already contains, since it never reads the raw bundle itself).
 */
function unionOfCitedIds(inputs: { risk: RiskOutput; careGap: CareGapOutput; sdoh: SdohOutput }): Set<string> {
  const ids = new Set<string>();
  for (const flag of inputs.risk.flags) ids.add(flag.fhirResourceId);
  for (const gap of inputs.careGap.gaps) ids.add(gap.fhirResourceId);
  for (const barrier of inputs.sdoh.barriers) ids.add(barrier.fhirResourceId);
  return ids;
}

function buildPrompt(inputs: { risk: RiskOutput; careGap: CareGapOutput; sdoh: SdohOutput }): string {
  const citedIds = Array.from(unionOfCitedIds(inputs));

  return [
    'You are the Action Planner agent on a care-coordination platform. You do NOT see the patient’s raw FHIR record — you synthesize the ALREADY-PARSED structured findings of three other agents (Risk, Care Gap, and SDOH) into a prioritized worklist of care-coordination tasks.',
    '',
    'Risk agent findings (JSON):',
    JSON.stringify(inputs.risk),
    '',
    'Care Gap agent findings (JSON):',
    JSON.stringify(inputs.careGap),
    '',
    'SDOH agent findings (JSON):',
    JSON.stringify(inputs.sdoh),
    '',
    'The complete set of FHIR resource ids already cited across these three findings is:',
    citedIds.join(', '),
    '',
    'Every task you report MUST cite one or more of these ids via `fhirResources`. Never cite an id that is not in this set — fabricated citations are dropped and undermine clinical trust.',
    'Briefly narrate your reasoning, then call the `plan_tasks` tool exactly once with the structured, prioritized result.',
  ].join('\n');
}

/**
 * Runs the Action Planner agent on OpenAI gpt-5.5 (GD13, revised
 * 2026-07-04), synthesizing the Risk, Care Gap, and SDOH agents' already-
 * parsed structured outputs (no `PatientBundle`, no bundle read — this agent
 * is downstream of the other three) into a prioritized worklist. Streams
 * narrated reasoning as `token` events and finishes with a single `result`
 * event carrying the structured `ActionPlannerOutput` (obtained via the
 * `plan_tasks` function tool, parsed from the finalized `response.completed`
 * event's output array).
 *
 * `client` defaults to the lazily-constructed OpenAI client so tests can
 * inject a fake and avoid any live network/API call (and avoid ever
 * constructing the real client at all).
 */
export async function* runActionPlannerAgent(
  inputs: { risk: RiskOutput; careGap: CareGapOutput; sdoh: SdohOutput },
  client = getOpenAiClient()
): AsyncIterable<AgentEvent> {
  const stream = await client.responses.create({
    model: MODEL,
    input: buildPrompt(inputs),
    tools: [PLAN_TASKS_TOOL],
    stream: true,
  });

  let toolCall: { name: string; arguments: string } | undefined;

  for await (const event of stream as any) {
    if (event.type === 'response.output_text.delta') {
      yield { type: 'token', agentId: 'actionPlanner', text: event.delta };
    } else if (event.type === 'response.completed') {
      toolCall = event.response.output.find((item: any) => item.type === 'function_call' && item.name === 'plan_tasks');
    }
  }

  if (!toolCall) {
    throw new Error('Action Planner agent did not call plan_tasks with a structured result');
  }

  yield { type: 'result', agentId: 'actionPlanner', output: JSON.parse(toolCall.arguments) };
}
