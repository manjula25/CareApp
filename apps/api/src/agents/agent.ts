import { PatientBundle } from '../fhir/client';
import { AgentFlag } from './citationValidator';

/**
 * Shared Agent contract (S3 A1). One module of types the orchestrator and the
 * four agents share. Each agent self-tags its events with an `agentId` so a
 * single orchestrated stream can be demultiplexed by consumer.
 */
export type AgentId = 'risk' | 'careGap' | 'sdoh' | 'actionPlanner';

// --- Per-agent structured outputs (each item carries its citation id(s)). ---

// S14 D4 — each finding shape carries a `confidence: number` (0-1) that the
// heuristic scorer (apps/api/src/agents/confidenceScorer.ts) writes into the
// validated output. The model's raw output starts at a placeholder (see
// `mock-outputs.ts`'s 0.5 fill); the citation validator runs the scorer on
// each surviving finding and overwrites the field. The number is a
// property of the bundle + finding, NOT of model self-report.

export interface RiskFlag extends AgentFlag {
  confidence: number;
}

export interface CareGapFinding {
  gapType: string;
  description: string;
  lastDone?: string;
  dueDate?: string;
  urgency: string;
  fhirResourceId: string;
  confidence: number;
}

export interface SdohBarrierFinding {
  domain: string;
  finding: string;
  severity: string;
  fhirResourceId: string;
  confidence: number;
}

export interface ActionPlannerTaskFinding {
  title: string;
  description: string;
  priority: string;
  // Which access-scope domain this task belongs to. The model self-reports
  // it per task (it knows which upstream agent's finding each task
  // synthesizes); consumed downstream to write a Task.meta.tag coding —
  // not Task.category, which FHIR R4's Task has no element for (S7 A0).
  domain: 'clinical' | 'sdoh';
  assignTo?: string;
  dueInDays?: number;
  fhirResources: string[];
  // Action Planner task confidence is DERIVED from the contributing findings
  // (min of each cited finding's confidence, floor 0.2) — see
  // `deriveActionPlannerTaskConfidence` in confidenceScorer.ts. Never scored
  // from bundle evidence directly.
  confidence: number;
}

export interface CareGapOutput {
  gaps: CareGapFinding[];
}

export interface SdohOutput {
  barriers: SdohBarrierFinding[];
  referralsNeeded: string[];
}

export interface ActionPlannerOutput {
  tasks: ActionPlannerTaskFinding[];
}

export interface RiskOutput {
  riskScore: number;
  riskLevel: 'low' | 'moderate' | 'high' | 'critical';
  flags: RiskFlag[];
  readmissionProbability: number;
  // S19 Thread D — when the deterministic `clampRiskLevel` safety net
  // downgrades an LLM-emitted 'high' or 'critical' to 'moderate', the
  // output carries an `_safetyNetApplied` sentinel describing the
  // intervention. Optional (only present on downgrade). The leading
  // underscore is the codebase's tool-internal-fields convention
  // (`_meta`, `_selfCheck`); consumer code can ignore the field by
  // structural typing. The eval harness reads this field to surface
  // `## Safety-net activity` in `docs/eval-report.md`.
  _safetyNetApplied?: SafetyNetApplication;
}

// S19 Thread D — structured shape of a single clamp intervention.
// Pure-data; mirrors the deterministic scoring the clamp uses internally
// (conditionCount, recencyHours, deterministicScore) plus the from/to
// riskLevel transition. Stored verbatim in `RiskOutput._safetyNetApplied`
// so the eval-report's `## Safety-net activity` section can render
// per-patient (from, to, deterministicScore) without re-running the clamp.
export interface SafetyNetApplication {
  kind: 'risk-level-clamped';
  from: 'high' | 'critical';
  to: 'moderate';
  deterministicScore: number;
  conditionCount: number;
  recencyHours: number;
}

/**
 * Discriminated event union — `type` splits token vs. result, and the result
 * variants are further keyed by `agentId`, so `event.agentId === 'risk'`
 * narrows `event.output` to `RiskOutput`, and so on for each agent.
 */
export type AgentEvent =
  | { type: 'token'; agentId: AgentId; text: string }
  | { type: 'result'; agentId: 'risk'; output: RiskOutput }
  | { type: 'result'; agentId: 'careGap'; output: CareGapOutput }
  | { type: 'result'; agentId: 'sdoh'; output: SdohOutput }
  | { type: 'result'; agentId: 'actionPlanner'; output: ActionPlannerOutput }
  // S18 WSA — token-usage capture. Each `response.completed` event from the
  // OpenAI Responses API carries a `usage` field (`{input_tokens,
  // output_tokens, total_tokens}`); the agents yield one `usage` event per
  // completed LLM call. The eval pipeline (scripts/eval.ts) consumes these
  // into `docs/eval-report-cost.json` + the `## Cost per analysis` markdown
  // section. Downstream SSE consumers (routes/analysis.ts) silently skip this
  // variant — their switch on `event.type` only handles `token` and `result`.
  | { type: 'usage'; agentId: AgentId; usage: { inputTokens: number; outputTokens: number; totalTokens: number } };

export type Agent = (bundle: PatientBundle) => AsyncIterable<AgentEvent>;
