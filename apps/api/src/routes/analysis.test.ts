import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { migrate } from '../db';
import { seedDemoUsers, DEMO_PASSWORD } from '../db/seed';
import { createAuthRouter } from './auth';
import { createAnalysisRouter } from './analysis';
import { FhirReadService } from '../fhir/client';
import { AgentEvent, RiskOutput, CareGapOutput, SdohOutput, ActionPlannerOutput } from '../agents/agent';

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
      { text: 'CHF diagnosis drives elevated readmission risk', fhirResourceId: VALID_ID },
      { text: 'hallucinated finding', fhirResourceId: 'Condition/does-not-exist' },
    ],
    readmissionProbability: 0.7,
  };
  yield { type: 'result', agentId: 'risk', output: riskOutput };

  yield { type: 'token', agentId: 'careGap', text: 'Checking preventive care gaps...' };
  const careGapOutput: CareGapOutput = {
    gaps: [{ gapType: 'screening', description: 'Overdue HbA1c recheck', urgency: 'high', fhirResourceId: VALID_ID }],
  };
  yield { type: 'result', agentId: 'careGap', output: careGapOutput };

  yield { type: 'token', agentId: 'sdoh', text: 'Screening for social barriers...' };
  const sdohOutput: SdohOutput = {
    barriers: [
      { domain: 'transportation', finding: 'No reliable transportation to follow-up visits', severity: 'moderate', fhirResourceId: VALID_ID },
    ],
    referralsNeeded: ['transportation-assistance'],
  };
  yield { type: 'result', agentId: 'sdoh', output: sdohOutput };

  yield { type: 'token', agentId: 'actionPlanner', text: 'Synthesizing worklist...' };
  const actionPlannerOutput: ActionPlannerOutput = {
    tasks: [
      { title: 'Schedule cardiology follow-up', description: 'Address CHF readmission risk', priority: 'high', dueInDays: 5, fhirResources: [VALID_ID] },
      { title: 'Bogus outreach task', description: 'Cites nothing real', priority: 'medium', fhirResources: ['Condition/does-not-exist'] },
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
        { title: 'Run 1 Task A', description: 'first', priority: 'high', fhirResources: [VALID_ID] },
        { title: 'Run 1 Task B', description: 'second', priority: 'medium', fhirResources: [VALID_ID] },
      ],
    };
    yield { type: 'result', agentId: 'actionPlanner', output };
  };
}

function oneValidTaskAgent(): () => AsyncIterable<AgentEvent> {
  return async function* () {
    yield { type: 'token', agentId: 'actionPlanner', text: 'Planning...' };
    const output: ActionPlannerOutput = {
      tasks: [{ title: 'Run 2 Task C', description: 'only survivor', priority: 'high', fhirResources: [VALID_ID] }],
    };
    yield { type: 'result', agentId: 'actionPlanner', output };
  };
}

function buildApp(db: Database.Database, stub: (bundle: any) => AsyncIterable<AgentEvent>) {
  const app = express();
  app.use(express.json());
  const fhirService = new FhirReadService(db, FHIR_BASE_URL);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/patients', createAnalysisRouter(fhirService, stub));
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
    const run1App = buildApp(db, twoValidTasksAgent());
    const token1 = await loginAs(run1App, 'coordinator@caresync.demo');
    await request(run1App).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${token1}`);

    const afterRun1 = await fetchOwnedTasks(PATIENT_ID);
    expect(afterRun1).toHaveLength(2);

    const run2App = buildApp(db, oneValidTaskAgent());
    const token2 = await loginAs(run2App, 'coordinator@caresync.demo');
    await request(run2App).post(`/api/patients/${PATIENT_ID}/analysis`).set('Authorization', `Bearer ${token2}`);

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
