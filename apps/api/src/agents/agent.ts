import { PatientBundle } from '../fhir/client';
import { AgentFlag } from './citationValidator';

/**
 * Shared Agent contract (S3 A1). One module of types the orchestrator and the
 * four agents share. Each agent self-tags its events with an `agentId` so a
 * single orchestrated stream can be demultiplexed by consumer.
 */
export type AgentId = 'risk' | 'careGap' | 'sdoh' | 'actionPlanner';

// --- Per-agent structured outputs (each item carries its citation id(s)). ---

export interface RiskOutput {
  riskScore: number;
  riskLevel: 'low' | 'moderate' | 'high' | 'critical';
  flags: AgentFlag[];
  readmissionProbability: number;
}

export interface CareGapOutput {
  gaps: {
    gapType: string;
    description: string;
    lastDone?: string;
    dueDate?: string;
    urgency: string;
    fhirResourceId: string;
  }[];
}

export interface SdohOutput {
  barriers: {
    domain: string;
    finding: string;
    severity: string;
    fhirResourceId: string;
  }[];
  referralsNeeded: string[];
}

export interface ActionPlannerOutput {
  tasks: {
    title: string;
    description: string;
    priority: string;
    // Which access-scope domain this task belongs to. The model self-reports
    // it per task (it knows which upstream agent's finding each task
    // synthesizes); consumed downstream to write Task.category (S7 A0).
    domain: 'clinical' | 'sdoh';
    assignTo?: string;
    dueInDays?: number;
    fhirResources: string[];
  }[];
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
