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

/**
 * Role-level (not domain-level) denial: `hasScope`/`guard` below check
 * per-domain access (demographic/clinical/sdoh), but director AND coordinator
 * both hold clinical scope, so a Director-only action (e.g. S6 task
 * assignment, S5 population aggregates) can't be expressed as a missing
 * domain. This is the one shared class for that "role above domain" case —
 * `population/service.ts`'s `assertDirector` was the first caller and
 * originally defined this locally; it now imports it from here so there is
 * still exactly one Director-only error type, not two parallel ones.
 */
export class DirectorOnlyError extends Error {
  constructor(role: string, action: string) {
    super(`Role '${role}' cannot ${action} (Director-only)`);
    this.name = 'DirectorOnlyError';
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

// S6 A3 — TaskSummary plus the two fields the subscription webhook needs to
// route a notification: which patient the Task is for, and which coordinator
// (app `users.id`, via the logical `owner.identifier` reference) now owns it.
export interface TaskWithOwner extends TaskSummary {
  patientId?: string;
  ownerId?: string;
}

const FHIR_PRIORITY_TO_DISPLAY: Record<string, TaskPriority> = {
  stat: 'critical',
  urgent: 'high',
  asap: 'high',
  routine: 'medium',
};

// Maps an Action Planner priority string to the FHIR Task priority code —
// mirrors TASK_PRIORITY_TO_FHIR in scripts/import-fhir.ts (seed data), kept
// separate because the Action Planner's input strings are not guaranteed to
// be the same closed set as the seed data's SeedPatient['tasks'] type.
const ACTION_PLANNER_PRIORITY_TO_FHIR: Record<string, string> = {
  critical: 'stat',
  high: 'urgent',
  medium: 'routine',
};

// Every CareSync-authored Task carries this tag so replacePatientTasks can
// scope deletes to exactly the Tasks it created, never a seed/Synthea Task.
const CARESYNC_TASK_TAG = { system: 'https://caresync.demo/fhir/tags', code: 'ai-generated-task' } as const;

// S6 A1 — Task.owner identifier system for assignment. A *logical* reference
// (`{ identifier: { system, value } }`) rather than a literal
// `{ reference: 'Practitioner/{id}' }`: this POC has no Practitioner
// resources in HAPI, and HAPI enforces referential integrity on literal
// references by default (confirmed against the local instance — POSTing a
// Task with `owner.reference` pointing at a nonexistent Practitioner is
// rejected with HAPI-1094 "not found"). An identifier-only reference has
// nothing to resolve, so HAPI accepts it, and `coordinatorId` (the app's own
// `users.id`, not a FHIR id) round-trips exactly as assigned.
const COORDINATOR_OWNER_IDENTIFIER_SYSTEM = 'https://caresync.demo/fhir/coordinators';

/**
 * S6 A3 — maps a raw FHIR Task resource (as pushed by HAPI's subscription
 * webhook — see fhir/subscription.ts's `payload: 'application/fhir+json'`
 * note for why the webhook receives the full resource body, not just an id)
 * to the shape `routes/events.ts` needs: which patient it's for and which
 * coordinator (app `users.id`, via the logical `owner.identifier` reference
 * `assignTask` writes) now owns it. A standalone function, not a service
 * method — the webhook already has the resource in hand and needs no
 * further FHIR read (and thus no `writeAudit` call; the assignment itself
 * was already audited by `assignTask`).
 */
export function mapTaskResource(task: any): TaskWithOwner {
  return {
    id: task.id,
    title: task.description,
    priority: FHIR_PRIORITY_TO_DISPLAY[task.priority] ?? 'medium',
    due: task.restriction?.period?.end,
    status: FHIR_STATUS_TO_DISPLAY[task.status] ?? 'Open',
    patientId: task.for?.reference?.split('/')[1],
    ownerId: task.owner?.identifier?.value,
  };
}

export interface ActionPlannerTaskInput {
  title: string;
  description: string;
  priority: string;
  assignTo?: string;
  dueInDays?: number;
  fhirResources: string[];
}

export interface CreatedTask {
  id: string;
}

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

export interface PatientBundle {
  resources: any[];
  validIds: Set<string>;
}

interface FhirBundleEntry<T> {
  resource: T;
}
interface FhirBundle<T> {
  entry?: FhirBundleEntry<T>[];
}
interface PageableBundle<T> extends FhirBundle<T> {
  link?: { relation: string; url: string }[];
}

const COORDINATOR_PANEL_GROUP_ID = 'coordinator-demo-panel';

// S5 A2 — population aggregate reads. HAPI defaults to _count=20 per page;
// a single _count=1000 request comfortably covers the ~500-patient cohort
// (plus the handful of hero/panel patients) in one round trip. `fetchPages`
// below still follows any `link[rel=next]` HAPI returns anyway — belt and
// suspenders against a server-side page-size cap lower than this value —
// so growing the cohort past 1000 doesn't silently truncate results.
const POPULATION_FETCH_COUNT = 1000;

export interface PopulationRiskProfile {
  patientId: string;
  riskScore: number;
  /** Hours between now and this patient's most recent Encounter.period.end;
   *  undefined if no Encounter was found for the patient. */
  hoursSinceEncounter?: number;
}

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export class FhirReadService {
  constructor(
    private readonly db: Database.Database,
    private readonly baseUrl: string,
    private readonly tokenClient?: AccessTokenProvider
  ) {}

  private async fhirFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
    if (this.tokenClient) {
      headers.Authorization = `Bearer ${await this.tokenClient.getAccessToken()}`;
    }
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      throw new Error(`FHIR request failed: ${init.method ?? 'GET'} ${path} -> ${res.status}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Fetches every entry of a search, following `link[rel=next]` until HAPI
   * stops returning one — so a bulk population read never silently truncates
   * to whatever page size the server happens to cap requests at. `path`
   * should already include a bounding `_count` (see POPULATION_FETCH_COUNT);
   * this only kicks in the pagination loop if the server ignores/caps it.
   */
  private async fetchPages<T>(path: string): Promise<FhirBundleEntry<T>[]> {
    const entries: FhirBundleEntry<T>[] = [];
    let nextPath: string | undefined = path;
    while (nextPath) {
      const bundle: PageableBundle<T> = await this.fhirFetch<PageableBundle<T>>(nextPath);
      entries.push(...(bundle.entry ?? []));
      const nextUrl: string | undefined = bundle.link?.find((l) => l.relation === 'next')?.url;
      nextPath = nextUrl ? nextUrl.replace(this.baseUrl, '') : undefined;
    }
    return entries;
  }

  private guard(actor: AuthTokenPayload, domain: ResourceDomain, resource: string, action = 'read'): void {
    if (!hasScope(actor.role, domain)) {
      writeAudit(this.db, { actor: actor.id, action, fhirResource: resource, outcome: 'denied' });
      throw new ScopeDeniedError(actor.role, domain);
    }
  }

  /**
   * Public entry point to the same role→scope check (+ denial audit) every
   * other method here goes through via the private `guard`, for callers that
   * need to enforce the invariant without making a HAPI request themselves
   * (e.g. the analysis route's cache-replay path, S4 A2 — it skips
   * `getPatientBundle` to avoid a live HAPI read, but must not also skip the
   * scope gate + audit trail that method would otherwise be the only path
   * to). Same signature/behavior as `guard` — kept as a thin public alias
   * rather than renaming `guard` itself, so every existing call site here is
   * untouched.
   */
  assertScope(actor: AuthTokenPayload, domain: ResourceDomain, resource: string, action = 'read'): void {
    this.guard(actor, domain, resource, action);
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

  async getPatientBundle(actor: AuthTokenPayload, patientId: string): Promise<PatientBundle> {
    const resource = `Patient/${patientId}/$everything`;
    this.guard(actor, 'clinical', resource);
    const bundle = await this.fhirFetch<FhirBundle<any>>(`/${resource}`);
    writeAudit(this.db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'success' });

    const resources = (bundle.entry ?? []).map((e) => e.resource);
    // validIds is derived from resources — never assembled separately — so the
    // agent's input and the citation-check set cannot drift (GD11).
    const validIds = new Set(resources.map((r) => `${r.resourceType}/${r.id}`));
    return { resources, validIds };
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

  /**
   * S5 A2 — one bulk read backing both population dashboard endpoints
   * (scatter + summary). Two `_count`-bounded searches (RiskAssessment,
   * Encounter — no per-patient round trips) joined client-side on
   * `subject`. Audited ONCE for the whole aggregate read, mirroring
   * `getAssignedPanel` above (which also audits once despite several
   * per-patient fetches) rather than once per resource type — the
   * externally-observable action is "read the population", not "read
   * RiskAssessment" then separately "read Encounter".
   *
   * No Patient join: the scatter/summary consumers only need id + risk +
   * encounter recency, not demographics.
   */
  async getPopulationRiskProfile(actor: AuthTokenPayload): Promise<PopulationRiskProfile[]> {
    const resource = 'Population';
    this.guard(actor, 'clinical', resource);

    const [riskEntries, encounterEntries] = await Promise.all([
      this.fetchPages<any>(`/RiskAssessment?_count=${POPULATION_FETCH_COUNT}`),
      this.fetchPages<any>(`/Encounter?_count=${POPULATION_FETCH_COUNT}`),
    ]);
    writeAudit(this.db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'success' });

    const encounterEndByPatient = new Map<string, string>();
    for (const e of encounterEntries) {
      const patientId = e.resource.subject?.reference?.split('/')[1];
      const end = e.resource.period?.end;
      if (patientId && end) encounterEndByPatient.set(patientId, end);
    }

    const now = Date.now();
    return riskEntries
      .map((e): PopulationRiskProfile | undefined => {
        const patientId: string | undefined = e.resource.subject?.reference?.split('/')[1];
        if (!patientId) return undefined;
        const riskScore = Math.round((e.resource.prediction?.[0]?.probabilityDecimal ?? 0) * 100);
        const encounterEnd = encounterEndByPatient.get(patientId);
        const hoursSinceEncounter = encounterEnd ? (now - new Date(encounterEnd).getTime()) / (60 * 60 * 1000) : undefined;
        return { patientId, riskScore, hoursSinceEncounter };
      })
      .filter((p): p is PopulationRiskProfile => p !== undefined);
  }

  /**
   * Creates one CareSync-authored FHIR Task, tagged with CARESYNC_TASK_TAG so
   * a later replacePatientTasks run can find and replace it without ever
   * touching a seed/Synthea Task (which carries no such tag).
   *
   * Citation storage: `task.fhirResources` (the Action Planner's citations for
   * this task) is intentionally NOT persisted onto the FHIR Task. HAPI's Task
   * resource has no native "citations" field, and bolting one on via a custom
   * extension would invent a non-standard shape only this app understands —
   * for a POC that's more machinery than the problem needs. The caller (the
   * analysis route, wired in a later task) already holds the
   * ActionPlannerOutput in memory and can carry `fhirResources` alongside the
   * created Task id in its own SSE `task` event, so nothing is lost — it's
   * just kept out of the FHIR resource itself.
   */
  async createTask(actor: AuthTokenPayload, patientId: string, task: ActionPlannerTaskInput): Promise<CreatedTask> {
    const resource = `Task/${patientId}`;
    this.guard(actor, 'clinical', resource, 'create');

    const body: Record<string, unknown> = {
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      priority: ACTION_PLANNER_PRIORITY_TO_FHIR[task.priority] ?? 'routine',
      description: `${task.title} — ${task.description}`,
      for: { reference: `Patient/${patientId}` },
      authoredOn: new Date().toISOString(),
      meta: { tag: [CARESYNC_TASK_TAG] },
    };
    if (task.dueInDays != null) {
      body.restriction = {
        period: { end: new Date(Date.now() + task.dueInDays * 24 * 60 * 60 * 1000).toISOString() },
      };
    }

    const created = await this.fhirFetch<{ id: string }>('/Task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify(body),
    });
    writeAudit(this.db, { actor: actor.id, action: 'create', fhirResource: `Task/${created.id}`, outcome: 'success' });
    return { id: created.id };
  }

  /**
   * S6 A1 — Director-scoped Task assignment: sets `Task.owner` to a logical
   * reference to `coordinatorId` (see COORDINATOR_OWNER_IDENTIFIER_SYSTEM)
   * via a read-modify-PUT (FHIR's standard full-resource "update"), mirroring
   * `createTask`'s guard-then-write-then-audit shape. Director-only rather
   * than scope-gated: both director and coordinator hold 'clinical' scope
   * (see DirectorOnlyError doc), so this can't be expressed as a missing
   * domain — the same role-level exception `population/service.ts` uses.
   */
  async assignTask(actor: AuthTokenPayload, taskId: string, coordinatorId: string): Promise<{ id: string; owner: string }> {
    const resource = `Task/${taskId}`;
    if (actor.role !== 'director') {
      writeAudit(this.db, { actor: actor.id, action: 'update', fhirResource: resource, outcome: 'denied' });
      throw new DirectorOnlyError(actor.role, 'assign tasks');
    }

    const task = await this.fhirFetch<Record<string, unknown>>(`/${resource}`);
    task.owner = { identifier: { system: COORDINATOR_OWNER_IDENTIFIER_SYSTEM, value: coordinatorId } };

    await this.fhirFetch(`/${resource}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify(task),
    });
    writeAudit(this.db, { actor: actor.id, action: 'update', fhirResource: resource, outcome: 'success' });
    return { id: taskId, owner: coordinatorId };
  }

  /**
   * Replaces all CareSync-authored Tasks for a patient: deletes every
   * existing Task tagged ai-generated-task for this patient, then creates one
   * Task per entry in `tasks`. A Task from the seed data (or any other
   * source) that lacks the tag is never a delete candidate, no matter how
   * re-runs pile up.
   *
   * Query note: existing owned Tasks are found via `Patient/{id}/$everything`
   * (filtered client-side for resourceType Task + CARESYNC_TASK_TAG), NOT via
   * a `Task?search` endpoint. Verified against the real local HAPI (7.2.0):
   * both `Task?patient=...&_tag=...` and even a bare `Task?patient=...`
   * lagged well behind writes under a create→delete→create burst (still
   * missing a just-created Task after 6+ seconds of polling), while
   * `$everything` reflected the same burst's end state immediately and
   * correctly every time. `$everything` reads the patient compartment
   * directly rather than through the (evidently backlogged) search index on
   * this instance, so it's the reliable choice for the read-before-delete
   * step here.
   */
  async replacePatientTasks(
    actor: AuthTokenPayload,
    patientId: string,
    tasks: ActionPlannerTaskInput[]
  ): Promise<CreatedTask[]> {
    const resource = `Task/${patientId}`;
    this.guard(actor, 'clinical', resource, 'delete');

    const bundle = await this.fhirFetch<FhirBundle<any>>(`/Patient/${patientId}/$everything`);
    const ownedTasks = (bundle.entry ?? []).filter(
      (e) =>
        e.resource.resourceType === 'Task' &&
        (e.resource.meta?.tag ?? []).some(
          (t: any) => t.system === CARESYNC_TASK_TAG.system && t.code === CARESYNC_TASK_TAG.code
        )
    );
    for (const entry of ownedTasks) {
      const id = entry.resource.id;
      await this.fhirFetch(`/Task/${id}`, { method: 'DELETE' });
      writeAudit(this.db, { actor: actor.id, action: 'delete', fhirResource: `Task/${id}`, outcome: 'success' });
    }

    const created: CreatedTask[] = [];
    for (const task of tasks) {
      created.push(await this.createTask(actor, patientId, task));
    }
    return created;
  }
}
