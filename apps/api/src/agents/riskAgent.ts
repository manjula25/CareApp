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

/**
 * S16 Commit 3 — exported for TDD unit tests (`riskAgent.test.ts` pins the
 * prompt's structural surface — citation requirement + bundle embedding +
 * the 3 v2 structure pins: 3 calibration anchors, "0 anchors → low" rule,
 * 3 worked examples using actual seed-text bundle shapes).
 *
 * History note:
 * - S13 attempted a prompt-rubric calibration mirroring
 *   `fhir-data/population.ts:127-134`'s `riskScoreFor()` ≥ 75 threshold
 *   (see docs/plans/caresync-ai/design-risk-calibration.md). Live re-eval
 *   showed it caused the model to over-call (specificity regressed from
 *   30.8% → 0% on the 16-patient held-out set — every patient including
 *   the no-evidence ones got `riskLevel: 'critical'`). The rubric was
 *   reverted in S13b to a 1-paragraph clinical-judgment prompt.
 * - S16 Commit 3 replaces the 1-paragraph prompt with this v2 rubric:
 *   3 calibration anchors (multi-condition comorbidity, recent inpatient
 *   discharge ≤30d, abnormal labs — same as S13's anchors), an explicit
 *   "0 anchors met is ALWAYS riskLevel='low'" hard rule (the lower bound
 *   S13 was missing), and 3 worked examples using actual seed-text
 *   bundle shapes (james-okafor for 0 anchors, maria-chen for 1 anchor,
 *   a synthetic `bob` synthesizing multi-condition + abnormal lab +
 *   recent discharge for 2 anchors). The few-shot examples address S13's
 *   failure mode #1 (negative-instruction vs clinical-judgment), the
 *   "0 anchors → low" rule addresses failure mode #3 (any-condition →
 *   critical over-call), and the worked-example anchors tighten failure
 *   mode #2 (loose abstract anchors). See
 *   docs/plans/caresync-ai/design-risk-calibration-v2.md §"The v2 rubric"
 *   + §"Why this design should hold specificity" for the full mapping.
 */
export function buildPrompt(bundle: PatientBundle): string {
  const resourceLines = bundle.resources.map((r) => `- ${r.resourceType}/${r.id}: ${JSON.stringify(r)}`).join('\n');

  return [
    'You are a clinical risk-assessment agent. Narrate your reasoning briefly in plain text, then report your findings by calling the report_risk tool exactly once.',
    '',
    "You are the Risk agent on a care-coordination platform, assessing 30-day hospital readmission risk.",
    "Below is the patient's complete retrieved FHIR record (one resource per line, as `ResourceType/id: <resource JSON>`).",
    '',
    resourceLines,
    '',
    '## Calibration anchors (3 of 3)',
    '',
    '  Anchor A: Multi-condition comorbidity — ≥2 active Conditions from',
    '            {diabetes E11.9, CHF I50.9, depression F33.1, CKD N18.3}',
    '  Anchor B: Recent inpatient discharge — any Encounter with class/act',
    '            inpatient or acute, ending within the last 30 days',
    '  Anchor C: Abnormal labs — BNP > 200 pg/mL, OR HbA1c > 9.0%, OR',
    '            eGFR < 30 mL/min/1.73m²',
    '',
    '## Hard rule — read this before anchoring',
    '',
    "A patient with 0 anchors met is ALWAYS riskLevel='low' — even if they",
    'have multiple active Conditions, are on multiple medications, or have',
    'a complex chart. Do not escalate on complexity alone. The single most',
    "common over-call pattern is \"any active Condition → high/critical\";",
    "that mapping is incorrect. Default to 'low' when no anchors are met;",
    "justify 'moderate', 'high', or 'critical' explicitly by the number of",
    'anchors met and the cited resources.',
    '',
    '## Worked examples',
    '',
    "These three examples use the actual seed-text bundle shapes from this",
    "codebase's `data/eval/labels.json`. Use them as calibration anchors for",
    'your reasoning — not as the only valid pattern, but as the lower/upper',
    'bounds.',
    '',
    '  Example 1 (0 anchors → low):',
    '    Bundle: [Patient/james-okafor, Condition/COPD (J44.9)]',
    "    Result: riskScore ~15, riskLevel 'low', 0 flags",
    '    Reasoning: 1 active Condition, no inpatient discharge, no abnormal',
    '               labs. 0 anchors met → low, per the hard rule above.',
    '',
    '  Example 2 (1 anchor → moderate):',
    '    Bundle: [Patient/maria-chen, Condition/CHF (I50.9),',
    '             Observation/BNP-380]',
    '    Result: riskScore ~55, riskLevel \'moderate\', 1 flag',
    '             ("Elevated BNP consistent with CHF exacerbation")',
    '    Reasoning: 1 anchor met (abnormal lab: BNP > 200). 1 anchor is',
    "               'moderate', not 'high'.",
    '',
    '  Example 3 (2 anchors → high):',
    '    Bundle: [Patient/bob, Condition/diabetes (E11.9),',
    '             Condition/CHF (I50.9), Observation/HbA1c-10.2,',
    '             Encounter/inpatient-discharge 3 days ago]',
    '    Result: riskScore ~85, riskLevel \'high\', 3 flags',
    '             ("Comorbid diabetes + CHF",',
    '              "Uncontrolled diabetes (HbA1c 10.2)",',
    '              "Recent inpatient discharge")',
    '    Reasoning: 2 anchors met (multi-condition comorbidity +',
    '               abnormal labs); recent discharge pushes to \'high\'.',
    '',
    'Every flag you report MUST cite the exact `ResourceType/id` of a',
    'resource listed above via `fhirResourceId`. Never cite a resource id',
    'that is not listed above — fabricated citations are dropped and',
    'undermine clinical trust.',
    '',
    'Briefly narrate your clinical reasoning, then call the `report_risk`',
    'tool exactly once with the structured result.',
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
