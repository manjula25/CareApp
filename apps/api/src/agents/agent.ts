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
  | { type: 'result'; agentId: 'actionPlanner'; output: ActionPlannerOutput };

export type Agent = (bundle: PatientBundle) => AsyncIterable<AgentEvent>;
