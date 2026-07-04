import { orchestrate } from './orchestrator';
import { AgentEvent, RiskOutput, CareGapOutput, SdohOutput, ActionPlannerOutput } from './agent';
import { PatientBundle } from '../fhir/client';

// Deferred — a promise plus its own resolver, so the test can pause a stub
// generator at a specific `await` point and release it on demand. This is
// how we prove true (non-timer, non-flaky) concurrency and a specific
// interleaving: each stub blocks on its own gate until the test resolves it,
// and the test resolves gates in the exact order it wants to observe.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const bundle: PatientBundle = { resources: [], validIds: new Set<string>() };

const RISK_OUTPUT: RiskOutput = { riskScore: 80, riskLevel: 'high', flags: [], readmissionProbability: 0.5 };
const CARE_GAP_OUTPUT: CareGapOutput = { gaps: [] };
const SDOH_OUTPUT: SdohOutput = { barriers: [], referralsNeeded: [] };
const ACTION_PLANNER_OUTPUT: ActionPlannerOutput = { tasks: [] };

describe('orchestrate (S3 B1 — four-agent orchestration)', () => {
  it('runs the three parallel agents concurrently (interleaved), then the planner once all three finish, with the planner receiving exactly the three collected outputs', async () => {
    const gates = {
      riskToken: deferred(),
      riskResult: deferred(),
      careGapToken: deferred(),
      careGapResult: deferred(),
      sdohToken: deferred(),
      sdohResult: deferred(),
    };

    async function* fakeRisk(): AsyncIterable<AgentEvent> {
      await gates.riskToken.promise;
      yield { type: 'token', agentId: 'risk', text: 'risk-token' };
      await gates.riskResult.promise;
      yield { type: 'result', agentId: 'risk', output: RISK_OUTPUT };
    }

    async function* fakeCareGap(): AsyncIterable<AgentEvent> {
      await gates.careGapToken.promise;
      yield { type: 'token', agentId: 'careGap', text: 'careGap-token' };
      await gates.careGapResult.promise;
      yield { type: 'result', agentId: 'careGap', output: CARE_GAP_OUTPUT };
    }

    async function* fakeSdoh(): AsyncIterable<AgentEvent> {
      await gates.sdohToken.promise;
      yield { type: 'token', agentId: 'sdoh', text: 'sdoh-token' };
      await gates.sdohResult.promise;
      yield { type: 'result', agentId: 'sdoh', output: SDOH_OUTPUT };
    }

    let plannerCalledWith: { risk: RiskOutput; careGap: CareGapOutput; sdoh: SdohOutput } | undefined;
    async function* fakeActionPlanner(inputs: {
      risk: RiskOutput;
      careGap: CareGapOutput;
      sdoh: SdohOutput;
    }): AsyncIterable<AgentEvent> {
      plannerCalledWith = inputs;
      yield { type: 'token', agentId: 'actionPlanner', text: 'plan-token' };
      yield { type: 'result', agentId: 'actionPlanner', output: ACTION_PLANNER_OUTPUT };
    }

    const iterator = orchestrate(bundle, {
      risk: fakeRisk,
      careGap: fakeCareGap,
      sdoh: fakeSdoh,
      actionPlanner: fakeActionPlanner,
    })[Symbol.asyncIterator]();

    const events: AgentEvent[] = [];

    // Step 1: risk's token arrives first.
    gates.riskToken.resolve();
    events.push((await iterator.next()).value as AgentEvent);

    // Step 2: sdoh's token arrives next — proves risk and sdoh ran
    // concurrently rather than risk-to-completion-then-sdoh.
    gates.sdohToken.resolve();
    events.push((await iterator.next()).value as AgentEvent);

    // Step 3: risk finishes (its result) before careGap has even started —
    // proves the agents are not run strictly one-after-another.
    gates.riskResult.resolve();
    events.push((await iterator.next()).value as AgentEvent);

    // Step 4: careGap's token now arrives — AFTER risk's result, while sdoh
    // is still mid-flight. This is the "not strictly serialized" assertion:
    // careGap's token interleaves after risk's terminal event, not before it
    // and not only once risk+sdoh have both fully finished.
    gates.careGapToken.resolve();
    events.push((await iterator.next()).value as AgentEvent);

    // Step 5: sdoh finishes.
    gates.sdohResult.resolve();
    events.push((await iterator.next()).value as AgentEvent);

    // Step 6: careGap finishes — all three parallel agents are now done.
    gates.careGapResult.resolve();
    events.push((await iterator.next()).value as AgentEvent);

    // Step 7: only now should the planner start.
    const plannerToken = await iterator.next();
    events.push(plannerToken.value as AgentEvent);

    // Step 8: planner result.
    events.push((await iterator.next()).value as AgentEvent);

    // Step 9: stream ends.
    const final = await iterator.next();
    expect(final.done).toBe(true);

    expect(events).toEqual([
      { type: 'token', agentId: 'risk', text: 'risk-token' },
      { type: 'token', agentId: 'sdoh', text: 'sdoh-token' },
      { type: 'result', agentId: 'risk', output: RISK_OUTPUT },
      { type: 'token', agentId: 'careGap', text: 'careGap-token' },
      { type: 'result', agentId: 'sdoh', output: SDOH_OUTPUT },
      { type: 'result', agentId: 'careGap', output: CARE_GAP_OUTPUT },
      { type: 'token', agentId: 'actionPlanner', text: 'plan-token' },
      { type: 'result', agentId: 'actionPlanner', output: ACTION_PLANNER_OUTPUT },
    ]);

    // The planner must receive exactly the three collected outputs, keyed
    // correctly by agent.
    expect(plannerCalledWith).toEqual({
      risk: RISK_OUTPUT,
      careGap: CARE_GAP_OUTPUT,
      sdoh: SDOH_OUTPUT,
    });
  });
});
