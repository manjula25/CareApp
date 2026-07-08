import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { createAuthRouter } from './auth';
import { createAnalysisRouter, AnalysisResultJson } from './analysis';
import { FhirReadService } from '../fhir/client';
import { AgentEvent, RiskOutput, CareGapOutput, SdohOutput, ActionPlannerOutput } from '../agents/agent';
import { readAnalysisCache, writeAnalysisCache, AnalysisCacheRow } from '../db/analysisCache';

// Deliberately NOT 'maria-chen': fhir/client.test.ts (B2) already exercises
// Task create/replace against 'maria-chen', and Jest runs different test
// FILES in separate parallel workers — two suites racing create/delete
// against the same patient's Tasks in real HAPI produces genuine
// cross-suite flakiness (observed: one suite's Task briefly visible/counted
// in the other's assertions). A different demo patient sidesteps it
// entirely without serializing the whole run.
const PATIENT_ID = 'james-okafor';
const VALID_ID = 'Condition/james-okafor-copd';
const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';
const CARESYNC_TASK_TAG_CODE = 'ai-generated-task';

// Full four-agent stub (S3 acceptance) — no live OpenAI call. Mirrors the
// shape orchestrate() itself yields: token+result for risk, careGap, sdoh,
// then the action planner. Risk carries one valid + one fabricated flag;
// careGap and sdoh each carry one valid item; the action planner carries one
// task citing a valid id (+ a dueInDays) and one task citing ONLY a
// fabricated id, so the route's GD11 gate has something real to drop at
// every shape (single-id AND list-id).
async function* stubOrchestrate(): AsyncIterable<AgentEvent> {
  yield { type: 'token', agentId: 'risk', text: 'Reviewing chart...' };
  const riskOutput: RiskOutput = {
    riskScore: 87,
    riskLevel: 'critical',
    flags: [
      { text: 'CHF diagnosis drives elevated readmission risk', fhirResourceId: VALID_ID, confidence: 0.5 },
      { text: 'hallucinated finding', fhirResourceId: 'Condition/does-not-exist', confidence: 0.5 },
    ],
    readmissionProbability: 0.7,
  };
  yield { type: 'result', agentId: 'risk', output: riskOutput };

  yield { type: 'token', agentId: 'careGap', text: 'Checking preventive care gaps...' };
  const careGapOutput: CareGapOutput = {
    gaps: [{ gapType: 'screening', description: 'Overdue HbA1c recheck', urgency: 'high', fhirResourceId: VALID_ID, confidence: 0.5 }],
  };
  yield { type: 'result', agentId: 'careGap', output: careGapOutput };

  yield { type: 'token', agentId: 'sdoh', text: 'Screening for social barriers...' };
  const sdohOutput: SdohOutput = {
    barriers: [
      { domain: 'transportation', finding: 'No reliable transportation to follow-up visits', severity: 'moderate', fhirResourceId: VALID_ID, confidence: 0.5 },
    ],
    referralsNeeded: ['transportation-assistance'],
  };
  yield { type: 'result', agentId: 'sdoh', output: sdohOutput };

  yield { type: 'token', agentId: 'actionPlanner', text: 'Synthesizing worklist...' };
  const actionPlannerOutput: ActionPlannerOutput = {
    tasks: [
      { title: 'Schedule cardiology follow-up', description: 'Address CHF readmission risk', priority: 'high', domain: 'clinical', dueInDays: 5, fhirResources: [VALID_ID], confidence: 0.5 },
      { title: 'Bogus outreach task', description: 'Cites nothing real', priority: 'medium', domain: 'sdoh', fhirResources: ['Condition/does-not-exist'], confidence: 0.5 },
    ],
  };
  yield { type: 'result', agentId: 'actionPlanner', output: actionPlannerOutput };
}

async function* throwingAgent(): AsyncIterable<AgentEvent> {
  yield { type: 'token', agentId: 'risk', text: 'Reviewing the full chart in detail before reaching any conclusion at all here...' };
  throw new Error('OpenAI request failed');
}

// Interleaves risk and careGap narration BEFORE either agent's result, so a
// shared (non-per-agent) buffer would let careGap's fabricated mention leak
// into what looks like risk's stream (or vice versa). Each agent's own
// result flushes only that agent's buffer.
async function* interleavedNarrationAgent(): AsyncIterable<AgentEvent> {
  yield { type: 'token', agentId: 'risk', text: `CHF diagnosis (${VALID_ID}) drives this risk. ` };
  yield { type: 'token', agentId: 'careGap', text: 'Notably, Observation/does-not-exist supports this gap. ' };
  const riskOutput: RiskOutput = { riskScore: 40, riskLevel: 'moderate', flags: [], readmissionProbability: 0.3 };
  yield { type: 'result', agentId: 'risk', output: riskOutput };
  const careGapOutput: CareGapOutput = { gaps: [] };
  yield { type: 'result', agentId: 'careGap', output: careGapOutput };
  const sdohOutput: SdohOutput = { barriers: [], referralsNeeded: [] };
  yield { type: 'result', agentId: 'sdoh', output: sdohOutput };
  const actionPlannerOutput: ActionPlannerOutput = { tasks: [] };
  yield { type: 'result', agentId: 'actionPlanner', output: actionPlannerOutput };
}

function twoValidTasksAgent(): () => AsyncIterable<AgentEvent> {
  return async function* () {
    yield { type: 'token', agentId: 'actionPlanner', text: 'Planning...' };
    const output: ActionPlannerOutput = {
      tasks: [
        { title: 'Run 1 Task A', description: 'first', priority: 'high', domain: 'clinical', fhirResources: [VALID_ID], confidence: 0.5 },
        { title: 'Run 1 Task B', description: 'second', priority: 'medium', domain: 'clinical', fhirResources: [VALID_ID], confidence: 0.5 },
      ],
    };
    yield { type: 'result', agentId: 'actionPlanner', output };
  };
}

function oneValidTaskAgent(): () => AsyncIterable<AgentEvent> {
  return async function* () {
    yield { type: 'token', agentId: 'actionPlanner', text: 'Planning...' };
    const output: ActionPlannerOutput = {
      tasks: [{ title: 'Run 2 Task C', description: 'only survivor', priority: 'high', domain: 'clinical', fhirResources: [VALID_ID], confidence: 0.5 }],
    };
    yield { type: 'result', agentId: 'actionPlanner', output };
  };
}

function buildApp(
  db: Database.Database,
  stub: (bundle: any) => AsyncIterable<AgentEvent>,
  readCache?: (db: Database.Database, patientId: string) => AnalysisCacheRow | null
) {
  const app = express();
  app.use(express.json());
  const fhirService = new FhirReadService(db, FHIR_BASE_URL);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/patients', createAnalysisRouter(fhirService, stub, db, readCache));
  return app;
}

// Mirrors exactly what stubOrchestrate's SURVIVING (post-citation-gate) output
// looks like once run through the live route — used to seed a cache row that
// looks like real prior output (GD2), not an invented shape, so replay tests
// exercise the same resultJson a live run would actually persist. `narration`
// per agent matches the safe (emitted) token text stubOrchestrate streams —
// each is a single short chunk that flushes whole through the GD11 buffer.
function cachedResultFromStub(taskId: string): AnalysisResultJson {
  return {
    risk: {
      narration: 'Reviewing chart...',
      findings: [{ text: 'CHF diagnosis drives elevated readmission risk', fhirResourceId: VALID_ID }],
      complete: { riskScore: 87, riskLevel: 'critical', readmissionProbability: 0.7, findingCount: 1, droppedCount: 1 },
    },
    careGap: {
      narration: 'Checking preventive care gaps...',
      findings: [{ gapType: 'screening', description: 'Overdue HbA1c recheck', urgency: 'high', fhirResourceId: VALID_ID }],
      complete: { findingCount: 1, droppedCount: 0 },
    },
    sdoh: {
      narration: 'Screening for social barriers...',
      findings: [
        { domain: 'transportation', finding: 'No reliable transportation to follow-up visits', severity: 'moderate', fhirResourceId: VALID_ID },
      ],
      complete: { findingCount: 1, droppedCount: 0, referralsNeeded: ['transportation-assistance'] },
    },
    actionPlanner: {
      narration: 'Synthesizing worklist...',
      tasks: [
        {
          id: taskId,
          reference: `Task/${taskId}`,
          title: 'Schedule cardiology follow-up',
          description: 'Address CHF readmission risk',
          priority: 'high',
          domain: 'clinical',
          dueInDays: 5,
          fhirResources: [VALID_ID],
          confidence: 0.5,
        },
      ],
      complete: { findingCount: 1, droppedCount: 1 },
    },
  };
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

// Reads owned (ai-generated-task-tagged) Tasks for the patient straight from
// HAPI via $everything — mirrors replacePatientTasks's own read strategy
// (client.ts notes the Task search endpoint lags behind writes on this
// instance, while $everything reflects a just-finished create/delete burst
// immediately), so this verification is checking the same ground truth the
// production code relies on.
async function fetchOwnedTasks(patientId: string): Promise<any[]> {
  const res = await fetch(`${FHIR_BASE_URL}/Patient/${patientId}/$everything`);
  const bundle = (await res.json()) as any;
  return (bundle.entry ?? [])
    .map((e: any) => e.resource)
    .filter(
      (r: any) => r.resourceType === 'Task' && (r.meta?.tag ?? []).some((t: any) => t.code === CARESYNC_TASK_TAG_CODE)
    );
}

async function deleteTask(id: string): Promise<void> {
  await fetch(`${FHIR_BASE_URL}/Task/${id}`, { method: 'DELETE' });
}

describe('analysis routes (B3 — orchestrated SSE stream + citation validation gate, GD11)', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
    app = buildApp(db, stubOrchestrate);
  });

  // Deliberately no blanket afterEach hitting HAPI: only the tests that
  // actually create Tasks clean up (by id, directly — no need for the
  // heavier replacePatientTasks $everything read+guard) — cheap on the
  // shared real local HAPI instance, and safe alongside other suites (e.g.
  // patients.test.ts) that read the same demo patient concurrently.

  it('streams findings/complete per agent, gates the action planner Task creation, and audits the read', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');

    const res = await request(app).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const events = parseSse(res.text);

    // --- findings, tagged by agentId, fabricated flag never present anywhere ---
    const findingEvents = events.filter((e) => e.event === 'finding');
    expect(findingEvents.map((e) => e.data.agentId).sort()).toEqual(['careGap', 'risk', 'sdoh']);
    expect(findingEvents.find((e) => e.data.agentId === 'risk')?.data).toMatchObject({ fhirResourceId: VALID_ID });
    expect(findingEvents.find((e) => e.data.agentId === 'careGap')?.data).toMatchObject({ gapType: 'screening', fhirResourceId: VALID_ID });
    expect(findingEvents.find((e) => e.data.agentId === 'sdoh')?.data).toMatchObject({ domain: 'transportation', fhirResourceId: VALID_ID });
    expect(res.text).not.toContain('hallucinated finding');
    expect(res.text).not.toContain('does-not-exist');

    // --- one complete per agent (4 total) ---
    const completeEvents = events.filter((e) => e.event === 'complete');
    expect(completeEvents.map((e) => e.data.agentId).sort()).toEqual(['actionPlanner', 'careGap', 'risk', 'sdoh']);
    expect(completeEvents.find((e) => e.data.agentId === 'risk')!.data).toMatchObject({
      riskScore: 87,
      riskLevel: 'critical',
      readmissionProbability: 0.7,
      findingCount: 1,
      droppedCount: 1,
    });
    expect(completeEvents.find((e) => e.data.agentId === 'careGap')!.data).toMatchObject({ findingCount: 1, droppedCount: 0 });
    expect(completeEvents.find((e) => e.data.agentId === 'sdoh')!.data).toMatchObject({ findingCount: 1, droppedCount: 0 });
    expect(completeEvents.find((e) => e.data.agentId === 'actionPlanner')!.data).toMatchObject({ findingCount: 1, droppedCount: 1 });

    // --- only the validly-cited task becomes a Task; the all-fabricated one never does ---
    const taskEvents = events.filter((e) => e.event === 'task');
    expect(taskEvents).toHaveLength(1);
    expect(taskEvents[0].data).toMatchObject({
      agentId: 'actionPlanner',
      title: 'Schedule cardiology follow-up',
      fhirResources: [VALID_ID],
    });

    const owned = await fetchOwnedTasks(PATIENT_ID);
    expect(owned).toHaveLength(1);
    expect(owned[0].description).toContain('Schedule cardiology follow-up');
    expect(owned[0].description).not.toContain('Bogus outreach task');

    // --- exactly one `done`, and it's the last event ---
    const doneEvents = events.filter((e) => e.event === 'done');
    expect(doneEvents).toHaveLength(1);
    expect(events[events.length - 1].event).toBe('done');

    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    const readRows = rows.filter((r) => r.action === 'read' && r.fhir_resource === `Patient/${PATIENT_ID}/$everything`);
    expect(readRows).toHaveLength(1);
    expect(readRows[0]).toMatchObject({ actor: expect.any(String), outcome: 'success' });

    await deleteTask(taskEvents[0].data.id);
  });

  it('creates a real, resolvable HAPI Task tagged ai-generated-task, carrying the surviving citation in its SSE payload', async () => {
    const token = await loginAs(app, 'coordinator@caresync.demo');

    const res = await request(app).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${token}`);

    const events = parseSse(res.text);
    const taskEvent = events.find((e) => e.event === 'task');
    expect(taskEvent).toBeDefined();
    expect(taskEvent!.data.fhirResources).toEqual([VALID_ID]);

    const taskRes = await fetch(`${FHIR_BASE_URL}/Task/${taskEvent!.data.id}`);
    expect(taskRes.status).toBe(200);
    const task = (await taskRes.json()) as any;
    expect(task.resourceType).toBe('Task');
    expect((task.meta?.tag ?? []).some((t: any) => t.code === CARESYNC_TASK_TAG_CODE)).toBe(true);
    expect(task.description).toContain('Schedule cardiology follow-up');

    await deleteTask(taskEvent!.data.id);
  });

  it('leaves only the second run’s Tasks in HAPI after calling the route twice (no dupes)', async () => {
    // S4 A2: a default (non-`?live=1`) POST now serves a cache replay once a
    // row exists, so a second bare POST after run1 would never reach
    // replacePatientTasks at all. `?live=1` forces both runs live — which is
    // exactly the real-orchestration path this test exists to verify (B2's
    // replace guarantee) — independent of caching.
    const run1App = buildApp(db, twoValidTasksAgent());
    const token1 = await loginAs(run1App, 'coordinator@caresync.demo');
    await request(run1App).post(`/api/patients/${PATIENT_ID}/analysis?live=1`).set('Authorization', `Bearer ${token1}`);

    const afterRun1 = await fetchOwnedTasks(PATIENT_ID);
    expect(afterRun1).toHaveLength(2);

    const run2App = buildApp(db, oneValidTaskAgent());
    const token2 = await loginAs(run2App, 'coordinator@caresync.demo');
    await request(run2App).post(`/api/patients/${PATIENT_ID}/analysis?live=1`).set('Authorization', `Bearer ${token2}`);

    const afterRun2 = await fetchOwnedTasks(PATIENT_ID);
    expect(afterRun2).toHaveLength(1);
    expect(afterRun2[0].description).toContain('Run 2 Task C');

    // Cleanup for this test's own extra Task, on top of the afterEach hook.
    await Promise.all(afterRun2.map((t: any) => deleteTask(t.id)));
  });

  it('emits an error event and ends the stream cleanly if an agent throws mid-stream, with no complete/done', async () => {
    const throwingApp = buildApp(db, throwingAgent);
    const token = await loginAs(throwingApp, 'coordinator@caresync.demo');

    const res = await request(throwingApp).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const events = parseSse(res.text);
    expect(events.find((e) => e.event === 'error')).toBeDefined();
    expect(events.find((e) => e.event === 'complete')).toBeUndefined();
    expect(events.find((e) => e.event === 'done')).toBeUndefined();
  });

  it('redacts a fabricated citation in one agent’s narration without touching another agent’s valid citation (per-agent buffer isolation)', async () => {
    const narrationApp = buildApp(db, interleavedNarrationAgent);
    const token = await loginAs(narrationApp, 'coordinator@caresync.demo');

    const res = await request(narrationApp).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${token}`);

    const events = parseSse(res.text);
    const riskToken = events.find((e) => e.event === 'token' && e.data.agentId === 'risk');
    const careGapToken = events.find((e) => e.event === 'token' && e.data.agentId === 'careGap');

    expect(riskToken!.data.text).toContain(VALID_ID);
    expect(careGapToken!.data.text).not.toContain('does-not-exist');
    expect(careGapToken!.data.text).toContain('[unverified citation removed]');
    expect(res.text).not.toContain('does-not-exist');
  });

  it('denies a Social Worker (no clinical scope) before streaming', async () => {
    const token = await loginAs(app, 'socialworker@caresync.demo');

    const res = await request(app).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('requires auth', async () => {
    const res = await request(app).post(`/api/patients/${PATIENT_ID}/analysis`);
    expect(res.status).toBe(401);
  });
});

describe('analysis routes — cache-aware live/replay (S4 A2)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    seedDemoUsers(db);
  });

  it('(a) replays a seeded cache row with zero agent invocations, in the same phased agentId order as a live run', async () => {
    const orchestratorSpy = jest.fn(stubOrchestrate);
    const cachedApp = buildApp(db, orchestratorSpy);
    writeAnalysisCache(db, {
      patientId: PATIENT_ID,
      resultJson: cachedResultFromStub('cached-task-1'),
      modelVersion: 'gpt-5.5',
      createdTs: '2020-01-01T00:00:00.000Z',
    });

    const token = await loginAs(cachedApp, 'coordinator@caresync.demo');
    const res = await request(cachedApp).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(orchestratorSpy).not.toHaveBeenCalled();

    const events = parseSse(res.text);
    // Same phased order a live run produces: each agent narrates (a `token`
    // event), then its own finding(s), then its own complete; actionPlanner
    // last (token → task → complete), ending in `done` — risk, careGap,
    // sdoh, actionPlanner. The `token` frames are part of the replayed
    // sequence now (narration parity, S4 C2/GD2), not filtered out.
    expect(events.map((e) => [e.event, e.data.agentId ?? null])).toEqual([
      ['token', 'risk'],
      ['finding', 'risk'],
      ['complete', 'risk'],
      ['token', 'careGap'],
      ['finding', 'careGap'],
      ['complete', 'careGap'],
      ['token', 'sdoh'],
      ['finding', 'sdoh'],
      ['complete', 'sdoh'],
      ['token', 'actionPlanner'],
      ['task', 'actionPlanner'],
      ['complete', 'actionPlanner'],
      ['done', null],
    ]);
    expect(events.find((e) => e.event === 'task')!.data).toMatchObject({
      id: 'cached-task-1',
      title: 'Schedule cardiology follow-up',
    });
    // Replayed token payload is byte-identical in shape to a live one
    // (`{ agentId, text }`) and carries the stored safe narration.
    expect(events.find((e) => e.event === 'token' && e.data.agentId === 'risk')!.data).toEqual({
      agentId: 'risk',
      text: 'Reviewing chart...',
    });

    // Replay must not mutate the cache row it just served.
    const row = readAnalysisCache(db, PATIENT_ID);
    expect(row!.createdTs).toBe('2020-01-01T00:00:00.000Z');

    // A successful replay is still a clinical read and must be audited,
    // same as a live getPatientBundle read — the replay path skips HAPI but
    // must not skip the audit trail S8's governance dashboard depends on.
    const auditRows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    const successRows = auditRows.filter(
      (r) => r.action === 'read' && r.fhir_resource === `Patient/${PATIENT_ID}/$everything` && r.outcome === 'success'
    );
    expect(successRows).toHaveLength(1);
    expect(successRows[0]).toMatchObject({ actor: expect.any(String), outcome: 'success' });
  });

  it('(d) denies a Social Worker (no clinical scope) on the cache-replay path too, and audits the denial', async () => {
    const orchestratorSpy = jest.fn(stubOrchestrate);
    const cachedApp = buildApp(db, orchestratorSpy);
    writeAnalysisCache(db, {
      patientId: PATIENT_ID,
      resultJson: cachedResultFromStub('cached-task-1'),
      modelVersion: 'gpt-5.5',
      createdTs: '2020-01-01T00:00:00.000Z',
    });

    const token = await loginAs(cachedApp, 'socialworker@caresync.demo');
    const res = await request(cachedApp).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${token}`);

    // Same 403 shape the live path already produces for this role (see the
    // B3 describe block's "denies a Social Worker" test) — the replay path
    // must not leak cached clinical findings just because someone else
    // triggered a live run for this patient earlier.
    expect(res.status).toBe(403);
    expect(orchestratorSpy).not.toHaveBeenCalled();

    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    const denialRows = rows.filter((r) => r.action === 'read' && r.fhir_resource === `Patient/${PATIENT_ID}/$everything` && r.outcome === 'denied');
    expect(denialRows).toHaveLength(1);
    expect(denialRows[0]).toMatchObject({ actor: expect.any(String), outcome: 'denied' });

    // Cache row itself must be untouched by the denial.
    const row = readAnalysisCache(db, PATIENT_ID);
    expect(row!.createdTs).toBe('2020-01-01T00:00:00.000Z');
  });

  it('(e) emits an `error` SSE event — not a hang — if a malformed cached row fails to replay', async () => {
    const orchestratorSpy = jest.fn(stubOrchestrate);
    // Injected in place of the real readAnalysisCache: returns a row whose
    // resultJson is missing every expected agent key, so replayCachedAnalysis
    // throws reading `result.risk.findings`. Mirrors a legacy/corrupted row
    // shape without needing to hand-corrupt real SQLite storage.
    const brokenReadCache = jest.fn(
      (): AnalysisCacheRow => ({
        patientId: PATIENT_ID,
        resultJson: {} as unknown,
        modelVersion: 'gpt-5.5',
        createdTs: '2020-01-01T00:00:00.000Z',
      })
    );
    const brokenApp = buildApp(db, orchestratorSpy, brokenReadCache);

    const token = await loginAs(brokenApp, 'coordinator@caresync.demo');
    const res = await request(brokenApp).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(orchestratorSpy).not.toHaveBeenCalled();

    const events = parseSse(res.text);
    expect(events.find((e) => e.event === 'error')).toBeDefined();
    // Same convention the live path's error boundary already establishes:
    // no `done` fires on a failed run — its absence is itself the signal.
    expect(events.find((e) => e.event === 'done')).toBeUndefined();
  });

  it('(b) ?live=1 always invokes the orchestrator and overwrites the cache row, even when one already exists', async () => {
    const orchestratorSpy = jest.fn(stubOrchestrate);
    const liveApp = buildApp(db, orchestratorSpy);
    writeAnalysisCache(db, {
      patientId: PATIENT_ID,
      resultJson: cachedResultFromStub('stale-task-id'),
      modelVersion: 'stale-model',
      createdTs: '2020-01-01T00:00:00.000Z',
    });

    const token = await loginAs(liveApp, 'coordinator@caresync.demo');
    const res = await request(liveApp)
      .post(`/api/patients/${PATIENT_ID}/analysis?live=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(orchestratorSpy).toHaveBeenCalledTimes(1);

    const events = parseSse(res.text);
    const taskEvent = events.find((e) => e.event === 'task');
    expect(taskEvent).toBeDefined();
    expect(taskEvent!.data.id).not.toBe('stale-task-id');

    const row = readAnalysisCache(db, PATIENT_ID);
    expect(row).not.toBeNull();
    expect(row!.modelVersion).toBe('gpt-5.5');
    expect(row!.createdTs).not.toBe('2020-01-01T00:00:00.000Z');
    const resultJson = row!.resultJson as AnalysisResultJson;
    expect(resultJson.actionPlanner.tasks).toHaveLength(1);
    expect(resultJson.actionPlanner.tasks[0].id).toBe(taskEvent!.data.id);

    await deleteTask(taskEvent!.data.id);
  });

  it('(c) cold cache: default request falls back to exactly one live run and populates the cache row', async () => {
    const orchestratorSpy = jest.fn(stubOrchestrate);
    const coldApp = buildApp(db, orchestratorSpy);
    expect(readAnalysisCache(db, PATIENT_ID)).toBeNull();

    const token = await loginAs(coldApp, 'coordinator@caresync.demo');
    const res = await request(coldApp).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(orchestratorSpy).toHaveBeenCalledTimes(1);

    const row = readAnalysisCache(db, PATIENT_ID);
    expect(row).not.toBeNull();

    const events = parseSse(res.text);
    const taskEvent = events.find((e) => e.event === 'task');
    expect(taskEvent).toBeDefined();

    await deleteTask(taskEvent!.data.id);
  });

  it('(f) captures live narration into the cache and replays it as byte-identical `token` events', async () => {
    // Live run (?live=1) first — capture the token events it emits and let it
    // persist the row — then a default request replays that row. The token
    // events must match (agentId + text), proving the reasoning prose shows
    // in the feed on a replay exactly as it did live (C2 / GD2), not a blank
    // narration.
    const liveApp = buildApp(db, stubOrchestrate);
    const liveToken = await loginAs(liveApp, 'coordinator@caresync.demo');
    const liveRes = await request(liveApp)
      .post(`/api/patients/${PATIENT_ID}/analysis?live=1`)
      .set('Authorization', `Bearer ${liveToken}`);
    const liveTokens = parseSse(liveRes.text)
      .filter((e) => e.event === 'token')
      .map((e) => e.data);

    // Sanity: the live run really did stream per-agent narration.
    expect(liveTokens.length).toBeGreaterThan(0);
    expect(liveTokens.map((t) => t.agentId).sort()).toEqual(['actionPlanner', 'careGap', 'risk', 'sdoh']);

    // The persisted row captured that same safe narration per agent.
    const row = readAnalysisCache(db, PATIENT_ID);
    const stored = row!.resultJson as AnalysisResultJson;
    expect(stored.risk.narration).toBe('Reviewing chart...');
    expect(stored.careGap.narration).toBe('Checking preventive care gaps...');
    expect(stored.sdoh.narration).toBe('Screening for social barriers...');
    expect(stored.actionPlanner.narration).toBe('Synthesizing worklist...');

    // Replay (default request) — its token events are identical in shape and
    // content to the live ones (per agent; replay coalesces each agent's
    // narration into one frame, which is what the live stub emits too here).
    const replayApp = buildApp(db, stubOrchestrate);
    const replayToken = await loginAs(replayApp, 'coordinator@caresync.demo');
    const replayRes = await request(replayApp).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${replayToken}`);
    const replayTokens = parseSse(replayRes.text)
      .filter((e) => e.event === 'token')
      .map((e) => e.data);

    expect(replayTokens).toEqual(liveTokens);

    // Cleanup the Task the live run created (replay creates none).
    const liveTaskEvent = parseSse(liveRes.text).find((e) => e.event === 'task');
    await deleteTask(liveTaskEvent!.data.id);
  });

  it('(g) a cache-write failure does not sink an otherwise-successful run — `done` still fires', async () => {
    // writeCache is best-effort: the stream + HAPI Task writes already
    // succeeded by the time it runs, so a persistence throw must not flip the
    // run into the `error`/no-`done` path (which would hang the graph in
    // `synthesizing`). Inject a throwing writeCache and prove `done` fires,
    // no `error` event, and the real work (task creation) still happened.
    const orchestratorSpy = jest.fn(stubOrchestrate);
    const throwingWriteCache = jest.fn(() => {
      throw new Error('disk full');
    });
    const fhirService = new FhirReadService(db, FHIR_BASE_URL);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(db));
    app.use('/api/patients', createAnalysisRouter(fhirService, orchestratorSpy, db, undefined, throwingWriteCache));

    const token = await loginAs(app, 'coordinator@caresync.demo');
    const res = await request(app).post(`/api/patients/${PATIENT_ID}/analysis?live=1`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(throwingWriteCache).toHaveBeenCalledTimes(1);

    const events = parseSse(res.text);
    expect(events.find((e) => e.event === 'error')).toBeUndefined();
    expect(events.find((e) => e.event === 'done')).toBeDefined();
    expect(events[events.length - 1].event).toBe('done');

    const taskEvent = events.find((e) => e.event === 'task');
    expect(taskEvent).toBeDefined();
    await deleteTask(taskEvent!.data.id);
  });
});
