const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'caresync_token';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function login(email: string, password: string): Promise<{ token: string }> {
  return apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export interface PanelPatient {
  id: string;
  name: string;
  gender: string;
  birthDate: string;
  riskScore: number;
  taskCount: number;
  conditionTags: string[];
}

export function getAssignedPanel(): Promise<PanelPatient[]> {
  return apiFetch('/api/patients/assigned');
}

export interface TaskSummary {
  id: string;
  title: string;
  priority: 'critical' | 'high' | 'medium';
  due: string;
  status: string;
}

// S7 B1 — TaskSummary plus the fields the M02 task-queue card needs: which
// patient the task belongs to, a display name, and a short condition tag.
// Mirrors `TaskListEntry` in apps/api/src/fhir/client.ts, returned only by
// `GET /api/tasks` (listTasks) — not by `getPatient`'s embedded tasks.
export interface TaskListEntry extends TaskSummary {
  patientId: string;
  patientName: string;
  conditionTag?: string;
}

export function listTasks(): Promise<TaskListEntry[]> {
  return apiFetch('/api/tasks');
}

// S7 B2 — TaskListEntry plus the fields the M03 task-detail screen needs:
// resolved citations and the patient's phone (for the Call action). Mirrors
// `TaskDetail` in apps/api/src/fhir/client.ts, returned only by
// `GET /api/tasks/:id` (getTaskDetail).
export interface TaskDetail extends TaskListEntry {
  citations: Array<{ reference: string; display: string }>;
  patientPhone?: string;
}

export function getTaskDetail(id: string): Promise<TaskDetail> {
  return apiFetch(`/api/tasks/${id}`);
}

export type TaskStatusTransition = 'complete' | 'defer' | 'escalate';

/** S7 B2 — the M03 task-detail screen's Complete/Defer/Escalate buttons all PATCH the same endpoint with a different transition. */
export function transitionTask(id: string, transition: TaskStatusTransition): Promise<{ id: string; status: string }> {
  return apiFetch(`/api/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ transition }) });
}

/** S7 B1 — the M02 queue's only wired action; a thin sibling of `transitionTask` kept for the existing call sites. */
export function completeTask(id: string): Promise<{ id: string; status: string }> {
  return transitionTask(id, 'complete');
}

export interface PatientDetail {
  patient: { id: string; name: string; gender: string; birthDate: string };
  conditions: Array<{ id: string; code: string; display: string }>;
  tasks: TaskSummary[];
}

export function getPatient(id: string): Promise<PatientDetail> {
  return apiFetch(`/api/patients/${id}`);
}

/** One plotted patient in the W02 population scatter — `x` is riskScore, `y` is urgency (both 0-100), matching `apps/api/src/population/service.ts`'s `ScatterPoint`. */
export interface ScatterPoint {
  id: string;
  riskScore: number;
  urgency: number;
  x: number;
  y: number;
}

export function getPopulationScatter(): Promise<ScatterPoint[]> {
  return apiFetch('/api/population/scatter');
}

/** Real-but-not-yet-sliced-by-team counts — see `PopulationSummaryResult.teamKpis` in `apps/api/src/population/service.ts`. */
export interface TeamKpis {
  criticalZonePatients: number;
  totalPatients: number;
}

export interface PopulationSummary {
  criticalZoneCount: number;
  projectedCostAvoidance: number;
  teamKpis: TeamKpis;
}

export function getPopulationSummary(): Promise<PopulationSummary> {
  return apiFetch('/api/population/summary');
}

// --- S8 B — governance dashboard (W06) -----------------------------------

/** One row of the S1 `audit_log`, as returned by `GET /api/governance/audit` — no patient name/recommendation text/FHIR citation/confidence% (the mockup's per-entry fields): the real audit_log row only ever carries these five columns (`apps/api/src/db/audit.ts`'s `AuditTrailEntry`). */
export interface AuditTrailEntry {
  ts: string;
  actor: string;
  action: string;
  resource: string;
  outcome: 'success' | 'denied' | 'error';
}

export interface AuditTrailResult {
  entries: AuditTrailEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** Director-only, paged read of the audit trail — mirrors `apps/api/src/routes/governance.ts`'s `?limit=&offset=` query params exactly. */
export function getAuditTrail(limit = 50, offset = 0): Promise<AuditTrailResult> {
  return apiFetch(`/api/governance/audit?limit=${limit}&offset=${offset}`);
}

export interface AnalysisVersionEntry {
  patientId: string;
  modelVersion: string;
  createdTs: string;
}

/** One of the 4 fixed confidence bands `apps/api/src/governance/service.ts`'s `CONFIDENCE_BUCKETS` derives from actual cached agent output — not the mockup's 5 hardcoded demo bands. */
export interface ConfidenceBucket {
  range: string;
  count: number;
}

export interface ModelPerformanceResult {
  analyses: AnalysisVersionEntry[];
  confidenceDistribution: ConfidenceBucket[];
}

export function getModelPerformance(): Promise<ModelPerformanceResult> {
  return apiFetch('/api/governance/model');
}

/** One demographic group's cached-risk-score stat within a single stratification dimension (age band / sex / race / ethnicity). */
export interface ParityGroupStat {
  group: string;
  patientCount: number;
  avgRiskScore: number;
}

export interface ParityResult {
  byAgeBand: ParityGroupStat[];
  bySex: ParityGroupStat[];
  byRace: ParityGroupStat[];
  byEthnicity: ParityGroupStat[];
}

/** Director-only demographic parity (GD12) — real, computed from cached risk scores joined to live HAPI demographics; see `apps/api/src/governance/service.ts`'s `getParityMetrics` doc. */
export function getParityMetrics(): Promise<ParityResult> {
  return apiFetch('/api/governance/parity');
}

/**
 * The B2 eval headline tile's data source: a stateless read of the S9
 * evaluation report JSON (`docs/eval-report.json`, repo root — see
 * `apps/api/src/governance/service.ts`'s `EVAL_REPORT_PATH`). S9 doesn't
 * exist on this branch, so `available` is `false` today and will stay that
 * way until S9 ships; `summary`'s shape is deliberately `unknown` since S9's
 * JSON contract isn't defined yet.
 */
export interface EvalSummaryResult {
  available: boolean;
  summary?: unknown;
}

export function getEvalSummary(): Promise<EvalSummaryResult> {
  return apiFetch('/api/governance/eval');
}

// --- S11 A2 — Quality/HEDIS measure aggregate (W05/W07) ------------------

/**
 * The ONE real HEDIS-style measure this POC computes end to end
 * ("Comprehensive Diabetes Care: HbA1c Testing" — see
 * `apps/api/src/quality/service.ts`'s `getDiabetesHba1cMeasure` doc for the
 * FHIR codes and the "one honest measure beats two fabricated ones" reasoning).
 * `illustrativeIncentiveDollars` is a documented, labeled estimate
 * (`gapPatients * $5,000/closed gap`), never a real payer-contract figure —
 * `Quality.tsx` must render it with that caveat, not as a plain dollar amount.
 */
export interface QualityMeasureResult {
  measureId: string;
  measureName: string;
  numerator: number;
  denominator: number;
  rate: number;
  gapPatients: number;
  illustrativeIncentiveDollars: number;
}

export function getQualityMeasures(): Promise<QualityMeasureResult> {
  return apiFetch('/api/quality/measures');
}

// --- S11 A3 — Team performance aggregate (W04) ---------------------------

/** Mirrors `CoordinatorWorkload` in `apps/api/src/team/service.ts`. */
export interface CoordinatorWorkload {
  coordinatorId: string;
  name: string;
  assignedCount: number;
  completedCount: number;
  completionRate: number;
}

/**
 * Mirrors `TeamPerformanceResult` in `apps/api/src/team/service.ts` exactly.
 * Computed live from real Task ownership/status at request time — an empty
 * `coordinators` array or all-zero counts is a true reflection of current
 * demo state (e.g. no coordinators seeded, or no Task has been assigned/
 * completed yet), never a loading artifact.
 */
export interface TeamPerformanceResult {
  coordinators: CoordinatorWorkload[];
  unassignedCount: number;
  totalTasks: number;
  overallCompletionRate: number;
}

export function getTeamPerformance(): Promise<TeamPerformanceResult> {
  return apiFetch('/api/team/performance');
}

export type AgentId = 'risk' | 'careGap' | 'sdoh' | 'actionPlanner';

/**
 * A `finding` event's payload. Shape varies per agent (risk/careGap/sdoh each
 * add their own fields), so only `agentId` is required; the rest are optional
 * so callers can safely read whichever fields their agentId implies while
 * still typechecking (e.g. `flag.fhirResourceId`, `flag.text`).
 */
export interface AnalysisFinding {
  agentId: AgentId;
  text?: string;
  fhirResourceId?: string;
  gapType?: string;
  description?: string;
  urgency?: string;
  domain?: string;
  finding?: string;
  severity?: string;
  [key: string]: unknown;
}

/** A `complete` event's payload — fires once per agent. */
export interface AnalysisSummary {
  agentId: AgentId;
  findingCount: number;
  droppedCount: number;
  riskScore?: number;
  riskLevel?: string;
  readmissionProbability?: number;
  referralsNeeded?: string[];
}

/** A `task` event's payload — one per Task created in HAPI by the action planner. */
export interface AnalysisTask {
  agentId: 'actionPlanner';
  id: string;
  reference: string;
  title: string;
  description: string;
  priority: string;
  assignTo?: string;
  dueInDays?: number;
  fhirResources: string[];
}

export interface AnalysisHandlers {
  onToken?: (agentId: AgentId, text: string) => void;
  onFinding?: (flag: AnalysisFinding) => void;
  onComplete?: (summary: AnalysisSummary) => void;
  onTask?: (task: AnalysisTask) => void;
  onDone?: () => void;
}

/**
 * Streams `POST /api/patients/:id/analysis`'s `text/event-stream` response,
 * dispatching each SSE frame (`event: <type>\ndata: <json>\n\n`) to the
 * matching handler as it arrives. Buffers across `read()` calls so a frame
 * split across chunk boundaries is still parsed correctly.
 *
 * Pass `{ live: true }` to append `?live=1`, forcing the backend to run the
 * orchestrator fresh instead of replaying its cache. The SSE event shape is
 * identical either way (by backend design), so this flag only chooses the
 * source of the data — the caller renders both modes through one code path.
 */
export async function streamAnalysis(
  patientId: string,
  handlers: AnalysisHandlers,
  opts?: { live?: boolean }
): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  const query = opts?.live ? '?live=1' : '';
  const res = await fetch(`${API_BASE_URL}/api/patients/${patientId}/analysis${query}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (event: string, data: string) => {
    const payload = JSON.parse(data);
    if (event === 'token') handlers.onToken?.(payload.agentId, payload.text);
    else if (event === 'finding') handlers.onFinding?.(payload);
    else if (event === 'complete') handlers.onComplete?.(payload);
    else if (event === 'task') handlers.onTask?.(payload);
    else if (event === 'done') handlers.onDone?.();
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let frameEnd: number;
    while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);

      let event = '';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice('event: '.length);
        else if (line.startsWith('data: ')) data = line.slice('data: '.length);
      }
      if (event && data) dispatch(event, data);
    }
  }
}

// --- S11 A1 — SDOH resource directory + referral (M05) -------------------

/** Mirrors `CommunityResource` in `apps/api/src/sdoh/resources.ts` — a static seed list, not FHIR-backed (see that file's doc). */
export interface CommunityResource {
  id: string;
  name: string;
  category: 'transportation' | 'food' | 'housing' | 'mental_health' | 'utilities';
  description: string;
  coverage: string;
  phone?: string;
}

/** Any authenticated role can browse the directory; `category` filters server-side, omitted/`'all'` returns everything. */
export function getSdohResources(category?: string): Promise<CommunityResource[]> {
  return apiFetch(`/api/sdoh/resources${category && category !== 'all' ? `?category=${category}` : ''}`);
}

/** Director/Coordinator/Social Worker (sdoh scope) can all refer — `createServiceRequest` on the backend does the actual audited FHIR write. */
export function postSdohReferral(patientId: string, resourceId: string): Promise<{ id: string }> {
  return apiFetch('/api/sdoh/referrals', { method: 'POST', body: JSON.stringify({ patientId, resourceId }) });
}

export interface AssignedTaskEvent {
  id: string;
  title: string;
  priority: string;
  due?: string;
  status: string;
  patientId?: string;
  ownerId?: string;
}

/**
 * S6 B1 — subscribes to `/api/events`, the real-time relay. Uses `fetch` +
 * a stream reader (same framing as `streamAnalysis` above), not
 * `EventSource` — `EventSource` can't send the `Authorization` header this
 * bearer-gated route requires. Reconnects (after a short delay) on stream
 * end/error so a dropped connection recovers without user action, per the
 * plan's "reconnect re-establishes" rollback note; the in-memory relay hub
 * has nothing to replay, so any event that fired while disconnected is
 * simply missed — acceptable for this POC's single-connection demo flow.
 *
 * Returns an unsubscribe function that stops the read loop and any pending
 * reconnect.
 */
export function subscribeToEvents(handlers: {
  onAssignment?: (task: AssignedTaskEvent) => void;
  // S7 B3 — cross-surface sync: fires on every Task webhook (assigned or
  // not), unlike `onAssignment` (owner-scoped). Same `AssignedTaskEvent`
  // shape — the wire payload is the same mapped Task either way.
  onTaskUpdated?: (task: AssignedTaskEvent) => void;
}): () => void {
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  async function connectOnce(): Promise<void> {
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch(`${API_BASE_URL}/api/events`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok || !res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done || stopped) break;
      buffer += decoder.decode(value, { stream: true });

      let frameEnd: number;
      while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);

        let event = '';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice('event: '.length);
          else if (line.startsWith('data: ')) data = line.slice('data: '.length);
        }
        if (event === 'assignment' && data) handlers.onAssignment?.(JSON.parse(data));
        else if (event === 'task-updated' && data) handlers.onTaskUpdated?.(JSON.parse(data));
      }
    }
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        await connectOnce();
      } catch {
        // Connection dropped or never opened — reconnect below.
      }
      if (stopped) return;
      await new Promise<void>((resolve) => {
        reconnectTimer = setTimeout(resolve, 3000);
      });
    }
  }

  loop();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}
