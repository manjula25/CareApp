import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { createCdsHooksRouter, CDS_PATIENT_VIEW_SERVICE_ID } from './cdsHooks';
import { writeAnalysisCache } from '../db/analysisCache';
import { AnalysisResultJson } from './analysis';

const PATIENT_ID = 'james-okafor';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/cds-services', createCdsHooksRouter(db));
  return app;
}

// Mirrors the shape a real cache row's resultJson carries (see
// analysis.test.ts's cachedResultFromStub) — one finding per agent, plus a
// populated actionPlanner to prove the route's card mapping ignores it.
function cachedResult(): AnalysisResultJson {
  return {
    risk: {
      narration: 'Reviewing chart...',
      findings: [{ text: 'CHF diagnosis drives elevated readmission risk', fhirResourceId: 'Condition/chf-1' }],
      complete: { riskScore: 90, riskLevel: 'critical', readmissionProbability: 0.8, findingCount: 1, droppedCount: 0 },
    },
    careGap: {
      narration: 'Checking preventive care gaps...',
      findings: [{ gapType: 'screening', description: 'Overdue HbA1c recheck', urgency: 'high', fhirResourceId: 'Observation/hba1c-1' }],
      complete: { findingCount: 1, droppedCount: 0 },
    },
    sdoh: {
      narration: 'Screening for social barriers...',
      findings: [
        { domain: 'transportation', finding: 'No reliable transportation to follow-up visits', severity: 'moderate', fhirResourceId: 'Observation/sdoh-1' },
      ],
      complete: { findingCount: 1, droppedCount: 0, referralsNeeded: ['transportation-assistance'] },
    },
    actionPlanner: {
      narration: 'Synthesizing worklist...',
      tasks: [
        {
          id: 'task-1',
          reference: 'Task/task-1',
          title: 'Schedule cardiology follow-up',
          description: 'Address CHF readmission risk',
          priority: 'high',
          fhirResources: ['Condition/chf-1'],
        },
      ],
      complete: { findingCount: 1, droppedCount: 0 },
    },
  };
}

describe('CDS Hooks discovery route (S10 A1)', () => {
  it('lists the patient-view service with a well-formed descriptor, no auth required', async () => {
    const db = new Database(':memory:');
    migrate(db);
    const app = buildApp(db);

    const res = await request(app).get('/cds-services');

    expect(res.status).toBe(200);
    expect(res.body.services).toHaveLength(1);

    const service = res.body.services[0];
    expect(service.hook).toBe('patient-view');
    expect(service.id).toBe(CDS_PATIENT_VIEW_SERVICE_ID);
    expect(typeof service.title).toBe('string');
    expect(service.title.length).toBeGreaterThan(0);
    expect(typeof service.description).toBe('string');
    expect(service.description.length).toBeGreaterThan(0);
    expect(typeof service.prefetch).toBe('object');
    expect(service.prefetch).not.toBeNull();
  });
});

describe('CDS Hooks patient-view service route (S10 A2)', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    app = buildApp(db);
  });

  it('returns cards mapped from the S4 cache for the patient in context, not behind auth', async () => {
    writeAnalysisCache(db, {
      patientId: PATIENT_ID,
      resultJson: cachedResult(),
      modelVersion: 'gpt-5.5',
      createdTs: '2020-01-01T00:00:00.000Z',
    });

    const res = await request(app)
      .post(`/cds-services/${CDS_PATIENT_VIEW_SERVICE_ID}`)
      .send({
        hookInstance: 'd1577c69-dfbe-44ad-ba6d-3e05e953b2ea',
        hook: 'patient-view',
        context: { patientId: PATIENT_ID, userId: 'Practitioner/example' },
      });

    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(3); // risk + careGap + sdoh, no actionPlanner
    expect(res.body.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: { label: 'CareSync AI — Risk' }, indicator: 'critical' }),
        expect.objectContaining({ source: { label: 'CareSync AI — Care Gap' }, indicator: 'critical' }),
        expect.objectContaining({ source: { label: 'CareSync AI — SDOH' }, indicator: 'warning' }),
      ])
    );
    // Every card carries a resolvable FHIR citation in its detail.
    for (const card of res.body.cards) {
      expect(card.detail).toMatch(/\(FHIR: [A-Za-z]+\/[\w-]+\)/);
    }
    // actionPlanner's task never leaks into the cards.
    expect(res.body.cards.some((c: any) => c.detail.includes('Schedule cardiology follow-up'))).toBe(false);
  });

  it('returns an empty cards array on a cache miss (no live orchestrator trigger)', async () => {
    const res = await request(app)
      .post(`/cds-services/${CDS_PATIENT_VIEW_SERVICE_ID}`)
      .send({ hookInstance: 'x', hook: 'patient-view', context: { patientId: 'nobody-cached' } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cards: [] });
  });

  it('responds 404 for an unknown service id', async () => {
    const res = await request(app)
      .post('/cds-services/not-a-real-service')
      .send({ hookInstance: 'x', hook: 'patient-view', context: { patientId: PATIENT_ID } });

    expect(res.status).toBe(404);
  });

  it('responds 400 when context.patientId is missing', async () => {
    const res = await request(app)
      .post(`/cds-services/${CDS_PATIENT_VIEW_SERVICE_ID}`)
      .send({ hookInstance: 'x', hook: 'patient-view', context: {} });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'context.patientId is required' });
  });

  it('does not require auth (no Authorization header)', async () => {
    const res = await request(app)
      .post(`/cds-services/${CDS_PATIENT_VIEW_SERVICE_ID}`)
      .send({ hookInstance: 'x', hook: 'patient-view', context: { patientId: 'no-cache-either' } });

    expect(res.status).toBe(200);
  });
});
