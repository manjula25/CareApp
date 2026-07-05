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
});
