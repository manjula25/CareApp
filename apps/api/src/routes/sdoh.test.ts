import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { createAuthRouter } from './auth';
import { createSdohRouter } from './sdoh';
import { FhirReadService } from '../fhir/client';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  const fhirService = new FhirReadService(db, FHIR_BASE_URL);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/sdoh', createSdohRouter(fhirService));
  return app;
}

async function loginAs(app: express.Express, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  return res.body.token;
}

// S11 A1 — exercised against the real disposable HAPI container + seed data,
// same Seam 1 reference pattern as routes/tasks.test.ts. Every ServiceRequest
// this suite creates is a disposable referral probe, cleaned up in afterEach.
describe('sdoh routes', () => {
  let db: Database.Database;
  let app: express.Express;
  const createdServiceRequestIds: string[] = [];

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  afterEach(async () => {
    while (createdServiceRequestIds.length > 0) {
      const id = createdServiceRequestIds.pop()!;
      await fetch(`${FHIR_BASE_URL}/ServiceRequest/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  describe('GET /api/sdoh/resources', () => {
    it('requires auth', async () => {
      const res = await request(app).get('/api/sdoh/resources');
      expect(res.status).toBe(401);
    });

    it('returns the full static resource list for any authenticated role', async () => {
      const token = await loginAs(app, 'socialworker@caresync.demo');
      const res = await request(app).get('/api/sdoh/resources').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(8);
      expect(res.body.map((r: any) => r.category)).toEqual(expect.arrayContaining(['transportation', 'food']));
    });

    it('filters by ?category=', async () => {
      const token = await loginAs(app, 'coordinator@caresync.demo');
      const res = await request(app)
        .get('/api/sdoh/resources?category=housing')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every((r: any) => r.category === 'housing')).toBe(true);
    });
  });

  describe('POST /api/sdoh/referrals', () => {
    it('requires auth', async () => {
      const res = await request(app).post('/api/sdoh/referrals').send({ patientId: 'maria-chen', resourceId: 'metro-transit-assistance' });
      expect(res.status).toBe(401);
    });

    it('400s when patientId or resourceId is missing', async () => {
      const token = await loginAs(app, 'coordinator@caresync.demo');
      const res = await request(app)
        .post('/api/sdoh/referrals')
        .set('Authorization', `Bearer ${token}`)
        .send({ patientId: 'maria-chen' });
      expect(res.status).toBe(400);
    });

    it('400s when resourceId does not match a known resource', async () => {
      const token = await loginAs(app, 'coordinator@caresync.demo');
      const res = await request(app)
        .post('/api/sdoh/referrals')
        .set('Authorization', `Bearer ${token}`)
        .send({ patientId: 'maria-chen', resourceId: 'not-a-real-resource' });
      expect(res.status).toBe(400);
    });

    it('creates a resolvable ServiceRequest referencing the patient, resolvable via a live GET against HAPI', async () => {
      const token = await loginAs(app, 'coordinator@caresync.demo');
      const res = await request(app)
        .post('/api/sdoh/referrals')
        .set('Authorization', `Bearer ${token}`)
        .send({ patientId: 'maria-chen', resourceId: 'metro-transit-assistance' });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      createdServiceRequestIds.push(res.body.id);

      const fetched = (await (await fetch(`${FHIR_BASE_URL}/ServiceRequest/${res.body.id}`)).json()) as any;
      expect(fetched.resourceType).toBe('ServiceRequest');
      expect(fetched.subject).toEqual({ reference: 'Patient/maria-chen' });
      expect(fetched.code?.text).toBe('Metro Transit Assistance Program');
    });

    it('lets a social_worker create a referral too (sdoh scope)', async () => {
      const token = await loginAs(app, 'socialworker@caresync.demo');
      const res = await request(app)
        .post('/api/sdoh/referrals')
        .set('Authorization', `Bearer ${token}`)
        .send({ patientId: 'maria-chen', resourceId: 'community-mental-health-clinic' });
      expect(res.status).toBe(200);
      createdServiceRequestIds.push(res.body.id);
    });
  });

  // S12 A.5 — `/api/sdoh/screening/:patientId` returns QuestionnaireResponse
  // resources on the patient record. Maria Chen (no screening on file in the
  // default seed) → empty array + screeningFound:false. Live HAPI-dependent;
  // the empty-shape contract is what matters here, not exact counts.
  describe('GET /api/sdoh/screening/:patientId', () => {
    it('requires auth', async () => {
      const res = await request(app).get('/api/sdoh/screening/maria-chen');
      expect(res.status).toBe(401);
    });

    it('returns screeningFound:false and empty responses for a patient with no screening on file', async () => {
      const token = await loginAs(app, 'socialworker@caresync.demo');
      const res = await request(app)
        .get('/api/sdoh/screening/maria-chen')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        patientId: 'maria-chen',
        screeningFound: false,
      });
      expect(res.body.responses).toEqual([]);
    }, 20000);

    it('returns the same shape for a director (sdoh domain accessible to director too)', async () => {
      const token = await loginAs(app, 'director@caresync.demo');
      const res = await request(app)
        .get('/api/sdoh/screening/maria-chen')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.patientId).toBe('maria-chen');
    }, 20000);
  });
});
