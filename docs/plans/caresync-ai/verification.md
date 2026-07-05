# Verification — CareSync AI, S6 (Task assignment + real-time FHIR Subscription)

> **PLAN_ID:** `caresync-ai` · **Slice:** S6 · **Date:** 2026-07-05
> **Stage:** Phase 5 (`verification-before-completion`), run on `feature/caresync-s6-realtime-assignment`
> (base `1c8c612` = last S5 commit, tip `d75645e`, 1 commit: `d75645e` A1+A2+A3+B1+C1+C2).
> Read `docs/plans/caresync-ai/implementation-plan.md` Iteration 6 and `docs/plans/caresync-ai/issues.md`
> S6 for the plan this verifies against — not re-derived here. Prior slice's verification preserved at
> `verification-s5.md`.

## 1. Fresh command evidence (this session, 2026-07-05)

All commands re-run fresh in this session against the live local stack (Docker HAPI FHIR healthy,
DB migrated/seeded, `GET /fhir/Patient?_summary=count` → `506`).

| Command | Result |
|---|---|
| `cd apps/api && npx jest --runInBand` | **27 suites / 119 tests passed** |
| `npm run test:web` | **13 files / 116 tests passed** |
| `cd apps/web && npx playwright test` (full suite, 6 workers) | **9/9 specs passed**, incl. the new `coordinator-live-assignment.spec.ts` |
| `cd apps/api && npx tsc --noEmit` | exit 0 |
| `cd apps/web && npx tsc --noEmit` | exit 0 |
| `npm run lint --workspace apps/api` | 0 errors, 13 pre-existing warnings (none in files this slice touched) |
| `npm run lint --workspace apps/web` | 0 errors, 4 pre-existing warnings (none in files this slice touched) |

**A genuinely live, non-mocked proof.** `coordinator-live-assignment.spec.ts` is not a simulated
webhook call — it logs a Coordinator into a real browser tab (holding an open `/api/events` SSE
connection), then a Director's `PATCH /api/tasks/:id/assign` updates the real FHIR Task in the
disposable HAPI container, HAPI's real rest-hook Subscription fires the API's real webhook, and the
test asserts the toast appears in the already-rendered tab **without a page reload or any further
test interaction**. This is the strongest evidence class this POC's E2E suite produces (packaged
UI + local HAPI, per CLAUDE.md's evidence-boundary rubric — see §6).

## 2. Definition-of-done check (S6 acceptance, `issues.md`)

All 4 acceptance bullets confirmed against the actual code and this session's live evidence.
Checkboxes in `issues.md` and `implementation-plan.md` Iteration 6 were stale (`[ ]` despite full
implementation) — corrected to `[x]` as part of this pass:

1. **A FHIR Subscription resource exists on HAPI with a rest-hook on Task changes** —
   `ensureTaskSubscription` (`fhir/subscription.ts`, A2) idempotently creates one at boot: `criteria:
   'Task?'`, `channel: {type: 'rest-hook', endpoint: SUBSCRIPTION_CALLBACK_URL, payload:
   'application/fhir+json'}`. Confirmed live: `GET /fhir/Subscription/<id>` → `status: 'active'`,
   correct criteria/channel, no `error` field.
2. **Assigning a task updates the FHIR Task and fires the Subscription to the API webhook (visible
   in logs/network)** — `assignTask` (A1) does a guarded read-modify-`PUT` of `Task.owner`, audited.
   The webhook handler (A3) logs `[S6] Subscription fired: Task/<id> -> owner <id>` on every real
   delivery — confirmed present in the dev server's console during manual verification and exercised
   live by the E2E spec.
3. **The webhook relays to the client over SSE/websocket; the Coordinator's queue updates live and
   shows a notification** — confirmed live end-to-end via the E2E spec: toast text `New task
   assigned: <title>` appears in the already-open tab within ~1–8s of the PATCH, no reload. *Scope
   note, not a gap:* "queue" in the acceptance text anticipates S7's `M02` task queue, which doesn't
   exist yet. The live-updating surface today is `PatientPanel` ("My Patients", W12) — its
   `assigned-panel` query is invalidated on the relayed event.
4. **API-boundary test for assignment; an integration test asserting the webhook→relay path
   delivers the update** — `apps/api/src/routes/tasks.test.ts` (Supertest vs real HAPI: assignment
   sets `Task.owner`, reflected on read-back, audit row written, 403 for non-director) and
   `apps/api/src/routes/events.test.ts` (the webhook→relay path, exercised at both delivery shapes
   HAPI actually uses — see §3).

No drift between what's claimed done and what the code does.

## 3. Spec-drift check (issues.md / implementation-plan.md vs. code)

- **`issues.md` S6 acceptance checkboxes and `implementation-plan.md` Iteration 6 A1/A2/A3/B1/C1/C2
  were unchecked** — all now `[x]`, matching the actual committed state (see §2 for the "queue"
  scope note added alongside).
- **Two implementation details the plan didn't (and couldn't) specify, discovered empirically against
  the real local HAPI and now documented in `implementation-plan.md` Iteration 6 inline:**
  - The plan's A3 wording ("`POST /api/fhir/subscription-hook`... resolves the changed Task") assumed
    a fixed `POST` to the bare endpoint and a re-read by id. Neither holds: with `channel.payload`
    set, HAPI delivers as `PUT {endpoint}/Task/{id}` (mimicking the triggering verb+path), and the
    POST/PUT body already **is** the changed Task resource — no re-read needed. The original
    `router.post('/subscription-hook', ...)` route matched none of HAPI's real requests and 404'd
    silently; this was invisible until a temporary raw request-logging middleware was added to the
    real dev server and a live assignment was driven through it. Fixed to
    `router.all('/subscription-hook{/*splat}', ...)`, parsing `resourceType`/`id` from the body.
  - HAPI has been observed to deliver a single Task update's rest-hook **twice** in quick succession.
    Rather than attempt server-side de-duplication (which would need to reason about delivery
    identity HAPI doesn't expose), the client (`AppShell`, B1) skips showing a second toast with the
    same message — simpler and sufficient for this POC's single-connection demo flow.
- **Stock HAPI ships rest-hook delivery OFF and the Docker-vs-host callback URL is a real trap** —
  both fixed and documented: `docker-compose.yml` sets `hapi.fhir.subscription.resthook_enabled:
  "true"`; `SUBSCRIPTION_CALLBACK_URL` defaults to `host.docker.internal` (reachable from *inside*
  the HAPI container), not `localhost`.
- **`EventSource` was ruled out before coding, not discovered as a bug** — the plan's B1 wording said
  "Subscribe to `/api/events`" without specifying the transport; `EventSource` can't send the
  `Authorization` header this bearer-gated route requires, so `subscribeToEvents` (client.ts) reuses
  `streamAnalysis`'s existing `fetch` + stream-reader pattern instead. No rework needed because this
  was decided during plan review, before Phase B was written.
- **A1's `Task.owner` shape** — the plan didn't specify how to reference a Coordinator with no
  Practitioner resources in HAPI. Resolved with a *logical* reference
  (`{identifier:{system,value}}`) rather than a literal `Practitioner/{id}` reference, which HAPI
  rejects for a resource it can't resolve (confirmed empirically: HAPI-1094 "not found"). Documented
  in `fhir/client.ts`'s `COORDINATOR_OWNER_IDENTIFIER_SYSTEM` comment.
- Iteration 7+ (S7–S9) content already drafted in `implementation-plan.md`, per prior slices'
  verifications — not touched by this pass, still out of scope for S6.

## 4. Review pass (ahead of the formal `code-review` skill)

This slice's process differed from S4/S5's subagent-driven two-stage implementer/reviewer loop: work
started from an already-partially-implemented state (a prior session/agent had written `tasks.ts`,
`subscription.ts`, `eventHub.test.ts`, and partial `client.ts`/`analysis.ts`/`population/service.ts`
diffs in a red-TDD state), which was audited task-by-task against the plan rather than re-implemented,
then completed (`eventHub.ts`, `events.ts`, the `index.ts` wiring, the frontend) and driven through
real, live verification rather than a second reviewer subagent re-reading the diff.

- **A1 (assignment endpoint)** — audited the inherited code: guard-then-write-then-audit shape
  correctly mirrors `createTask`'s pattern; `DirectorOnlyError` was correctly extracted from
  `population/service.ts` into `fhir/client.ts` as a shared class (avoiding two parallel Director-only
  error types) rather than duplicated. No changes needed.
- **A2 (Subscription bootstrap)** — audited: idempotency search uses `Cache-Control: no-cache`
  (documented as load-bearing against a real HAPI search-caching quirk); the `docker-compose.yml`
  `resthook_enabled` fix was already in place. No changes needed.
- **A3 (webhook + relay)** — this is where the real defect was: the route shape was wrong (see §3).
  Found via empirical investigation (raw request logging on a disposable second server instance),
  not by re-reading the diff — this class of bug (a real third-party server's actual wire behavior
  differing from the natural reading of its own spec) is exactly the kind that a code-only review
  would not have caught. Fixed, and both the real delivery shape and the bare-POST fallback are now
  covered by `events.test.ts`.
- **B1 (client + toast)** — one real bug found running the actual Vite dev server (not caught by
  Vitest): `import { subscribeToEvents, AssignedTaskEvent } from '../api/client'` mixed a type-only
  import into a value import, which Vite's per-file esbuild transform failed to elide at runtime
  (`SyntaxError: does not provide an export named 'AssignedTaskEvent'`) even though Vitest's
  transform tolerated it. Fixed to `import type`. This is the exact class of bug
  `frontend-e2e-verification`'s "drive a real browser" requirement exists to catch.
- **E2E spec itself** — two bugs in the spec, not the product, found and fixed: (1) Playwright's
  `request` fixture resolves relative paths against `use.baseURL` (the **web** dev server, :5173),
  not the API (:4000) — direct backend calls needed an absolute URL. (2) HAPI does not create a new
  resource version (and therefore never fires the Subscription) for a `PUT` whose content is
  unchanged from the current version — a re-run of the spec against the same disposable HAPI would
  silently no-op if the Task was already assigned to the same coordinator from a prior run. Fixed by
  resetting the Task's owner to a placeholder value immediately before the assignment under test.

The formal `code-review` skill (Standards + Spec axes over the full branch diff since `main`) is the
next gate and is not pre-empted here.

## 5. Domain-term documentation check

New domain terms introduced by S6 — **FHIR Subscription / rest-hook** (`fhir/subscription.ts`),
**assignment** as a `Task.owner` logical-reference write (`fhir/client.ts`'s `assignTask` +
`COORDINATOR_OWNER_IDENTIFIER_SYSTEM`), and the **event hub / webhook relay** (`routes/eventHub.ts`,
`routes/events.ts`) — are documented inline via module/function doc comments, consistent with the
"Domain rule:"/"ponytail:" annotation convention already established in `implementation-plan.md` and
used by S2–S5. `docs/agents/domain.md` still doesn't exist — the same pre-existing, deferred gap
noted in every prior slice's verification, unchanged by S6.

## 6. Evidence-boundary labeling (CLAUDE.md)

Per CLAUDE.md's evidence-boundaries rule: all evidence in this document is **local mock / packaged
UI strength** — a headless Playwright run and a Jest/Vitest suite against a local dev stack and a
disposable local Docker HAPI container. This slice's E2E evidence is a genuine step stronger than
S1–S5's within that same class: it proves a real third-party system (HAPI's rest-hook Subscription
mechanism) actually fires and is actually consumed, not just that our own code's internal contract
holds. It is still **not** target-environment, client-accepted, or production-hardware evidence — no
such claim is made here. In particular: HAPI's in-memory Subscription matching was observed, during
manual investigation this session, to sometimes go stale after sustained unrelated activity even
while the resource still reports `status: active` (not reproduced as a factor in the actual root
cause — the real bug was the route shape, §3 — but noted here as an environmental characteristic of
this specific `hapiproject/hapi:7.2.0` image observed under heavy manual probing, not confirmed to
recur under normal single-assignment demo usage).

## 7. Gate outcome

**PASS.** All fresh command evidence is green (§1). Definition-of-done (§2) and spec-drift (§3)
checks found stale-checkbox bookkeeping (fixed) and several implementation details the plan
appropriately left to discovery — most notably a real defect in HAPI's actual webhook delivery shape,
found and fixed via live investigation rather than assumed correct from a code read (§4). No product-
behavior defects remain open.

## Next step

`code-review`, covering the full branch diff since `feature/caresync-s5-population-dashboard` (this
slice's actual base — see the header note) along the Standards and Spec axes.
