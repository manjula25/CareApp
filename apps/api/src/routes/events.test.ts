import express from 'express';
import request from 'supertest';
import { Response } from 'express';
import { createEventsRouter, createSubscriptionWebhookRouter } from './events';
import { createEventHub } from './eventHub';

function buildApp(hub: ReturnType<typeof createEventHub>) {
  const app = express();
  app.use('/api/events', createEventsRouter(hub));
  app.use('/api/fhir', createSubscriptionWebhookRouter(hub));
  return app;
}

function fakeRes(): Response & { chunks: string[] } {
  const chunks: string[] = [];
  return { chunks, write: (chunk: string) => (chunks.push(chunk), true) } as unknown as Response & { chunks: string[] };
}

// The webhook body IS the changed Task resource (Subscription created with
// `channel.payload: 'application/fhir+json'` — see fhir/subscription.ts).
// Confirmed against the local instance: HAPI delivers this as a `PUT` to
// `{endpoint}/Task/<id>` (mimicking the triggering interaction's own verb
// and path), NOT a `POST` to the bare endpoint — the first test below uses
// that real shape; the second checks the route also accepts the bare-POST
// shape (belt and suspenders). No live HAPI needed for this unit-level test
// of the webhook→relay path; C2 covers HAPI actually firing.
describe('events routes — webhook to relay', () => {
  let hub: ReturnType<typeof createEventHub>;
  let app: express.Express;

  beforeEach(() => {
    hub = createEventHub();
    app = buildApp(hub);
  });

  it('GET /api/events requires auth', async () => {
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(401);
  });

  it('parses a PUT delivery at {endpoint}/Task/<id> (HAPI\'s real update shape) and relays it to its owner', async () => {
    const coordinatorId = 'coordinator-1';
    const pushedTask = {
      resourceType: 'Task',
      id: 'task-123',
      status: 'requested',
      intent: 'order',
      description: 'Medication reconciliation follow-up',
      for: { reference: 'Patient/maria-chen' },
      owner: { identifier: { system: 'https://caresync.demo/fhir/coordinators', value: coordinatorId } },
    };

    const coordinatorConn = fakeRes();
    const otherConn = fakeRes();
    hub.register(coordinatorId, coordinatorConn);
    hub.register('someone-else', otherConn);

    const res = await request(app)
      .put('/api/fhir/subscription-hook/Task/task-123')
      .set('Content-Type', 'application/fhir+json')
      .send(JSON.stringify(pushedTask));

    expect(res.status).toBe(200);
    expect(coordinatorConn.chunks.join('')).toContain('event: assignment');
    expect(coordinatorConn.chunks.join('')).toContain('task-123');
    expect(otherConn.chunks).toHaveLength(0);
  });

  it('also accepts a bare POST to the endpoint (e.g. a create delivery)', async () => {
    const coordinatorId = 'coordinator-2';
    const pushedTask = {
      resourceType: 'Task',
      id: 'task-789',
      status: 'requested',
      intent: 'order',
      description: 'Fresh SDOH referral',
      for: { reference: 'Patient/maria-chen' },
      owner: { identifier: { system: 'https://caresync.demo/fhir/coordinators', value: coordinatorId } },
    };
    const coordinatorConn = fakeRes();
    hub.register(coordinatorId, coordinatorConn);

    const res = await request(app)
      .post('/api/fhir/subscription-hook')
      .set('Content-Type', 'application/fhir+json')
      .send(JSON.stringify(pushedTask));

    expect(res.status).toBe(200);
    expect(coordinatorConn.chunks.join('')).toContain('event: assignment');
  });

  it('is a no-op when the pushed Task has no owner (unassigned Task changed)', async () => {
    const pushedTask = {
      resourceType: 'Task',
      id: 'task-456',
      status: 'requested',
      intent: 'order',
      description: 'Unassigned task',
      for: { reference: 'Patient/maria-chen' },
    };

    const res = await request(app)
      .post('/api/fhir/subscription-hook')
      .set('Content-Type', 'application/fhir+json')
      .send(JSON.stringify(pushedTask));

    expect(res.status).toBe(200);
  });
});
