import OpenAI from 'openai';
import { PatientBundle } from '../fhir/client';
import { AgentEvent, SdohOutput } from './agent';
import { MOCK_SDOH_OUTPUT } from './mock-outputs';
import { extractUsage } from './usage';

// Re-exported for parity with the other agents — the shared Agent contract owns
// these types (see ./agent.ts).
export type { AgentEvent, SdohOutput } from './agent';

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
// rather than free text, and every barrier must cite a `ResourceType/id` that
// exists in the bundle it was given (enforced downstream by the citation
// validator — this schema just shapes the model's output). Responses API
// function tools are flat (not nested under `function` like Chat Completions).
const REPORT_SDOH_TOOL = {
  type: 'function' as const,
  name: 'report_sdoh',
  description:
    'Report the structured social-determinants-of-health (SDOH) assessment for this patient. Call this exactly once, after narrating your reasoning.',
  strict: false,
  parameters: {
    type: 'object' as const,
    properties: {
      barriers: {
        type: 'array',
        description: 'Social barriers to health identified from the AHC-HRSN screening, demographics, and observations.',
        items: {
          type: 'object',
          properties: {
            domain: {
              type: 'string',
              description: 'The SDOH domain, e.g. "housing", "food", "transportation", "utilities", "safety".',
            },
            finding: { type: 'string', description: 'Human-readable description of the barrier.' },
            severity: { type: 'string', enum: ['low', 'moderate', 'high'] },
            fhirResourceId: {
              type: 'string',
              description:
                'The exact "ResourceType/id" of the FHIR resource that supports this barrier. Must be one of the ids provided in the prompt — never invent one.',
            },
          },
          required: ['domain', 'finding', 'severity', 'fhirResourceId'],
        },
      },
      referralsNeeded: {
        type: 'array',
        description: 'Social-service referrals recommended to address the identified barriers.',
        items: { type: 'string' },
      },
    },
    required: ['barriers', 'referralsNeeded'],
  },
};

function buildPrompt(bundle: PatientBundle): string {
  const resourceLines = bundle.resources.map((r) => `- ${r.resourceType}/${r.id}: ${JSON.stringify(r)}`).join('\n');

  return [
    'You are the SDOH (social determinants of health) agent on a care-coordination platform. Narrate your reasoning briefly in plain text, then report your findings by calling the report_sdoh tool exactly once.',
    '',
    'Focus on the AHC-HRSN screening (the Accountable Health Communities Health-Related Social Needs screening, seeded as an Observation) to identify social barriers to health, alongside patient demographics (Patient) and relevant Observations.',
    "Below is the patient's complete retrieved FHIR record (one resource per line, as `ResourceType/id: <resource JSON>`).",
    '',
    resourceLines,
    '',
    'Every barrier you report MUST cite the exact `ResourceType/id` of a resource listed above via `fhirResourceId`. Barriers drawn from the AHC-HRSN screening must cite that Observation id.',
    'Never cite a resource id that is not listed above — fabricated citations are dropped and undermine clinical trust.',
    'Briefly narrate your reasoning, then call the `report_sdoh` tool exactly once with the structured result.',
  ].join('\n');
}

/**
 * Runs the SDOH agent over a patient's FHIR bundle on OpenAI gpt-5.5 (GD13,
 * revised 2026-07-04), streaming narrated reasoning as `token` events and
 * finishing with a single `result` event carrying the structured
 * `SdohOutput` (obtained via the `report_sdoh` function tool, parsed from the
 * finalized `response.completed` event's output array).
 *
 * `client` defaults to the lazily-constructed OpenAI client so tests can inject
 * a fake and avoid any live network/API call (and avoid ever constructing the
 * real client at all).
 */
async function* streamMockSdoh(bundle: PatientBundle): AsyncIterable<AgentEvent> {
  yield {
    type: 'token',
    agentId: 'sdoh',
    text:
      '[demo fallback — OPENAI_API_KEY is unset] Reviewing AHC-HRSN screening, demographics, and observations ' +
      'for social barriers to health.',
  };
  yield { type: 'result', agentId: 'sdoh', output: MOCK_SDOH_OUTPUT };
  void bundle;
}

export async function* runSdohAgent(bundle: PatientBundle, client?: OpenAI): AsyncIterable<AgentEvent> {
  // S12 B.1 — fallback path activates only when no client was injected AND
  // the OpenAI key is missing (see riskAgent.ts for the rationale).
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      yield* streamMockSdoh(bundle);
      return;
    }
    client = getOpenAiClient();
  }

  const stream = await client.responses.create({
    model: MODEL,
    input: buildPrompt(bundle),
    tools: [REPORT_SDOH_TOOL],
    stream: true,
  });

  let toolCall: { name: string; arguments: string } | undefined;

  for await (const event of stream as any) {
    if (event.type === 'response.output_text.delta') {
      yield { type: 'token', agentId: 'sdoh', text: event.delta };
    } else if (event.type === 'response.completed') {
      toolCall = event.response.output.find((item: any) => item.type === 'function_call' && item.name === 'report_sdoh');
      // S18 WSA — token-usage capture (see riskAgent.ts comment).
      const usage = extractUsage(event);
      if (usage) yield { type: 'usage', agentId: 'sdoh', usage };
    }
  }

  if (!toolCall) {
    throw new Error('SDOH agent did not call report_sdoh with a structured result');
  }

  yield { type: 'result', agentId: 'sdoh', output: JSON.parse(toolCall.arguments) };
}
