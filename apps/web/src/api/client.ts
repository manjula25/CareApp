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

/** S7 B1 — the M02 queue's only wired action; Defer/Escalate/Call belong to B2's task-detail screen. */
export function completeTask(id: string): Promise<{ id: string; status: string }> {
  return apiFetch(`/api/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ transition: 'complete' }) });
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
export function subscribeToEvents(handlers: { onAssignment?: (task: AssignedTaskEvent) => void }): () => void {
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
