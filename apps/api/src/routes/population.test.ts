import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { createAuthRouter } from './auth';
import { createPopulationRouter } from './population';
import { FhirReadService } from '../fhir/client';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  const fhirService = new FhirReadService(db, process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir');
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/population', createPopulationRouter(fhirService, db));
  return app;
}

async function loginAs(app: express.Express, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  return res.body.token;
}

describe('population routes', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  it('GET /api/population/scatter returns a large number of scatter points for a Director', async () => {
    const token = await loginAs(app, 'director@caresync.demo');
    const res = await request(app).get('/api/population/scatter').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Tolerant lower bound, not exactly 500: the cohort import (A1) may
    // still be catching up against the shared live HAPI instance.
    expect(res.body.length).toBeGreaterThanOrEqual(400);
    expect(res.body[0]).toMatchObject({
      id: expect.any(String),
      riskScore: expect.any(Number),
      urgency: expect.any(Number),
      x: expect.any(Number),
      y: expect.any(Number),
    });
  }, 20000);

  it('GET /api/population/summary returns critical-zone count and cost avoidance computed from real data', async () => {
    const token = await loginAs(app, 'director@caresync.demo');
    const res = await request(app).get('/api/population/summary').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.criticalZoneCount).toBeGreaterThan(0);
    expect(res.body.projectedCostAvoidance).toBeGreaterThan(0);
    expect(res.body.teamKpis).toBeDefined();
  }, 20000);

  it('GET /api/population/scatter is denied for a Coordinator and writes a denial audit row', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).get('/api/population/scatter').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);

    const rows = db
      .prepare(`SELECT * FROM audit_log WHERE fhir_resource LIKE 'Population%' AND outcome = 'denied'`)
      .all();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('GET /api/population/summary is denied for a Coordinator', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).get('/api/population/summary').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/population/scatter');
    expect(res.status).toBe(401);
  });
});
