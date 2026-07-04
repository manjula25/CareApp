import Database from 'better-sqlite3';
import { AuthTokenPayload } from '../auth/jwt';
import { hasScope, ResourceDomain } from '../auth/scopes';
import { writeAudit } from '../db/audit';
import { shortConditionTag } from './conditionTags';

export class ScopeDeniedError extends Error {
  constructor(role: string, domain: ResourceDomain) {
    super(`Role '${role}' does not have '${domain}' scope`);
    this.name = 'ScopeDeniedError';
  }
}

export interface PatientSummary {
  id: string;
  name: string;
  gender: string;
  birthDate: string;
}

export interface ConditionSummary {
  id: string;
  code: string;
  display: string;
}

export type TaskPriority = 'critical' | 'high' | 'medium';

export interface TaskSummary {
  id: string;
  title: string;
  priority: TaskPriority;
  due: string;
  status: string;
}

const FHIR_PRIORITY_TO_DISPLAY: Record<string, TaskPriority> = {
  stat: 'critical',
  urgent: 'high',
  asap: 'high',
  routine: 'medium',
};

const FHIR_STATUS_TO_DISPLAY: Record<string, string> = {
  requested: 'Open',
  accepted: 'Open',
  'in-progress': 'In progress',
  completed: 'Done',
  cancelled: 'Cancelled',
};

export interface PanelEntry {
  id: string;
  name: string;
  gender: string;
  birthDate: string;
  riskScore: number;
  taskCount: number;
  conditionTags: string[];
}

interface FhirBundleEntry<T> {
  resource: T;
}
interface FhirBundle<T> {
  entry?: FhirBundleEntry<T>[];
}

const COORDINATOR_PANEL_GROUP_ID = 'coordinator-demo-panel';

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export class FhirReadService {
  constructor(
    private readonly db: Database.Database,
    private readonly baseUrl: string,
    private readonly tokenClient?: AccessTokenProvider
  ) {}

  private async fhirFetch<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.tokenClient) {
      headers.Authorization = `Bearer ${await this.tokenClient.getAccessToken()}`;
    }
    const res = await fetch(`${this.baseUrl}${path}`, { headers });
    if (!res.ok) {
      throw new Error(`FHIR request failed: GET ${path} -> ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private guard(actor: AuthTokenPayload, domain: ResourceDomain, resource: string): void {
    if (!hasScope(actor.role, domain)) {
      writeAudit(this.db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'denied' });
      throw new ScopeDeniedError(actor.role, domain);
    }
  }

  async getPatient(actor: AuthTokenPayload, patientId: string): Promise<PatientSummary> {
    const resource = `Patient/${patientId}`;
    this.guard(actor, 'demographic', resource);
    const patient = await this.fhirFetch<any>(`/${resource}`);
    writeAudit(this.db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'success' });
    const name = patient.name?.[0];
    return {
      id: patient.id,
      name: [name?.given?.join(' '), name?.family].filter(Boolean).join(' '),
      gender: patient.gender,
      birthDate: patient.birthDate,
    };
  }

  async getConditions(actor: AuthTokenPayload, patientId: string): Promise<ConditionSummary[]> {
    const resource = `Condition/${patientId}`;
    this.guard(actor, 'clinical', resource);
    const bundle = await this.fhirFetch<FhirBundle<any>>(`/Condition?subject=Patient/${patientId}`);
    writeAudit(this.db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'success' });
    return (bundle.entry ?? []).map((e) => ({
      id: e.resource.id,
      code: e.resource.code?.coding?.[0]?.code,
      display: e.resource.code?.text ?? e.resource.code?.coding?.[0]?.display,
    }));
  }

  async getTasks(actor: AuthTokenPayload, patientId: string): Promise<TaskSummary[]> {
    const resource = `Task/${patientId}`;
    this.guard(actor, 'clinical', resource);
    const bundle = await this.fhirFetch<FhirBundle<any>>(`/Task?subject=Patient/${patientId}`);
    writeAudit(this.db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'success' });
    return (bundle.entry ?? []).map((e) => ({
      id: e.resource.id,
      title: e.resource.description,
      priority: FHIR_PRIORITY_TO_DISPLAY[e.resource.priority] ?? 'medium',
      due: e.resource.restriction?.period?.end,
      status: FHIR_STATUS_TO_DISPLAY[e.resource.status] ?? 'Open',
    }));
  }

  async getAssignedPanel(actor: AuthTokenPayload): Promise<PanelEntry[]> {
    const resource = `Group/${COORDINATOR_PANEL_GROUP_ID}`;
    this.guard(actor, 'clinical', resource);
    const group = await this.fhirFetch<any>(`/${resource}`);
    writeAudit(this.db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'success' });

    const patientIds: string[] = (group.member ?? []).map((m: any) => m.entity.reference.split('/')[1]);

    return Promise.all(
      patientIds.map(async (id) => {
        const [patient, risk, tasks, conditions] = await Promise.all([
          this.fhirFetch<any>(`/Patient/${id}`),
          this.fhirFetch<FhirBundle<any>>(`/RiskAssessment?subject=Patient/${id}`),
          this.fhirFetch<FhirBundle<any>>(`/Task?subject=Patient/${id}`),
          this.fhirFetch<FhirBundle<any>>(`/Condition?subject=Patient/${id}`),
        ]);
        const name = patient.name?.[0];
        const riskScore = Math.round((risk.entry?.[0]?.resource.prediction?.[0]?.probabilityDecimal ?? 0) * 100);
        const conditionTags = (conditions.entry ?? [])
          .slice(0, 2)
          .map((e) => shortConditionTag(e.resource.code?.coding?.[0]?.code, e.resource.code?.text ?? ''));
        return {
          id,
          name: [name?.given?.join(' '), name?.family].filter(Boolean).join(' '),
          gender: patient.gender,
          birthDate: patient.birthDate,
          riskScore,
          taskCount: tasks.entry?.length ?? 0,
          conditionTags,
        };
      })
    );
  }
}
