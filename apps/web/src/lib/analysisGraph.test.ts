import { describe, it, expect } from 'vitest';
import {
  analysisGraphReducer,
  initialAnalysisGraphState,
  type AnalysisGraphAction,
  type AnalysisGraphState,
} from './analysisGraph';

interface FixtureStep {
  /** Unique label for this step, so assertions key off intent instead of array position — surviving fixture edits. */
  label: string;
  action: AnalysisGraphAction;
}

/**
 * One full realistic run, phased per-agent (risk → careGap → sdoh →
 * actionPlanner → done) — the order `replayCachedAnalysis` in
 * `apps/api/src/routes/analysis.ts` actually emits, and a live run's
 * eventual per-agent order too (risk/careGap/sdoh run in parallel and can
 * interleave live, but this pure state-machine test only cares about
 * per-agent ordering, which phased blocks exercise just as well).
 */
const FIXTURE: FixtureStep[] = [
  { label: 'risk:token:1', action: { event: 'token', agentId: 'risk' } },
  { label: 'risk:token:2', action: { event: 'token', agentId: 'risk' } },
  { label: 'risk:finding:1', action: { event: 'finding', agentId: 'risk' } },
  { label: 'risk:finding:2', action: { event: 'finding', agentId: 'risk' } },
  { label: 'risk:complete', action: { event: 'complete', agentId: 'risk' } },

  { label: 'careGap:token', action: { event: 'token', agentId: 'careGap' } },
  { label: 'careGap:finding', action: { event: 'finding', agentId: 'careGap' } },
  { label: 'careGap:complete', action: { event: 'complete', agentId: 'careGap' } },

  { label: 'sdoh:token', action: { event: 'token', agentId: 'sdoh' } },
  { label: 'sdoh:finding', action: { event: 'finding', agentId: 'sdoh' } },
  { label: 'sdoh:complete', action: { event: 'complete', agentId: 'sdoh' } },

  { label: 'actionPlanner:token', action: { event: 'token', agentId: 'actionPlanner' } },
  { label: 'actionPlanner:finding', action: { event: 'finding', agentId: 'actionPlanner' } },
  { label: 'actionPlanner:task:1', action: { event: 'task', agentId: 'actionPlanner' } },
  { label: 'actionPlanner:task:2', action: { event: 'task', agentId: 'actionPlanner' } },
  { label: 'actionPlanner:complete', action: { event: 'complete', agentId: 'actionPlanner' } },

  { label: 'done', action: { event: 'done' } },
];

/**
 * Runs the fixture through the reducer, returning the state snapshot after
 * each step keyed by that step's label (not its index) — so an edit to
 * `FIXTURE` (inserting/removing/reordering a step) can't silently shift
 * what a test is actually asserting against; a stale/removed label fails
 * loudly with `undefined` instead of pointing at the wrong snapshot.
 */
function runFixture(steps: FixtureStep[]): Record<string, AnalysisGraphState> {
  const snapshots: Record<string, AnalysisGraphState> = {};
  let state = initialAnalysisGraphState;
  for (const { label, action } of steps) {
    state = analysisGraphReducer(state, action);
    snapshots[label] = state;
  }
  return snapshots;
}

describe('analysisGraphReducer', () => {
  it('starts idle with all four nodes pending', () => {
    expect(initialAnalysisGraphState).toEqual({
      graphState: 'idle',
      nodes: { risk: 'pending', careGap: 'pending', sdoh: 'pending', actionPlanner: 'pending' },
    });
  });

  it('drives the documented event sequence through graph states in order', () => {
    const snapshots = runFixture(FIXTURE);

    // INIT→DISPATCH: fires immediately, on the very first event of the run.
    expect(snapshots['risk:token:1'].graphState).toBe('dispatch');
    // Every subsequent event before actionPlanner's first tagged event
    // keeps the graph in the parallel-analysis phase.
    expect(snapshots['risk:token:2'].graphState).toBe('analyzing');
    expect(snapshots['risk:complete'].graphState).toBe('analyzing'); // graph itself isn't done
    expect(snapshots['careGap:complete'].graphState).toBe('analyzing');
    expect(snapshots['sdoh:complete'].graphState).toBe('analyzing');

    // SYNTHESIZING: fires on actionPlanner's FIRST tagged event.
    expect(snapshots['actionPlanner:token'].graphState).toBe('synthesizing');
    // Stays synthesizing through actionPlanner's remaining events, including its own complete.
    expect(snapshots['actionPlanner:finding'].graphState).toBe('synthesizing');
    expect(snapshots['actionPlanner:task:1'].graphState).toBe('synthesizing');
    expect(snapshots['actionPlanner:task:2'].graphState).toBe('synthesizing');
    expect(snapshots['actionPlanner:complete'].graphState).toBe('synthesizing');

    // Graph-level COMPLETE only on the terminal `done` event.
    expect(snapshots['done'].graphState).toBe('complete');
  });

  it('flips a node to analyzing on its first tagged event, independent of other agents', () => {
    const snapshots = runFixture(FIXTURE);

    // risk's first event flips risk to analyzing while the other three stay pending.
    expect(snapshots['risk:token:1'].nodes).toEqual({
      risk: 'analyzing',
      careGap: 'pending',
      sdoh: 'pending',
      actionPlanner: 'pending',
    });

    // careGap's first event flips careGap to analyzing; risk is already complete by then.
    expect(snapshots['careGap:token'].nodes.risk).toBe('complete');
    expect(snapshots['careGap:token'].nodes.careGap).toBe('analyzing');
    expect(snapshots['careGap:token'].nodes.sdoh).toBe('pending');
    expect(snapshots['careGap:token'].nodes.actionPlanner).toBe('pending');
  });

  it('flips a node to complete on its own complete event, independent of other agents', () => {
    const snapshots = runFixture(FIXTURE);

    expect(snapshots['risk:complete'].nodes.risk).toBe('complete');
    expect(snapshots['risk:complete'].nodes.careGap).toBe('pending'); // untouched
    expect(snapshots['risk:complete'].nodes.sdoh).toBe('pending');
    expect(snapshots['risk:complete'].nodes.actionPlanner).toBe('pending');

    expect(snapshots['careGap:complete'].nodes.careGap).toBe('complete');
    expect(snapshots['sdoh:complete'].nodes.sdoh).toBe('complete');
    expect(snapshots['actionPlanner:complete'].nodes.actionPlanner).toBe('complete');

    // Final state: every node complete, graph complete.
    expect(snapshots['done'].nodes).toEqual({
      risk: 'complete',
      careGap: 'complete',
      sdoh: 'complete',
      actionPlanner: 'complete',
    });
  });

  it('supports an explicit start action (idle → init) ahead of the first SSE event, for real hook usage', () => {
    const afterStart = analysisGraphReducer(initialAnalysisGraphState, { event: 'start' });
    expect(afterStart.graphState).toBe('init');

    const afterFirstEvent = analysisGraphReducer(afterStart, { event: 'token', agentId: 'risk' });
    expect(afterFirstEvent.graphState).toBe('dispatch');
    expect(afterFirstEvent.nodes.risk).toBe('analyzing');
  });
});
