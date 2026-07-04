import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { createAuthRouter } from './auth';
import { createAnalysisRouter } from './analysis';
import { FhirReadService } from '../fhir/client';
import { AgentEvent, RiskOutput } from '../agents/riskAgent';

// Stub agent (S2 acceptance) — no live OpenAI call. Yields one token then a
// result with one in-bundle citation and one fabricated citation, so the
// route's GD11 validation gate (Seam 2) has something real to drop.
async function* stubAgent(): AsyncIterable<AgentEvent> {
  yield { type: 'token', text: 'Reviewing chart...' };
  const output: RiskOutput = {
    riskScore: 87,
    riskLevel: 'critical',
    flags: [
      { text: 'CHF diagnosis drives elevated readmission risk', fhirResourceId: 'Condition/maria-chen-chf' },
      { text: 'hallucinated finding', fhirResourceId: 'Condition/does-not-exist' },
    ],
    readmissionProbability: 0.7,
  };
  yield { type: 'result', output };
}

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  const fhirService = new FhirReadService(db, process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir');
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/patients', createAnalysisRouter(fhirService, stubAgent));
  return app;
}

async function loginAs(app: express.Express, email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  return res.body.token;
}

interface SseEvent {
  event: string;
  data: any;
}

function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const lines = chunk.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine = lines.find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) {
        throw new Error(`Malformed SSE chunk: ${chunk}`);
      }
      return { event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) };
    });
}

async function* throwingAgent(): AsyncIterable<AgentEvent> {
  yield { type: 'token', text: 'Reviewing the full chart in detail before reaching any conclusion at all here...' };
  throw new Error('OpenAI request failed');
}

async function* narrationWithFabricatedCitationAgent(): AsyncIterable<AgentEvent> {
  yield { type: 'token', text: 'Notably, Observation/does-not-exist supports this, and Condition/maria-chen-chf too.' };
  const output: RiskOutput = {
    riskScore: 40,
    riskLevel: 'moderate',
    flags: [],
    readmissionProbability: 0.3,
  };
  yield { type: 'result', output };
}

describe('analysis routes (B2 — SSE stream + citation validation gate, GD11)', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db);
  });

  it('streams the token, emits only the valid finding, drops the fabricated citation, and audits the read', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');

    const res = await request(app).post('/api/patients/maria-chen/analysis').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const events = parseSse(res.text);

    const tokenEvents = events.filter((e) => e.event === 'token');
    expect(tokenEvents).toEqual([{ event: 'token', data: { text: 'Reviewing chart...' } }]);

    const findingEvents = events.filter((e) => e.event === 'finding');
    expect(findingEvents).toHaveLength(1);
    expect(findingEvents[0].data).toMatchObject({ fhirResourceId: 'Condition/maria-chen-chf' });

    // The fabricated citation never reaches the client, in any event payload.
    expect(res.text).not.toContain('does-not-exist');

    const completeEvent = events.find((e) => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.data).toMatchObject({
      riskScore: 87,
      riskLevel: 'critical',
      readmissionProbability: 0.7,
      findingCount: 1,
      droppedCount: 1,
    });

    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: expect.any(String),
      outcome: 'success',
      fhir_resource: 'Patient/maria-chen/$everything',
    });
  });

  it('emits an error event and ends the stream cleanly if the agent throws mid-stream', async () => {
    const app = express();
    app.use(express.json());
    const fhirService = new FhirReadService(db, process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir');
    app.use('/api/auth', createAuthRouter(db));
    app.use('/api/patients', createAnalysisRouter(fhirService, throwingAgent));
    const token = await loginAs(app, 'coordinator@caresync.demo');

    const res = await request(app).post('/api/patients/maria-chen/analysis').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const events = parseSse(res.text);
    const errorEvent = events.find((e) => e.event === 'error');
    expect(errorEvent).toBeDefined();
    expect(events.find((e) => e.event === 'complete')).toBeUndefined();
  });

  it('redacts a fabricated citation mentioned in the narration stream, not just in structured flags', async () => {
    const app = express();
    app.use(express.json());
    const fhirService = new FhirReadService(db, process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir');
    app.use('/api/auth', createAuthRouter(db));
    app.use('/api/patients', createAnalysisRouter(fhirService, narrationWithFabricatedCitationAgent));
    const token = await loginAs(app, 'coordinator@caresync.demo');

    const res = await request(app).post('/api/patients/maria-chen/analysis').set('Authorization', `Bearer ${token}`);

    expect(res.text).not.toContain('does-not-exist');
    expect(res.text).toContain('Condition/maria-chen-chf');
    expect(res.text).toContain('[unverified citation removed]');
  });

  it('denies a Social Worker (no clinical scope) before streaming', async () => {
    const token = await loginAs(app, 'socialworker@caresync.demo');

    const res = await request(app).post('/api/patients/maria-chen/analysis').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).post('/api/patients/maria-chen/analysis');
    expect(res.status).toBe(401);
  });
});
