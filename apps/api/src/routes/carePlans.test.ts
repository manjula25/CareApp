import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { createAuthRouter } from './auth';
import { createCarePlansRouter } from './carePlans';
import { FhirReadService } from '../fhir/client';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  const fhirService = new FhirReadService(db, FHIR_BASE_URL);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/care-plans', createCarePlansRouter(fhirService));
  return app;
}

async function loginAs(app: express.Express, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  return res.body.token;
}

// S12 C.2 — `POST /api/care-plans/:patientId` thin shell over
// `FhirReadService.createCarePlan`. Exercises against the real HAPI + seed
// data, same pattern as routes/tasks.test.ts.
describe('POST /api/care-plans/:patientId', () => {
  let db: Database.Database;
  let app: express.Express;
  const createdCarePlanIds: string[] = [];

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  afterEach(async () => {
    while (createdCarePlanIds.length > 0) {
      const id = createdCarePlanIds.pop()!;
      await fetch(`${FHIR_BASE_URL}/CarePlan/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  it('requires auth', async () => {
    const res = await request(app)
      .post('/api/care-plans/maria-chen')
      .send({ goals: ['Reduce HbA1c'], interventions: [{ text: '48h call' }] });
    expect(res.status).toBe(401);
  });

  it('400s when goals or interventions are missing', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app)
      .post('/api/care-plans/maria-chen')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('creates a real, resolvable CarePlan against HAPI and writes an audit row', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app)
      .post('/api/care-plans/maria-chen')
      .set('Authorization', `Bearer ${token}`)
      .send({
        goals: ['Reduce HbA1c to < 8% within 90 days', 'Monitor daily weight — alert if +3 lbs in 24h'],
        interventions: [
          { text: '48h post-discharge follow-up call', frequency: 'Once' },
          { text: 'Weekly check-in calls for 4 weeks', frequency: 'Weekly' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    createdCarePlanIds.push(res.body.id);

    // Verify it round-trips against HAPI as a real CarePlan.
    const fetched = (await (await fetch(`${FHIR_BASE_URL}/CarePlan/${res.body.id}`)).json()) as any;
    expect(fetched.resourceType).toBe('CarePlan');
    expect(fetched.subject).toEqual({ reference: 'Patient/maria-chen' });
    expect(fetched.goal).toHaveLength(2);
    expect(fetched.activity).toHaveLength(2);

    // Audit row was written.
    const audit = db.prepare(`SELECT * FROM audit_log WHERE fhir_resource LIKE 'CarePlan/%' AND outcome = 'success'`).all();
    expect(audit.length).toBeGreaterThan(0);
  }, 20000);

  it('is denied for a Social Worker (clinical-only write)', async () => {
    const token = await loginAs(app, 'socialworker@caresync.demo');
    const res = await request(app)
      .post('/api/care-plans/maria-chen')
      .set('Authorization', `Bearer ${token}`)
      .send({ goals: ['g'], interventions: [{ text: 'i' }] });
    expect(res.status).toBe(403);
  });
});