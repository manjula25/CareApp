import express, { Router } from 'express';
import { mapTaskResource } from '../fhir/client';
import { requireAuth } from '../middleware/auth';
import { EventHub } from './eventHub';
import { writeSseEvent } from './analysis';

/**
 * S6 A3 — the client relay: `GET /` (mounted at `/api/events`, auth'd) opens
 * a long-lived SSE connection registered in the hub under the caller's user
 * id. Uses `fetch` + a stream reader on the client (see api/client.ts), not
 * `EventSource` — `EventSource` can't send an `Authorization` header, and
 * this route is bearer-gated like every other route.
 */
export function createEventsRouter(hub: EventHub): Router {
  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // Opens the stream immediately — some proxies/clients hold response
    // headers until the first byte of body arrives.
    writeSseEvent(res, 'connected', {});

    hub.register(req.auth!.id, res);
    req.on('close', () => {
      hub.unregister(req.auth!.id, res);
    });
  });

  return router;
}

/**
 * S6 A3 — HAPI's webhook target (mounted at `/api/fhir`, NOT auth'd — HAPI
 * calls this server-to-server and has no bearer-token support to configure
 * into the stock image; same honest-staging class as the SMART note in
 * plan.md §3, a POC-scoped tradeoff, not something to carry into a real
 * deployment).
 *
 * Route shape confirmed against the local instance (7.2.0): with
 * `channel.payload` set, HAPI does NOT always `POST` to the bare
 * `channel.endpoint`. It mimics the triggering FHIR interaction's own verb
 * (`PUT` for an update, `POST` for a create) at
 * `{endpoint}/{ResourceType}/{id}` — e.g. a Task update delivers as
 * `PUT /api/fhir/subscription-hook/Task/<id>`, not `POST
 * /api/fhir/subscription-hook`. `router.all` + a wildcard suffix matches
 * both that shape and the bare endpoint (belt and suspenders for any other
 * verb/shape HAPI might use); the resource's own `resourceType`/`id` come
 * from the JSON body regardless of what the URL suffix says, so the route
 * doesn't need to parse it.
 *
 * The Subscription (fhir/subscription.ts) is created with
 * `channel.payload: 'application/fhir+json'`, so the body IS the changed
 * Task resource — no re-read against HAPI needed. A dedicated JSON parser is
 * used here (rather than the app-wide `express.json()` in index.ts) because
 * HAPI sends `Content-Type: application/fhir+json`, which the default
 * `application/json`-only parser wouldn't recognize.
 */
export function createSubscriptionWebhookRouter(hub: EventHub): Router {
  const router = Router();
  router.use(express.json({ type: ['application/json', 'application/fhir+json'] }));

  router.all('/subscription-hook{/*splat}', (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (body?.resourceType === 'Task') {
      const task = mapTaskResource(body);
      // S6 C2 acceptance ("visible in logs/network"): the browser can't
      // observe this HAPI→API server-to-server call directly, so this is
      // the log line that makes a real Subscription firing observable.
      console.log(`[S6] Subscription fired: Task/${task.id} -> owner ${task.ownerId ?? '(none)'}`);
      if (task.ownerId) {
        hub.publish(task.ownerId, 'assignment', task);
      }
      // S7 B3 — cross-surface sync: every Task webhook fire, assigned or
      // not, also broadcasts to every connected client (unlike `assignment`
      // above, which stays owner-scoped) so any open view of that task
      // (e.g. PatientDetail) can live-update.
      hub.publishAll('task-updated', task);
    }
    res.status(200).end();
  });

  return router;
}
