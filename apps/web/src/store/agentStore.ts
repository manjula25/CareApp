import { create } from 'zustand';
import type { AgentId, AnalysisFinding, AnalysisSummary } from '../api/client';

interface AgentResult {
  agentId: AgentId;
  status: 'pending' | 'running' | 'complete' | 'error';
  findings: AnalysisFinding[];
  streamText: string;
  summary?: AnalysisSummary;
  completedAt?: string;
}

interface AgentState {
  patientId: string | null;
  agents: Record<string, AgentResult>;
  isAnalyzing: boolean;
  startAnalysis: (patientId: string) => void;
  updateAgent: (agentId: string, result: Partial<AgentResult>) => void;
  resetAnalysis: () => void;
}

const AGENT_IDS: AgentId[] = ['risk', 'careGap', 'sdoh', 'actionPlanner'];

export const useAgentStore = create<AgentState>((set) => ({
  patientId: null,
  agents: {},
  isAnalyzing: false,
  startAnalysis: (patientId) =>
    set({
      patientId,
      isAnalyzing: true,
      agents: Object.fromEntries(
        AGENT_IDS.map((id) => [id, { agentId: id, status: 'pending' as const, findings: [], streamText: '' }])
      ),
    }),
  updateAgent: (agentId, result) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [agentId]: { ...state.agents[agentId], ...result },
      },
    })),
  resetAnalysis: () => set({ patientId: null, agents: {}, isAnalyzing: false }),
}));
