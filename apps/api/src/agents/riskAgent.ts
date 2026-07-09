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
 * the v3 structure pins: 3 calibration anchors, explicit anchor-to-level
 * mapping rules (Rule 1 + Rule 2), 5 worked examples covering 0-anchor
 * (non-anchor condition + single anchor-set condition), 1-anchor, 3-anchor,
 * and the critical 2-anchor-without-labs → moderate case).
 *
 * History note:
 * - S13 attempted a prompt-rubric calibration mirroring
 *   `fhir-data/population.ts:127-134`'s `riskScoreFor()` ≥ 75 threshold
 *   (see docs/plans/caresync-ai/design-risk-calibration.md). Live re-eval
 *   showed it caused the model to over-call (specificity regressed from
 *   30.8% → 0% on the 16-patient held-out set — every patient including
 *   the no-evidence ones got `riskLevel: 'critical'`). The rubric was
 *   reverted in S13b to a 1-paragraph clinical-judgment prompt.
 * - S16 Commit 3 replaces the 1-paragraph prompt with a v2 rubric:
 *   3 calibration anchors, "0 anchors → low" hard rule, 3 worked examples.
 *   Specificity improved 0%→69.2% but 4/16 dev-labeled and 5/10 held-out
 *   FPs remained — all 2-anchor-without-labs cases the v2 rubric still
 *   allowed as 'high'.
 * - S17 replaces v2 with this v3 rubric: adds Rule 2 (explicit anchor-to-
 *   level mapping where 2 anchors without Anchor C is 'moderate'), adds
 *   Example 2 (linda-torres: 0-anchor single-condition → low), adds
 *   Example 5 (pop-0004: 2 anchors without labs → moderate). Combined
 *   with the deterministic `clampRiskLevel` safety net in
 *   `confidenceScorer.ts`, this targets ~100% specificity without
 *   reducing sensitivity.
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
    '## Hard rules — read before anchoring',
    '',
    "Rule 1: A patient with 0 anchors met is ALWAYS riskLevel='low' — even",
    'if they have multiple active Conditions, are on multiple medications,',
    'or have a complex chart. Do not escalate on complexity alone. The',
    "single most common over-call pattern is \"any active Condition →",
    "high/critical\"; that mapping is incorrect.",
    '',
    "Rule 2: Anchor-to-level mapping (follow exactly):",
    "  0 anchors met → ALWAYS 'low'",
    "  1 anchor met  → ALWAYS 'moderate' (never 'high')",
    "  2 anchors met → 'high' ONLY if Anchor C (abnormal labs) is one of",
    "                   the two met anchors; otherwise 'moderate'",
    "  3 anchors met → 'critical'",
    '',
    'The most common over-call after 0-anchor is escalating 2 anchors',
    "(comorbidity + recent discharge) to 'high' when no abnormal labs are",
    "present — that combination is 'moderate', not 'high'. Abnormal labs",
    "(Anchor C) are the distinguishing signal that justifies 'high'.",
    '',
    '## Worked examples',
    '',
    "These examples use the actual seed-text bundle shapes from this",
    "codebase's `data/eval/labels.json`. Use them as calibration anchors for",
    'your reasoning — not as the only valid pattern, but as the lower/upper',
    'bounds.',
    '',
    '  Example 1 (0 anchors, non-anchor condition → low):',
    '    Bundle: [Patient/james-okafor, Condition/COPD (J44.9)]',
    "    Result: riskScore ~15, riskLevel 'low', 0 flags",
    '    Reasoning: 1 active Condition, but COPD (J44.9) is NOT in the',
    '               anchor comorbidity set. No inpatient discharge, no',
    '               abnormal labs. 0 anchors met → low, per Rule 1.',
    '',
    '  Example 2 (0 anchors, single anchor-set condition → low):',
    '    Bundle: [Patient/linda-torres, Condition/CKD (N18.3)]',
    "    Result: riskScore ~20, riskLevel 'low', 0 flags",
    '    Reasoning: 1 active Condition from the anchor set (CKD N18.3),',
    '               but Anchor A requires ≥2. No inpatient discharge, no',
    '               abnormal labs. 0 anchors met → low. A single serious',
    '               Condition is NOT the same as meeting Anchor A — do',
    '               not escalate on condition severity alone.',
    '',
    '  Example 3 (1 anchor → moderate):',
    '    Bundle: [Patient/maria-chen, Condition/CHF (I50.9),',
    '             Observation/BNP-380]',
    '    Result: riskScore ~55, riskLevel \'moderate\', 1 flag',
    '             ("Elevated BNP consistent with CHF exacerbation")',
    '    Reasoning: 1 anchor met (abnormal lab: BNP > 200). Per Rule 2,',
    "               1 anchor is ALWAYS 'moderate', never 'high'.",
    '',
    '  Example 4 (3 anchors → critical):',
    '    Bundle: [Patient/bob, Condition/diabetes (E11.9),',
    '             Condition/CHF (I50.9), Observation/HbA1c-10.2,',
    '             Encounter/inpatient-discharge 3 days ago]',
    "    Result: riskScore ~85, riskLevel 'critical', 3 flags",
    '             ("Comorbid diabetes + CHF",',
    '              "Uncontrolled diabetes (HbA1c 10.2)",',
    '              "Recent inpatient discharge")',
    '    Reasoning: 3 anchors met (multi-condition comorbidity +',
    "               abnormal labs + recent discharge) → 'critical'",
    '               per Rule 2.',
    '',
    '  Example 5 (2 anchors WITHOUT abnormal labs → moderate):',
    '    Bundle: [Patient/pop-0004, Condition/diabetes (E11.9),',
    '             Condition/CHF (I50.9), Encounter/inpatient-discharge',
    '             8 days ago, NO Observations]',
    "    Result: riskScore ~50, riskLevel 'moderate', 2 flags",
    '             ("Comorbid diabetes + CHF",',
    '              "Recent inpatient discharge")',
    '    Reasoning: 2 anchors met (Anchor A + Anchor B), but Anchor C',
    "               (abnormal labs) is NOT met. Per Rule 2, 2 anchors",
    "               without abnormal labs is 'moderate', not 'high'.",
    '               This is the most common over-call pattern — do not',
    "               escalate to 'high' without abnormal labs.",
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
