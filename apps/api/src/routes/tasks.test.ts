import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { createAuthRouter } from './auth';
import { createTasksRouter } from './tasks';
import { FhirReadService } from '../fhir/client';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  const fhirService = new FhirReadService(db, FHIR_BASE_URL);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/tasks', createTasksRouter(fhirService));
  return app;
}

async function loginAs(app: express.Express, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  return res.body.token;
}

function userIdFor(db: Database.Database, email: string): string {
  return (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;
}

// Exercised against the real disposable HAPI container (Seam 1 reference
// pattern, same as fhir/client.test.ts). Every Task this suite creates is a
// disposable probe (never a seed Task), cleaned up in afterEach.
describe('tasks routes', () => {
  let db: Database.Database;
  let app: express.Express;
  const createdTaskIds: string[] = [];

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  afterEach(async () => {
    while (createdTaskIds.length > 0) {
      const id = createdTaskIds.pop()!;
      await fetch(`${FHIR_BASE_URL}/Task/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  async function createProbeTask(): Promise<string> {
    const res = await fetch(`${FHIR_BASE_URL}/Task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        description: 'S6 A1 assignment probe task',
        for: { reference: 'Patient/maria-chen' },
      }),
    });
    const created = (await res.json()) as { id: string };
    createdTaskIds.push(created.id);
    return created.id;
  }

  // S7 A1 — same probe-task pattern as createProbeTask, but tags the Task
  // with A0's domain coding (or leaves it untagged) so the role-filtered
  // listing has something to filter on. Constructs the raw meta.tag directly
  // (matching TASK_DOMAIN_SYSTEM in fhir/client.ts) rather than adding a new
  // service method just for test setup.
  const TASK_DOMAIN_SYSTEM = 'https://caresync.demo/fhir/task-domain';
  async function createProbeTaskWithDomain(domain?: 'clinical' | 'sdoh'): Promise<string> {
    const res = await fetch(`${FHIR_BASE_URL}/Task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        description: 'S7 A1 domain-filter probe task',
        for: { reference: 'Patient/maria-chen' },
        ...(domain ? { meta: { tag: [{ system: TASK_DOMAIN_SYSTEM, code: domain }] } } : {}),
      }),
    });
    const created = (await res.json()) as { id: string };
    createdTaskIds.push(created.id);
    return created.id;
  }

  // S7 B2 — probe for GET /api/tasks/:id: a Task carrying Task.input citation
  // entries (the same shape createTask now writes — see client.ts's doc on
  // createTask) pointing at real seed Condition/Observation resources, so the
  // detail read has something real to resolve a display string from.
  async function createProbeTaskWithCitations(citations: string[], domain?: 'clinical' | 'sdoh'): Promise<string> {
    const res = await fetch(`${FHIR_BASE_URL}/Task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        priority: 'urgent',
        description: 'S7 B2 task-detail probe: cardiology follow-up',
        for: { reference: 'Patient/maria-chen' },
        authoredOn: new Date().toISOString(),
        input: citations.map((ref) => ({ type: { text: 'citation' }, valueReference: { reference: ref } })),
        ...(domain ? { meta: { tag: [{ system: TASK_DOMAIN_SYSTEM, code: domain }] } } : {}),
      }),
    });
    const created = (await res.json()) as { id: string };
    createdTaskIds.push(created.id);
    return created.id;
  }

  it('PATCH /api/tasks/:id/assign sets Task.owner, reflected on read-back, and writes a success audit row', async () => {
    const taskId = await createProbeTask();
    const token = await loginAs(app, 'director@caresync.demo');
    const coordinatorId = userIdFor(db, 'coordinator@caresync.demo');

    const res = await request(app)
      .patch(`/api/tasks/${taskId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ coordinatorId });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: taskId, owner: coordinatorId });

    const fetched = (await (await fetch(`${FHIR_BASE_URL}/Task/${taskId}`)).json()) as any;
    expect(fetched.owner?.identifier?.value).toBe(coordinatorId);

    const rows = db
      .prepare(`SELECT * FROM audit_log WHERE fhir_resource = ? AND outcome = 'success'`)
      .all(`Task/${taskId}`) as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ action: 'update' });
  });

  it('rejects a non-director actor with 403 and writes a denial audit row', async () => {
    const taskId = await createProbeTask();
    const token = await loginAs(app, 'coordinator@caresync.demo');

    const res = await request(app)
      .patch(`/api/tasks/${taskId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ coordinatorId: 'someone' });

    expect(res.status).toBe(403);

    const rows = db
      .prepare(`SELECT * FROM audit_log WHERE fhir_resource = ? AND outcome = 'denied'`)
      .all(`Task/${taskId}`) as any[];
    expect(rows.length).toBeGreaterThan(0);
  });

  it('requires auth', async () => {
    const res = await request(app).patch('/api/tasks/some-id/assign').send({ coordinatorId: 'x' });
    expect(res.status).toBe(401);
  });

  describe('GET /api/tasks (S7 A1 — role-filtered listing)', () => {
    it('requires auth', async () => {
      const res = await request(app).get('/api/tasks');
      expect(res.status).toBe(401);
    });

    it('Social Worker sees sdoh-domain and uncategorized tasks, but not clinical-domain tasks', async () => {
      const sdohId = await createProbeTaskWithDomain('sdoh');
      const clinicalId = await createProbeTaskWithDomain('clinical');
      const uncategorizedId = await createProbeTaskWithDomain(undefined);
      const token = await loginAs(app, 'socialworker@caresync.demo');

      const res = await request(app).get('/api/tasks').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(sdohId);
      expect(ids).toContain(uncategorizedId);
      expect(ids).not.toContain(clinicalId);
    });

    it('Coordinator sees all task domains, including clinical', async () => {
      const sdohId = await createProbeTaskWithDomain('sdoh');
      const clinicalId = await createProbeTaskWithDomain('clinical');
      const uncategorizedId = await createProbeTaskWithDomain(undefined);
      const token = await loginAs(app, 'coordinator@caresync.demo');

      const res = await request(app).get('/api/tasks').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(sdohId);
      expect(ids).toContain(clinicalId);
      expect(ids).toContain(uncategorizedId);
    });

    // S7 B1 — the M02 task-queue card needs the patient's name and a short
    // condition tag alongside each task, so listTasks (unlike getTasks) also
    // returns patientId/patientName/conditionTag. maria-chen's seed conditions
    // (E11.9 Diabetes, I50.9 CHF, F33.1 Depression) all resolve through the
    // existing ICD10_SHORT_TAG map (see fhir/conditionTags.ts), so any one of
    // those three short labels is an acceptable conditionTag here — this test
    // doesn't pin down which of Maria's conditions $everything happens to
    // list first.
    it('includes patientId, patientName, and a conditionTag on each task', async () => {
      const taskId = await createProbeTaskWithDomain('sdoh');
      const token = await loginAs(app, 'coordinator@caresync.demo');

      const res = await request(app).get('/api/tasks').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const found = (
        res.body as Array<{ id: string; patientId: string; patientName: string; conditionTag?: string }>
      ).find((t) => t.id === taskId);
      expect(found).toBeDefined();
      expect(found?.patientId).toBe('maria-chen');
      expect(found?.patientName).toBe('Maria Chen');
      expect(['Diabetes', 'CHF', 'Depression']).toContain(found?.conditionTag);
    });
  });

  describe('PATCH /api/tasks/:id/status (S7 A2 — status transitions)', () => {
    it('requires auth', async () => {
      const res = await request(app).patch('/api/tasks/some-id/status').send({ transition: 'complete' });
      expect(res.status).toBe(401);
    });

    it('rejects a missing/invalid transition with 400', async () => {
      const taskId = await createProbeTask();
      const token = await loginAs(app, 'coordinator@caresync.demo');

      const missing = await request(app)
        .patch(`/api/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(missing.status).toBe(400);

      const invalid = await request(app)
        .patch(`/api/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ transition: 'bogus' });
      expect(invalid.status).toBe(400);
    });

    it('complete sets FHIR Task.status to completed, reflected on read-back, and audits success', async () => {
      const taskId = await createProbeTask();
      const token = await loginAs(app, 'coordinator@caresync.demo');

      const res = await request(app)
        .patch(`/api/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ transition: 'complete' });

      expect(res.status).toBe(200);

      const fetched = (await (await fetch(`${FHIR_BASE_URL}/Task/${taskId}`)).json()) as any;
      expect(fetched.status).toBe('completed');

      const rows = db
        .prepare(`SELECT * FROM audit_log WHERE fhir_resource = ? AND outcome = 'success'`)
        .all(`Task/${taskId}`) as any[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toMatchObject({ action: 'update' });
    });

    it("defer sets Task.status to on-hold and businessStatus to 'Deferred', reflected on read-back", async () => {
      const taskId = await createProbeTask();
      const token = await loginAs(app, 'coordinator@caresync.demo');

      const res = await request(app)
        .patch(`/api/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ transition: 'defer' });

      expect(res.status).toBe(200);

      const fetched = (await (await fetch(`${FHIR_BASE_URL}/Task/${taskId}`)).json()) as any;
      expect(fetched.status).toBe('on-hold');
      expect(fetched.businessStatus?.text).toBe('Deferred');
    });

    it("escalate sets businessStatus to 'Escalated' and bumps priority to urgent without terminating status", async () => {
      const taskId = await createProbeTask();
      const token = await loginAs(app, 'coordinator@caresync.demo');

      const res = await request(app)
        .patch(`/api/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ transition: 'escalate' });

      expect(res.status).toBe(200);

      const fetched = (await (await fetch(`${FHIR_BASE_URL}/Task/${taskId}`)).json()) as any;
      expect(fetched.businessStatus?.text).toBe('Escalated');
      expect(fetched.priority).toBe('urgent');
      expect(fetched.status).toBe('requested'); // unchanged, not a terminal status

      const rows = db
        .prepare(`SELECT * FROM audit_log WHERE fhir_resource = ? AND outcome = 'success'`)
        .all(`Task/${taskId}`) as any[];
      expect(rows.length).toBeGreaterThan(0);
    });

    it('a Social Worker can transition an sdoh-domain task', async () => {
      const taskId = await createProbeTaskWithDomain('sdoh');
      const token = await loginAs(app, 'socialworker@caresync.demo');

      const res = await request(app)
        .patch(`/api/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ transition: 'complete' });

      expect(res.status).toBe(200);
      const fetched = (await (await fetch(`${FHIR_BASE_URL}/Task/${taskId}`)).json()) as any;
      expect(fetched.status).toBe('completed');
    });

    it('a Social Worker can transition an uncategorized (domainless) task', async () => {
      const taskId = await createProbeTaskWithDomain(undefined);
      const token = await loginAs(app, 'socialworker@caresync.demo');

      const res = await request(app)
        .patch(`/api/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ transition: 'complete' });

      expect(res.status).toBe(200);
    });

    it('a Social Worker is denied (403) transitioning a clinical-domain task, and a denial audit row is written', async () => {
      const taskId = await createProbeTaskWithDomain('clinical');
      const token = await loginAs(app, 'socialworker@caresync.demo');

      const res = await request(app)
        .patch(`/api/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ transition: 'complete' });

      expect(res.status).toBe(403);

      const fetched = (await (await fetch(`${FHIR_BASE_URL}/Task/${taskId}`)).json()) as any;
      expect(fetched.status).toBe('requested'); // unchanged

      const rows = db
        .prepare(`SELECT * FROM audit_log WHERE fhir_resource = ? AND outcome = 'denied'`)
        .all(`Task/${taskId}`) as any[];
      expect(rows.length).toBeGreaterThan(0);
    });

    it('a Director can transition a clinical-domain task', async () => {
      const taskId = await createProbeTaskWithDomain('clinical');
      const token = await loginAs(app, 'director@caresync.demo');

      const res = await request(app)
        .patch(`/api/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ transition: 'complete' });

      expect(res.status).toBe(200);
    });

    it('a deferred task shows a distinct status label in the role-filtered listing', async () => {
      const taskId = await createProbeTask();
      const token = await loginAs(app, 'coordinator@caresync.demo');

      const patchRes = await request(app)
        .patch(`/api/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ transition: 'defer' });
      expect(patchRes.status).toBe(200);

      const listRes = await request(app).get('/api/tasks').set('Authorization', `Bearer ${token}`);
      const found = (listRes.body as Array<{ id: string; status: string }>).find((t) => t.id === taskId);
      expect(found?.status).toBe('Deferred');
    });
  });

  describe('GET /api/tasks/:id (S7 B2 — task detail + citations)', () => {
    it('requires auth', async () => {
      const res = await request(app).get('/api/tasks/some-id');
      expect(res.status).toBe(401);
    });

    it('returns the task, its justifying patient context, and resolved citations', async () => {
      const taskId = await createProbeTaskWithCitations(['Condition/maria-chen-chf', 'Observation/maria-chen-hba1c']);
      const token = await loginAs(app, 'coordinator@caresync.demo');

      const res = await request(app).get(`/api/tasks/${taskId}`).set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: taskId,
        patientId: 'maria-chen',
        patientName: 'Maria Chen',
        patientPhone: '+1-555-0142',
      });
      const citations = res.body.citations as Array<{ reference: string; display: string }>;
      expect(citations).toHaveLength(2);
      const condition = citations.find((c) => c.reference === 'Condition/maria-chen-chf');
      const observation = citations.find((c) => c.reference === 'Observation/maria-chen-hba1c');
      expect(condition?.display).toContain('Heart failure');
      expect(observation?.display).toContain('Hemoglobin A1c');
    });

    it('writes one success audit row for the detail read', async () => {
      const taskId = await createProbeTaskWithCitations(['Condition/maria-chen-chf']);
      const token = await loginAs(app, 'coordinator@caresync.demo');

      await request(app).get(`/api/tasks/${taskId}`).set('Authorization', `Bearer ${token}`);

      const rows = db
        .prepare(`SELECT * FROM audit_log WHERE fhir_resource = ? AND outcome = 'success'`)
        .all(`Task/${taskId}`) as any[];
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({ action: 'read' });
    });

    it('a Social Worker is denied (403) reading a clinical-domain task, and a denial audit row is written', async () => {
      const taskId = await createProbeTaskWithCitations(['Condition/maria-chen-chf'], 'clinical');
      const token = await loginAs(app, 'socialworker@caresync.demo');

      const res = await request(app).get(`/api/tasks/${taskId}`).set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      const rows = db
        .prepare(`SELECT * FROM audit_log WHERE fhir_resource = ? AND outcome = 'denied'`)
        .all(`Task/${taskId}`) as any[];
      expect(rows.length).toBeGreaterThan(0);
    });

    it('a Social Worker can read an sdoh-domain task', async () => {
      const taskId = await createProbeTaskWithCitations(['Condition/maria-chen-chf'], 'sdoh');
      const token = await loginAs(app, 'socialworker@caresync.demo');

      const res = await request(app).get(`/api/tasks/${taskId}`).set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('returns 404 for a nonexistent task id', async () => {
      const token = await loginAs(app, 'coordinator@caresync.demo');

      const res = await request(app).get('/api/tasks/does-not-exist-12345').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });
});
