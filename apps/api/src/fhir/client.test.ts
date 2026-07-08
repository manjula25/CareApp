import Database from 'better-sqlite3';
import { migrate } from '../db';
import { FhirReadService, ScopeDeniedError, mapTaskResource } from './client';
import { AuthTokenPayload } from '../auth/jwt';

const coordinator: AuthTokenPayload = { id: 'coord-1', name: 'Cara Coordinator', role: 'coordinator' };
const socialWorker: AuthTokenPayload = { id: 'sw-1', name: 'Sam Socialworker', role: 'social_worker' };

// Exercised against the real disposable HAPI container + seed data from
// apps/api/src/scripts/import-fhir.ts (Seam 1 reference pattern).
describe('FhirReadService', () => {
  let db: Database.Database;
  let service: FhirReadService;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    service = new FhirReadService(db, process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir');
  });

  it('lets a Coordinator read Maria Chen conditions', async () => {
    const conditions = await service.getConditions(coordinator, 'maria-chen');
    expect(conditions.map((c) => c.display)).toEqual(
      expect.arrayContaining(['Heart failure, unspecified', 'Type 2 diabetes mellitus without complications'])
    );
  });

  it('denies a Social Worker reading non-SDOH conditions', async () => {
    await expect(service.getConditions(socialWorker, 'maria-chen')).rejects.toBeInstanceOf(ScopeDeniedError);
  });

  it('writes an audit row for every read, including denials', async () => {
    await service.getConditions(coordinator, 'maria-chen');
    await service.getConditions(socialWorker, 'maria-chen').catch(() => undefined);

    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actor: 'coord-1', outcome: 'success', fhir_resource: 'Condition/maria-chen' });
    expect(rows[1]).toMatchObject({ actor: 'sw-1', outcome: 'denied', fhir_resource: 'Condition/maria-chen' });
  });

  it('lets any role read basic patient demographics', async () => {
    const patient = await service.getPatient(socialWorker, 'maria-chen');
    expect(patient.name).toBe('Maria Chen');
  });

  it('lets a Coordinator read Maria Chen tasks with title, priority, and due date', async () => {
    const tasks = await service.getTasks(coordinator, 'maria-chen');
    expect(tasks).toHaveLength(2);
    const medrec = tasks.find((t) => t.id === 'maria-chen-task-medrec');
    expect(medrec).toMatchObject({ title: 'Medication reconciliation follow-up', priority: 'high', status: 'Open' });
    expect(new Date(medrec!.due).toString()).not.toBe('Invalid Date');
    expect(tasks.map((t) => t.priority)).toEqual(expect.arrayContaining(['high', 'medium']));
  });

  it('denies a Social Worker reading tasks (non-SDOH clinical read)', async () => {
    await expect(service.getTasks(socialWorker, 'maria-chen')).rejects.toBeInstanceOf(ScopeDeniedError);
  });

  it('returns the assigned panel with risk score, task count, and list-row display fields', async () => {
    const panel = await service.getAssignedPanel(coordinator);
    const maria = panel.find((p) => p.id === 'maria-chen');
    expect(maria).toMatchObject({
      name: 'Maria Chen',
      riskScore: 87,
      taskCount: 2,
      gender: 'female',
      birthDate: '1958-04-12',
    });
    expect(maria!.conditionTags).toEqual(expect.arrayContaining(['CHF', 'Diabetes']));
    expect(maria!.conditionTags.length).toBeLessThanOrEqual(2);
    expect(panel.length).toBeGreaterThanOrEqual(6);
  });

  // Caresync-coordinator-grid-my-patients — real `daysSinceContact` from the
  // most recent Encounter.period.end, not a mock value. Maria Chen's seed
  // encounters are discharged 48h ago, so her `daysSinceContact` should
  // resolve to 2. Other panel patients have no encounters seeded, so they
  // resolve to null (UI shows "—" rather than fabricating a value).
  it('derives daysSinceContact from the most recent Encounter.period.end', async () => {
    const panel = await service.getAssignedPanel(coordinator);
    const maria = panel.find((p) => p.id === 'maria-chen');
    expect(maria).toBeDefined();
    expect(maria!.daysSinceContact).toBe(2);

    const noEncounter = panel.find((p) => p.id === 'james-okafor');
    expect(noEncounter).toBeDefined();
    expect(noEncounter!.daysSinceContact).toBeNull();
  });

  describe('getPatientBundle ($everything — GD11 citation source)', () => {
    it("returns Maria's full record including her Conditions and Observations", async () => {
      const { resources } = await service.getPatientBundle(coordinator, 'maria-chen');

      const types = resources.map((r) => r.resourceType);
      expect(types).toEqual(expect.arrayContaining(['Patient', 'Condition', 'Observation']));
      expect(types.filter((t) => t === 'Condition').length).toBeGreaterThanOrEqual(1);
      expect(types.filter((t) => t === 'Observation').length).toBeGreaterThanOrEqual(1);
    });

    it('derives validIds as one ResourceType/id per returned resource, including Patient/maria-chen', async () => {
      const { resources, validIds } = await service.getPatientBundle(coordinator, 'maria-chen');

      expect(validIds.size).toBe(resources.length);
      expect(validIds.has('Patient/maria-chen')).toBe(true);
      for (const r of resources) {
        expect(validIds.has(`${r.resourceType}/${r.id}`)).toBe(true);
      }
    });

    it('writes one success audit row for the bundle read', async () => {
      await service.getPatientBundle(coordinator, 'maria-chen');

      const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor: 'coord-1',
        outcome: 'success',
        fhir_resource: 'Patient/maria-chen/$everything',
      });
    });

    it('denies a Social Worker (no clinical scope) and writes a denied audit row', async () => {
      await expect(service.getPatientBundle(socialWorker, 'maria-chen')).rejects.toBeInstanceOf(ScopeDeniedError);

      const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor: 'sw-1',
        outcome: 'denied',
        fhir_resource: 'Patient/maria-chen/$everything',
      });
    });
  });
});

describe('FhirReadService Task writes (createTask / replacePatientTasks)', () => {
  let db: Database.Database;
  let service: FhirReadService;
  const createdTaskIds: string[] = [];

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    service = new FhirReadService(db, process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir');
  });

  afterEach(async () => {
    // Best-effort cleanup so repeated local runs don't accumulate Tasks in the
    // shared HAPI instance. Ignore failures (already deleted by the test itself).
    while (createdTaskIds.length > 0) {
      const id = createdTaskIds.pop()!;
      await fetch(`${process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir'}/Task/${id}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  });

  async function fetchTask(id: string): Promise<any> {
    const res = await fetch(`${process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir'}/Task/${id}`);
    return res.json();
  }

  // Reads via Patient/{id}/$everything rather than a Task?search endpoint:
  // both `Task?patient=...&_tag=...` and even a bare `Task?patient=...`
  // lag well behind writes on this HAPI instance under a burst of
  // create/delete calls (confirmed by manual probing — see the comment on
  // replacePatientTasks in client.ts), which would make assertions through
  // that same search flaky against this test's own fixture data.
  // `$everything` reflects writes immediately, which is also why production
  // code (replacePatientTasks) uses it for the same read-before-delete step.
  async function fetchTaggedTasksFor(patientId: string): Promise<any[]> {
    const base = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';
    const res = await fetch(`${base}/Patient/${patientId}/$everything`);
    const bundle = (await res.json()) as { entry?: { resource: any }[] };
    return (bundle.entry ?? [])
      .map((e) => e.resource)
      .filter(
        (r) =>
          r.resourceType === 'Task' &&
          (r.meta?.tag ?? []).some(
            (t: any) => t.system === 'https://caresync.demo/fhir/tags' && t.code === 'ai-generated-task'
          )
      );
  }

  it('createTask POSTs a resolvable, tagged Task to HAPI and writes one audit row', async () => {
    const result = await service.createTask(coordinator, 'maria-chen', {
      title: 'Schedule follow-up',
      description: 'Call patient to schedule a cardiology follow-up',
      priority: 'high',
      fhirResources: ['Condition/maria-chen-chf'],
    });
    createdTaskIds.push(result.id);

    const fetched = await fetchTask(result.id);
    expect(fetched.resourceType).toBe('Task');
    expect(fetched.priority).toBe('urgent');
    expect(fetched.description).toContain('Schedule follow-up');
    expect(fetched.meta?.tag).toEqual(
      expect.arrayContaining([{ system: 'https://caresync.demo/fhir/tags', code: 'ai-generated-task' }])
    );

    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'coord-1', action: 'create', outcome: 'success', fhir_resource: `Task/${result.id}` });
  });

  // S7 B2 — Decision 1: fhirResources (the Action Planner's citations) is now
  // persisted onto the FHIR Task itself via Task.input (one entry per
  // citation, type.text: 'citation', valueReference pointing at the cited
  // resource), not just carried in the in-memory SSE payload. `Task.input` is
  // 0..* and built to be repeated — verified empirically against the local
  // HAPI instance to round-trip every entry intact, unlike `reasonReference`
  // (FHIR R4's `reasonReference` is 0..1 and HAPI silently keeps only the
  // first entry when given an array; confirmed by direct probe before this
  // approach was chosen).
  it('createTask persists fhirResources as Task.input citation entries, verified by reading the Task back from HAPI', async () => {
    const result = await service.createTask(coordinator, 'maria-chen', {
      title: 'Schedule follow-up',
      description: 'Call patient to schedule a cardiology follow-up',
      priority: 'high',
      fhirResources: ['Condition/maria-chen-chf', 'Observation/maria-chen-bnp'],
    });
    createdTaskIds.push(result.id);

    const fetched = await fetchTask(result.id);
    expect(fetched.input).toEqual([
      { type: { text: 'citation' }, valueReference: { reference: 'Condition/maria-chen-chf' } },
      { type: { text: 'citation' }, valueReference: { reference: 'Observation/maria-chen-bnp' } },
    ]);
  });

  it('createTask writes a domain coding for the given domain, verified by reading the Task back from HAPI', async () => {
    const result = await service.createTask(coordinator, 'maria-chen', {
      title: 'Arrange transport',
      description: 'Coordinate a ride to the SDOH resource center',
      priority: 'medium',
      domain: 'sdoh',
      fhirResources: [],
    });
    createdTaskIds.push(result.id);

    const fetched = await fetchTask(result.id);
    // Domain rides alongside the CareSync tag as a distinct-system meta.tag
    // coding (FHIR R4 Task has no `category` element; HAPI drops it silently).
    expect(fetched.meta?.tag).toEqual(
      expect.arrayContaining([{ system: 'https://caresync.demo/fhir/task-domain', code: 'sdoh' }])
    );
    // ...and still carries the CareSync ownership tag.
    expect(fetched.meta?.tag).toEqual(
      expect.arrayContaining([{ system: 'https://caresync.demo/fhir/tags', code: 'ai-generated-task' }])
    );
  });

  it('getTasks maps a Task with no domain tag to domain: undefined — fail-open for pre-existing (seed) Tasks', async () => {
    // Seed Tasks (e.g. maria-chen-task-medrec) predate the domain field and
    // carry no domain tag — getTasks must map them to `undefined`, never a
    // default, so A1 can treat an uncategorized Task as visible to every role.
    //
    // This asserts only the seed Task, which the `Task?subject=` search index
    // returns reliably. It deliberately does NOT create a fresh Task and read
    // it back through getTasks: that search index lags writes badly on this
    // HAPI instance (see the replacePatientTasks comment in client.ts — the
    // reason it uses `$everything` instead), so a just-created Task is not
    // reliably visible. The positive path — a domain tag → 'sdoh' — is covered
    // reliably by the `createTask` read-back test above (write side) and the
    // `mapTaskResource` unit tests below (the same `extractTaskDomain` getTasks
    // applies to each search-result entry).
    const tasks = await service.getTasks(coordinator, 'maria-chen');
    const seed = tasks.find((t) => t.id === 'maria-chen-task-medrec');
    expect(seed).toBeDefined();
    expect(seed?.domain).toBeUndefined();
  });

  it('replacePatientTasks called twice leaves exactly the second call\'s Tasks tagged for that patient', async () => {
    const firstRun = await service.replacePatientTasks(coordinator, 'maria-chen', [
      { title: 'First task A', description: 'desc A', priority: 'medium', fhirResources: [] },
      { title: 'First task B', description: 'desc B', priority: 'high', fhirResources: [] },
    ]);
    const secondRun = await service.replacePatientTasks(coordinator, 'maria-chen', [
      { title: 'Second task only', description: 'desc C', priority: 'critical', fhirResources: [] },
    ]);
    createdTaskIds.push(...secondRun.map((t) => t.id));

    const tagged = await fetchTaggedTasksFor('maria-chen');
    expect(tagged).toHaveLength(1);
    expect(tagged[0].id).toBe(secondRun[0].id);
    expect(tagged.map((t: any) => t.id)).not.toEqual(expect.arrayContaining(firstRun.map((t) => t.id)));
    expect(tagged[0].description).toContain('Second task only');
  });

  it('never deletes a seed Task lacking the ai-generated-task tag', async () => {
    const before = await fetchTask('maria-chen-task-medrec');
    expect(before.resourceType).toBe('Task');

    const created = await service.replacePatientTasks(coordinator, 'maria-chen', [
      { title: 'Replacement task', description: 'desc', priority: 'medium', fhirResources: [] },
    ]);
    createdTaskIds.push(...created.map((t) => t.id));

    const after = await fetchTask('maria-chen-task-medrec');
    expect(after.resourceType).toBe('Task');
    expect(after.id).toBe('maria-chen-task-medrec');
  });

  it('denies a Social Worker writing Tasks (no clinical scope) before any HAPI call, and audits denial', async () => {
    await expect(
      service.createTask(socialWorker, 'maria-chen', {
        title: 'Should not be created',
        description: 'desc',
        priority: 'high',
        fhirResources: [],
      })
    ).rejects.toBeInstanceOf(ScopeDeniedError);

    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'sw-1', action: 'create', outcome: 'denied' });

    // Confirm no Task was actually created for this social worker attempt.
    const tagged = await fetchTaggedTasksFor('maria-chen');
    expect(tagged.find((t: any) => t.description?.includes('Should not be created'))).toBeUndefined();
  });
});

describe('FhirReadService.createServiceRequest (S11 A1 — SDOH referral)', () => {
  let db: Database.Database;
  let service: FhirReadService;
  const createdServiceRequestIds: string[] = [];

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    service = new FhirReadService(db, process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir');
  });

  afterEach(async () => {
    while (createdServiceRequestIds.length > 0) {
      const id = createdServiceRequestIds.pop()!;
      await fetch(`${process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir'}/ServiceRequest/${id}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  });

  async function fetchServiceRequest(id: string): Promise<any> {
    const res = await fetch(`${process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir'}/ServiceRequest/${id}`);
    return res.json();
  }

  it('POSTs a resolvable ServiceRequest tagged and referencing the patient, and writes one audit row', async () => {
    const result = await service.createServiceRequest(coordinator, 'maria-chen', {
      category: 'transportation',
      resourceName: 'Metro Transit Assistance Program',
    });
    createdServiceRequestIds.push(result.id);

    const fetched = await fetchServiceRequest(result.id);
    expect(fetched.resourceType).toBe('ServiceRequest');
    expect(fetched.status).toBe('active');
    expect(fetched.intent).toBe('order');
    expect(fetched.subject).toEqual({ reference: 'Patient/maria-chen' });
    expect(fetched.code?.text).toBe('Metro Transit Assistance Program');
    expect(fetched.category).toEqual(expect.arrayContaining([{ text: 'Social Determinants of Health' }]));
    expect(fetched.meta?.tag).toEqual(
      expect.arrayContaining([{ system: 'https://caresync.demo/fhir/tags', code: 'ai-generated-referral' }])
    );

    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: 'coord-1',
      action: 'create',
      outcome: 'success',
      fhir_resource: `ServiceRequest/${result.id}`,
    });
  });

  it('includes a note when one is provided', async () => {
    const result = await service.createServiceRequest(coordinator, 'maria-chen', {
      category: 'food',
      resourceName: 'Metro Regional Food Bank',
      note: 'Patient prefers weekend pickup',
    });
    createdServiceRequestIds.push(result.id);

    const fetched = await fetchServiceRequest(result.id);
    expect(fetched.note).toEqual(expect.arrayContaining([{ text: 'Patient prefers weekend pickup' }]));
  });

  it('lets a Social Worker create a referral (sdoh scope)', async () => {
    const result = await service.createServiceRequest(socialWorker, 'maria-chen', {
      category: 'housing',
      resourceName: 'Regional Housing Navigator Program',
    });
    createdServiceRequestIds.push(result.id);

    const fetched = await fetchServiceRequest(result.id);
    expect(fetched.resourceType).toBe('ServiceRequest');
  });
});

describe('mapTaskResource domain extraction (S7 A0)', () => {
  it('extracts domain from a meta.tag domain coding', () => {
    const mapped = mapTaskResource({
      id: 't1',
      description: 'desc',
      priority: 'routine',
      status: 'requested',
      meta: {
        tag: [
          { system: 'https://caresync.demo/fhir/tags', code: 'ai-generated-task' },
          { system: 'https://caresync.demo/fhir/task-domain', code: 'sdoh' },
        ],
      },
    });
    expect(mapped.domain).toBe('sdoh');
  });

  it('returns domain: undefined for a Task with no domain tag — fail-open (never a default)', () => {
    const mapped = mapTaskResource({
      id: 't2',
      description: 'desc',
      priority: 'routine',
      status: 'requested',
    });
    expect(mapped.domain).toBeUndefined();
  });
});

// S11 A2 — bulk `_summary=count` read backing the real HEDIS diabetes/HbA1c
// measure (quality/service.ts's getDiabetesHba1cMeasure). Exercised against
// the real disposable HAPI container + seed data, same Seam 1 pattern as the
// rest of this file. Assertions are relative (>0 / denominator > numerator),
// not pinned to the exact 286/1 counts observed manually against the seeded
// population — that population is procedurally generated by
// scripts/import-fhir.ts, so exact counts aren't a stable contract, only the
// codes/systems and the "far more diabetics than HbA1c tests on file" shape are.
describe('FhirReadService.getResourceCountByCode (S11 A2 — HEDIS measure aggregate)', () => {
  let db: Database.Database;
  let service: FhirReadService;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    service = new FhirReadService(db, process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir');
  });

  it('returns the real count of Type 2 Diabetes Conditions (ICD-10-CM E11.9) — at least 1 in the seeded population', async () => {
    const count = await service.getResourceCountByCode(
      coordinator,
      'Condition',
      'http://hl7.org/fhir/sid/icd-10-cm',
      'E11.9'
    );
    expect(count).toBeGreaterThan(0);
  });

  it('returns the real count of HbA1c Observations (LOINC 4548-4), fewer than the diabetes Condition count', async () => {
    const [denominator, numerator] = await Promise.all([
      service.getResourceCountByCode(coordinator, 'Condition', 'http://hl7.org/fhir/sid/icd-10-cm', 'E11.9'),
      service.getResourceCountByCode(coordinator, 'Observation', 'http://loinc.org', '4548-4'),
    ]);
    expect(numerator).toBeGreaterThanOrEqual(0);
    expect(denominator).toBeGreaterThan(numerator);
  });

  it('returns 0 for a code with no matches, not an error', async () => {
    const count = await service.getResourceCountByCode(coordinator, 'Condition', 'http://hl7.org/fhir/sid/icd-10-cm', 'ZZZ99-no-such-code');
    expect(count).toBe(0);
  });

  it('denies a Social Worker (no clinical scope) and writes a denied audit row', async () => {
    await expect(
      service.getResourceCountByCode(socialWorker, 'Condition', 'http://hl7.org/fhir/sid/icd-10-cm', 'E11.9')
    ).rejects.toBeInstanceOf(ScopeDeniedError);
    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    expect(rows[rows.length - 1]).toMatchObject({ actor: 'sw-1', outcome: 'denied' });
  });
});

// S11 A3 — Team performance aggregate (W04). Exercised against the real
// disposable HAPI container + seed data, same Seam 1 pattern as the rest of
// this file. As of this writing, the seeded panel carries 7 real Tasks, all
// `status: 'requested'` and all ownerless (no frontend UI calls the S6 A1
// assign endpoint yet) — so this asserts a length >= 1 (not pinned to
// exactly 7, in case seed data changes) and that the shape/fail-open
// (ownerCoordinatorId undefined when no owner) is correct against that real
// current state, not a fabricated one.
describe('FhirReadService.getTaskOwnershipSummary (S11 A3 — team performance aggregate)', () => {
  let db: Database.Database;
  let service: FhirReadService;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    service = new FhirReadService(db, process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir');
  });

  it('returns an entry for every real Task in the seeded panel, with status/ownerCoordinatorId shaped correctly', async () => {
    const entries = await service.getTaskOwnershipSummary(coordinator);

    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of entries) {
      expect(typeof entry.taskId).toBe('string');
      expect(typeof entry.status).toBe('string');
      expect(entry.ownerCoordinatorId === undefined || typeof entry.ownerCoordinatorId === 'string').toBe(true);
    }
  });

  it('leaves ownerCoordinatorId undefined for a Task with no owner — matching the seeded panel\'s current real state', async () => {
    const entries = await service.getTaskOwnershipSummary(coordinator);
    expect(entries.some((e) => e.ownerCoordinatorId === undefined)).toBe(true);
  });

  it('writes exactly one success audit row for the whole read', async () => {
    await service.getTaskOwnershipSummary(coordinator);
    const rows = db.prepare("SELECT * FROM audit_log WHERE fhir_resource = 'Population/team-performance'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'coord-1', outcome: 'success' });
  });

  it('denies a Social Worker (no clinical scope) and writes a denied audit row', async () => {
    await expect(service.getTaskOwnershipSummary(socialWorker)).rejects.toBeInstanceOf(ScopeDeniedError);
    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    expect(rows[rows.length - 1]).toMatchObject({ actor: 'sw-1', outcome: 'denied' });
  });
});

describe('FhirReadService with a SMART token client', () => {
  it('attaches the SMART access token as a Bearer header on every HAPI call', async () => {
    const db = new Database(':memory:');
    migrate(db);
    const tokenClient = { getAccessToken: jest.fn().mockResolvedValue('smart-access-token') };
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ resourceType: 'Patient', id: 'maria-chen', name: [{ given: ['Maria'], family: 'Chen' }] }),
    } as Response);

    const service = new FhirReadService(db, 'http://localhost:8080/fhir', tokenClient);
    await service.getPatient(coordinator, 'maria-chen');

    expect(tokenClient.getAccessToken).toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer smart-access-token');
    fetchSpy.mockRestore();
  });
});
