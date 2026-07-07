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

/**
 * S7 B2 — distinguishes "the FHIR resource genuinely doesn't exist" (HAPI
 * 404) from any other upstream FHIR failure, so `getTaskDetail`'s route can
 * map it to a 404 instead of an opaque 500/hang. No existing caller of
 * `fhirFetch` needed this distinction before B2 (every other 404 case here
 * either can't happen against seed/probe data or is masked by an earlier
 * scope check), so this is additive: every other non-ok status still throws
 * the generic Error below, unchanged.
 */
export class FhirNotFoundError extends Error {
  constructor(resource: string) {
    super(`FHIR resource not found: ${resource}`);
    this.name = 'FhirNotFoundError';
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

// S7 A0 — the care domain a Task belongs to. Deliberately reuses the
// access-scope vocabulary (see auth/scopes.ts ResourceDomain) so A1 can filter
// with hasScope(role, 'sdoh'). Optional on reads: Tasks created before this
// field existed carry no category and MUST map to undefined (fail-open — an
// uncategorized Task is visible to every role), never a fabricated default.
export type TaskDomain = 'clinical' | 'sdoh';

export interface TaskSummary {
  id: string;
  title: string;
  priority: TaskPriority;
  due: string;
  status: string;
  domain?: TaskDomain;
}

// S6 A3 — TaskSummary plus the two fields the subscription webhook needs to
// route a notification: which patient the Task is for, and which coordinator
// (app `users.id`, via the logical `owner.identifier` reference) now owns it.
export interface TaskWithOwner extends TaskSummary {
  patientId?: string;
  ownerId?: string;
}

// S7 B1 — TaskSummary plus the fields the M02 task-queue card needs to show
// "who" alongside "what": the patient's id/name and a short condition tag
// (e.g. "CHF"), reusing shortConditionTag exactly as getAssignedPanel's
// conditionTags does. Scoped to `listTasks` only — `TaskSummary` itself and
// `getTasks`/`mapTaskResource`'s existing shapes are untouched.
export interface TaskListEntry extends TaskSummary {
  patientId: string;
  patientName: string;
  conditionTag?: string;
}

// S7 B2 — TaskListEntry plus the fields the M03 task-detail screen needs:
// the resolved citations (Task.input citation entries — see createTask's doc
// — each paired with a human-readable display string) and the patient's
// phone number (Patient.telecom, S7 B2 Decision 2), for the Call action.
export interface TaskDetail extends TaskListEntry {
  citations: Array<{ reference: string; display: string }>;
  patientPhone?: string;
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

// S11 A1 — same tagging convention as CARESYNC_TASK_TAG (same `system`,
// distinct `code`), so a CareSync-authored SDOH referral ServiceRequest is
// identifiable in HAPI the same way an AI-generated Task is.
const CARESYNC_REFERRAL_TAG = { system: 'https://caresync.demo/fhir/tags', code: 'ai-generated-referral' } as const;

// S7 A0 — coding system for the meta.tag that records a Task's care domain
// ('clinical' | 'sdoh'). Stored as a second `meta.tag` coding (a distinct
// system from CARESYNC_TASK_TAG), directly mirroring that tag pattern.
//
// NOTE (deviation from the A0 plan text): the plan asked for a `Task.category`
// CodeableConcept, but FHIR R4 `Task` has no `category` element and the local
// HAPI (7.2.0) silently drops it on write (verified — it round-trips as
// undefined), so filtering could never see it. `meta.tag` is the pattern the
// plan itself pointed at (CARESYNC_TASK_TAG), is a proven-persistent element,
// and keeps `Task.code` (whose FHIR meaning is "the activity to perform") free.
// The externally-visible contract is unchanged: domain is exposed on
// TaskSummary.domain as 'clinical' | 'sdoh', undefined when absent.
const TASK_DOMAIN_SYSTEM = 'https://caresync.demo/fhir/task-domain';

// S7 B2 — Task.input.type.text value marking an input entry as a citation
// (see createTask's doc for why Task.input, not Task.reasonReference, is the
// citation-storage field).
const TASK_CITATION_INPUT_TYPE = 'citation';

/**
 * Extracts a Task's care domain from its `meta.tag` codings, or undefined if
 * the Task carries no CareSync domain coding. Fail-open by design: Tasks
 * created before this field existed carry no domain tag and map to undefined,
 * never a default like 'clinical' (A1 filtering treats undefined as visible
 * to every role).
 */
function extractTaskDomain(task: any): TaskDomain | undefined {
  const coding = (task.meta?.tag ?? []).find((t: any) => t.system === TASK_DOMAIN_SYSTEM);
  return coding ? (coding.code as TaskDomain) : undefined;
}

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
    status: displayStatus(task),
    domain: extractTaskDomain(task),
    patientId: task.for?.reference?.split('/')[1],
    ownerId: task.owner?.identifier?.value,
  };
}

export interface ActionPlannerTaskInput {
  title: string;
  description: string;
  priority: string;
  domain?: TaskDomain;
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

// S7 A2 — the transitions `transitionTask` accepts. FHIR R4 Task.status has
// no native "deferred"/"escalated" value (see transitionTask's doc), so only
// 'complete' maps directly onto a status change; 'defer'/'escalate' are
// expressed via Task.businessStatus (+ priority for escalate).
export type TaskStatusTransition = 'complete' | 'defer' | 'escalate';

/**
 * S7 A2 — read-side counterpart to `transitionTask`: prefers a human-readable
 * `businessStatus.text` (set by 'defer'/'escalate') over the generic
 * FHIR_STATUS_TO_DISPLAY mapping, so a deferred/escalated Task shows a
 * distinct label ('Deferred'/'Escalated') in the queue instead of falling
 * back to 'Open'/'In progress'. Applied consistently everywhere
 * FHIR_STATUS_TO_DISPLAY was previously read directly.
 */
function displayStatus(task: any): string {
  return task.businessStatus?.text ?? FHIR_STATUS_TO_DISPLAY[task.status] ?? 'Open';
}

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

// S8 A3 — real Synthea demographics for GD12 demographic-parity computation
// (governance/service.ts). `birthDate`/`sex` come straight off `Patient`;
// `race`/`ethnicity` come off the US Core race/ethnicity extensions
// scripts/import-fhir.ts writes onto every seeded Patient (see
// raceEthnicityExtensions there for the exact shape this mirrors). Any of the
// four is undefined if the source Patient lacks it — age-banding/stratifying
// an undefined field is governance/service.ts's job, not this read's.
export interface PatientDemographics {
  patientId: string;
  birthDate?: string;
  sex?: string;
  race?: string;
  ethnicity?: string;
}

const US_CORE_RACE_EXTENSION_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race';
const US_CORE_ETHNICITY_EXTENSION_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity';

// Reads the `ombCategory` sub-extension's `valueCoding.display` off a
// top-level US Core race/ethnicity extension — the exact nesting
// scripts/import-fhir.ts's raceEthnicityExtensions writes (a top-level
// extension carrying `ombCategory` + `text` sub-extensions).
function extractOmbCategoryDisplay(patient: any, extensionUrl: string): string | undefined {
  const extension = (patient.extension ?? []).find((e: any) => e.url === extensionUrl);
  const ombCategory = (extension?.extension ?? []).find((e: any) => e.url === 'ombCategory');
  return ombCategory?.valueCoding?.display;
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
      if (res.status === 404) throw new FhirNotFoundError(path);
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
   * S7 A2/B2 — the per-task (not per-role) domain-scope check shared by
   * `transitionTask` (a write) and `getTaskDetail` (a read): deny only if the
   * Task's own domain tag is defined and the actor's role lacks scope for it
   * (fail-open on an undefined domain, same as A1's `listTasks` filter — see
   * `transitionTask`'s doc for the full reasoning on why this can't be a
   * plain `guard()` call). Returns the extracted domain so callers can also
   * surface it (`getTaskDetail`'s response includes it via `TaskListEntry`).
   */
  private guardTaskDomain(actor: AuthTokenPayload, resource: string, task: any, action: string): TaskDomain | undefined {
    const domain = extractTaskDomain(task);
    if (domain !== undefined && !hasScope(actor.role, domain)) {
      writeAudit(this.db, { actor: actor.id, action, fhirResource: resource, outcome: 'denied' });
      throw new ScopeDeniedError(actor.role, domain);
    }
    return domain;
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
      status: displayStatus(e.resource),
      domain: extractTaskDomain(e.resource),
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
   * S7 A1 — role-filtered task listing across the same fixed demo panel
   * `getAssignedPanel` uses (COORDINATOR_PANEL_GROUP_ID; this POC's
   * task-bearing population is that small panel, not all ~500 Synthea
   * patients). Fetches every patient's Tasks via `Patient/{id}/$everything`
   * (filtered client-side for `resourceType === 'Task'`), audits ONCE for the
   * whole aggregate read (mirroring `getAssignedPanel`'s audit-once shape),
   * then filters client-side by domain.
   *
   * Query note: same reasoning as `replacePatientTasks` below — a
   * `Task?subject=Patient/{id}` search lags behind writes on the local HAPI
   * (7.2.0) under a create-then-immediately-read pattern, so a just-created
   * Task can be briefly invisible to this listing. That's a real correctness
   * risk here (this is a live read path, not just a replace-then-forget
   * write), not merely a test-fixture inconvenience, so `$everything` (which
   * reads the patient compartment directly rather than through the
   * search index) is the correct choice, not a workaround.
   *
   * Deliberately does not `guard()` on a domain: no role is *denied* this
   * read (a hasScope gate would incorrectly 403 a Social Worker, who has no
   * 'clinical' scope — see auth/scopes.ts). Instead this is a per-task
   * visibility filter: a task's domain is undefined (fail-open, per A0) or a
   * value the actor's role holds scope for. Director/Coordinator hold both
   * 'clinical' and 'sdoh' scope, so every task passes; Social Worker holds
   * only 'sdoh', so a 'clinical'-tagged task is dropped while 'sdoh' and
   * untagged tasks remain.
   */
  async listTasks(actor: AuthTokenPayload): Promise<TaskListEntry[]> {
    const resource = `Group/${COORDINATOR_PANEL_GROUP_ID}`;
    const group = await this.fhirFetch<any>(`/${resource}`);
    const patientIds: string[] = (group.member ?? []).map((m: any) => m.entity.reference.split('/')[1]);

    const perPatientBundles = await Promise.all(
      patientIds.map((id) => this.fhirFetch<FhirBundle<any>>(`/Patient/${id}/$everything`))
    );
    writeAudit(this.db, { actor: actor.id, action: 'read', fhirResource: 'Task', outcome: 'success' });

    // S7 B1 — the same $everything bundle already fetched above (per the
    // HAPI search-lag reasoning in this method's doc) also contains the
    // Patient resource (name) and Condition resources (tag) for that same
    // patient, so no extra FHIR calls are needed to fill in patientName /
    // conditionTag. Only the first condition is used — one tag per task
    // card, not getAssignedPanel's two-tag panel-row list.
    const allTasks: TaskListEntry[] = perPatientBundles.flatMap((bundle, i) => {
      const patientId = patientIds[i];
      const entries = bundle.entry ?? [];
      const { patientName, conditionTag } = this.patientContextFromBundle(entries);

      return entries
        .filter((e) => e.resource.resourceType === 'Task')
        .map((e) => ({
          id: e.resource.id,
          title: e.resource.description,
          priority: FHIR_PRIORITY_TO_DISPLAY[e.resource.priority] ?? 'medium',
          due: e.resource.restriction?.period?.end,
          status: displayStatus(e.resource),
          domain: extractTaskDomain(e.resource),
          patientId,
          patientName,
          conditionTag,
        }));
    });

    return allTasks.filter((task) => task.domain === undefined || hasScope(actor.role, task.domain));
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
   * S8 A3 — batch demographics read backing GD12 demographic-parity
   * computation (governance/service.ts's getParityMetrics). Follows
   * `getPopulationRiskProfile`'s bulk-read pattern just above, but scoped to
   * exactly the given `patientIds` (a `_id=id1,id2,...` search) rather than
   * the whole cohort — the caller only ever needs demographics for patients
   * that have a cached analysis to join against, so fetching the full
   * ~500-patient population here would be pure waste. Empty `patientIds`
   * short-circuits to `[]` with no HAPI call and no audit row (there is
   * nothing to read). Audited once for the whole batch, mirroring
   * `getPopulationRiskProfile`/`getAssignedPanel`'s audit-once-per-aggregate-
   * read shape rather than once per patient.
   */
  async getPatientDemographics(actor: AuthTokenPayload, patientIds: string[]): Promise<PatientDemographics[]> {
    if (patientIds.length === 0) return [];

    const resource = 'Population/demographics';
    this.guard(actor, 'demographic', resource);

    const entries = await this.fetchPages<any>(`/Patient?_id=${patientIds.join(',')}&_count=${patientIds.length}`);
    writeAudit(this.db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'success' });

    return entries.map((e) => ({
      patientId: e.resource.id,
      birthDate: e.resource.birthDate,
      sex: e.resource.gender,
      race: extractOmbCategoryDisplay(e.resource, US_CORE_RACE_EXTENSION_URL),
      ethnicity: extractOmbCategoryDisplay(e.resource, US_CORE_ETHNICITY_EXTENSION_URL),
    }));
  }

  /**
   * Creates one CareSync-authored FHIR Task, tagged with CARESYNC_TASK_TAG so
   * a later replacePatientTasks run can find and replace it without ever
   * touching a seed/Synthea Task (which carries no such tag).
   *
   * Citation storage (S7 B2): `task.fhirResources` (the Action Planner's
   * citations for this task — often more than one; the Action Planner's own
   * prompt requires citing "one or more" resources) is persisted onto the
   * FHIR Task via `Task.input`, one entry per citation:
   * `{ type: { text: 'citation' }, valueReference: { reference: ref } }`.
   * `Task.input` is FHIR R4's native `0..*` (repeatable) element for "inputs
   * consumed by the task" — a standard element, not a custom extension.
   * `Task.reasonReference` was tried first and rejected: FHIR R4 defines it
   * as `0..1` (a single Reference, not an array), and HAPI (7.2.0) accepts a
   * multi-entry array on write with no error but silently keeps only the
   * first entry — confirmed by direct probe. `Task.input` was verified the
   * same way (multi-entry POST → GET) to round-trip every entry intact, so
   * every citation a task carries now survives on the resource itself, not
   * just in the in-memory SSE payload the caller could otherwise drop.
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
    if (task.fhirResources.length > 0) {
      body.input = task.fhirResources.map((ref) => ({
        type: { text: TASK_CITATION_INPUT_TYPE },
        valueReference: { reference: ref },
      }));
    }
    // Only tag the domain when one is present — an untagged Task must stay
    // untagged (fail-open on the read side), never carry an empty coding.
    if (task.domain != null) {
      body.meta = { tag: [CARESYNC_TASK_TAG, { system: TASK_DOMAIN_SYSTEM, code: task.domain }] };
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
   * S11 A1 — creates one audited FHIR ServiceRequest recording an SDOH
   * community-resource referral (M05). Mirrors `createTask`'s guard-then-
   * write-then-audit shape exactly, but gated on the `'sdoh'` domain (not
   * `'clinical'`) — director, coordinator, AND social_worker all hold `sdoh`
   * scope (see auth/scopes.ts), so any of the three can make a referral.
   * Tagged with CARESYNC_REFERRAL_TAG (same convention as CARESYNC_TASK_TAG)
   * so a referral ServiceRequest is identifiable the same way an
   * AI-generated Task is, should a later slice need to find/replace them.
   */
  async createServiceRequest(
    actor: AuthTokenPayload,
    patientId: string,
    input: { category: string; resourceName: string; note?: string }
  ): Promise<CreatedTask> {
    const resource = `ServiceRequest/${patientId}`;
    this.guard(actor, 'sdoh', resource, 'create');

    const body: Record<string, unknown> = {
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      subject: { reference: `Patient/${patientId}` },
      authoredOn: new Date().toISOString(),
      category: [{ text: 'Social Determinants of Health' }],
      code: { text: input.resourceName },
      meta: { tag: [CARESYNC_REFERRAL_TAG] },
    };
    if (input.note) {
      body.note = [{ text: input.note }];
    }

    const created = await this.fhirFetch<{ id: string }>('/ServiceRequest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify(body),
    });
    writeAudit(this.db, {
      actor: actor.id,
      action: 'create',
      fhirResource: `ServiceRequest/${created.id}`,
      outcome: 'success',
    });
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
   * S7 A2 — audited status-transition write for a Task's own domain-scoped
   * actor (Social Worker completing/deferring/escalating their own sdoh
   * tasks, Coordinator/Director working their queue). Deliberately NOT
   * `this.guard(actor, 'clinical', ...)` like `assignTask`/`createTask` —
   * that would incorrectly block a Social Worker (no 'clinical' scope) from
   * acting on their own sdoh Tasks. Instead generalizes A1's per-task domain
   * filter (see `listTasks`) to a write: fetch the Task, extract its domain,
   * and deny only if the domain is defined and the actor's role lacks scope
   * for it (fail-open on an undefined domain, same as A1's read filter).
   *
   * FHIR R4 Task.status has no native 'deferred'/'escalated' value, so:
   * - complete  -> status = 'completed'.
   * - defer     -> status = 'on-hold', businessStatus = { text: 'Deferred' }.
   * - escalate  -> status left as-is (already non-terminal in the intended
   *   caller flow), businessStatus = { text: 'Escalated' }, priority bumped
   *   to 'urgent' (a FHIR-native field) so escalated tasks also sort higher
   *   in any priority-ordered view.
   *
   * Read-modify-PUT, mirroring `assignTask`'s shape exactly.
   */
  async transitionTask(
    actor: AuthTokenPayload,
    taskId: string,
    transition: TaskStatusTransition
  ): Promise<{ id: string; status: string }> {
    const resource = `Task/${taskId}`;
    const task = await this.fhirFetch<Record<string, any>>(`/${resource}`);

    this.guardTaskDomain(actor, resource, task, 'update');

    switch (transition) {
      case 'complete':
        task.status = 'completed';
        break;
      case 'defer':
        task.status = 'on-hold';
        task.businessStatus = { text: 'Deferred' };
        break;
      case 'escalate':
        task.businessStatus = { text: 'Escalated' };
        task.priority = 'urgent';
        break;
    }

    await this.fhirFetch(`/${resource}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify(task),
    });
    writeAudit(this.db, { actor: actor.id, action: 'update', fhirResource: resource, outcome: 'success' });
    return { id: taskId, status: task.status as string };
  }

  /**
   * S7 B1/B2 — pulls the name/condition-tag/phone display fields `listTasks`
   * and `getTaskDetail` both need out of a patient's `$everything` bundle
   * (already fetched by each caller for its own reasons — see their docs).
   * Only the first condition is used — one tag, not `getAssignedPanel`'s
   * two-tag panel-row list.
   */
  private patientContextFromBundle(entries: FhirBundleEntry<any>[]): {
    patientName: string;
    conditionTag: string | undefined;
    patientPhone: string | undefined;
  } {
    const patientResource = entries.find((e) => e.resource.resourceType === 'Patient')?.resource;
    const name = patientResource?.name?.[0];
    const patientName = [name?.given?.join(' '), name?.family].filter(Boolean).join(' ');
    const firstCondition = entries.find((e) => e.resource.resourceType === 'Condition')?.resource;
    const conditionTag = firstCondition
      ? shortConditionTag(firstCondition.code?.coding?.[0]?.code, firstCondition.code?.text ?? '')
      : undefined;
    const patientPhone: string | undefined = patientResource?.telecom?.find((t: any) => t.system === 'phone')?.value;
    return { patientName, conditionTag, patientPhone };
  }

  /**
   * S7 B2 — resolves one Task.input citation entry's `valueReference` into a
   * short human-readable display string, reusing the same field-reading
   * conventions already established elsewhere in this file: Condition reads
   * `code.text`/`code.coding[0].display` the way `getConditions`/
   * `shortConditionTag` callers do; Observation pairs that same code label
   * with `valueQuantity` (see `observationResource` in scripts/import-fhir.ts
   * for the shape). Any other resource type, or a reference that no longer
   * resolves (e.g. a citation pointing at a deleted resource), falls back to
   * the raw reference string rather than failing the whole detail read.
   */
  private async resolveCitationDisplay(reference: string): Promise<string> {
    try {
      const resource = await this.fhirFetch<any>(`/${reference}`);
      const label = resource.code?.text ?? resource.code?.coding?.[0]?.display;
      if (resource.resourceType === 'Observation' && resource.valueQuantity) {
        const { value, unit } = resource.valueQuantity;
        return `${label ?? reference}: ${value}${unit ? ` ${unit}` : ''}`;
      }
      return label ?? reference;
    } catch {
      return reference;
    }
  }

  /**
   * S7 B2 — single-Task read backing the M03 task-detail screen: the Task
   * itself (mapped the same way `listTasks` maps each entry), its patient's
   * name/conditionTag/phone (from the same `Patient/{id}/$everything` bundle
   * `listTasks` uses), and its citations — `Task.input` entries tagged
   * `TASK_CITATION_INPUT_TYPE` (see `createTask`'s doc), each resolved to a
   * display string via `resolveCitationDisplay`.
   *
   * Domain-scope check reuses `guardTaskDomain` (the same rule
   * `transitionTask` enforces for writes, applied here to a read) rather than
   * duplicating it inline. Audited once for the whole read, mirroring
   * `getAssignedPanel`/`listTasks`'s audit-once-per-logical-read shape — a
   * 404 (Task doesn't exist) or a 403 (domain denial, audited by
   * `guardTaskDomain` itself) never reaches the success audit below.
   */
  async getTaskDetail(actor: AuthTokenPayload, taskId: string): Promise<TaskDetail> {
    const resource = `Task/${taskId}`;
    const task = await this.fhirFetch<Record<string, any>>(`/${resource}`);
    const domain = this.guardTaskDomain(actor, resource, task, 'read');

    const patientId: string | undefined = task.for?.reference?.split('/')[1];
    const bundle = patientId
      ? await this.fhirFetch<FhirBundle<any>>(`/Patient/${patientId}/$everything`)
      : undefined;
    const entries = bundle?.entry ?? [];
    const { patientName, conditionTag, patientPhone } = this.patientContextFromBundle(entries);

    const citationInputs: any[] = (task.input ?? []).filter(
      (i: any) => i.type?.text === TASK_CITATION_INPUT_TYPE && i.valueReference?.reference
    );
    const citations = await Promise.all(
      citationInputs.map(async (i) => ({
        reference: i.valueReference.reference as string,
        display: await this.resolveCitationDisplay(i.valueReference.reference),
      }))
    );

    writeAudit(this.db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'success' });

    return {
      id: task.id,
      title: task.description,
      priority: FHIR_PRIORITY_TO_DISPLAY[task.priority] ?? 'medium',
      due: task.restriction?.period?.end,
      status: displayStatus(task),
      domain,
      patientId: patientId as string,
      patientName,
      conditionTag,
      citations,
      patientPhone,
    };
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
