import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { createAuthRouter } from './auth';
import { createPatientsRouter } from './patients';
import { FhirReadService } from '../fhir/client';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  const fhirService = new FhirReadService(db, process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir');
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/patients', createPatientsRouter(fhirService));
  return app;
}

async function loginAs(app: express.Express, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  return res.body.token;
}

describe('patients routes', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  it('GET /api/patients/assigned returns the Coordinator panel', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).get('/api/patients/assigned').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.find((p: any) => p.id === 'maria-chen')).toMatchObject({ riskScore: 87 });
  });

  it('GET /api/patients/:id returns name and conditions for a Coordinator', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).get('/api/patients/maria-chen').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.patient.name).toBe('Maria Chen');
    expect(res.body.conditions.length).toBeGreaterThan(0);
  });

  it('GET /api/patients/:id is denied for a Social Worker (non-SDOH clinical read)', async () => {
    const token = await loginAs(app, 'socialworker@caresync.demo');
    const res = await request(app).get('/api/patients/maria-chen').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/patients/assigned');
    expect(res.status).toBe(401);
  });
});
