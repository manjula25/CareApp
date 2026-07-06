import fs from 'fs';
import path from 'path';
import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { writeAudit } from '../db/audit';
import { writeAnalysisCache } from '../db/analysisCache';
import { createAuthRouter } from './auth';
import { createGovernanceRouter } from './governance';
import { FhirReadService } from '../fhir/client';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';

// Same path governance/service.ts's getEvalSummary reads (repo root
// docs/eval-report.json) — resolved the same way (4 dirs up from
// src/routes), so this test can't drift from where the endpoint actually looks.
const EVAL_REPORT_PATH = path.resolve(__dirname, '../../../../docs/eval-report.json');

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  const fhirService = new FhirReadService(db, FHIR_BASE_URL);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/governance', createGovernanceRouter(fhirService, db));
  return app;
}

async function loginAs(app: express.Express, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  return res.body.token;
}

// S8 A1 — Director-only audit trail, paging the existing S1 audit_log table.
describe('GET /api/governance/audit', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  it('lists real audit rows most-recent-first with actor + timestamp, paged by limit/offset', async () => {
    writeAudit(db, { actor: 'coord-1', action: 'read', fhirResource: 'Patient/maria-chen', outcome: 'success' });
    writeAudit(db, { actor: 'coord-2', action: 'read', fhirResource: 'Patient/john-doe', outcome: 'denied' });
    writeAudit(db, { actor: 'coord-3', action: 'update', fhirResource: 'Task/abc', outcome: 'success' });

    const token = await loginAs(app, 'director@caresync.demo');
    const res = await request(app).get('/api/governance/audit?limit=2&offset=0').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    // Most-recent-first: the last row written (coord-3) comes first.
    expect(res.body.entries[0]).toMatchObject({
      actor: 'coord-3',
      action: 'update',
      resource: 'Task/abc',
      outcome: 'success',
    });
    expect(res.body.entries[0].ts).toEqual(expect.any(String));
    expect(res.body.entries[1]).toMatchObject({ actor: 'coord-2', resource: 'Patient/john-doe', outcome: 'denied' });
    expect(res.body.total).toBeGreaterThanOrEqual(3);
  });

  it('is denied for a Coordinator (Director-only)', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).get('/api/governance/audit').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/governance/audit');
    expect(res.status).toBe(401);
  });
});

// S8 A2 — model version/timestamp per cached analysis, plus a confidence
// distribution bucketed from the actual cached agent outputs. `resultJson` is
// stored (and read back) as loosely-typed JSON (see db/analysisCache.ts), so
// this seeds rows with a `confidence` field per finding even though
// `AgentFlag` (agents/citationValidator.ts) does not currently declare one —
// see governance/service.ts's doc for why that's a deliberate, forward-
// compatible reading rather than a fabrication.
describe('GET /api/governance/model', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  it('returns model version + timestamp per analysis and a confidence distribution matching hand-computed buckets', async () => {
    writeAnalysisCache(db, {
      patientId: 'patient-a',
      modelVersion: 'gpt-5.5',
      createdTs: '2026-07-01T00:00:00.000Z',
      resultJson: {
        risk: { findings: [{ text: 'f1', fhirResourceId: 'Condition/1', confidence: 0.92 }, { text: 'f2', fhirResourceId: 'Condition/2', confidence: 0.4 }] },
        careGap: { findings: [{ gapType: 'g1', fhirResourceId: 'Condition/3', confidence: 0.6 }] },
        sdoh: { findings: [{ domain: 'housing', fhirResourceId: 'Observation/1', confidence: 0.8 }] },
      },
    });
    writeAnalysisCache(db, {
      patientId: 'patient-b',
      modelVersion: 'gpt-5.5',
      createdTs: '2026-07-02T00:00:00.000Z',
      resultJson: {
        risk: { findings: [{ text: 'f3', fhirResourceId: 'Condition/4', confidence: 0.3 }] },
        careGap: { findings: [] },
        sdoh: { findings: [{ domain: 'food', fhirResourceId: 'Observation/2', confidence: 0.95 }] },
      },
    });

    const token = await loginAs(app, 'director@caresync.demo');
    const res = await request(app).get('/api/governance/model').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.analyses).toEqual(
      expect.arrayContaining([
        { patientId: 'patient-a', modelVersion: 'gpt-5.5', createdTs: '2026-07-01T00:00:00.000Z' },
        { patientId: 'patient-b', modelVersion: 'gpt-5.5', createdTs: '2026-07-02T00:00:00.000Z' },
      ])
    );

    // Hand-computed: confidences are 0.92, 0.4, 0.6, 0.8 (patient-a) and
    // 0.3, 0.95 (patient-b) -> 0-0.5: {0.4, 0.3}=2, 0.5-0.7: {0.6}=1,
    // 0.7-0.85: {0.8}=1, 0.85-1.0: {0.92, 0.95}=2.
    expect(res.body.confidenceDistribution).toEqual(
      expect.arrayContaining([
        { range: '0-0.5', count: 2 },
        { range: '0.5-0.7', count: 1 },
        { range: '0.7-0.85', count: 1 },
        { range: '0.85-1.0', count: 2 },
      ])
    );
  });

  it('is denied for a Coordinator (Director-only)', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).get('/api/governance/model').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/governance/model');
    expect(res.status).toBe(401);
  });
});

// S8 A3 — demographic parity computed from REAL Synthea/HAPI demographics
// (GD12), joined to cached risk scores. Exercised against the real
// disposable HAPI container (same Seam 1 pattern as fhir/client.test.ts and
// routes/tasks.test.ts): probe Patients are created with a fixed id (PUT,
// the same create-with-known-id method scripts/import-fhir.ts uses) carrying
// the exact US Core race/ethnicity extension shape that script writes, then
// deleted in afterEach.
describe('GET /api/governance/parity', () => {
  let db: Database.Database;
  let app: express.Express;
  const createdPatientIds: string[] = [];

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  afterEach(async () => {
    while (createdPatientIds.length > 0) {
      const id = createdPatientIds.pop()!;
      await fetch(`${FHIR_BASE_URL}/Patient/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  function raceEthnicityExtensions(race: { code: string; display: string }, ethnicity: { code: string; display: string }) {
    return [
      {
        url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race',
        extension: [
          { url: 'ombCategory', valueCoding: { system: 'urn:oid:2.16.840.1.113883.6.238', code: race.code, display: race.display } },
          { url: 'text', valueString: race.display },
        ],
      },
      {
        url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity',
        extension: [
          { url: 'ombCategory', valueCoding: { system: 'urn:oid:2.16.840.1.113883.6.238', code: ethnicity.code, display: ethnicity.display } },
          { url: 'text', valueString: ethnicity.display },
        ],
      },
    ];
  }

  async function createProbePatient(opts: {
    id: string;
    birthDate: string;
    gender: string;
    race: { code: string; display: string };
    ethnicity: { code: string; display: string };
  }): Promise<void> {
    await fetch(`${FHIR_BASE_URL}/Patient/${opts.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify({
        resourceType: 'Patient',
        id: opts.id,
        extension: raceEthnicityExtensions(opts.race, opts.ethnicity),
        name: [{ given: ['Probe'], family: 'Patient' }],
        gender: opts.gender,
        birthDate: opts.birthDate,
      }),
    });
    createdPatientIds.push(opts.id);
  }

  const BLACK = { code: '2054-5', display: 'Black or African American' };
  const WHITE = { code: '2106-3', display: 'White' };
  const NOT_HISPANIC = { code: '2186-5', display: 'Not Hispanic or Latino' };
  const HISPANIC = { code: '2135-2', display: 'Hispanic or Latino' };

  it('stratifies cached risk scores by age band, sex, race, and ethnicity, reflecting a known-imbalanced fixture', async () => {
    await createProbePatient({ id: 'gov-a3-patient-1', birthDate: '1950-01-01', gender: 'female', race: BLACK, ethnicity: NOT_HISPANIC });
    await createProbePatient({ id: 'gov-a3-patient-2', birthDate: '1950-06-15', gender: 'female', race: BLACK, ethnicity: NOT_HISPANIC });
    await createProbePatient({ id: 'gov-a3-patient-3', birthDate: '1995-03-10', gender: 'male', race: WHITE, ethnicity: HISPANIC });

    writeAnalysisCache(db, {
      patientId: 'gov-a3-patient-1',
      modelVersion: 'gpt-5.5',
      createdTs: '2026-07-01T00:00:00.000Z',
      resultJson: { risk: { complete: { riskScore: 92 } } },
    });
    writeAnalysisCache(db, {
      patientId: 'gov-a3-patient-2',
      modelVersion: 'gpt-5.5',
      createdTs: '2026-07-01T00:00:00.000Z',
      resultJson: { risk: { complete: { riskScore: 78 } } },
    });
    writeAnalysisCache(db, {
      patientId: 'gov-a3-patient-3',
      modelVersion: 'gpt-5.5',
      createdTs: '2026-07-01T00:00:00.000Z',
      resultJson: { risk: { complete: { riskScore: 15 } } },
    });

    const token = await loginAs(app, 'director@caresync.demo');
    const res = await request(app).get('/api/governance/parity').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    expect(res.body.byAgeBand).toEqual(
      expect.arrayContaining([
        { group: '65+', patientCount: 2, avgRiskScore: 85 },
        { group: '18-34', patientCount: 1, avgRiskScore: 15 },
      ])
    );
    expect(res.body.bySex).toEqual(
      expect.arrayContaining([
        { group: 'female', patientCount: 2, avgRiskScore: 85 },
        { group: 'male', patientCount: 1, avgRiskScore: 15 },
      ])
    );
    expect(res.body.byRace).toEqual(
      expect.arrayContaining([
        { group: 'Black or African American', patientCount: 2, avgRiskScore: 85 },
        { group: 'White', patientCount: 1, avgRiskScore: 15 },
      ])
    );
    expect(res.body.byEthnicity).toEqual(
      expect.arrayContaining([
        { group: 'Not Hispanic or Latino', patientCount: 2, avgRiskScore: 85 },
        { group: 'Hispanic or Latino', patientCount: 1, avgRiskScore: 15 },
      ])
    );

    // Known-imbalanced fixture -> the expected disparity direction: the
    // Black/female/65+ group's avg risk score is well above the White/male/
    // 18-34 group's, not just marginally.
    const black = res.body.byRace.find((r: any) => r.group === 'Black or African American');
    const white = res.body.byRace.find((r: any) => r.group === 'White');
    expect(black.avgRiskScore).toBeGreaterThan(white.avgRiskScore);
  }, 20000);

  it('is denied for a Coordinator (Director-only)', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).get('/api/governance/parity').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/governance/parity');
    expect(res.status).toBe(401);
  });
});

// S8 B — tiny, stateless read of the S9 evaluation report JSON. S9 doesn't
// exist yet in this branch, so this endpoint must behave honestly (`available:
// false`, never throw/fabricate) until it does. Both branches are seeded by
// directly writing/removing the real file at the exact path the service reads
// (not a mock fs) — this is a stateless file-existence check, not a DB table,
// so exercising the real filesystem is the simplest faithful test.
describe('GET /api/governance/eval', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
    fs.rmSync(EVAL_REPORT_PATH, { force: true });
  });

  afterEach(() => {
    fs.rmSync(EVAL_REPORT_PATH, { force: true });
  });

  it('returns { available: false } when no S9 report file exists yet', async () => {
    const token = await loginAs(app, 'director@caresync.demo');
    const res = await request(app).get('/api/governance/eval').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
  });

  it('returns { available: true, summary } with the parsed JSON when the report file exists', async () => {
    fs.writeFileSync(EVAL_REPORT_PATH, JSON.stringify({ headline: 'Care Gap sensitivity 91%', generatedAt: '2026-07-05T00:00:00.000Z' }));

    const token = await loginAs(app, 'director@caresync.demo');
    const res = await request(app).get('/api/governance/eval').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      available: true,
      summary: { headline: 'Care Gap sensitivity 91%', generatedAt: '2026-07-05T00:00:00.000Z' },
    });
  });

  it('returns { available: false } (not a 500) when the report file exists but is not valid JSON', async () => {
    fs.writeFileSync(EVAL_REPORT_PATH, '{ not valid json');

    const token = await loginAs(app, 'director@caresync.demo');
    const res = await request(app).get('/api/governance/eval').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
  });

  it('is denied for a Coordinator (Director-only)', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).get('/api/governance/eval').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/governance/eval');
    expect(res.status).toBe(401);
  });
});
