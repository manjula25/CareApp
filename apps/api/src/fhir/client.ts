import Database from 'better-sqlite3';
import { AuthTokenPayload } from '../auth/jwt';
import { hasScope, ResourceDomain } from '../auth/scopes';
import { writeAudit } from '../db/audit';

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

export interface PanelEntry {
  id: string;
  name: string;
  riskScore: number;
  taskCount: number;
}

interface FhirBundleEntry<T> {
  resource: T;
}
interface FhirBundle<T> {
  entry?: FhirBundleEntry<T>[];
}

const COORDINATOR_PANEL_GROUP_ID = 'coordinator-demo-panel';

export class FhirReadService {
  constructor(private readonly db: Database.Database, private readonly baseUrl: string) {}

  private async fhirFetch<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
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

  async getAssignedPanel(actor: AuthTokenPayload): Promise<PanelEntry[]> {
    const resource = `Group/${COORDINATOR_PANEL_GROUP_ID}`;
    this.guard(actor, 'clinical', resource);
    const group = await this.fhirFetch<any>(`/${resource}`);
    writeAudit(this.db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'success' });

    const patientIds: string[] = (group.member ?? []).map((m: any) => m.entity.reference.split('/')[1]);

    return Promise.all(
      patientIds.map(async (id) => {
        const [patient, risk, tasks] = await Promise.all([
          this.fhirFetch<any>(`/Patient/${id}`),
          this.fhirFetch<FhirBundle<any>>(`/RiskAssessment?subject=Patient/${id}`),
          this.fhirFetch<FhirBundle<any>>(`/Task?subject=Patient/${id}`),
        ]);
        const name = patient.name?.[0];
        const riskScore = Math.round((risk.entry?.[0]?.resource.prediction?.[0]?.probabilityDecimal ?? 0) * 100);
        return {
          id,
          name: [name?.given?.join(' '), name?.family].filter(Boolean).join(' '),
          riskScore,
          taskCount: tasks.entry?.length ?? 0,
        };
      })
    );
  }
}
