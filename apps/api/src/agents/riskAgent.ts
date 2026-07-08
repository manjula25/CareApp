import OpenAI from 'openai';
import { PatientBundle } from '../fhir/client';
import { AgentEvent, RiskOutput } from './agent';
import { MOCK_RISK_OUTPUT } from './mock-outputs';

// Re-exported for existing importers (routes/analysis.ts, tests) — the shared
// Agent contract now owns these types (see ./agent.ts).
export type { AgentEvent, RiskOutput } from './agent';

// Agent model is OpenAI gpt-5.5 (GD13, revised 2026-07-04 — see plan.md).
export const MODEL = 'gpt-5.5';

// The SDK client is the abstraction (GD13 / plan A1 — no factory module).
// Built lazily, on first use, not at module import time: `new OpenAI()`
// throws synchronously if OPENAI_API_KEY is unset, and this module is
// imported unconditionally at API boot (via routes/analysis.ts) — an eager
// `const openai = new OpenAI()` here would crash the whole process on
// startup whenever the key is missing, instead of failing only the one
// request that needs it (see implementation-plan.md Iteration 2 rollback
// note).
let cachedClient: OpenAI | undefined;

function getOpenAiClient(): OpenAI {
  if (!cachedClient) {
    cachedClient = new OpenAI();
  }
  return cachedClient;
}

// Structured-output contract (GD11): the agent must report through this tool
// rather than free text, and every flag must cite a `ResourceType/id` that
// exists in the bundle it was given (enforced downstream by the citation
// validator — this schema just shapes the model's output). Responses API
// function tools are flat (not nested under `function` like Chat Completions).
const REPORT_RISK_TOOL = {
  type: 'function' as const,
  name: 'report_risk',
  description:
    'Report the structured 30-day readmission risk assessment for this patient. Call this exactly once, after narrating your reasoning.',
  strict: false,
  parameters: {
    type: 'object' as const,
    properties: {
      riskScore: { type: 'number', description: 'Overall readmission risk score, 0-100.' },
      riskLevel: { type: 'string', enum: ['low', 'moderate', 'high', 'critical'] },
      flags: {
        type: 'array',
        description: 'Clinical findings driving the risk score.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Human-readable finding.' },
            fhirResourceId: {
              type: 'string',
              description:
                'The exact "ResourceType/id" of the FHIR resource that supports this finding. Must be one of the ids provided in the prompt — never invent one.',
            },
          },
          required: ['text', 'fhirResourceId'],
        },
      },
      readmissionProbability: { type: 'number', description: '30-day readmission probability, 0-1.' },
    },
    required: ['riskScore', 'riskLevel', 'flags', 'readmissionProbability'],
  },
};

function buildPrompt(bundle: PatientBundle): string {
  const resourceLines = bundle.resources.map((r) => `- ${r.resourceType}/${r.id}: ${JSON.stringify(r)}`).join('\n');

  return [
    'You are a clinical risk-assessment agent. Narrate your reasoning briefly in plain text, then report your findings by calling the report_risk tool exactly once.',
    '',
    "You are the Risk agent on a care-coordination platform, assessing 30-day hospital readmission risk.",
    "Below is the patient's complete retrieved FHIR record (one resource per line, as `ResourceType/id: <resource JSON>`).",
    '',
    resourceLines,
    '',
    'Every flag you report MUST cite the exact `ResourceType/id` of a resource listed above via `fhirResourceId`.',
    'Never cite a resource id that is not listed above — fabricated citations are dropped and undermine clinical trust.',
    'Briefly narrate your clinical reasoning, then call the `report_risk` tool exactly once with the structured result.',
  ].join('\n');
}

/**
 * S12 B.1 — demo fallback. When `OPENAI_API_KEY` is unset, the real path
 * can't run (lazy `getOpenAiClient()` would throw). Yields one narrated
 * token + the deterministic `MOCK_RISK_OUTPUT` so the SSE stream still
 * emits the right shape. Citations are likely to be dropped downstream
 * (mock ids aren't in any real bundle) — acceptable for a demo where the
 * point is "show the pipeline", not "show validated citations".
 */
async function* streamMockRisk(bundle: PatientBundle): AsyncIterable<AgentEvent> {
  yield {
    type: 'token',
    agentId: 'risk',
    text:
      '[demo fallback — OPENAI_API_KEY is unset] Synthesizing risk assessment from the patient FHIR bundle. ' +
      'Lab values, active conditions, and care-continuity signals indicate critical readmission risk.',
  };
  yield { type: 'result', agentId: 'risk', output: MOCK_RISK_OUTPUT };
  void bundle;
}

/**
 * Runs the Risk agent over a patient's FHIR bundle on OpenAI gpt-5.5 (GD13,
 * revised 2026-07-04), streaming narrated reasoning as `token` events and
 * finishing with a single `result` event carrying the structured
 * `RiskOutput` (obtained via the `report_risk` function tool, parsed from
 * the finalized `response.completed` event's output array).
 *
 * `client` defaults to the lazily-constructed OpenAI client so tests can
 * inject a fake and avoid any live network/API call (and avoid ever
 * constructing the real client at all).
 */
export async function* runRiskAgent(bundle: PatientBundle, client?: OpenAI): AsyncIterable<AgentEvent> {
  // S12 B.1 — fallback path activates only when no client was injected AND
  // the OpenAI key is missing. When the caller passes a fake/test client,
  // we trust it and run the real path regardless of env-var state (so the
  // existing fake-client tests don't accidentally trigger the mock).
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      yield* streamMockRisk(bundle);
      return;
    }
    client = getOpenAiClient();
  }

  const stream = await client.responses.create({
    model: MODEL,
    input: buildPrompt(bundle),
    tools: [REPORT_RISK_TOOL],
    stream: true,
  });

  let toolCall: { name: string; arguments: string } | undefined;

  for await (const event of stream as any) {
    if (event.type === 'response.output_text.delta') {
      yield { type: 'token', agentId: 'risk', text: event.delta };
    } else if (event.type === 'response.completed') {
      toolCall = event.response.output.find((item: any) => item.type === 'function_call' && item.name === 'report_risk');
    }
  }

  if (!toolCall) {
    throw new Error('Risk agent did not call report_risk with a structured result');
  }

  yield { type: 'result', agentId: 'risk', output: JSON.parse(toolCall.arguments) };
}
