import OpenAI from 'openai';
import { PatientBundle } from '../fhir/client';
import { AgentEvent, CareGapFinding, CareGapOutput } from './agent';
import { MOCK_CARE_GAP_OUTPUT } from './mock-outputs';
import { extractUsage } from './usage';

// Re-exported for parity with riskAgent — the shared Agent contract owns these
// types (see ./agent.ts).
export type { AgentEvent, CareGapOutput } from './agent';

// Agent model is OpenAI gpt-5.5 (GD13, revised 2026-07-04 — see plan.md).
export const MODEL = 'gpt-5.5';

// The SDK client is the abstraction (GD13 / plan A1 — no factory module).
// Built lazily, on first use, not at module import time: `new OpenAI()` throws
// synchronously if OPENAI_API_KEY is unset, and this module is imported
// unconditionally at API boot (via routes/analysis.ts) — an eager
// `const openai = new OpenAI()` would crash the whole process on startup
// whenever the key is missing, instead of failing only the one request that
// needs it (mirrors riskAgent's rationale).
let cachedClient: OpenAI | undefined;

function getOpenAiClient(): OpenAI {
  if (!cachedClient) {
    cachedClient = new OpenAI();
  }
  return cachedClient;
}

// Structured-output contract (GD11): the agent must report through this tool
// rather than free text, and every gap must cite a `ResourceType/id` that
// exists in the bundle it was given (enforced downstream by the citation
// validator — this schema just shapes the model's output). Responses API
// function tools are flat (not nested under `function` like Chat Completions).
const REPORT_CARE_GAPS_TOOL = {
  type: 'function' as const,
  name: 'report_care_gaps',
  description:
    'Report the overdue or missing preventive and chronic-care items for this patient. Call this exactly once, after narrating your reasoning.',
  strict: false,
  parameters: {
    type: 'object' as const,
    properties: {
      gaps: {
        type: 'array',
        description: 'Overdue or missing preventive/chronic-care items.',
        items: {
          type: 'object',
          properties: {
            gapType: { type: 'string', description: 'Short label for the kind of gap, e.g. "HbA1c monitoring".' },
            description: { type: 'string', description: 'Human-readable explanation of the gap.' },
            lastDone: { type: 'string', description: 'When this item was last completed, if known (ISO date).' },
            dueDate: { type: 'string', description: 'When this item is/was due, if known (ISO date).' },
            urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
            fhirResourceId: {
              type: 'string',
              description:
                'The exact "ResourceType/id" of the FHIR resource that supports this gap. Must be one of the ids provided in the prompt — never invent one.',
            },
          },
          required: ['gapType', 'description', 'urgency', 'fhirResourceId'],
        },
      },
    },
    required: ['gaps'],
  },
};

function buildPrompt(bundle: PatientBundle): string {
  const resourceLines = bundle.resources.map((r) => `- ${r.resourceType}/${r.id}: ${JSON.stringify(r)}`).join('\n');

  return [
    'You are a care-gap agent identifying overdue or missing preventive and chronic-care items. Narrate your reasoning briefly in plain text, then report your findings by calling the report_care_gaps tool exactly once.',
    '',
    'You are the Care Gap agent on a care-coordination platform. Focus on Condition, Encounter, and Observation resources to find preventive screenings and chronic-care monitoring that are overdue or missing.',
    "Below is the patient's complete retrieved FHIR record (one resource per line, as `ResourceType/id: <resource JSON>`).",
    '',
    resourceLines,
    '',
    'Every gap you report MUST cite the exact `ResourceType/id` of a resource listed above via `fhirResourceId`.',
    'Never cite a resource id that is not listed above — fabricated citations are dropped and undermine clinical trust.',
    'Briefly narrate your clinical reasoning, then call the `report_care_gaps` tool exactly once with the structured result.',
  ].join('\n');
}

/**
 * Runs the Care Gap agent over a patient's FHIR bundle on OpenAI gpt-5.5 (GD13,
 * revised 2026-07-04), streaming narrated reasoning as `token` events and
 * finishing with a single `result` event carrying the structured
 * `CareGapOutput` (obtained via the `report_care_gaps` function tool, parsed
 * from the finalized `response.completed` event's output array).
 *
 * `client` defaults to the lazily-constructed OpenAI client so tests can inject
 * a fake and avoid any live network/API call (and avoid ever constructing the
 * real client at all).
 */
/**
 * S20 — demo fallback. Mirrors `streamMockRisk`: the citation gates run in
 * `routes/analysis.ts:358`, so every `gaps[].fhirResourceId` MUST exist in
 * `bundle.validIds` or the whole gap gets dropped. Picking real Conditions
 * (cap 2) and emitting one chronic-care-monitoring gap per condition makes
 * the demo show findings; empty bundle produces an honest empty `gaps`.
 */
async function* streamMockCareGap(bundle: PatientBundle): AsyncIterable<AgentEvent> {
  yield {
    type: 'token',
    agentId: 'careGap',
    text:
      '[demo fallback — OPENAI_API_KEY is unset] Reviewing preventive and chronic-care items. ' +
      'Identifying overdue screenings and missing monitoring items.',
  };

  const gaps: CareGapFinding[] = [];
  for (const c of bundle.resources.filter((r) => r?.resourceType === 'Condition').slice(0, 2)) {
    const code = c?.code?.coding?.[0]?.display ?? c?.code?.text ?? c?.id;
    gaps.push({
      gapType: 'Chronic-condition follow-up',
      description: `Active ${code} condition — chronic-care monitoring recommended.`,
      urgency: 'medium',
      fhirResourceId: `Condition/${c.id}`,
      confidence: 0.5,
    });
  }

  const output: CareGapOutput = { gaps };
  yield { type: 'result', agentId: 'careGap', output };
}

export async function* runCareGapAgent(bundle: PatientBundle, client?: OpenAI): AsyncIterable<AgentEvent> {
  // S12 B.1 — fallback path activates only when no client was injected AND
  // the OpenAI key is missing (see riskAgent.ts for the rationale).
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      yield* streamMockCareGap(bundle);
      return;
    }
    client = getOpenAiClient();
  }

  const stream = await client.responses.create({
    model: MODEL,
    input: buildPrompt(bundle),
    tools: [REPORT_CARE_GAPS_TOOL],
    stream: true,
  });

  let toolCall: { name: string; arguments: string } | undefined;

  for await (const event of stream as any) {
    if (event.type === 'response.output_text.delta') {
      yield { type: 'token', agentId: 'careGap', text: event.delta };
    } else if (event.type === 'response.completed') {
      toolCall = event.response.output.find(
        (item: any) => item.type === 'function_call' && item.name === 'report_care_gaps'
      );
      // S18 WSA — token-usage capture (see riskAgent.ts comment).
      const usage = extractUsage(event);
      if (usage) yield { type: 'usage', agentId: 'careGap', usage };
    }
  }

  if (!toolCall) {
    throw new Error('Care Gap agent did not call report_care_gaps with a structured result');
  }

  yield { type: 'result', agentId: 'careGap', output: JSON.parse(toolCall.arguments) };
}
