# Changelog: S6 — Task assignment + real-time FHIR Subscription

**Type:** Feature

**Branch:** `feature/caresync-s6-realtime-assignment` (branched off `feature/caresync-s5-population-dashboard`)

**Date:** 2026-07-05

## Summary

Delivers the real-time loop (GD7). A Director assigns Maria's tasks to a specific Care Coordinator
via an audited `PATCH /api/tasks/:id/assign`, which updates `Task.owner` in HAPI. A real FHIR
**Subscription** (rest-hook on Task create/update, bootstrapped idempotently at API boot) fires to an
API webhook, which relays the change over an in-process SSE hub to the assigned Coordinator's
connected clients — the "My Patients" panel refetches and a toast notification appears, with no
manual refresh.

## Changes Made

### Backend — Task assignment (audited)

- **Before:** No way to assign a Task to a specific Coordinator; `Task.owner` was never written.
- **After:** `PATCH /api/tasks/:id/assign { coordinatorId }`, Director-scoped, updates the FHIR
  `Task.owner` via the S3 audited write client (`assignTask`). `Task.owner` is written as a **logical
  reference** (`{identifier:{system,value}}`), not a literal `Practitioner/{id}` reference — this POC
  seeds no `Practitioner` resources in HAPI, and HAPI rejects literal references it can't resolve.
  Denial audited before the read; success path does read-modify-PUT (preserving the full resource)
  and audits the write.
- **Files changed:** `apps/api/src/fhir/client.ts` (`assignTask`, `mapTaskResource`,
  `COORDINATOR_OWNER_IDENTIFIER_SYSTEM`), `apps/api/src/routes/tasks.ts`.

### Backend — FHIR Subscription bootstrap

- **Before:** No Subscription resource existed on HAPI; Task changes were invisible outside a poll.
- **After:** At boot, `ensureTaskSubscription` idempotently creates a HAPI `Subscription` (rest-hook,
  criteria `Task?` — bare `Task` is rejected by HAPI as error `HAPI-0014` — `payload:
  application/fhir+json`) pointing at our webhook, deduped on criteria + endpoint. Stock HAPI ships
  rest-hook delivery **off**; `docker-compose.yml` now sets
  `hapi.fhir.subscription.resthook_enabled: "true"`. The callback URL must be reachable *from the HAPI
  container*, not the host — `SUBSCRIPTION_CALLBACK_URL` defaults to
  `http://host.docker.internal:4000/...`.
- **Files changed:** `apps/api/src/fhir/subscription.ts` (new), `apps/api/src/index.ts`,
  `docker-compose.yml`.

### Backend — Webhook receiver + SSE relay hub

- **Before:** N/A — no path existed from a HAPI-side change to a connected client.
- **After:** `router.all('/subscription-hook{/*splat}', ...)` (not `router.post`) resolves the changed
  Task from the request body and fans it out over a new in-process `Map<userId, Response[]>` hub
  (`eventHub.ts`) to the affected Coordinator's `/api/events` connections (auth'd SSE, registered per
  user). Reuses the existing `writeSseEvent` helper from `routes/analysis.ts` for framing rather than
  re-authoring SSE plumbing.
  - **Real bug found and fixed during live verification, not assumed from the plan:** a rest-hook
    Subscription with `channel.payload` set does not `POST` to the bare `channel.endpoint`. HAPI
    mimics the triggering interaction's own verb and path — a Task update delivers as
    `PUT {endpoint}/Task/{id}`. The route's `router.all(...{/*splat})` match, plus reading the changed
    resource from the body (not the URL), handles this. HAPI was also observed to deliver a single
    update's hook twice in quick succession; the client de-dupes by toast message rather than the
    route de-duplicating server-side. Both behaviors are documented inline in `subscription.ts` /
    `events.ts` and in `verification.md` §3 — this took live investigation (temporary raw
    request-logging middleware on a disposable second API instance) to isolate.
- **Files changed:** `apps/api/src/routes/events.ts` (new), `apps/api/src/routes/eventHub.ts` (new),
  `apps/api/src/routes/analysis.ts` (`writeSseEvent` exported for reuse).

### Frontend — Live client update + notification

- **Before:** No client-side subscription to server-relayed events; assignment changes were invisible
  without a manual refresh.
- **After:** `subscribeToEvents` (`fetch`+stream reader, mirroring `streamAnalysis`'s pattern — not
  `EventSource`, which can't send the `Authorization` header this bearer-gated route requires)
  connects `AppShell` to `/api/events`. On a relayed `assignment` event for the current Coordinator,
  the `assigned-panel` query is invalidated (live-refetches "My Patients") and a toast notification
  appears, de-duplicated by message to absorb HAPI's observed double-delivery. No `M02` task queue
  exists yet (S7's job) — the live-updating surface today is `PatientPanel`/"My Patients" (W12).
- **Files changed:** `apps/web/src/api/client.ts` (`subscribeToEvents`), `apps/web/src/components/AppShell.tsx`.

### E2E — Real Subscription, not mocked

- **After:** `apps/web/e2e/coordinator-live-assignment.spec.ts` drives the actual HAPI Subscription
  end to end: Director assigns → real Subscription fires → webhook → SSE relay → Coordinator's panel
  updates + toast appears, all without a mock in the path.

## Files Modified

| File | Change Description |
|------|---------------------|
| `apps/api/src/fhir/client.ts` | `assignTask` (audited Task.owner update via logical reference), `mapTaskResource`, hoisted `DirectorOnlyError` |
| `apps/api/src/fhir/subscription.ts` | New — idempotent Subscription bootstrap at boot |
| `apps/api/src/fhir/subscription.test.ts` | New — Subscription resource + criteria/idempotency tests |
| `apps/api/src/index.ts` | Boot-time `ensureTaskSubscription` call, `/api/events` + webhook route registration |
| `apps/api/src/routes/tasks.ts` | `PATCH /api/tasks/:id/assign`, Director-scoped |
| `apps/api/src/routes/tasks.test.ts` | New — assignment API-boundary tests (owner round-trip, audit row, denial) |
| `apps/api/src/routes/events.ts` | New — webhook receiver (`router.all`, verb/path-agnostic) + `/api/events` SSE endpoint |
| `apps/api/src/routes/events.test.ts` | New — webhook→relay integration tests (PUT-suffix + bare-POST shapes, no-owner no-op) |
| `apps/api/src/routes/eventHub.ts` | New — in-process `Map<userId, Response[]>` SSE hub |
| `apps/api/src/routes/eventHub.test.ts` | New — hub register/unregister/publish tests |
| `apps/api/src/routes/analysis.ts` | `writeSseEvent` exported for reuse by `events.ts` |
| `apps/api/src/population/service.ts` | `DirectorOnlyError` re-exported from `fhir/client.ts` (dedup, no behavior change) |
| `apps/api/.env.example` | `SUBSCRIPTION_CALLBACK_URL` documented |
| `docker-compose.yml` | `hapi.fhir.subscription.resthook_enabled: "true"` |
| `apps/web/src/api/client.ts` | `subscribeToEvents` (fetch+stream SSE consumer) |
| `apps/web/src/api/client.test.ts` | New — `subscribeToEvents` frame-parsing tests |
| `apps/web/src/components/AppShell.tsx` | Live event subscription: toast + `assigned-panel` invalidation, coordinator-only |
| `apps/web/src/components/AppShell.test.tsx` | New — relayed-event → queue-invalidation + toast tests |
| `apps/web/e2e/coordinator-live-assignment.spec.ts` | New — real (unmocked) end-to-end Subscription flow |
| `docs/plans/caresync-ai/{implementation-plan,issues}.md` | S6 task/AC checkboxes corrected to done |
| `docs/plans/caresync-ai/{verification,review}.md` | S6 verification + code-review gates recorded (S5 rotated to `-s5`) |

## Commits

| Commit | Description |
|--------|-------------|
| `d75645e` | feat(S6): task assignment + real-time FHIR Subscription relay |
| `a281628` | docs(S6): verification-before-completion artifacts + checkbox closeout |
| `2b933b6` | docs(S6): two-axis code-review artifact (Standards + Spec) |

## Testing & Verification

**How to verify this works:**
- Bring up HAPI with rest-hook delivery on: `docker compose up` (uses the new
  `hapi.fhir.subscription.resthook_enabled` setting)
- `cd apps/api && npx jest --runInBand`
- `cd apps/web && npm test -- --run`
- `cd apps/web && npx playwright test` (drives the real Subscription — needs Docker HAPI +
  API:4000/Vite:5173)

**Test results (this session, 2026-07-05, fresh, re-confirmed before PR):** API **27 suites / 119
tests passed**, web **13 files / 116 tests passed**, both `tsc --noEmit` exit 0, both `lint` clean (0
errors; pre-existing warnings only, none in S6 files). E2E evidence (9/9, incl. the new live
Subscription spec) is recorded fresh in `docs/plans/caresync-ai/verification.md` §1 from the prior
session — not re-run here per that skill's guidance (no new UI-visible changes since).

## Notes

- **Real FHIR Subscription, not app-level SSE relabeled** (GD7) — HAPI's actual rest-hook delivery
  shape (verb/path-mimicking, occasional double-delivery) was discovered live, not assumed; documented
  in `subscription.ts`/`events.ts` doc comments and `verification.md` §3.
- **This slice's process differed from S4/S5's subagent-driven-development two-stage loop** — work
  started from a partially-implemented state already on disk from an earlier session, audited and
  completed directly rather than re-implemented via fresh subagent rounds. Disclosed in
  `verification.md` §4.
- **Non-blocking debt (from `review.md`):** `subscribeToEvents`'s SSE frame parser duplicates
  `streamAnalysis`'s decoding loop (extract a shared helper); `mapTaskResource`/`assignTask` lean on
  `any` for the raw FHIR Task. Spec note: "the Coordinator's queue updates live" is currently satisfied
  by the toast alone — the `assigned-panel` refetch is a visual no-op until S7's task queue exists to
  render ownership; this is the plan's own documented scope boundary, not a defect.
- **Evidence strength:** local mock / packaged UI — headless Playwright + Jest/Vitest against a local
  dev stack and disposable Docker HAPI, plus one round of genuine live-HAPI debugging for the
  Subscription delivery shape. Not target-environment or client-accepted.
- **PR base-branch note:** `main` does not yet contain S5 — PR #6 (S5) was merged into
  `feature/caresync-s4-agent-graph-cache` instead of `main`, apparently by mistake, breaking this
  repo's normal one-PR-per-slice-into-`main` pattern (PRs #3–#5). This branch's PR targets `main`
  directly and will bring in S5's changes together with S6's in one combined diff, catching `main` up
  to the current tip. User-confirmed choice, recorded here so it isn't mistaken for scope creep in
  future review.
