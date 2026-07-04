import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import {
  getPatient,
  streamAnalysis,
  type TaskSummary,
  type AnalysisFinding,
  type AnalysisSummary,
} from '../api/client';
import { ageSexLabel } from '../lib/patient';
import { PRIORITY_LABEL, dueLabel } from '../lib/task';

const PRIORITY_CLASS: Record<TaskSummary['priority'], string> = {
  critical: 'text-red bg-red-dim border-red',
  high: 'text-amber bg-amber-dim border-amber',
  medium: 'text-violet bg-violet-dim border-violet',
};

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

export function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => getPatient(id!),
    enabled: !!id,
  });

  const [running, setRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [riskText, setRiskText] = useState('');
  const [findings, setFindings] = useState<AnalysisFinding[]>([]);
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);

  const riskState: FeedState = !hasRun ? 'idle' : running ? 'streaming' : 'done';

  async function handleRunAnalysis() {
    if (!id || running) return;
    setRunning(true);
    setHasRun(true);
    setRiskText('');
    setFindings([]);
    setSummary(null);
    try {
      await streamAnalysis(id, {
        onToken: (text) => setRiskText((prev) => prev + text),
        onFinding: (flag) => setFindings((prev) => [...prev, flag]),
        onComplete: (result) => setSummary(result),
      });
    } finally {
      setRunning(false);
    }
  }

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
            <button
              onClick={handleRunAnalysis}
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

          {/* Feeds grid matches reference-materials/caresync-ai.html's .feeds — the
              agent-graph canvas above it is out of scope (S4). Risk Agent is live
              this slice; Care Gap/SDOH/Action Planner stay honest idle placeholders
              until S3 wires their agents up. */}
          <div className="grid grid-cols-4 gap-2.5 mb-6">
            <FeedBox label="Risk Agent" accent="red" state={riskState}>
              {!hasRun ? (
                <IdlePlaceholder />
              ) : (
                <>
                  <span>{riskText}</span>
                  {findings.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {findings.map((flag, i) => (
                        <span
                          key={`${flag.fhirResourceId}-${i}`}
                          className="font-mono text-[10px] text-text-dim bg-bg border border-border rounded-chip px-1.5 py-0.5"
                        >
                          {flag.fhirResourceId}
                        </span>
                      ))}
                    </div>
                  )}
                  {summary && (
                    <div className="mt-2 pt-2 border-t border-border text-[11px] text-text-muted">
                      <span data-testid="risk-summary">
                        {summary.riskLevel} risk · score {summary.riskScore}
                      </span>
                    </div>
                  )}
                </>
              )}
            </FeedBox>
            <FeedBox label="Care Gap" accent="violet" state="idle">
              <IdlePlaceholder />
            </FeedBox>
            <FeedBox label="SDOH" accent="emerald" state="idle">
              <IdlePlaceholder />
            </FeedBox>
            <FeedBox label="Action Planner" accent="amber" state="idle">
              <IdlePlaceholder />
            </FeedBox>
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
              {data.tasks.length} open
            </span>
          </div>
          {data.tasks.length === 0 && <p className="text-body text-text-muted">No open tasks.</p>}
          {data.tasks.map((task) => (
            <div key={task.id} className="bg-surface-raised border border-border rounded-card p-2.5 mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`text-[9px] font-bold tracking-wide rounded-pill border px-2 py-0.5 ${PRIORITY_CLASS[task.priority]}`}
                >
                  {PRIORITY_LABEL[task.priority]}
                </span>
                <span className="text-xs text-text-muted">Due: {dueLabel(task.due)}</span>
              </div>
              <p className="text-body font-bold text-text mb-1.5">{task.title}</p>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] text-text-dim">Task/{task.id}</span>
                <span className="text-xs font-semibold text-text-muted border border-border-light rounded-pill px-2 py-px">
                  {task.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
