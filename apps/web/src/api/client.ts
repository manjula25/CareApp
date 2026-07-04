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

export interface PatientDetail {
  patient: { id: string; name: string; gender: string; birthDate: string };
  conditions: Array<{ id: string; code: string; display: string }>;
  tasks: TaskSummary[];
}

export function getPatient(id: string): Promise<PatientDetail> {
  return apiFetch(`/api/patients/${id}`);
}

export interface AnalysisFinding {
  text: string;
  fhirResourceId: string;
}

export interface AnalysisSummary {
  riskScore: number;
  riskLevel: string;
  readmissionProbability: number;
  findingCount: number;
  droppedCount: number;
}

export interface AnalysisHandlers {
  onToken?: (text: string) => void;
  onFinding?: (flag: AnalysisFinding) => void;
  onComplete?: (summary: AnalysisSummary) => void;
}

/**
 * Streams `POST /api/patients/:id/analysis`'s `text/event-stream` response,
 * dispatching each SSE frame (`event: <type>\ndata: <json>\n\n`) to the
 * matching handler as it arrives. Buffers across `read()` calls so a frame
 * split across chunk boundaries is still parsed correctly.
 */
export async function streamAnalysis(patientId: string, handlers: AnalysisHandlers): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE_URL}/api/patients/${patientId}/analysis`, {
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
    if (event === 'token') handlers.onToken?.(payload.text);
    else if (event === 'finding') handlers.onFinding?.(payload);
    else if (event === 'complete') handlers.onComplete?.(payload);
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
