import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { AgentFinding } from '../types';
import { getPatient, streamAnalysis } from '../api/client';
import { mapAnalysisFindingToAgentFinding } from '../types';
import {
  MOCK_PATIENTS,
  MOCK_ANALYSIS,
  DEFAULT_VITALS,
  GRAPH_TASKS,
  FHIR_BUNDLE,
  type DisplayPatient,
  type DisplayAnalysisData,
} from './PatientDetail.fixtures';

// ── Constants ────────────────────────────────────────────────────────────────

const AGENT_KEYS = ['riskAgent', 'careGapAgent', 'sdohAgent', 'actionPlanner'] as const;
type AgentKey = (typeof AGENT_KEYS)[number];

const AGENT_LABELS: Record<AgentKey, string> = {
  riskAgent: 'Risk Agent',
  careGapAgent: 'Care Gap Agent',
  sdohAgent: 'SDOH Agent',
  actionPlanner: 'Action Planner',
};

/** Maps wire agent ids (`risk`/`careGap`/`sdoh`/`actionPlanner`) to component agent keys. */
const AGENT_ID_MAP: Record<string, AgentKey> = {
  risk: 'riskAgent',
  careGap: 'careGapAgent',
  sdoh: 'sdohAgent',
  actionPlanner: 'actionPlanner',
};

const CONDITION_SEVERITIES: AgentFinding['severity'][] = ['critical', 'high', 'medium', 'low'];

type AgentState = {
  status: 'idle' | 'running' | 'complete' | 'error';
  findings: AgentFinding[];
  streamText: string;
  riskScore?: number;
  riskLevel?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function severityDot(severity: AgentFinding['severity'] | undefined): string {
  switch (severity) {
    case 'critical': return 'bg-red';
    case 'high': return 'bg-red';
    case 'medium': return 'bg-amber';
    case 'low': return 'bg-emerald';
    default: return 'bg-surface-hover border border-border';
  }
}

function riskBadgeClasses(level: DisplayPatient['riskLevel']): string {
  switch (level) {
    case 'critical': return 'bg-red text-white';
    case 'high': return 'bg-amber text-bg';
    case 'medium': return 'bg-amber-dim text-amber';
    case 'low': return 'bg-emerald-dim text-emerald';
  }
}

function priorityBadgeClasses(severity: AgentFinding['severity'] | undefined): string {
  switch (severity) {
    case 'critical': return 'bg-red-dim text-red';
    case 'high': return 'bg-amber-dim text-amber';
    case 'medium': return 'bg-amber-dim text-amber';
    case 'low': return 'bg-emerald-dim text-emerald';
    default: return 'bg-surface-raised text-text-muted';
  }
}

function confidenceBarColor(confidence: number): string {
  if (confidence >= 0.9) return 'bg-emerald';
  if (confidence >= 0.75) return 'bg-amber';
  return 'bg-red';
}

function makeInitialAgentStates(): Record<AgentKey, AgentState> {
  const blank = (): AgentState => ({ status: 'idle', findings: [], streamText: '' });
  return {
    riskAgent: blank(),
    careGapAgent: blank(),
    sdohAgent: blank(),
    actionPlanner: blank(),
  };
}

function agentStatesFromAnalysis(data: DisplayAnalysisData): Record<AgentKey, AgentState> {
  const fromAgent = (a: { findings: AgentFinding[] }) =>
    ({ status: 'complete' as const, findings: a.findings, streamText: '' });
  return {
    riskAgent: fromAgent(data.riskAgent),
    careGapAgent: fromAgent(data.careGapAgent),
    sdohAgent: fromAgent(data.sdohAgent),
    actionPlanner: fromAgent(data.actionPlanner),
  };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: AgentState['status'] }) {
  if (status === 'running') {
    return (
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet" />
      </span>
    );
  }
  if (status === 'complete') return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald" />;
  if (status === 'error') return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red" />;
  return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-surface-hover border border-border" />;
}

function statusLabel(state: AgentState): string {
  switch (state.status) {
    case 'idle': return 'Idle';
    case 'running': return 'Running...';
    case 'complete': return `Complete — ${state.findings.length} finding${state.findings.length !== 1 ? 's' : ''}`;
    case 'error': return 'Error';
  }
}

function AgentCard({ agentKey, state }: { agentKey: AgentKey; state: AgentState }) {
  return (
    <div className="bg-surface-raised rounded-lg p-4 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <StatusDot status={state.status} />
        <span className="font-bold text-text text-sm">{AGENT_LABELS[agentKey]}</span>
        <span className="ml-auto text-text-dim text-xs">{statusLabel(state)}</span>
      </div>

      {state.streamText && (
        <p
          className="text-text-muted text-xs font-mono mt-1 leading-relaxed line-clamp-3"
          data-testid={`stream-${agentKey}`}
        >
          {state.streamText}
        </p>
      )}

      {state.status === 'complete' && state.findings.length > 0 && (
        <ul className="mt-2 space-y-2">
          {state.findings.map((f, i) => (
            <li key={`${f.fhirResourceId}-${i}`} className="flex gap-2 items-start" data-testid={`finding-${agentKey}-${i}`}>
              <span className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${severityDot(f.severity)}`} />
              <div className="min-w-0">
                <p className="text-text text-sm leading-snug">{f.finding}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-text-dim text-xs font-mono truncate">{f.fhirResourceId}</span>
                  <span className="text-text-dim text-xs flex-shrink-0" data-testid={`confidence-${agentKey}-${i}`}>
                    Conf: {f.confidence.toFixed(2)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {state.status === 'complete' && (state.riskScore !== undefined || state.riskLevel) && (
        <p className="mt-2 pt-2 border-t border-border text-[11px] text-text-muted" data-testid={`summary-${agentKey}`}>
          {state.riskLevel ? `${state.riskLevel} risk` : 'complete'}
          {state.riskScore !== undefined ? ` · score ${state.riskScore}` : ''}
        </p>
      )}
    </div>
  );
}

interface ActionCardProps {
  finding: AgentFinding;
  isCreated: boolean;
  onCreated: (key: string) => void;
}

function ActionCard({ finding, isCreated, onCreated }: ActionCardProps) {
  const [loading, setLoading] = useState(false);

  /**
   * Phase 1 — task creation is intentionally a local-only UI stub. The real
   * `POST /api/tasks` endpoint requires a `patientId` plus a full Task body,
   * and the lead's design never wired one up here. We mark-as-created for
   * demo polish; a future slice will replace this with a real `transitionTask`
   * or a dedicated `assignRecommendedTask` endpoint.
   */
  const handleCreateTask = async () => {
    if (isCreated || loading) return;
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      onCreated(finding.finding);
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface-raised rounded-lg p-4 mb-3 border border-border-light">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${priorityBadgeClasses(finding.severity)}`}>
          {finding.severity}
        </span>
      </div>
      <p className="font-medium text-text text-sm leading-snug mb-1">{finding.finding}</p>
      <p className="text-text-dim text-xs font-mono mb-3">{finding.fhirResourceId}</p>

      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <span className="text-text-dim text-xs">Confidence</span>
          <span className="text-text-dim text-xs">{(finding.confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="w-full h-1 bg-surface rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${confidenceBarColor(finding.confidence)}`} style={{ width: `${finding.confidence * 100}%` }} />
        </div>
      </div>

      <button
        onClick={handleCreateTask}
        disabled={isCreated || loading}
        data-testid={`create-task-${finding.fhirResourceId}`}
        className={`text-xs px-3 py-1 rounded border transition-colors ${
          isCreated
            ? 'bg-emerald-dim text-emerald border-emerald cursor-default'
            : 'bg-surface-hover border border-border-light text-text-muted hover:border-cyan hover:text-cyan'
        }`}
      >
        {isCreated ? 'Task Created ✓' : loading ? 'Creating...' : 'Create Task'}
      </button>
    </div>
  );
}

// ── Cinema view ──────────────────────────────────────────────────────────────

const AGENT_ACCENT: Record<AgentKey, { border: string; bg: string; text: string; label: string; icon: string }> = {
  riskAgent:     { border: 'border-red/40',     bg: 'bg-red/5',     text: 'text-red',     label: 'Risk Agent',        icon: '⚡' },
  careGapAgent:  { border: 'border-amber/40',   bg: 'bg-amber/5',   text: 'text-amber',   label: 'Care Gap Agent',    icon: '🩺' },
  sdohAgent:     { border: 'border-violet/40',  bg: 'bg-violet/5',  text: 'text-violet',  label: 'SDOH Agent',        icon: '🏘' },
  actionPlanner: { border: 'border-cyan/40',    bg: 'bg-cyan/5',    text: 'text-cyan',    label: 'Action Planner',    icon: '✅' },
};

function CinemaAgentPanel({ agentKey, state }: { agentKey: AgentKey; state: AgentState }) {
  const accent = AGENT_ACCENT[agentKey];
  const isAction = agentKey === 'actionPlanner';
  return (
    <div className={`rounded-xl border ${accent.border} ${accent.bg} p-5 flex flex-col gap-3`}>
      <div className="flex items-center gap-3">
        <span className="text-xl leading-none">{accent.icon}</span>
        <span className={`font-bold text-sm tracking-wide uppercase ${accent.text}`}>{accent.label}</span>
        <div className="ml-auto flex items-center gap-2">
          <StatusDot status={state.status} />
          <span className="text-text-dim text-xs">{statusLabel(state)}</span>
        </div>
      </div>

      {state.status === 'running' && (
        <div className="bg-bg rounded-lg p-3 border border-border min-h-[48px]">
          <p className="text-text-muted text-xs font-mono leading-relaxed">
            {state.streamText || 'Analyzing FHIR bundle…'}
            <span className="animate-pulse">▍</span>
          </p>
        </div>
      )}

      {state.status === 'idle' && <p className="text-text-dim text-sm italic">Waiting to run…</p>}

      {state.status === 'complete' && state.findings.length > 0 && (
        <div className="space-y-3">
          {state.findings.map((f, i) => (
            <div key={i} className="flex gap-3 items-start">
              <span className={`mt-1.5 flex-shrink-0 w-2.5 h-2.5 rounded-full ${severityDot(f.severity)}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium leading-snug ${isAction ? 'text-text text-base' : 'text-text'}`}>
                  {f.finding}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs font-mono text-text-dim truncate">{f.fhirResourceId}</span>
                  <span className={`text-xs font-semibold flex-shrink-0 ${
                    f.confidence >= 0.9 ? 'text-emerald' : f.confidence >= 0.75 ? 'text-amber' : 'text-red'
                  }`}>{(f.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
              <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full uppercase tracking-wide font-semibold ${priorityBadgeClasses(f.severity)}`}>
                {f.severity}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CinemaViewProps {
  patient: DisplayPatient;
  agentStates: Record<AgentKey, AgentState>;
  isRunning: boolean;
  onRun: () => void;
  displayedActionFindings: AgentFinding[];
  createdTasks: Set<string>;
  onTaskCreated: (key: string) => void;
  onBack: () => void;
}

function CinemaView({ patient, agentStates, isRunning, onRun, displayedActionFindings, createdTasks, onTaskCreated, onBack }: CinemaViewProps) {
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
            <span className="text-4xl font-black leading-none">{patient.riskScore}</span>
            <span className="text-xs font-bold uppercase tracking-wider opacity-80 mt-1">{patient.riskLevel}</span>
          </div>
          <div className="text-center">
            <p className="text-text font-bold text-lg">{patient.name}</p>
            <p className="text-text-muted text-xs">{patient.age}y {patient.sex} · MRN {patient.mrn}</p>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Conditions</p>
          {patient.conditions.map((c, i) => (
            <div key={c} className="flex items-center gap-2 mb-1.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${severityDot(CONDITION_SEVERITIES[Math.min(i, 3)])}`} />
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
            <span className={`font-semibold ${patient.daysSinceContact <= 3 ? 'text-emerald' : patient.daysSinceContact <= 14 ? 'text-amber' : 'text-red'}`}>{patient.daysSinceContact}d ago</span>
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
            disabled={isRunning}
            data-testid="cinema-run-analysis"
            className="bg-violet text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ boxShadow: '0 0 20px rgba(134,97,212,0.4)' }}
          >
            {isRunning ? '⟳ Running…' : '▶ Run Analysis'}
          </button>
        </div>

        <div className="px-8 py-6 space-y-4">
          {(['riskAgent', 'careGapAgent', 'sdohAgent'] as AgentKey[]).map((key) => (
            <CinemaAgentPanel key={key} agentKey={key} state={agentStates[key]} />
          ))}

          {agentStates.actionPlanner.status !== 'idle' && (
            <div className="flex items-center gap-3 py-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-text-dim text-xs uppercase tracking-widest">synthesized action plan</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {agentStates.actionPlanner.status !== 'idle' && (
            <CinemaAgentPanel agentKey="actionPlanner" state={agentStates.actionPlanner} />
          )}

          {displayedActionFindings.length > 0 && (
            <div className="grid grid-cols-3 gap-4 pt-2">
              {displayedActionFindings.map((finding, i) => (
                <ActionCard key={i} finding={finding} isCreated={createdTasks.has(finding.finding)} onCreated={onTaskCreated} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Orchestrator view ────────────────────────────────────────────────────────

const ORCH_COLORS: Record<AgentKey | 'orchestrator', string> = {
  orchestrator:  '#00C8FF',
  riskAgent:     '#E84848',
  careGapAgent:  '#8661D4',
  sdohAgent:     '#0FC48A',
  actionPlanner: '#F0970A',
};

const GRAPH_PANEL_LABELS: Record<AgentKey, string> = {
  riskAgent:     'RISK AGENT',
  careGapAgent:  'CARE GAP',
  sdohAgent:     'SDOH',
  actionPlanner: 'ACTION PLANNER',
};

function h2r(hex: string) {
  return `${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)}`;
}

function OrchestratorCanvas({ agentStates }: { agentStates: Record<AgentKey, AgentState> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const statesRef = useRef(agentStates);
  statesRef.current = agentStates;

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
      const st = statesRef.current;

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

      const nodes = [
        { key: 'orchestrator' as const, x: cx, y: cy, r: 38, label: 'Orchestrator', color: ORCH_COLORS.orchestrator, status: 'running' as AgentState['status'] },
        { key: 'riskAgent' as const, x: cx, y: cy - vSpread, r: 26, label: 'Risk Agent', color: ORCH_COLORS.riskAgent, status: st.riskAgent.status },
        { key: 'careGapAgent' as const, x: cx + hSpread, y: cy, r: 26, label: 'Care Gap', color: ORCH_COLORS.careGapAgent, status: st.careGapAgent.status },
        { key: 'sdohAgent' as const, x: cx, y: cy + vSpread, r: 26, label: 'SDOH', color: ORCH_COLORS.sdohAgent, status: st.sdohAgent.status },
        { key: 'actionPlanner' as const, x: cx - hSpread, y: cy, r: 26, label: 'Action Planner', color: ORCH_COLORS.actionPlanner, status: st.actionPlanner.status },
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

        const isBottomNode = node.key === 'sdohAgent';
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

function OrchestratorView({
  patient, agentStates, isRunning, onRun, onBack,
}: {
  patient: DisplayPatient;
  agentStates: Record<AgentKey, AgentState>;
  isRunning: boolean;
  onRun: () => void;
  onBack: () => void;
}) {
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
            onClick={onRun} disabled={isRunning}
            data-testid="orchestrator-run-analysis"
            className="ml-auto text-sm font-semibold px-4 py-1.5 rounded-lg border transition-all disabled:opacity-50"
            style={{ borderColor: '#00C8FF', color: '#00C8FF' }}
          >
            {isRunning ? '⟳ Running…' : '▶ Run Analysis'}
          </button>
        </div>

        {isRunning && (
          <div className="flex-shrink-0 overflow-hidden" style={{ height: 2, background: 'rgba(0,200,255,0.08)' }}>
            <div style={{
              height: '100%', width: '35%',
              background: 'linear-gradient(90deg, transparent, #00C8FF, #8661D4, transparent)',
              animation: 'sweep 1.8s ease-in-out infinite',
            }} />
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          <OrchestratorCanvas agentStates={agentStates} />
        </div>

        <div className="flex-shrink-0 grid grid-cols-4" style={{ height: '216px', borderTop: '1px solid rgba(0,200,255,0.1)' }}>
          {AGENT_KEYS.map((key) => {
            const color = ORCH_COLORS[key];
            const state = agentStates[key];
            return (
              <div
                key={key}
                className="flex flex-col overflow-hidden"
                style={{
                  borderLeft: `2px solid ${color}44`,
                  borderRight: '1px solid rgba(0,200,255,0.07)',
                  background: 'rgba(8,18,36,0.97)',
                }}
              >
                <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid rgba(0,200,255,0.08)' }}>
                  <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color }}>{GRAPH_PANEL_LABELS[key]}</span>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-2.5">
                  {state.status === 'idle' && (
                    <p className="text-xs italic" style={{ color: 'rgba(140,180,210,0.38)' }}>Awaiting analysis run...</p>
                  )}
                  {state.status === 'running' && (
                    <p className="text-xs font-mono leading-relaxed" style={{ color: 'rgba(150,200,230,0.72)' }}>
                      {state.streamText || 'Analyzing FHIR bundle…'}<span className="animate-pulse" style={{ color }}>▍</span>
                    </p>
                  )}
                  {state.status === 'complete' && state.findings.map((f, i) => (
                    <div key={i} className="mb-2.5">
                      <div className="flex items-start gap-1.5">
                        <span className={`mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full ${severityDot(f.severity)}`} />
                        <p className="text-xs leading-snug" style={{ color: 'rgba(200,230,245,0.88)' }}>{f.finding}</p>
                      </div>
                      <p className="text-[10px] font-mono mt-0.5 ml-3" style={{ color: 'rgba(100,150,185,0.5)' }}>{f.fhirResourceId}</p>
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

// ── Floating progress widget ─────────────────────────────────────────────────

function AnalysisProgressFloat({ isRunning, agentStates }: { isRunning: boolean; agentStates: Record<AgentKey, AgentState> }) {
  const [elapsed, setElapsed] = useState(0);
  const [show, setShow] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isRunning) {
      setShow(true);
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed((s) => +(s + 0.1).toFixed(1)), 100);
    } else {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      const t = setTimeout(() => setShow(false), 2800);
      return () => clearTimeout(t);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunning]);

  if (!show) return null;

  const allDone = AGENT_KEYS.every((k) => agentStates[k].status === 'complete' || agentStates[k].status === 'error');

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
        {isRunning ? (
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
        {AGENT_KEYS.map((key) => {
          const state = agentStates[key];
          const color = ORCH_COLORS[key];
          const done = state.status === 'complete';
          const running = state.status === 'running';
          return (
            <div key={key} className="flex items-center gap-3">
              <div style={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {done && <span style={{ color: '#0FC48A', fontSize: 11, fontWeight: 700 }}>✓</span>}
                {running && (
                  <span className="relative inline-flex" style={{ width: 10, height: 10 }}>
                    <span className="animate-ping absolute inset-0 rounded-full opacity-55" style={{ background: color }} />
                    <span className="relative inline-flex rounded-full" style={{ width: 10, height: 10, background: color }} />
                  </span>
                )}
                {state.status === 'idle' && (
                  <span style={{ width: 10, height: 10, borderRadius: '50%', border: '1px solid rgba(80,130,170,0.25)', display: 'block' }} />
                )}
              </div>
              <span
                className="flex-1 text-xs"
                style={{
                  color: done ? 'rgba(180,220,245,0.6)' :
                         running ? 'rgba(225,242,255,0.95)' :
                                   'rgba(110,155,190,0.35)',
                  fontWeight: running ? 600 : 400,
                }}
              >
                {AGENT_LABELS[key]}
              </span>
              {done && state.findings.length > 0 && (
                <span className="text-[10px] font-mono" style={{ color: 'rgba(15,196,138,0.65)' }}>
                  {state.findings.length} finding{state.findings.length !== 1 ? 's' : ''}
                </span>
              )}
              {running && (
                <span className="text-[10px] animate-pulse font-semibold" style={{ color }}>running</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

/**
 * Phase 1 of the lead-project integration: PatientDetail is now lead's
 * 1,286-line `pages/director/PatientDetail.tsx` (panel/cinema/orchestrator
 * view modes + animated orchestrator Canvas + AnalysisProgressFloat),
 * adapted to:
 *   - my real `/api/patients/:id` (via `getPatient`) — patient fallback chain
 *     is "real → MOCK_PATIENTS find → MOCK_PATIENTS[0]"
 *   - my real `/api/patients/:id/analysis` SSE stream (via `streamAnalysis`)
 *     with event-mapping bridge (`token` → agent streamText, `finding` →
 *     findings array, `complete` → agent complete + summary) — fallback to
 *     `runMockSim()` (staggered timeouts against MOCK_ANALYSIS) on stream
 *     error or no-events-within-timeout
 *   - my auth token key (`caresync_token`) and my `/population` route
 *
 * Honest-staging notes:
 *   - `ActionCard.handleCreateTask` is intentionally a local UI stub (250ms
 *     timeout → mark as created). My real `/api/tasks` endpoint requires a
 *     full Task body; we don't have an "assign recommended task" endpoint,
 *     so this slot ships as demo polish only. Future slice can replace with
 *     a real backend call.
 *   - `OrchestratorView`'s FHIR Bundle + Tasks panels use the hero patient's
 *     hardcoded counts (`FHIR_BUNDLE`, `GRAPH_TASKS`); they're a visual
 *     demo of the orchestration surface, not a live task list (the live
 *     task list surface is `/tasks`, not this page).
 *   - Default patient is `maria-chen-4829` whenever the route id doesn't
 *     resolve to a real patient, so `/patients/anything` always renders.
 */
export function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [patient, setPatient] = useState<DisplayPatient>(() => MOCK_PATIENTS[0]);
  const [viewMode, setViewMode] = useState<'panel' | 'cinema' | 'orchestrator'>('panel');
  const [isRunning, setIsRunning] = useState(false);
  const [analysisData, setAnalysisData] = useState<DisplayAnalysisData | null>(() =>
    MOCK_ANALYSIS['maria-chen-4829'] ?? null
  );
  const [agentStates, setAgentStates] = useState<Record<AgentKey, AgentState>>(() =>
    makeInitialAgentStates()
  );
  const [createdTasks, setCreatedTasks] = useState<Set<string>>(new Set());

  // Layer 1: load real patient when the route id changes; fall back to mock.
  useEffect(() => {
    if (!id) {
      setPatient(MOCK_PATIENTS[0]);
      return;
    }
    let cancelled = false;

    const fallback = MOCK_PATIENTS.find((p) => p.id === id) ?? MOCK_PATIENTS[0];

    getPatient(id)
      .then((data) => {
        if (cancelled) return;
        const realAge = data.patient.birthDate
          ? Math.floor((Date.now() - new Date(data.patient.birthDate).getTime()) / (365.25 * 24 * 3600 * 1000))
          : fallback.age;
        setPatient({
          id: data.patient.id ?? fallback.id,
          mrn: data.patient.id ?? fallback.mrn,
          name: data.patient.name ?? fallback.name,
          age: realAge,
          sex: data.patient.gender === 'male' ? 'M' : data.patient.gender === 'female' ? 'F' : fallback.sex,
          conditions: data.conditions.map((c) => c.display).filter(Boolean).length > 0
            ? data.conditions.map((c) => c.display)
            : fallback.conditions,
          riskScore: fallback.riskScore,
          riskLevel: fallback.riskLevel,
          daysSinceContact: fallback.daysSinceContact,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPatient(fallback);
      });

    // Preload mock analysis only when the hero patient is selected.
    if (id === 'maria-chen-4829') {
      const pre = MOCK_ANALYSIS['maria-chen-4829'];
      if (pre) {
        setAnalysisData(pre);
        setAgentStates(agentStatesFromAnalysis(pre));
      }
    } else {
      setAnalysisData(null);
      setAgentStates(makeInitialAgentStates());
    }

    return () => { cancelled = true; };
  }, [id]);

  // Track setTimeout IDs from `runMockSim` so a test (or user navigation) can
  // cancel them on unmount — without this, pending 7.4s mock-sim timers would
  // fire `setAgentStates` on an unmounted component and bleed state updates
  // into the *next* test in the same run, slowing it past the 5s vitest
  // default timeout (the cause of intermittent Governance/MoreScreens
  // timeouts when the full suite runs).
  const mockSimTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      mockSimTimeoutsRef.current.forEach(clearTimeout);
      mockSimTimeoutsRef.current = [];
    };
  }, []);

  function runMockSim(patientId: string) {
    const mockData = MOCK_ANALYSIS[patientId] ?? MOCK_ANALYSIS['maria-chen-4829'];
    if (!mockData) return;

    const schedule: [AgentKey, number, number, string][] = [
      ['riskAgent',     300,  2400, 'Evaluating HbA1c trends, BNP elevation, medication adherence gaps…'],
      ['careGapAgent',  600,  3900, 'Reviewing preventive care schedules, immunization records, screenings…'],
      ['sdohAgent',     900,  5300, 'Assessing social determinants — housing stability, food security, transport…'],
      ['actionPlanner', 4200, 7000, 'Synthesizing all findings into a prioritized care action plan…'],
    ];

    schedule.forEach(([key, startMs, doneMs, text]) => {
      mockSimTimeoutsRef.current.push(setTimeout(() => setAgentStates((prev) =>
        prev[key].status === 'complete' ? prev :
        { ...prev, [key]: { status: 'running', findings: [], streamText: text } }
      ), startMs));
      mockSimTimeoutsRef.current.push(setTimeout(() => setAgentStates((prev) =>
        prev[key].status === 'complete' ? prev :
        { ...prev, [key]: { status: 'complete', findings: mockData[key].findings, streamText: '' } }
      ), doneMs));
    });

    mockSimTimeoutsRef.current.push(setTimeout(() => {
      setAnalysisData(mockData);
      setIsRunning(false);
    }, 7400));
  }

  async function handleRunAnalysis() {
    if (isRunning) return;
    setIsRunning(true);
    setAgentStates({
      riskAgent: { status: 'running', findings: [], streamText: '' },
      careGapAgent: { status: 'running', findings: [], streamText: '' },
      sdohAgent: { status: 'running', findings: [], streamText: '' },
      actionPlanner: { status: 'running', findings: [], streamText: '' },
    });

    const patientId = patient.id;
    const anyEventTimeout = setTimeout(() => {
      // If we get nothing from the real stream within 4s, fall back to mock sim
      // so the UI never appears stuck on a silent network failure.
      runMockSim(patientId);
    }, 4000);

    try {
      await streamAnalysis(patientId, {
        onToken: (agentId, text) => {
          clearTimeout(anyEventTimeout);
          const key = AGENT_ID_MAP[agentId];
          if (!key) return;
          setAgentStates((prev) => ({
            ...prev,
            [key]: { ...prev[key], streamText: prev[key].streamText + text },
          }));
        },
        onFinding: (raw) => {
          clearTimeout(anyEventTimeout);
          const key = AGENT_ID_MAP[raw.agentId];
          if (!key) return;
          const finding = mapAnalysisFindingToAgentFinding(raw);
          setAgentStates((prev) => ({
            ...prev,
            [key]: { ...prev[key], findings: [...prev[key].findings, finding] },
          }));
        },
        onComplete: (summary) => {
          clearTimeout(anyEventTimeout);
          const key = AGENT_ID_MAP[summary.agentId];
          if (!key) return;
          setAgentStates((prev) => ({
            ...prev,
            [key]: {
              status: 'complete',
              findings: prev[key].findings,
              streamText: '',
              riskScore: summary.riskScore,
              riskLevel: summary.riskLevel,
            },
          }));
        },
        onTask: (task) => {
          // Action Planner's `task` events are created HAPI tasks (one per
          // stream-emitted Task). Surface them into the panel mode's
          // Action Plan column. For patients that aren't preloaded with mock
          // analysis data (e.g. `/patients/maria-1`), `analysisData` may be
          // null at this point — seed a base so the append doesn't no-op.
          setAnalysisData((prev) => {
            const base: DisplayAnalysisData =
              prev ?? {
                riskAgent: { status: 'complete', findings: [] },
                careGapAgent: { status: 'complete', findings: [] },
                sdohAgent: { status: 'complete', findings: [] },
                actionPlanner: { status: 'complete', findings: [] },
              };
            return {
              ...base,
              actionPlanner: {
                status: 'complete',
                findings: [
                  ...base.actionPlanner.findings,
                  {
                    type: 'action',
                    finding: task.title,
                    fhirResourceId: task.reference,
                    severity: (['critical', 'high', 'medium', 'low'] as const).includes(task.priority as 'critical' | 'high' | 'medium' | 'low')
                      ? (task.priority as AgentFinding['severity'])
                      : 'medium',
                    confidence: 0.8,
                  },
                ],
              },
            };
          });
        },
        onDone: () => {
          clearTimeout(anyEventTimeout);
          setIsRunning(false);
        },
      });
    } catch {
      clearTimeout(anyEventTimeout);
      runMockSim(patientId);
    }
  }

  const handleTaskCreated = (findingText: string) => {
    setCreatedTasks((prev) => new Set(prev).add(findingText));
  };

  const actionFindings: AgentFinding[] =
    agentStates.actionPlanner.status === 'complete' ? agentStates.actionPlanner.findings : [];

  const displayedActionFindings =
    actionFindings.length > 0
      ? actionFindings
      : analysisData?.actionPlanner.findings ?? [];

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

  if (viewMode === 'cinema') {
    return (
      <>
        <div className="relative">
          <div className="fixed top-2.5 right-36 z-50">
            <ViewToggle />
          </div>
          <CinemaView
            patient={patient}
            agentStates={agentStates}
            isRunning={isRunning}
            onRun={handleRunAnalysis}
            displayedActionFindings={displayedActionFindings}
            createdTasks={createdTasks}
            onTaskCreated={handleTaskCreated}
            onBack={() => navigate('/population')}
          />
        </div>
        <AnalysisProgressFloat isRunning={isRunning} agentStates={agentStates} />
      </>
    );
  }

  if (viewMode === 'orchestrator') {
    return (
      <>
        <div className="relative">
          <div className="fixed top-2.5 right-36 z-50">
            <ViewToggle />
          </div>
          <OrchestratorView
            patient={patient}
            agentStates={agentStates}
            isRunning={isRunning}
            onRun={handleRunAnalysis}
            onBack={() => navigate('/population')}
          />
        </div>
        <AnalysisProgressFloat isRunning={isRunning} agentStates={agentStates} />
      </>
    );
  }

  return (
    <>
      <div className="grid h-[calc(100vh-48px)] overflow-hidden gap-4 p-4" style={{ gridTemplateColumns: '25% 40% 35%' }}>
        <div className="bg-surface rounded-xl border border-border p-5 overflow-y-auto flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate('/population')}
              className="text-text-muted text-sm hover:text-cyan transition-colors text-left"
            >
              ← Population
            </button>
            <ViewToggle />
          </div>

          <p className="text-text-muted text-xs uppercase tracking-wider">Patient Profile</p>

          <div>
            <h1 className="text-xl font-bold text-text">{patient.name}</h1>
            <p className="text-text-muted text-sm mt-0.5">
              {patient.age}y {patient.sex} · MRN {patient.mrn}
            </p>
          </div>

          <div className="flex justify-center">
            <div
              className={`px-6 py-3 rounded-full flex flex-col items-center ${riskBadgeClasses(patient.riskLevel)}`}
              data-testid="patient-risk-badge"
            >
              <span className="text-3xl font-bold leading-none">{patient.riskScore}</span>
              <span className="text-xs font-semibold uppercase tracking-wider mt-1 opacity-80">
                {patient.riskLevel} risk
              </span>
            </div>
          </div>

          <div>
            <p className="text-text-muted text-xs uppercase tracking-wider mb-2">Conditions</p>
            <ul className="space-y-1.5" data-testid="patient-conditions">
              {patient.conditions.map((condition, i) => {
                const sev = CONDITION_SEVERITIES[Math.min(i, CONDITION_SEVERITIES.length - 1)];
                return (
                  <li key={condition} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${severityDot(sev)}`} />
                    <span className="text-text text-sm">{condition}</span>
                  </li>
                );
              })}
            </ul>
          </div>

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

          <div className="mt-auto pt-4 border-t border-border-light">
            <p className="text-text-muted text-xs">
              Last contact:{' '}
              <span className={`font-medium ${patient.daysSinceContact <= 3 ? 'text-emerald' : patient.daysSinceContact <= 14 ? 'text-amber' : 'text-red'}`}>
                {patient.daysSinceContact}d ago
              </span>
            </p>
          </div>
        </div>

        <div className="bg-surface rounded-xl border border-border p-5 overflow-y-auto flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-text font-semibold text-base">AI Agent Analysis</h2>
            <button
              onClick={handleRunAnalysis}
              disabled={isRunning}
              data-testid="run-analysis"
              className="bg-violet text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? 'Running...' : 'Run Analysis'}
            </button>
          </div>

          <div className="flex-1">
            {AGENT_KEYS.map((key) => (
              <AgentCard key={key} agentKey={key} state={agentStates[key]} />
            ))}
          </div>
        </div>

        <div className="bg-surface rounded-xl border border-border p-5 overflow-y-auto flex flex-col">
          <p className="text-text-muted text-xs uppercase tracking-wider mb-4">Action Plan</p>

          {displayedActionFindings.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
              <span className="text-4xl">🤖✨</span>
              <p className="text-text font-medium">No action plan yet</p>
              <p className="text-text-muted text-sm max-w-xs">
                Run analysis to let the AI agents generate a prioritised action plan for this patient.
              </p>
            </div>
          ) : (
            <div className="flex-1" data-testid="action-plan">
              {displayedActionFindings.map((finding, i) => (
                <ActionCard
                  key={`${finding.fhirResourceId}-${i}`}
                  finding={finding}
                  isCreated={createdTasks.has(finding.finding)}
                  onCreated={handleTaskCreated}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <AnalysisProgressFloat isRunning={isRunning} agentStates={agentStates} />
    </>
  );
}
