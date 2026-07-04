import { PatientBundle } from '../fhir/client';
import { AgentEvent, RiskOutput, CareGapOutput, SdohOutput } from './agent';
import { runRiskAgent } from './riskAgent';
import { runCareGapAgent } from './careGapAgent';
import { runSdohAgent } from './sdohAgent';
import { runActionPlannerAgent } from './actionPlannerAgent';

type BundleAgent = (bundle: PatientBundle) => AsyncIterable<AgentEvent>;
type ActionPlannerAgent = (inputs: {
  risk: RiskOutput;
  careGap: CareGapOutput;
  sdoh: SdohOutput;
}) => AsyncIterable<AgentEvent>;

interface Agents {
  risk: BundleAgent;
  careGap: BundleAgent;
  sdoh: BundleAgent;
  actionPlanner: ActionPlannerAgent;
}

const DEFAULT_AGENTS: Agents = {
  risk: runRiskAgent,
  careGap: runCareGapAgent,
  sdoh: runSdohAgent,
  actionPlanner: runActionPlannerAgent,
};

/**
 * S3 B1 — orchestrates the four agents into one merged stream. Runs the
 * three bundle-driven agents (risk, careGap, sdoh) concurrently, forwarding
 * every event as it arrives (true interleaving, not await-then-await), while
 * collecting each one's terminal `result.output`. Once all three are
 * exhausted, runs the action planner on their collected outputs and forwards
 * its events too.
 *
 * `agents` defaults to the real four agents (mirrors the `client`-defaulting
 * pattern used throughout this package) so tests can inject stubs with
 * controllable timing instead of hitting OpenAI.
 */
export async function* orchestrate(bundle: PatientBundle, agents: Agents = DEFAULT_AGENTS): AsyncIterable<AgentEvent> {
  const iterators = {
    risk: agents.risk(bundle)[Symbol.asyncIterator](),
    careGap: agents.careGap(bundle)[Symbol.asyncIterator](),
    sdoh: agents.sdoh(bundle)[Symbol.asyncIterator](),
  };
  type Key = keyof typeof iterators;

  let riskOutput: RiskOutput | undefined;
  let careGapOutput: CareGapOutput | undefined;
  let sdohOutput: SdohOutput | undefined;

  // Minimal race-based merge: keep exactly one in-flight `.next()` promise
  // per still-running iterator, race them, yield whichever settles first,
  // then re-queue that one's next `.next()` — until all three are done.
  const pending = new Map<Key, Promise<{ key: Key; result: IteratorResult<AgentEvent> }>>();

  function queue(key: Key): void {
    pending.set(
      key,
      iterators[key].next().then((result) => ({ key, result }))
    );
  }

  (Object.keys(iterators) as Key[]).forEach(queue);

  while (pending.size > 0) {
    const { key, result } = await Promise.race(pending.values());

    if (result.done) {
      pending.delete(key);
      continue;
    }

    yield result.value;

    if (result.value.type === 'result') {
      if (result.value.agentId === 'risk') riskOutput = result.value.output;
      else if (result.value.agentId === 'careGap') careGapOutput = result.value.output;
      else if (result.value.agentId === 'sdoh') sdohOutput = result.value.output;
    }

    queue(key);
  }

  if (!riskOutput || !careGapOutput || !sdohOutput) {
    throw new Error('Orchestrator: one or more agents finished without emitting a result event');
  }

  yield* agents.actionPlanner({ risk: riskOutput, careGap: careGapOutput, sdoh: sdohOutput });
}
