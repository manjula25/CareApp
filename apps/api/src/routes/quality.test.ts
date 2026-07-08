import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { createAuthRouter } from './auth';
import { createQualityRouter } from './quality';
import { FhirReadService } from '../fhir/client';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  const fhirService = new FhirReadService(db, FHIR_BASE_URL);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/quality', createQualityRouter(fhirService, db));
  return app;
}

async function loginAs(app: express.Express, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  return res.body.token;
}

// S11 A2 — the real HEDIS diabetes/HbA1c measure endpoint, exercised against
// the real disposable HAPI container + seed data (same Seam 1 pattern as
// routes/governance.test.ts / fhir/client.test.ts). Assertions are shape- and
// relationship-based (not pinned to exact counts) — see quality/service.ts's
// doc for why exact counts aren't a stable contract. Director-only, matching
// Population's/Governance's own cross-patient aggregates.
describe('GET /api/quality/measures', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  it('returns the real diabetes/HbA1c measure shape for a Director', async () => {
    const token = await loginAs(app, 'director@caresync.demo');
    const res = await request(app).get('/api/quality/measures').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      measureId: 'diabetes-hba1c-testing',
      measureName: 'Comprehensive Diabetes Care: HbA1c Testing',
    });
    expect(res.body.denominator).toBeGreaterThan(0);
    expect(res.body.denominator).toBeGreaterThan(res.body.numerator);
    expect(res.body.gapPatients).toBe(res.body.denominator - res.body.numerator);
    expect(res.body.illustrativeIncentiveDollars).toBe(res.body.gapPatients * 5000);
  }, 20000);

  it('is denied for a Coordinator (Director-only)', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).get('/api/quality/measures').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('is denied for a Social Worker (Director-only)', async () => {
    const token = await loginAs(app, 'socialworker@caresync.demo');
    const res = await request(app).get('/api/quality/measures').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/quality/measures');
    expect(res.status).toBe(401);
  });
});

// S12 A.4 — `/api/quality/deadlines` returns the upcoming HEDIS calendar with
// a runtime-computed `daysRemaining`. Static source data + pure date math;
// no HAPI round-trip, so the test runs without the FHIR server.
describe('GET /api/quality/deadlines', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  it('returns three deadlines with computed daysRemaining for a Director', async () => {
    const token = await loginAs(app, 'director@caresync.demo');
    const res = await request(app).get('/api/quality/deadlines').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.deadlines).toHaveLength(3);
    for (const d of res.body.deadlines) {
      expect(d).toMatchObject({
        measure: expect.any(String),
        dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        daysRemaining: expect.any(Number),
      });
      expect(d.daysRemaining).toBeGreaterThanOrEqual(0);
    }
  });

  it('is denied for a Coordinator', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).get('/api/quality/deadlines').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/quality/deadlines');
    expect(res.status).toBe(401);
  });
});
