import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { createAuthRouter } from './auth';
import { createTeamRouter } from './team';
import { FhirReadService } from '../fhir/client';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  const fhirService = new FhirReadService(db, FHIR_BASE_URL);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/team', createTeamRouter(fhirService, db));
  return app;
}

async function loginAs(app: express.Express, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  return res.body.token;
}

// S11 A3 — the team performance endpoint (W04), exercised against the real
// disposable HAPI container + seed data (same Seam 1 pattern as
// routes/quality.test.ts / fhir/client.test.ts). Director-only, matching
// Population's/Governance's/Quality's own cross-patient aggregates.
describe('GET /api/team/performance', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  it('returns the real team performance shape for a Director', async () => {
    const token = await loginAs(app, 'director@caresync.demo');
    const res = await request(app).get('/api/team/performance').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.coordinators)).toBe(true);
    expect(typeof res.body.unassignedCount).toBe('number');
    expect(typeof res.body.totalTasks).toBe('number');
    expect(typeof res.body.overallCompletionRate).toBe('number');
    // seedDemoUsers seeds exactly one coordinator (Cara Coordinator).
    expect(res.body.coordinators).toHaveLength(1);
    expect(res.body.coordinators[0]).toMatchObject({ name: 'Cara Coordinator' });
  }, 20000);

  it('is denied for a Coordinator (Director-only)', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).get('/api/team/performance').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('is denied for a Social Worker (Director-only)', async () => {
    const token = await loginAs(app, 'socialworker@caresync.demo');
    const res = await request(app).get('/api/team/performance').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/team/performance');
    expect(res.status).toBe(401);
  });
});
