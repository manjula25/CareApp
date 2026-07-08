import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPatient,
  streamAnalysis,
  subscribeToEvents,
  type AgentId,
  type AnalysisFinding,
  type AnalysisSummary,
  type AnalysisTask,
  type AssignedTaskEvent,
  type PatientDetail as PatientDetailPayload,
} from '../api/client';
import { ageSexLabel, sexLabel } from '../lib/patient';
import { useAnalysisGraph } from '../lib/analysisGraph';
import {
  MOCK_PATIENTS,
  DEFAULT_VITALS,
  GRAPH_TASKS,
  FHIR_BUNDLE,
  type DisplayPatient,
} from './PatientDetail.fixtures';

/**
 * PatientDetail — merged UI/UX (CinemaView, OrchestratorView, ActionCard,
 * progress widget) from the lead project, with the real-data layer
 * (TanStack Query + clean SSE handlers + cross-surface sync) from the backend
 * branch.
 *
 * UI from lead:
 *   - Three view modes (Panel, Cinema, Orchestrator) toggled in the top bar.
 *   - CinemaView: left-rail patient card + 4 agent panels + action plan grid.
 *   - OrchestratorView: animated graph canvas + per-agent finding streams.
 *   - ActionCard with "Create Task" stub button (no real /api/tasks POST for
 *     recommended actions yet — the live stream emits real Task entities via
 *     the onTask handler below; the ActionCard UI is the in-place visual for
 *     findings already shown in the graph feeds).
 *   - AnalysisProgressFloat widget tracking all 4 agents.
 *
 * Real-data layer from backend:
 *   - `useQuery(['patient', id])` instead of MOCK_PATIENTS[0] default state.
 *   - `feeds` state keyed by AgentId with `withText` / `withFinding` /
 *     `withSummary` helpers — each SSE event updates exactly ONE feed, no
 *     cross-agent bleed (the bug the lead-port's mock-sim+timeout caused).
 *   - No 4s timeout, no runMockSim — the real stream IS the only source
 *     (per the user's "real implementation primary, mock as safety net only"
 *     decision). If the stream errors, the error is surfaced via the UI
 *     naturally; if it succeeds, it succeeds.
 *   - `subscribeToEvents` invalidates the patient query on Task updates for
 *     THIS patient so a coordinator's status change live-refetches this
 *     social-worker's / director's view (closes the cross-surface sync gap).
 *
 * Honest-staging notes:
 *   - `MOCK_PATIENTS` provides riskScore / riskLevel / daysSinceContact — the
 *     real `getPatient` API only returns patient / conditions / tasks. The
 *     sidebar uses MOCK_PATIENTS as a fallback for the visual risk badge in
 *     the hero-patient case; for non-hero patients, it shows "—".
 *   - `DEFAULT_VITALS` / `GRAPH_TASKS` / `FHIR_BUNDLE` are pure visual demo
 *     data feeding the sidebar vitals block + orchestrator-mode right rail.
 *     Not wired to /api/tasks or /api/patients/:id/bundle — those surfaces
 *     have their own pages.
 */

// ── Constants ───────────────────────────────────────────────────────────────

const AGENT_KEYS: AgentId[] = ['risk', 'careGap', 'sdoh', 'actionPlanner'];

const AGENT_LABELS: Record<AgentId, string> = {
  risk: 'Risk Agent',
  careGap: 'Care Gap Agent',
  sdoh: 'SDOH Agent',
  actionPlanner: 'Action Planner',
};

const AGENT_ACCENT: Record<AgentId, { border: string; bg: string; text: string; icon: string; label: string }> = {
  risk:         { border: 'border-red/40',    bg: 'bg-red/5',    text: 'text-red',    icon: '⚡', label: 'Risk Agent' },
  careGap:      { border: 'border-violet/40', bg: 'bg-violet/5', text: 'text-violet', icon: '🩺', label: 'Care Gap' },
  sdoh:         { border: 'border-cyan/40',   bg: 'bg-cyan/5',   text: 'text-cyan',   icon: '🏘', label: 'SDOH' },
  actionPlanner:{ border: 'border-amber/40',  bg: 'bg-amber/5',  text: 'text-amber',  icon: '✅', label: 'Action Planner' },
};

const ORCH_COLORS: Record<AgentId | 'orchestrator', string> = {
  orchestrator: '#00C8FF',
  risk: '#E84848',
  careGap: '#8661D4',
  sdoh: '#0FC48A',
  actionPlanner: '#F0970A',
};

const GRAPH_PANEL_LABELS: Record<AgentId, string> = {
  risk: 'RISK AGENT',
  careGap: 'CARE GAP',
  sdoh: 'SDOH',
  actionPlanner: 'ACTION PLANNER',
};

/** Per-agent summary testIds (used by PatientDetail.test.tsx). Matches the
 *  backend-branch wording the existing test suite asserts against. */
const SUMMARY_TESTID: Record<AgentId, string> = {
  risk: 'risk-summary',
  careGap: 'care-gap-summary',
  sdoh: 'sdoh-summary',
  actionPlanner: 'action-planner-summary',
};

type Severity = 'critical' | 'high' | 'medium' | 'low';

// ── Per-agent feed state (backend pattern) ─────────────────────────────────

interface AgentFeedState {
  started: boolean;
  text: string;
  findings: AnalysisFinding[];
  summary: AnalysisSummary | null;
}

function makeFeeds(): Record<AgentId, AgentFeedState> {
  const blank = (): AgentFeedState => ({ started: false, text: '', findings: [], summary: null });
  return { risk: blank(), careGap: blank(), sdoh: blank(), actionPlanner: blank() };
}

function withText(feeds: Record<AgentId, AgentFeedState>, agentId: AgentId, text: string) {
  return {
    ...feeds,
    [agentId]: { ...feeds[agentId], started: true, text: feeds[agentId].text + text },
  };
}

function withFinding(feeds: Record<AgentId, AgentFeedState>, finding: AnalysisFinding) {
  const prev = feeds[finding.agentId];
  return {
    ...feeds,
    [finding.agentId]: { ...prev, started: true, findings: [...prev.findings, finding] },
  };
}

function withSummary(feeds: Record<AgentId, AgentFeedState>, summary: AnalysisSummary) {
  return {
    ...feeds,
    [summary.agentId]: { ...feeds[summary.agentId], started: true, summary },
  };
}

/** Action plan view derives synthesized actions from `feeds[actionPlanner].summary`
 *  + any stream-emitted tasks; when the wire doesn't carry a separate
 *  action-finding list, we synthesise one from the actionPlanner summary so
 *  CinemaView's "Create Task" cards still have something to render. */
interface DisplayAction {
  key: string;
  text: string;
  citation: string;
  severity: Severity;
  confidence: number;
}

/** Human label per feed state, used by the progress widget + the cinema panels. */
function statusLabel(feed: AgentFeedState): 'running' | 'complete' | 'idle' {
  if (!feed.started) return 'idle';
  if (feed.summary) return 'complete';
  return 'running';
}

// ── Helpers ────────────────────────────────────────────────────────────────

function severityDot(s: Severity | undefined): string {
  switch (s) {
    case 'critical': return 'bg-red';
    case 'high': return 'bg-red';
    case 'medium': return 'bg-amber';
    case 'low': return 'bg-emerald';
    default: return 'bg-surface-hover border border-border';
  }
}

function riskBadgeClasses(level: DisplayPatient['riskLevel'] | undefined): string {
  switch (level) {
    case 'critical': return 'bg-red text-white';
    case 'high': return 'bg-amber text-bg';
    case 'medium': return 'bg-amber-dim text-amber';
    case 'low': return 'bg-emerald-dim text-emerald';
    default: return 'bg-surface-raised text-text-muted border border-border';
  }
}

function priorityBadgeClasses(s: Severity | undefined): string {
  switch (s) {
    case 'critical': return 'bg-red-dim text-red';
    case 'high': return 'bg-amber-dim text-amber';
    case 'medium': return 'bg-amber-dim text-amber';
    case 'low': return 'bg-emerald-dim text-emerald';
    default: return 'bg-surface-raised text-text-muted';
  }
}

function confidenceBarColor(c: number): string {
  if (c >= 0.9) return 'bg-emerald';
  if (c >= 0.75) return 'bg-amber';
  return 'bg-red';
}

/** Bridge API `PatientDetail` → `DisplayPatient` for the CinemaView sidebar.
 *  Risk score / risk level / daysSinceContact aren't on the API response, so
 *  we look them up from MOCK_PATIENTS (the hero-patient fixture set) and
 *  fall back to "—" for non-MOCK routes. Sidebar shows real name/age/sex/
 *  conditions pulled from the API so it never fabricates identifiers. */
function buildDisplayPatient(
  apiData: PatientDetailPayload | undefined,
  routeId: string | undefined,
): DisplayPatient {
  const baseFallback = MOCK_PATIENTS[0];
  const byId = routeId ? MOCK_PATIENTS.find((p) => p.id === routeId) : undefined;

  if (!apiData) {
    return routeId && byId ? byId : baseFallback;
  }

  const birthDate = apiData.patient.birthDate;
  const age = birthDate
    ? Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 3600 * 1000))
    : byId?.age ?? 0;

  return {
    id: apiData.patient.id ?? byId?.id ?? baseFallback.id,
    mrn: apiData.patient.id ?? byId?.mrn ?? baseFallback.mrn,
    name: apiData.patient.name ?? byId?.name ?? baseFallback.name,
    age,
    sex: sexLabel(apiData.patient.gender) ?? byId?.sex ?? baseFallback.sex,
    conditions: apiData.conditions.length > 0
      ? apiData.conditions.map((c) => c.display).filter(Boolean)
      : byId?.conditions ?? baseFallback.conditions,
    riskScore: byId?.riskScore ?? 0,
    riskLevel: byId?.riskLevel ?? 'low',
    daysSinceContact: byId?.daysSinceContact ?? 0,
  };
}

/** Severity fallback: `AnalysisTask.priority` is a bare wire string, so coerce
 *  unknown values to 'medium' rather than crashing the ActionCard render. */
function coerceSeverity(p: string): Severity {
  return (['critical', 'high', 'medium', 'low'] as const).includes(p as Severity)
    ? (p as Severity)
    : 'medium';
}

/** Synthesise an action-finding list for the CinemaView + PanelView "Action
 *  Plan" cards. The real stream doesn't always emit per-action findings with
 *  stable IDs + severities (the backend returns `findingCount` + `droppedCount`
 *  on `AnalysisSummary` instead), so when the wire feed lacks findings we
 *  render one card per stream-emitted `AnalysisTask` (the actionPlanner's
 *  `task` event), and when those are also absent we fall back to a single
 *  neutral "Run analysis to populate" placeholder card. */
function buildActionPlan(
  feeds: Record<AgentId, AgentFeedState>,
  createdTasks: AnalysisTask[],
): DisplayAction[] {
  const apFindings = feeds.actionPlanner.findings;
  if (apFindings.length > 0) {
    return apFindings.map((f, i) => ({
      key: `${f.fhirResourceId ?? 'finding'}-${i}`,
      text: f.text ?? f.finding ?? f.description ?? 'Untitled finding',
      citation: f.fhirResourceId ?? 'unsourced',
      severity: coerceSeverity(f.severity ?? 'medium'),
      // `confidence` lives in the index signature — narrow the unknown to a
      // number with a safe default so the ActionCard progress bar renders.
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.8,
    }));
  }
  if (createdTasks.length > 0) {
    return createdTasks.map((t) => ({
      key: `created-${t.id}`,
      text: t.title,
      citation: t.reference,
      severity: coerceSeverity(t.priority),
      confidence: 0.8,
    }));
  }
  return [];
}

// ── Visual helpers + sub-components (kept from lead) ───────────────────────

function StatusDot({ status }: { status: 'running' | 'complete' | 'idle' }) {
  if (status === 'running') {
    return (
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet" />
      </span>
    );
  }
  if (status === 'complete') return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald" />;
  return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-surface-hover border border-border" />;
}

function CinemaAgentPanel({ agentId, feed }: { agentId: AgentId; feed: AgentFeedState }) {
  const accent = AGENT_ACCENT[agentId];
  const status = statusLabel(feed);
  const isAction = agentId === 'actionPlanner';
  return (
    <div className={`rounded-xl border ${accent.border} ${accent.bg} p-5 flex flex-col gap-3`}>
      <div className="flex items-center gap-3">
        <span className="text-xl leading-none">{accent.icon}</span>
        <span className={`font-bold text-sm tracking-wide uppercase ${accent.text}`}>{accent.label}</span>
        <div className="ml-auto flex items-center gap-2">
          <StatusDot status={status} />
          <span className="text-text-dim text-xs">
            {status === 'idle' ? 'Waiting to run…' : status === 'running' ? 'Streaming…' : 'Complete'}
          </span>
        </div>
      </div>

      {status === 'running' && (
        <div className="bg-bg rounded-lg p-3 border border-border min-h-[48px]">
          <p className="text-text-muted text-xs font-mono leading-relaxed">
            {feed.text || 'Analyzing FHIR bundle…'}
            <span className="animate-pulse">▍</span>
          </p>
        </div>
      )}

      {status === 'idle' && <p className="text-text-dim text-sm italic">Waiting to run…</p>}

      {status === 'complete' && feed.findings.length > 0 && (
        <div className="space-y-3">
          {feed.findings.map((f, i) => {
            const sev = coerceSeverity(f.severity ?? 'medium');
            const confidence = typeof f.confidence === 'number' ? f.confidence : 0.8;
            return (
              <div key={`${f.fhirResourceId ?? 'finding'}-${i}`} className="flex gap-3 items-start">
                <span className={`mt-1.5 flex-shrink-0 w-2.5 h-2.5 rounded-full ${severityDot(sev)}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium leading-snug ${isAction ? 'text-text text-base' : 'text-text'}`}>
                    {f.text ?? f.finding ?? f.description ?? 'Untitled finding'}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs font-mono text-text-dim truncate">{f.fhirResourceId ?? 'unsourced'}</span>
                    <span className={`text-xs font-semibold flex-shrink-0 ${
                      confidence >= 0.9 ? 'text-emerald' : confidence >= 0.75 ? 'text-amber' : 'text-red'
                    }`}>{(confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full uppercase tracking-wide font-semibold ${priorityBadgeClasses(sev)}`}>
                  {sev}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {status === 'complete' && feed.summary && (
        <p className="text-text-dim text-xs italic" data-testid={SUMMARY_TESTID[agentId]}>
          {agentId === 'risk'
            ? `${feed.summary.riskLevel} risk · score ${feed.summary.riskScore}`
            : `${feed.summary.findingCount} findings · ${feed.summary.droppedCount} dropped`}
        </p>
      )}
    </div>
  );
}

interface ActionCardProps {
  action: DisplayAction;
  isCreated: boolean;
  onCreated: (key: string) => void;
}

function ActionCard({ action, isCreated, onCreated }: ActionCardProps) {
  const [loading, setLoading] = useState(false);

  /** Phase 1 — task creation is intentionally a local-only UI stub. The real
   *  `POST /api/tasks` endpoint requires a full Task body, and the action
   *  planner's stream-emitted `AnalysisTask` events are what create real
   *  Task resources in HAPI (handled in onTask above). This stub is the
   *  visual affordance the mockup expects for finding-→-task creation. */
  const handleCreate = async () => {
    if (isCreated || loading) return;
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      onCreated(action.key);
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface-raised rounded-lg p-4 mb-3 border border-border-light">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${priorityBadgeClasses(action.severity)}`}>
          {action.severity}
        </span>
      </div>
      <p className="font-medium text-text text-sm leading-snug mb-1">{action.text}</p>
      <p className="text-text-dim text-xs font-mono mb-3">{action.citation}</p>

      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <span className="text-text-dim text-xs">Confidence</span>
          <span className="text-text-dim text-xs">{(action.confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="w-full h-1 bg-surface rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${confidenceBarColor(action.confidence)}`} style={{ width: `${action.confidence * 100}%` }} />
        </div>
      </div>

      <button
        onClick={handleCreate}
        disabled={isCreated || loading}
        data-testid={`create-task-${action.citation}`}
        className={`text-xs px-3 py-1 rounded border transition-colors ${
          isCreated
            ? 'bg-emerald-dim text-emerald border-emerald cursor-default'
            : 'bg-surface-hover border border-border-light text-text-muted hover:border-cyan hover:text-cyan'
        }`}
      >
        {isCreated ? 'Task Created ✓' : loading ? 'Creating…' : 'Create Task'}
      </button>
    </div>
  );
}

// ── Panel-view sub-components (3-column layout, ported from lead) ───────────

/** Lead's `AgentCard` adapted to the current project's `AgentFeedState`. Renders
 *  the running-stream text and the complete-state findings list with severity
 *  dots + FHIR citation + confidence. The status pill ("Complete — N findings"
 *  / "Running" / "Idle") reuses the existing `statusLabel` helper. */
function PanelAgentCard({ agentId, feed }: { agentId: AgentId; feed: AgentFeedState }) {
  const status = statusLabel(feed);
  const label =
    status === 'complete'
      ? `Complete — ${feed.findings.length} finding${feed.findings.length !== 1 ? 's' : ''}`
      : status === 'running'
        ? 'Running…'
        : 'Idle';

  return (
    <div className="bg-surface-raised rounded-lg p-4 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <StatusDot status={status} />
        <span className="font-bold text-text text-sm">{AGENT_LABELS[agentId]}</span>
        <span className="ml-auto text-text-dim text-xs">{label}</span>
      </div>

      {status === 'running' && feed.text && (
        <p className="text-text-muted text-xs font-mono mt-1 leading-relaxed line-clamp-3">
          {feed.text}
        </p>
      )}

      {status === 'complete' && feed.findings.length > 0 && (
        <ul className="mt-2 space-y-2">
          {feed.findings.map((f, i) => {
            const sev = coerceSeverity(f.severity ?? 'medium');
            const text = f.text ?? f.finding ?? f.description ?? 'Untitled finding';
            const conf = typeof f.confidence === 'number' ? f.confidence : null;
            return (
              <li key={`${f.fhirResourceId ?? 'finding'}-${i}`} className="flex gap-2 items-start">
                <span className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${severityDot(sev)}`} />
                <div className="min-w-0">
                  <p className="text-text text-sm leading-snug">{text}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-text-dim text-xs font-mono truncate">{f.fhirResourceId ?? 'unsourced'}</span>
                    {conf !== null && (
                      <span className="text-text-dim text-xs flex-shrink-0">Conf: {conf.toFixed(2)}</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {feed.summary && (
        <div className="mt-2 pt-2 border-t border-border text-[11px] text-text-muted">
          <span data-testid={SUMMARY_TESTID[agentId]}>
            {agentId === 'risk'
              ? `${feed.summary.riskLevel ?? 'unknown'} risk · score ${feed.summary.riskScore ?? '—'}`
              : `${feed.summary.findingCount} findings · ${feed.summary.droppedCount} dropped`}
          </span>
        </div>
      )}
    </div>
  );
}

/** Lead's `ActionCard` adapted to the current project's `DisplayAction` shape.
 *  Severity pill + finding body + FHIR citation + confidence bar + "Create
 *  Task" stub button. Same local-only creation affordance as CinemaView's
 *  ActionCard — real Task resources are created by the actionPlanner's stream
 *  `task` event handler in `handleRunAnalysis`. */
function PanelActionCard({ action, isCreated, onCreated }: {
  action: DisplayAction;
  isCreated: boolean;
  onCreated: (key: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const handleCreate = async () => {
    if (isCreated || loading) return;
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      onCreated(action.key);
      setLoading(false);
    }
  };
  return (
    <div className="bg-surface-raised rounded-lg p-4 mb-3 border border-border-light">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${priorityBadgeClasses(action.severity)}`}>
          {action.severity}
        </span>
      </div>
      <p className="font-medium text-text text-sm leading-snug mb-1">{action.text}</p>
      <p className="text-text-dim text-xs font-mono mb-3">{action.citation}</p>
      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <span className="text-text-dim text-xs">Confidence</span>
          <span className="text-text-dim text-xs">{(action.confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="w-full h-1 bg-surface rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${confidenceBarColor(action.confidence)}`}
            style={{ width: `${action.confidence * 100}%` }}
          />
        </div>
      </div>
      <button
        onClick={handleCreate}
        disabled={isCreated || loading}
        data-testid={`panel-create-task-${action.citation}`}
        className={`text-xs px-3 py-1 rounded border transition-colors ${
          isCreated
            ? 'bg-emerald-dim text-emerald border-emerald cursor-default'
            : 'bg-surface-hover border border-border-light text-text-muted hover:border-cyan hover:text-cyan'
        }`}
      >
        {isCreated ? 'Task Created ✓' : loading ? 'Creating…' : 'Create Task'}
      </button>
    </div>
  );
}

// ── CinemaView (kept from lead, adapted to AgentId keys) ───────────────────

interface CinemaViewProps {
  patient: DisplayPatient;
  feeds: Record<AgentId, AgentFeedState>;
  running: boolean;
  onRun: () => void;
  actions: DisplayAction[];
  createdActionKeys: Set<string>;
  onActionCreated: (key: string) => void;
  onBack: () => void;
}

function CinemaView({ patient, feeds, running, onRun, actions, createdActionKeys, onActionCreated, onBack }: CinemaViewProps) {
  return (
    <div className="flex h-[calc(100vh-48px)] overflow-hidden">
      <div className="w-72 flex-shrink-0 bg-surface border-r border-border flex flex-col p-5 gap-4 overflow-y-auto">
        <button onClick={onBack} className="text-text-muted text-sm hover:text-cyan transition-colors text-left w-fit">
          ← Population
        </button>

        <div className="flex flex-col items-center gap-2 py-4">
          <div
            className={`w-24 h-24 rounded-full flex flex-col items-center justify-center ${riskBadgeClasses(patient.riskLevel)} shadow-lg`}
            style={{ boxShadow: patient.riskLevel === 'critical' ? '0 0 32px rgba(232,72,72,0.4)' : undefined }}
            data-testid="cinema-risk-badge"
          >
            <span className="text-4xl font-black leading-none">{patient.riskScore || '—'}</span>
            <span className="text-xs font-bold uppercase tracking-wider opacity-80 mt-1">{patient.riskLevel}</span>
          </div>
          <div className="text-center">
            <p className="text-text font-bold text-lg">{patient.name}</p>
            <p className="text-text-muted text-xs">{patient.age}y {patient.sex} · MRN {patient.mrn}</p>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Conditions</p>
          {patient.conditions.map((c) => (
            <div key={c} className="flex items-center gap-2 mb-1.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${severityDot('medium')}`} />
              <span className="text-text text-sm">{c}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Key Vitals</p>
          <div className="space-y-2">
            {DEFAULT_VITALS.map((v) => (
              <div key={v.label} className="flex justify-between">
                <span className="text-text-muted text-xs">{v.label}</span>
                <span className="text-text text-xs font-mono font-semibold">{v.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto border-t border-border pt-4">
          <p className="text-text-muted text-xs">
            Last contact:{' '}
            <span className={`font-semibold ${patient.daysSinceContact <= 3 ? 'text-emerald' : patient.daysSinceContact <= 14 ? 'text-amber' : 'text-red'}`}>
              {patient.daysSinceContact}d ago
            </span>
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-bg">
        <div className="sticky top-0 z-10 bg-bg/95 backdrop-blur border-b border-border px-8 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-text font-bold text-lg">AI Agent Analysis</h2>
            <p className="text-text-dim text-xs mt-0.5">Four specialized agents · FHIR R4 · Citations required</p>
          </div>
          <button
            onClick={onRun}
            disabled={running}
            data-testid="cinema-run-analysis"
            className="bg-violet text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ boxShadow: '0 0 20px rgba(134,97,212,0.4)' }}
          >
            {running ? '⟳ Running…' : '▶ Run Analysis'}
          </button>
        </div>

        <div className="px-8 py-6 space-y-4">
          {(['risk', 'careGap', 'sdoh'] as AgentId[]).map((agentId) => (
            <CinemaAgentPanel key={agentId} agentId={agentId} feed={feeds[agentId]} />
          ))}

          {feeds.actionPlanner.started && (
            <div className="flex items-center gap-3 py-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-text-dim text-xs uppercase tracking-widest">synthesized action plan</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {feeds.actionPlanner.started && (
            <CinemaAgentPanel agentId="actionPlanner" feed={feeds.actionPlanner} />
          )}

          {actions.length > 0 && (
            <div className="grid grid-cols-3 gap-4 pt-2">
              {actions.map((action) => (
                <ActionCard
                  key={action.key}
                  action={action}
                  isCreated={createdActionKeys.has(action.key)}
                  onCreated={onActionCreated}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── OrchestratorView (kept from lead, adapted to AgentId keys) ─────────────

function h2r(hex: string) {
  return `${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)}`;
}

function OrchestratorCanvas({ feeds }: { feeds: Record<AgentId, AgentFeedState> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const feedsRef = useRef(feeds);
  feedsRef.current = feeds;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize() {
      if (!canvas || !ctx) return;
      const dprInner = window.devicePixelRatio || 1;
      canvas!.width = canvas!.offsetWidth * dprInner;
      canvas!.height = canvas!.offsetHeight * dprInner;
      ctx!.setTransform(dprInner, 0, 0, dprInner, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const t0 = performance.now();

    function draw(now: number) {
      if (!canvas || !ctx) return;
      const t = now - t0;
      const W = canvas!.offsetWidth;
      const H = canvas!.offsetHeight;
      const fd = feedsRef.current;

      ctx!.clearRect(0, 0, W, H);
      ctx!.fillStyle = '#07111E';
      ctx!.fillRect(0, 0, W, H);

      const sp = 28;
      ctx!.fillStyle = 'rgba(0,200,255,0.05)';
      for (let gx = sp / 2; gx < W; gx += sp)
        for (let gy = sp / 2; gy < H; gy += sp) {
          ctx!.beginPath(); ctx!.arc(gx, gy, 1, 0, Math.PI * 2); ctx!.fill();
        }

      const cx = W / 2, cy = H / 2;
      const vSpread = H * 0.41;
      const hSpread = Math.min(W * 0.24, vSpread);

      const statusOf = (id: AgentId): 'running' | 'complete' | 'idle' => statusLabel(fd[id]);

      const nodes: Array<{ key: AgentId | 'orchestrator'; x: number; y: number; r: number; label: string; color: string; status: 'running' | 'complete' | 'idle' }> = [
        { key: 'orchestrator', x: cx, y: cy, r: 38, label: 'Orchestrator', color: ORCH_COLORS.orchestrator, status: 'running' as const },
        { key: 'risk',          x: cx, y: cy - vSpread, r: 26, label: 'Risk Agent', color: ORCH_COLORS.risk, status: statusOf('risk') },
        { key: 'careGap',       x: cx + hSpread, y: cy, r: 26, label: 'Care Gap',  color: ORCH_COLORS.careGap, status: statusOf('careGap') },
        { key: 'sdoh',          x: cx, y: cy + vSpread, r: 26, label: 'SDOH',      color: ORCH_COLORS.sdoh, status: statusOf('sdoh') },
        { key: 'actionPlanner', x: cx - hSpread, y: cy, r: 26, label: 'Action Planner', color: ORCH_COLORS.actionPlanner, status: statusOf('actionPlanner') },
      ];

      nodes.slice(1).forEach((node, i) => {
        const active = node.status === 'running';
        const complete = node.status === 'complete';
        const rgb = h2r(node.color);
        ctx!.save();
        ctx!.setLineDash(active ? [5, 5] : complete ? [] : [3, 7]);
        if (active) ctx!.lineDashOffset = -(t / 40);
        const alpha = active ? 0.5 + Math.sin(t / 400 + i) * 0.15 : complete ? 0.38 : 0.14;
        ctx!.strokeStyle = `rgba(${rgb},${alpha})`;
        ctx!.lineWidth = active ? 1.5 : 1;
        ctx!.beginPath(); ctx!.moveTo(cx, cy); ctx!.lineTo(node.x, node.y); ctx!.stroke();
        ctx!.restore();
      });

      nodes.forEach((node, i) => {
        const rgb = h2r(node.color);
        const isC = node.key === 'orchestrator';
        const active = node.status === 'running' || isC;
        const done = node.status === 'complete';
        const { x: nx, y: ny, r, color } = node;

        if (active || done) {
          const pulse = active ? Math.sin(t / 500 + i * 1.2) * 6 : 0;
          ctx!.beginPath(); ctx!.arc(nx, ny, r + 16 + pulse, 0, Math.PI * 2);
          ctx!.strokeStyle = `rgba(${rgb},${active ? 0.13 + Math.sin(t / 600 + i) * 0.07 : 0.07})`;
          ctx!.lineWidth = 1.5; ctx!.stroke();
        }

        [[10, 0.1, 1], [4, 0.25, 1], [0, done ? 0.9 : active ? 0.7 : 0.38, 2]].forEach(([off, al, lw]) => {
          ctx!.beginPath(); ctx!.arc(nx, ny, r + (off as number), 0, Math.PI * 2);
          ctx!.strokeStyle = `rgba(${rgb},${al as number})`;
          ctx!.lineWidth = lw as number; ctx!.stroke();
        });

        ctx!.beginPath(); ctx!.arc(nx, ny, r - 8, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${rgb},${active ? 0.14 : 0.07})`; ctx!.fill();

        if (isC) { ctx!.shadowBlur = 20; ctx!.shadowColor = color; }
        ctx!.beginPath(); ctx!.arc(nx, ny, isC ? 6 : 4, 0, Math.PI * 2);
        ctx!.fillStyle = color; ctx!.fill();
        ctx!.shadowBlur = 0;

        if (!isC) {
          ctx!.beginPath(); ctx!.arc(nx + r * 0.7, ny - r * 0.7, 4, 0, Math.PI * 2);
          ctx!.fillStyle = done ? '#0FC48A' : active ? '#8661D4' : '#1E3A55'; ctx!.fill();
        }

        const isBottomNode = node.key === 'sdoh';
        ctx!.fillStyle = isC ? color : 'rgba(180,220,245,0.78)';
        ctx!.font = `${isC ? '600 ' : '500 '}12px system-ui,-apple-system,sans-serif`;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = isBottomNode ? 'bottom' : 'top';
        ctx!.fillText(node.label, nx, isBottomNode ? ny - r - 8 : ny + r + 10);
        ctx!.textBaseline = 'alphabetic';
      });

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />;
}

interface OrchestratorViewProps {
  patient: DisplayPatient;
  feeds: Record<AgentId, AgentFeedState>;
  running: boolean;
  onRun: () => void;
  onBack: () => void;
}

function OrchestratorView({ patient, feeds, running, onRun, onBack }: OrchestratorViewProps) {
  const [fhirOpen, setFhirOpen] = useState(true);
  return (
    <div className="flex h-[calc(100vh-48px)] overflow-hidden" style={{ background: '#07111E' }}>
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: 'rgba(0,200,255,0.12)', background: 'rgba(7,17,30,0.96)' }}>
          <button onClick={onBack} className="text-text-muted hover:text-cyan text-sm transition-colors">←</button>
          <span className="font-bold text-white text-base">{patient.name}</span>
          <span className="text-text-muted text-sm">{patient.age}{patient.sex}</span>
          <span style={{ color: 'rgba(255,255,255,0.18)' }}>|</span>
          <span className="text-xs font-mono" style={{ color: 'rgba(0,200,255,0.55)' }}>MRN: {patient.mrn}</span>
          <button
            onClick={onRun} disabled={running}
            data-testid="orchestrator-run-analysis"
            className="ml-auto text-sm font-semibold px-4 py-1.5 rounded-lg border transition-all disabled:opacity-50"
            style={{ borderColor: '#00C8FF', color: '#00C8FF' }}
          >
            {running ? '⟳ Running…' : '▶ Run Analysis'}
          </button>
        </div>

        {running && (
          <div className="flex-shrink-0 overflow-hidden" style={{ height: 2, background: 'rgba(0,200,255,0.08)' }}>
            <div style={{
              height: '100%', width: '35%',
              background: 'linear-gradient(90deg, transparent, #00C8FF, #8661D4, transparent)',
              animation: 'sweep 1.8s ease-in-out infinite',
            }} />
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          <OrchestratorCanvas feeds={feeds} />
        </div>

        <div className="flex-shrink-0 grid grid-cols-4" style={{ height: '216px', borderTop: '1px solid rgba(0,200,255,0.1)' }}>
          {AGENT_KEYS.map((agentId) => {
            const color = ORCH_COLORS[agentId];
            const feed = feeds[agentId];
            return (
              <div
                key={agentId}
                className="flex flex-col overflow-hidden"
                style={{
                  borderLeft: `2px solid ${color}44`,
                  borderRight: '1px solid rgba(0,200,255,0.07)',
                  background: 'rgba(8,18,36,0.97)',
                }}
              >
                <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid rgba(0,200,255,0.08)' }}>
                  <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color }}>{GRAPH_PANEL_LABELS[agentId]}</span>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-2.5">
                  {!feed.started && (
                    <p className="text-xs italic" style={{ color: 'rgba(140,180,210,0.38)' }}>Awaiting analysis run…</p>
                  )}
                  {feed.started && !feed.summary && (
                    <p className="text-xs font-mono leading-relaxed" style={{ color: 'rgba(150,200,230,0.72)' }}>
                      {feed.text || 'Analyzing FHIR bundle…'}<span className="animate-pulse" style={{ color }}>▍</span>
                    </p>
                  )}
                  {feed.summary && feed.findings.map((f, i) => (
                    <div key={`${f.fhirResourceId ?? 'finding'}-${i}`} className="mb-2.5">
                      <div className="flex items-start gap-1.5">
                        <span className={`mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full ${severityDot(coerceSeverity(f.severity ?? 'medium'))}`} />
                        <p className="text-xs leading-snug" style={{ color: 'rgba(200,230,245,0.88)' }}>{f.text ?? f.finding ?? f.description ?? 'Untitled finding'}</p>
                      </div>
                      <p className="text-[10px] font-mono mt-0.5 ml-3" style={{ color: 'rgba(100,150,185,0.5)' }}>{f.fhirResourceId ?? 'unsourced'}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-shrink-0 w-72 flex flex-col overflow-hidden" style={{ borderLeft: '1px solid rgba(0,200,255,0.1)', background: 'rgba(9,19,37,0.98)' }}>
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(0,200,255,0.1)' }}>
          <span className="font-bold text-white text-sm">Tasks</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,200,255,0.14)', color: '#00C8FF' }}>
            {GRAPH_TASKS.length} open
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {GRAPH_TASKS.map((task, i) => (
            <div key={i} className="px-4 py-3" style={{ borderBottom: '1px solid rgba(0,200,255,0.07)' }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  task.priority === 'critical' ? 'bg-red/20 text-red' :
                  task.priority === 'high' ? 'bg-amber/20 text-amber' :
                                            'bg-violet/20 text-violet'
                }`}>{task.priority}</span>
                <span className="text-[10px]" style={{ color: 'rgba(150,185,210,0.5)' }}>Due: {task.due}</span>
              </div>
              <p className="text-sm font-semibold leading-snug" style={{ color: 'rgba(220,240,255,0.92)' }}>{task.title}</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(150,190,215,0.65)' }}>{task.desc}</p>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] font-mono" style={{ color: 'rgba(100,145,178,0.45)' }}>{task.fhir}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded border" style={{ color: 'rgba(150,190,215,0.45)', borderColor: 'rgba(100,150,180,0.18)' }}>Open</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex-shrink-0" style={{ borderTop: '1px solid rgba(0,200,255,0.1)' }}>
          <button
            onClick={() => setFhirOpen((v) => !v)}
            data-testid="fhir-bundle-toggle"
            className="w-full flex items-center justify-between px-4 py-2.5 hover:opacity-80 transition-opacity"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(140,185,215,0.5)' }}>FHIR Bundle</span>
            <span style={{ color: 'rgba(140,185,215,0.5)' }}>{fhirOpen ? '▾' : '▸'}</span>
          </button>
          {fhirOpen && (
            <div className="px-4 pb-4" data-testid="fhir-bundle-panel">
              {FHIR_BUNDLE.map(({ type, count, icon }) => (
                <div key={type} className="flex items-center gap-2 py-1.5" style={{ borderBottom: '1px solid rgba(0,200,255,0.06)' }}>
                  <span className="text-sm">{icon}</span>
                  <span className="text-xs flex-1" style={{ color: 'rgba(175,215,235,0.78)' }}>{type}</span>
                  <span className="text-xs font-mono" style={{ color: 'rgba(0,200,255,0.48)' }}>({count})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── AnalysisProgressFloat (kept from lead) ─────────────────────────────────

function AnalysisProgressFloat({ running, feeds }: { running: boolean; feeds: Record<AgentId, AgentFeedState> }) {
  const [elapsed, setElapsed] = useState(0);
  const [show, setShow] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      setShow(true);
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed((s) => +(s + 0.1).toFixed(1)), 100);
    } else {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      const t = setTimeout(() => setShow(false), 2800);
      return () => clearTimeout(t);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  if (!show) return null;

  const allDone = AGENT_KEYS.every((id) => statusLabel(feeds[id]) === 'complete' || statusLabel(feeds[id]) === 'idle');

  return (
    <div
      className="fixed bottom-6 right-6 z-[300]"
      style={{
        width: 300,
        borderRadius: 14,
        background: 'rgba(7,16,33,0.97)',
        border: '1px solid rgba(0,200,255,0.22)',
        boxShadow: '0 12px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,200,255,0.07)',
        overflow: 'hidden',
      }}
      data-testid="analysis-progress-float"
    >
      <div style={{ height: 3, background: 'rgba(0,200,255,0.1)' }}>
        {running ? (
          <div style={{
            height: '100%',
            width: '35%',
            background: 'linear-gradient(90deg, transparent, #00C8FF, #8661D4, transparent)',
            animation: 'sweep 1.8s ease-in-out infinite',
          }} />
        ) : (
          <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, #0FC48A, #00C8FF)' }} />
        )}
      </div>

      <style>{`@keyframes sweep { 0%{transform:translateX(-100%)} 100%{transform:translateX(400%)} }`}</style>

      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(0,200,255,0.1)' }}>
        <div className="flex items-center gap-2">
          {allDone ? (
            <>
              <span style={{ color: '#0FC48A', fontSize: 14, lineHeight: 1 }}>✓</span>
              <span className="text-xs font-semibold" style={{ color: '#0FC48A' }}>Analysis complete</span>
            </>
          ) : (
            <>
              <span className="relative inline-flex h-2 w-2 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-70 bg-cyan" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan" />
              </span>
              <span className="text-xs font-semibold" style={{ color: 'rgba(0,200,255,0.9)' }}>Agent analysis running</span>
            </>
          )}
        </div>
        <span className="text-xs font-mono tabular-nums" style={{ color: 'rgba(0,200,255,0.5)' }}>{elapsed.toFixed(1)}s</span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {AGENT_KEYS.map((agentId) => {
          const feed = feeds[agentId];
          const color = ORCH_COLORS[agentId];
          const status = statusLabel(feed);
          const done = status === 'complete';
          const isRunning = status === 'running';
          return (
            <div key={agentId} className="flex items-center gap-3">
              <div style={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {done && <span style={{ color: '#0FC48A', fontSize: 11, fontWeight: 700 }}>✓</span>}
                {isRunning && (
                  <span className="relative inline-flex" style={{ width: 10, height: 10 }}>
                    <span className="animate-ping absolute inset-0 rounded-full opacity-55" style={{ background: color }} />
                    <span className="relative inline-flex rounded-full" style={{ width: 10, height: 10, background: color }} />
                  </span>
                )}
                {status === 'idle' && (
                  <span style={{ width: 10, height: 10, borderRadius: '50%', border: '1px solid rgba(80,130,170,0.25)', display: 'block' }} />
                )}
              </div>
              <span
                className="flex-1 text-xs"
                style={{
                  color: done ? 'rgba(180,220,245,0.6)' :
                         isRunning ? 'rgba(225,242,255,0.95)' :
                                   'rgba(110,155,190,0.35)',
                  fontWeight: isRunning ? 600 : 400,
                }}
              >
                {AGENT_LABELS[agentId]}
              </span>
              {done && feed.summary && (
                <span className="text-[10px] font-mono" style={{ color: 'rgba(15,196,138,0.65)' }}>
                  {feed.summary.findingCount} findings
                </span>
              )}
              {isRunning && (
                <span className="text-[10px] animate-pulse font-semibold" style={{ color }}>running</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

type ViewMode = 'panel' | 'cinema' | 'orchestrator';

export function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Real data fetch (backend pattern).
  // Don't retry 4xx — a 404 means the patient id isn't in HAPI, retrying
  // would just delay the UI's fall-through to the MOCK-fixture display path
  // (and keep the "Loading patient…" message on screen for ~30s while the
  // library's default 3-retry exponential backoff runs out).
  const { data: patientData, isLoading, isError, error } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => getPatient(id!),
    enabled: !!id,
    retry: (failureCount, err) => {
      const msg = (err as Error).message ?? '';
      if (/not found|404/i.test(msg)) return false;
      return failureCount < 2;
    },
  });

  // Cross-surface sync (backend pattern): a `task-updated` event for THIS
  // patient invalidates the patient query so the task list refetches live.
  useEffect(() => {
    if (!id) return;
    const unsubscribe = subscribeToEvents({
      onTaskUpdated: (task: AssignedTaskEvent) => {
        if (task.patientId === id) {
          queryClient.invalidateQueries({ queryKey: ['patient', id] });
        }
      },
    });
    return unsubscribe;
  }, [id, queryClient]);

  // SSE state (backend pattern, no race, no mock-sim fallback).
  const [running, setRunning] = useState(false);
  const [feeds, setFeeds] = useState<Record<AgentId, AgentFeedState>>(() => makeFeeds());
  const [createdTasks, setCreatedTasks] = useState<AnalysisTask[]>([]);
  const [graphState, dispatchGraph] = useAnalysisGraph();
  const [lastMode, setLastMode] = useState<'cached' | 'live' | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('panel');
  const [createdActionKeys, setCreatedActionKeys] = useState<Set<string>>(new Set());
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  async function handleRunAnalysis(live: boolean) {
    if (!id || running) return;
    setRunning(true);
    setAnalysisError(null);
    setLastMode(live ? 'live' : 'cached');
    setFeeds(makeFeeds());
    setCreatedTasks([]);
    setCreatedActionKeys(new Set());
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
        { live },
      );
    } catch (err) {
      // S12 follow-up — stream errors were previously swallowed in the
      // finally block, leaving the UI in `running=false` with no feedback
      // (the "Run Analysis" button just stops spinning). Surface the
      // message inline so the user knows why nothing happened — e.g. the
      // API returned 404 for a patient id that has no MOCK analysis
      // fallback.
      setAnalysisError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const handleActionCreated = (key: string) => {
    setCreatedActionKeys((prev) => new Set(prev).add(key));
  };

  const patient = buildDisplayPatient(patientData, id);
  const actions = buildActionPlan(feeds, createdTasks);

  // Real-implementation risk override: the hero badge reflects the live analysis
  // (feeds.risk.summary carries riskScore + riskLevel emitted by the backend's
  // risk agent) once a run completes, so ANY seeded HAPI patient — not just the
  // MOCK fixtures — gets a meaningful score. Falls back to the MOCK-derived
  // patient.riskScore/riskLevel only before the first analysis runs.
  const liveRisk = feeds.risk.summary;
  const displayRiskScore =
    typeof liveRisk?.riskScore === 'number' ? liveRisk.riskScore : patient.riskScore;
  const displayRiskLevel: DisplayPatient['riskLevel'] =
    liveRisk?.riskLevel === 'critical' || liveRisk?.riskLevel === 'high' ||
    liveRisk?.riskLevel === 'medium' || liveRisk?.riskLevel === 'low'
      ? liveRisk.riskLevel
      : patient.riskLevel;

  const ViewToggle = () => (
    <div className="inline-flex items-center bg-surface border border-border rounded-lg p-0.5 text-xs font-medium">
      <button
        onClick={() => setViewMode('panel')}
        data-testid="view-mode-panel"
        className={`px-3 py-1.5 rounded-md transition-colors ${viewMode === 'panel' ? 'bg-cyan text-bg font-semibold' : 'text-text-muted hover:text-text'}`}
      >
        ⊞ Panel
      </button>
      <button
        onClick={() => setViewMode('cinema')}
        data-testid="view-mode-cinema"
        className={`px-3 py-1.5 rounded-md transition-colors ${viewMode === 'cinema' ? 'bg-violet text-white font-semibold' : 'text-text-muted hover:text-text'}`}
      >
        ◉ Cinema
      </button>
      <button
        onClick={() => setViewMode('orchestrator')}
        data-testid="view-mode-orchestrator"
        className={`px-3 py-1.5 rounded-md transition-colors`}
        style={viewMode === 'orchestrator' ? { background: '#00C8FF22', color: '#00C8FF', border: '1px solid #00C8FF55', fontWeight: 600 } : {}}
      >
        ◈ Orchestrator
      </button>
    </div>
  );

  const BackLink = () => (
    <Link to="/panel" className="text-label text-cyan hover:underline">
      ← My Patient Panel
    </Link>
  );

  // Cinema view --------------------------------------------------------------
  if (viewMode === 'cinema') {
    return (
      <>
        <div className="relative">
          <div className="fixed top-2.5 right-36 z-50">
            <ViewToggle />
          </div>
          <CinemaView
            patient={patient}
            feeds={feeds}
            running={running}
            onRun={() => handleRunAnalysis(false)}
            actions={actions}
            createdActionKeys={createdActionKeys}
            onActionCreated={handleActionCreated}
            onBack={() => navigate('/population')}
          />
        </div>
        <AnalysisProgressFloat running={running} feeds={feeds} />
      </>
    );
  }

  // Orchestrator view --------------------------------------------------------
  if (viewMode === 'orchestrator') {
    return (
      <>
        <div className="relative">
          <div className="fixed top-2.5 right-36 z-50">
            <ViewToggle />
          </div>
          <OrchestratorView
            patient={patient}
            feeds={feeds}
            running={running}
            onRun={() => handleRunAnalysis(false)}
            onBack={() => navigate('/population')}
          />
        </div>
        <AnalysisProgressFloat running={running} feeds={feeds} />
      </>
    );
  }

  // Panel view (default — 3-column layout ported from lead project) --------
  // Render the grid off the `patient` view-model, which is ALWAYS populated
  // (buildDisplayPatient falls back to MOCK_PATIENTS when the API 404s). This
  // means the screen renders for every patient — HAPI-seeded, MOCK-only, or
  // unknown — and the API error is shown inline instead of blocking the UI.
  return (
    <>
      {isLoading && <p className="text-body text-text-muted mt-4">Loading patient…</p>}
      {isError && (
        <p className="text-body text-amber mt-4" data-testid="patient-fallback-notice">
          Showing demo data — live record unavailable: {(error as Error).message}
        </p>
      )}

      {!isLoading && (
      <div className="grid h-[calc(100vh-48px)] overflow-hidden gap-4 p-4" style={{ gridTemplateColumns: '25% 40% 35%' }}>
          {/* ── Left column: Patient Profile ───────────────────────────── */}
          <div className="bg-surface rounded-xl border border-border p-5 overflow-y-auto flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <BackLink />
              <ViewToggle />
            </div>

            <p className="text-text-muted text-xs uppercase tracking-wider">Patient Profile</p>

            <div>
              <h1 className="text-xl font-bold text-text">{patient.name}</h1>
              <p className="text-text-muted text-sm mt-0.5">
                {patient.age}y {patient.sex} · MRN {patient.mrn}
              </p>
            </div>

            {/* Hero risk badge — driven by live analysis once available, so it
                reflects the real implementation for any patient, not just the
                MOCK fixtures in PatientDetail.fixtures.ts. */}
            <div className="flex justify-center">
              <div
                className={`px-6 py-3 rounded-full flex flex-col items-center ${riskBadgeClasses(displayRiskLevel)}`}
                style={displayRiskLevel === 'critical' ? { boxShadow: '0 0 32px rgba(232,72,72,0.4)' } : undefined}
                data-testid="panel-risk-badge"
              >
                <span className="text-3xl font-bold leading-none">{displayRiskScore || '—'}</span>
                <span className="text-xs font-semibold uppercase tracking-wider mt-1 opacity-80">
                  {displayRiskLevel} risk
                </span>
              </div>
            </div>

            {/* Conditions */}
            <div>
              <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Conditions</p>
              <ul className="space-y-1.5">
                {patient.conditions.map((condition, i) => {
                  // Mirror lead's conditionDot scheme — assign critical/high/medium/low
                  // round-robin so the demo shows the colour scale.
                  const sev: Severity = (['critical', 'high', 'medium', 'low'] as Severity[])[
                    Math.min(i, 3)
                  ];
                  return (
                    <li key={condition} className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${severityDot(sev)}`} />
                      <span className="text-text text-sm">{condition}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Key vitals */}
            <div>
              <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Key Vitals</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {DEFAULT_VITALS.map((vital) => (
                  <div key={vital.label}>
                    <p className="text-text-muted text-xs">{vital.label}</p>
                    <p className="text-text font-mono text-sm font-medium">{vital.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Last contact */}
            <div className="mt-auto pt-4 border-t border-border-light">
              <p className="text-text-muted text-xs">
                Last contact:{' '}
                <span
                  className={`font-medium ${
                    patient.daysSinceContact <= 3
                      ? 'text-emerald'
                      : patient.daysSinceContact <= 14
                        ? 'text-amber'
                        : 'text-red'
                  }`}
                >
                  {patient.daysSinceContact}d ago
                </span>
              </p>
            </div>
          </div>

          {/* ── Middle column: AI Agent Analysis ────────────────────────── */}
          <div className="bg-surface rounded-xl border border-border p-5 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-text font-semibold text-base">AI Agent Analysis</h2>
              <div className="flex items-center gap-2">
                {lastMode && (
                  <span
                    className="font-mono text-[10px] text-text-dim uppercase tracking-wide"
                    data-testid="analysis-mode"
                    aria-live="polite"
                  >
                    {lastMode === 'live' ? 'requested: live' : 'requested: cached'}
                  </span>
                )}
                <button
                  onClick={() => handleRunAnalysis(true)}
                  disabled={running}
                  className="bg-transparent border border-border-light text-text-muted font-mono text-label font-bold tracking-wide px-3 py-1.5 rounded-md disabled:opacity-60 disabled:cursor-default"
                >
                  Run live
                </button>
                <button
                  onClick={() => handleRunAnalysis(false)}
                  disabled={running}
                  data-testid="panel-run-analysis"
                  className="bg-violet text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {running ? 'Running…' : 'Run Analysis'}
                </button>
              </div>
            </div>

            <div className="flex-1">
              {analysisError && (
                <p className="text-amber text-xs mb-2" data-testid="analysis-error">
                  Analysis unavailable: {analysisError}
                </p>
              )}
              {AGENT_KEYS.map((agentId) => (
                <PanelAgentCard key={agentId} agentId={agentId} feed={feeds[agentId]} />
              ))}
            </div>
          </div>

          {/* ── Right column: Action Plan ───────────────────────────────── */}
          <div className="bg-surface rounded-xl border border-border p-5 overflow-y-auto flex flex-col">
            <p className="text-text-muted text-xs uppercase tracking-wider mb-4">Action Plan</p>

            {actions.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                <span className="text-4xl">🤖✨</span>
                <p className="text-text font-medium">No action plan yet</p>
                <p className="text-text-muted text-sm max-w-xs">
                  Run analysis to let the AI agents generate a prioritised action plan for this patient.
                </p>
              </div>
            ) : (
              <div className="flex-1">
                {actions.map((action) => (
                  <PanelActionCard
                    key={action.key}
                    action={action}
                    isCreated={createdActionKeys.has(action.key)}
                    onCreated={handleActionCreated}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <AnalysisProgressFloat running={running} feeds={feeds} />
    </>
  );
}
