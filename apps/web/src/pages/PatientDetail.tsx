import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  getPatient,
  streamAnalysis,
  type AgentId,
  type TaskSummary,
  type AnalysisFinding,
  type AnalysisSummary,
  type AnalysisTask,
} from '../api/client';
import { ageSexLabel } from '../lib/patient';
import { PRIORITY_LABEL, dueLabel } from '../lib/task';
import { useAnalysisGraph } from '../lib/analysisGraph';
import { AgentGraph } from '../components/AgentGraph';

const PRIORITY_CLASS: Record<TaskSummary['priority'], string> = {
  critical: 'text-red bg-red-dim border-red',
  high: 'text-amber bg-amber-dim border-amber',
  medium: 'text-violet bg-violet-dim border-violet',
};

const FALLBACK_PRIORITY_CLASS = 'text-text-muted bg-surface-raised border-border-light';

/**
 * `AnalysisTask.priority` is a bare `string` on the wire (it comes back from a
 * JSON payload, not a typechecked union), so a value outside `TaskPriority`
 * shouldn't crash the render — fall back to a neutral pill instead.
 */
function priorityClassName(priority: string): string {
  return PRIORITY_CLASS[priority as TaskSummary['priority']] ?? FALLBACK_PRIORITY_CLASS;
}

function priorityLabelText(priority: string): string {
  return PRIORITY_LABEL[priority as TaskSummary['priority']] ?? priority.toUpperCase();
}

type FeedAccent = 'red' | 'violet' | 'emerald' | 'amber';
type FeedState = 'idle' | 'streaming' | 'done';

// Translates the mockup's `.feed{border-left:3px solid var(--ac)}` /
// `.feed-label{color:var(--ac)}` CSS-custom-property pattern into per-accent
// Tailwind class sets (no runtime CSS vars needed since the palette is fixed).
const FEED_ACCENT: Record<FeedAccent, { border: string; label: string; cursor: string }> = {
  red: { border: 'border-l-red', label: 'text-red', cursor: 'text-red' },
  violet: { border: 'border-l-violet', label: 'text-violet', cursor: 'text-violet' },
  emerald: { border: 'border-l-emerald', label: 'text-emerald', cursor: 'text-emerald' },
  amber: { border: 'border-l-amber', label: 'text-amber', cursor: 'text-amber' },
};

const SUMMARY_TESTID: Record<AgentId, string> = {
  risk: 'risk-summary',
  careGap: 'care-gap-summary',
  sdoh: 'sdoh-summary',
  actionPlanner: 'action-planner-summary',
};

const FEED_DEFS: Array<{ id: AgentId; label: string; accent: FeedAccent }> = [
  { id: 'risk', label: 'Risk Agent', accent: 'red' },
  { id: 'careGap', label: 'Care Gap', accent: 'violet' },
  { id: 'sdoh', label: 'SDOH', accent: 'emerald' },
  { id: 'actionPlanner', label: 'Action Planner', accent: 'amber' },
];

function FeedBox({
  label,
  accent,
  state,
  children,
}: {
  label: string;
  accent: FeedAccent;
  state: FeedState;
  children: React.ReactNode;
}) {
  const c = FEED_ACCENT[accent];
  return (
    <div
      className={`bg-surface border border-border ${c.border} border-l-[3px] rounded-card flex flex-col overflow-hidden min-h-[112px]`}
    >
      <div className={`text-[9.5px] font-bold tracking-wide uppercase px-2.5 pt-2 pb-1 ${c.label}`}>{label}</div>
      <div
        className={`flex-1 px-2.5 pb-2.5 text-xs leading-relaxed overflow-y-auto ${
          state === 'idle' ? 'text-text-muted' : 'text-text'
        }`}
      >
        {children}
        {state === 'streaming' && (
          <span className={`feed-cursor ${c.cursor}`} aria-hidden="true">
            ▌
          </span>
        )}
      </div>
    </div>
  );
}

function IdlePlaceholder() {
  return <span className="italic text-text-dim">Awaiting analysis run…</span>;
}

/** Per-agent slice of the feeds grid's state. `started` gates idle vs. live rendering. */
interface AgentFeedState {
  started: boolean;
  text: string;
  findings: AnalysisFinding[];
  summary: AnalysisSummary | null;
}

function makeFeeds(riskStarted: boolean): Record<AgentId, AgentFeedState> {
  const blank = (started: boolean): AgentFeedState => ({ started, text: '', findings: [], summary: null });
  return { risk: blank(riskStarted), careGap: blank(false), sdoh: blank(false), actionPlanner: blank(false) };
}

function agentFeedState(feed: AgentFeedState, running: boolean): FeedState {
  if (!feed.started) return 'idle';
  return running ? 'streaming' : 'done';
}

function withText(feeds: Record<AgentId, AgentFeedState>, agentId: AgentId, text: string) {
  return { ...feeds, [agentId]: { ...feeds[agentId], started: true, text: feeds[agentId].text + text } };
}

function withFinding(feeds: Record<AgentId, AgentFeedState>, finding: AnalysisFinding) {
  const prev = feeds[finding.agentId];
  return { ...feeds, [finding.agentId]: { ...prev, started: true, findings: [...prev.findings, finding] } };
}

function withSummary(feeds: Record<AgentId, AgentFeedState>, summary: AnalysisSummary) {
  return { ...feeds, [summary.agentId]: { ...feeds[summary.agentId], started: true, summary } };
}

function AgentFeedContent({ agentId, feed }: { agentId: AgentId; feed: AgentFeedState }) {
  if (!feed.started) return <IdlePlaceholder />;
  return (
    <>
      <span>{feed.text}</span>
      {feed.findings.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {feed.findings.map((flag, i) => (
            <span
              key={`${flag.fhirResourceId}-${i}`}
              className="font-mono text-[10px] text-text-dim bg-bg border border-border rounded-chip px-1.5 py-0.5"
            >
              {flag.fhirResourceId}
            </span>
          ))}
        </div>
      )}
      {feed.summary && (
        <div className="mt-2 pt-2 border-t border-border text-[11px] text-text-muted">
          <span data-testid={SUMMARY_TESTID[agentId]}>
            {agentId === 'risk'
              ? `${feed.summary.riskLevel} risk · score ${feed.summary.riskScore}`
              : `${feed.summary.findingCount} findings · ${feed.summary.droppedCount} dropped`}
          </span>
        </div>
      )}
    </>
  );
}

/** Normalized shape both `TaskSummary` (initial query) and `AnalysisTask` (freshly streamed) render into. */
interface DisplayTask {
  key: string;
  priorityClassName: string;
  priorityLabel: string;
  due: string;
  title: string;
  description?: string;
  reference: string;
  status: string;
  citations?: string[];
}

function fromTaskSummary(task: TaskSummary): DisplayTask {
  return {
    key: `existing-${task.id}`,
    priorityClassName: PRIORITY_CLASS[task.priority],
    priorityLabel: PRIORITY_LABEL[task.priority],
    due: `Due: ${dueLabel(task.due)}`,
    title: task.title,
    reference: `Task/${task.id}`,
    status: task.status,
  };
}

function fromAnalysisTask(task: AnalysisTask): DisplayTask {
  return {
    key: `created-${task.id}`,
    priorityClassName: priorityClassName(task.priority),
    priorityLabel: priorityLabelText(task.priority),
    due: task.dueInDays !== undefined ? `Due in ${task.dueInDays}d` : 'Due: —',
    title: task.title,
    description: task.description,
    reference: task.reference,
    status: 'Open',
    citations: task.fhirResources,
  };
}

export function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => getPatient(id!),
    enabled: !!id,
  });

  const [running, setRunning] = useState(false);
  const [feeds, setFeeds] = useState<Record<AgentId, AgentFeedState>>(() => makeFeeds(false));
  const [createdTasks, setCreatedTasks] = useState<AnalysisTask[]>([]);
  const [graphState, dispatchGraph] = useAnalysisGraph();
  // Which button the user last pressed — the ONLY cache-vs-live signal the
  // client has, since replayed and live SSE streams are identical by design.
  const [lastMode, setLastMode] = useState<'cached' | 'live' | null>(null);

  // `live` selects the SSE source only; every handler below is identical for
  // both modes so the graph + feeds render the same way whether the data came
  // from an instant cache replay or a fresh model run (S4 cache/live parity).
  async function handleRunAnalysis(live: boolean) {
    if (!id || running) return;
    setRunning(true);
    setLastMode(live ? 'live' : 'cached');
    setFeeds(makeFeeds(true));
    setCreatedTasks([]);
    dispatchGraph({ event: 'start' });
    try {
      await streamAnalysis(
        id,
        {
          onToken: (agentId, text) => {
            setFeeds((prev) => withText(prev, agentId, text));
            dispatchGraph({ event: 'token', agentId });
          },
          onFinding: (flag) => {
            setFeeds((prev) => withFinding(prev, flag));
            dispatchGraph({ event: 'finding', agentId: flag.agentId });
          },
          onComplete: (summary) => {
            setFeeds((prev) => withSummary(prev, summary));
            dispatchGraph({ event: 'complete', agentId: summary.agentId });
          },
          onTask: (task) => {
            setCreatedTasks((prev) => [...prev, task]);
            dispatchGraph({ event: 'task', agentId: task.agentId });
          },
          onDone: () => dispatchGraph({ event: 'done' }),
        },
        { live }
      );
    } finally {
      setRunning(false);
    }
  }

  const displayTasks: DisplayTask[] = [
    ...(data?.tasks.map(fromTaskSummary) ?? []),
    ...createdTasks.map(fromAnalysisTask),
  ];

  return (
    <div>
      <Link to="/panel" className="text-label text-cyan hover:underline">
        ← My Patient Panel
      </Link>

      {isLoading && <p className="text-body text-text-muted mt-4">Loading patient…</p>}
      {isError && <p className="text-body text-red mt-4">{(error as Error).message}</p>}

      {data && (
        <div className="mt-4">
          {/* Top bar matches reference-materials/caresync-ai.html's .pt-bar. */}
          <div className="h-11 flex items-center gap-2.5 px-4 -mx-6 -mt-6 mb-6 border-b border-border bg-surface">
            <span className="text-section font-bold text-text">{data.patient.name}</span>
            <span className="text-body text-text-muted">{ageSexLabel(data.patient.birthDate, data.patient.gender)}</span>
            <span className="font-mono text-xs text-text-dim flex-1 truncate">| Patient/{data.patient.id}</span>
            {/* Mode note: derived purely from which button was pressed — the SSE
                stream itself carries no cache-vs-live signal (identical by design).
                A default "Run Analysis" press could still have been served by a
                cold-cache live fallback on the backend; this label reflects intent. */}
            {lastMode && (
              <span className="font-mono text-[10px] text-text-dim uppercase tracking-wide" data-testid="analysis-mode">
                {lastMode === 'live' ? 'live run' : 'cached replay'}
              </span>
            )}
            {/* Secondary, de-emphasized sibling of Run Analysis — forces ?live=1. */}
            <button
              onClick={() => handleRunAnalysis(true)}
              disabled={running}
              className="flex items-center gap-2 bg-transparent border border-border-light text-text-muted font-mono text-label font-bold tracking-wide px-3 py-1.5 rounded-md disabled:opacity-60 disabled:cursor-default"
            >
              Run live
            </button>
            <button
              onClick={() => handleRunAnalysis(false)}
              disabled={running}
              className="flex items-center gap-2 bg-cyan-dim border border-cyan text-cyan font-mono text-label font-bold tracking-wide px-4 py-1.5 rounded-md disabled:opacity-85 disabled:cursor-default"
            >
              {running ? (
                <span className="w-3 h-3 rounded-full border-2 border-cyan/25 border-t-cyan animate-spin" aria-hidden="true" />
              ) : (
                <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden="true">
                  <path d="M1 1.2v9.6L9 6 1 1.2Z" fill="#00C8FF" />
                </svg>
              )}
              <span>{running ? 'Analyzing…' : 'Run Analysis'}</span>
            </button>
          </div>

          {/* Agent-graph canvas — matches reference-materials/caresync-ai.html's
              .canvas-wrap sitting directly above .feeds (S4 closes the last
              recorded W03 deviation). Presentational: PatientDetail owns the
              analysis-graph state (live SSE or, in a future slice, cache
              replay) and passes it down. */}
          <div className="mb-6">
            <AgentGraph state={graphState} />
          </div>

          {/* Feeds grid matches reference-materials/caresync-ai.html's .feeds —
              all four agents (Risk/Care Gap/SDOH/Action Planner) stream live. */}
          <div className="grid grid-cols-4 gap-2.5 mb-6">
            {FEED_DEFS.map(({ id: agentId, label, accent }) => (
              <FeedBox key={agentId} label={label} accent={accent} state={agentFeedState(feeds[agentId], running)}>
                <AgentFeedContent agentId={agentId} feed={feeds[agentId]} />
              </FeedBox>
            ))}
          </div>

          <h2 className="text-section text-text mb-2">Active Conditions</h2>
          <div className="border border-border rounded-card overflow-hidden mb-6">
            {data.conditions.map((condition) => (
              <div key={condition.id} className="px-4 py-3 border-b border-border last:border-b-0 bg-surface">
                <p className="text-body text-text">{condition.display}</p>
                <p className="text-xs font-mono text-text-dim">
                  ICD-10 {condition.code} · Condition/{condition.id}
                </p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-section text-text">Tasks</h2>
            <span className="text-xs font-bold text-cyan bg-cyan-dim border border-cyan rounded-pill px-2.5 py-0.5">
              {displayTasks.length} open
            </span>
          </div>
          {displayTasks.length === 0 && <p className="text-body text-text-muted">No open tasks.</p>}
          {displayTasks.map((task) => (
            <div key={task.key} data-testid={task.key} className="bg-surface-raised border border-border rounded-card p-2.5 mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`text-[9px] font-bold tracking-wide rounded-pill border px-2 py-0.5 ${task.priorityClassName}`}
                >
                  {task.priorityLabel}
                </span>
                <span className="text-xs text-text-muted">{task.due}</span>
              </div>
              <p className="text-body font-bold text-text mb-1.5">{task.title}</p>
              {task.description && <p className="text-xs text-text-muted mb-1.5">{task.description}</p>}
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] text-text-dim">{task.reference}</span>
                <span className="text-xs font-semibold text-text-muted border border-border-light rounded-pill px-2 py-px">
                  {task.status}
                </span>
              </div>
              {task.citations && task.citations.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {task.citations.map((ref) => (
                    <span
                      key={ref}
                      className="font-mono text-[10px] text-text-dim bg-bg border border-border rounded-chip px-1.5 py-0.5"
                    >
                      {ref}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
