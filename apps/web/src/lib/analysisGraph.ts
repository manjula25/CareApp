import { useReducer } from 'react';
import type { AgentId } from '../api/client';

/**
 * Graph-level state for the S4 agent-graph canvas (Orchestrator + 4 agent
 * nodes). `idle`/`init` only exist for the real hook-driven flow (see
 * `useAnalysisGraph` below) — a pure fixture of SSE events (no explicit
 * `start`) skips straight from `idle` to `dispatch` on its first event,
 * since there's no separate "stream opened" SSE frame to key off of.
 *
 * `dispatch` is the exact tick the very first event of the run arrives
 * (any agentId, any event type) — the moment the backend has clearly
 * started dispatching work to the agents. Every event after that first one
 * (while risk/careGap/sdoh are still working) promotes the graph to
 * `analyzing`. `synthesizing` fires on actionPlanner's first tagged event
 * (per the Event→state contract, actionPlanner only starts once the three
 * parallel agents have already produced their structured results, so its
 * first event is the unambiguous parallel→synthesis pivot). `complete`
 * fires only on the terminal `done` event — there is no single unified
 * "complete" event in the real SSE vocabulary, just four per-agent ones.
 */
export type GraphState = 'idle' | 'init' | 'dispatch' | 'analyzing' | 'synthesizing' | 'complete';

/** Per-node status for each of the 4 real `AgentId`s. Orchestrator itself has no node status — it IS the `GraphState`. */
export type NodeStatus = 'pending' | 'analyzing' | 'complete';

export interface AnalysisGraphState {
  graphState: GraphState;
  nodes: Record<AgentId, NodeStatus>;
}

export const initialAnalysisGraphState: AnalysisGraphState = {
  graphState: 'idle',
  nodes: { risk: 'pending', careGap: 'pending', sdoh: 'pending', actionPlanner: 'pending' },
};

/**
 * The graph reducer only cares about *occurrence* (which event type, tagged
 * to which agent) — never payload contents (token text, finding fields,
 * summary numbers). `PatientDetail`'s own feed state already owns that data;
 * this action shape is a deliberately thin mapping of `AnalysisHandlers`'
 * real callback shapes, not a parallel event vocabulary. `start` is the one
 * addition beyond the real SSE vocabulary — the hook fires it when a run
 * begins (before the fetch's first byte), so `init` is observable in real
 * usage even though the pure fixture below never needs it.
 */
export type AnalysisGraphAction =
  | { event: 'start' }
  | { event: 'token'; agentId: AgentId }
  | { event: 'finding'; agentId: AgentId }
  | { event: 'complete'; agentId: AgentId }
  | { event: 'task'; agentId: 'actionPlanner' }
  | { event: 'done' };

/** Pure reducer: `AnalysisGraphState + AnalysisGraphAction → AnalysisGraphState`. */
export function analysisGraphReducer(state: AnalysisGraphState, action: AnalysisGraphAction): AnalysisGraphState {
  if (action.event === 'start') {
    return state.graphState === 'idle' ? { ...state, graphState: 'init' } : state;
  }

  if (action.event === 'done') {
    return { ...state, graphState: 'complete' };
  }

  // Any tagged event (token/finding/complete/task) — the stream has
  // produced a frame for some agent.
  const isFirstEventEver = state.graphState === 'idle' || state.graphState === 'init';
  let graphState = state.graphState;
  if (isFirstEventEver) {
    graphState = 'dispatch';
  } else if (graphState === 'dispatch') {
    graphState = 'analyzing';
  }

  let nodes = state.nodes;
  if (action.event === 'complete') {
    nodes = { ...nodes, [action.agentId]: 'complete' };
  } else if (nodes[action.agentId] === 'pending') {
    // First tagged event (token/finding/task) for this agent.
    nodes = { ...nodes, [action.agentId]: 'analyzing' };
  }

  if (action.agentId === 'actionPlanner' && graphState !== 'synthesizing' && graphState !== 'complete') {
    graphState = 'synthesizing';
  }

  return { graphState, nodes };
}

/**
 * Thin `useReducer` wrapper around `analysisGraphReducer` — the integration
 * point a future `PatientDetail.tsx` (Task B2/B3) can call alongside
 * `streamAnalysis`'s handlers to drive the agent-graph canvas. Not wired up
 * yet; `analysisGraphReducer` above is the tested unit.
 */
export function useAnalysisGraph() {
  return useReducer(analysisGraphReducer, initialAnalysisGraphState);
}
