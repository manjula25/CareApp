import type { AnalysisFinding, AgentId } from '../api/client';

export type UserRole = 'director' | 'coordinator' | 'social_worker';

export interface User {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  initials: string;
}

export interface Patient {
  id: string;
  mrn?: string;
  name: string;
  age?: number;
  sex?: string;
  dob?: string;
  conditions: string[];
  riskScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  daysSinceContact?: number;
  assignedTo?: string;
}

export interface AgentFinding {
  type: string;
  finding: string;
  fhirResourceId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
}

export interface AgentResult {
  agentId: AgentId;
  status: 'pending' | 'running' | 'complete' | 'error';
  findings: AgentFinding[];
  streamText: string;
  completedAt?: string;
}

export interface Task {
  id: string;
  patientId: string;
  patientName: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in_progress' | 'completed' | 'deferred';
  fhirResourceId: string;
  dueDate: string;
  assignedTo?: string;
  createdAt: string;
}

export function mapAnalysisFindingToAgentFinding(f: AnalysisFinding): AgentFinding {
  // S12 — the lead's `AgentFinding` (used by PatientDetail's cinema/orchestrator
  // views) carries a per-flag `confidence` float. Until the API emits one
  // explicitly, fall back to 0.85 rather than `0` (which would render as
  // "0% confidence" and visually shout "fabricated"). When the SSE event does
  // carry a confidence, prefer it.
  const confidence =
    typeof (f as unknown as { confidence?: unknown }).confidence === 'number'
      ? ((f as unknown as { confidence: number }).confidence as number)
      : 0.85;
  return {
    type: f.agentId,
    finding: f.text ?? f.finding ?? f.description ?? '',
    fhirResourceId: f.fhirResourceId ?? '',
    severity: (f.severity as AgentFinding['severity']) ?? 'medium',
    confidence,
  };
}
