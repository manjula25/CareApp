# Changelog: S10 — CDS Hooks patient-view service

**Type:** Feature

**Branch:** `feature/caresync-s10-cds-hooks` (branched off `main` at the S8 merge, `d219b9c` —
deliberately not off the unmerged `feature/caresync-s9-eval-harness`, since S10 is only blocked by S3)

**Date:** 2026-07-07

## Summary

Delivers the fifth load-bearing standard (GD6): a real CDS Hooks **patient-view** service. Given a
patient context, it reads that patient's already-validated cached analysis (S4) and maps the
risk/care-gap/SDOH findings into CDS Hooks cards carrying FHIR citations — demoable by pointing the
public CDS Hooks sandbox at the service. No CDS-specific agent logic: card mapping is a pure function
over data an existing pipeline already validated.

## Changes Made

### Pre-implementation plan review (plan-review finding, resolved before any code was written)

- **Before:** the plan's A2 said the service should "reuse cached (or run) analysis." There is no
  reusable, non-streaming "run the orchestrator and return a validated result" function in this
  codebase — that sequence (`orchestrate` → citation validation → cache write) lives inline inside
  `analysis.ts`'s SSE handler, and CDS Hooks services must answer synchronously and fast, which a
  4-agent LLM run can't do inline.
- **After:** A2 was scoped to cache-only. A cache miss returns `cards: []` (a valid CDS Hooks
  response) rather than triggering a live run. B1's CORS work turned out to already be done
  (`app.use(cors())`, no options, already fully open).
- **Files changed:** `docs/plans/caresync-ai/implementation-plan.md` (plan-review note added above
  Phase A).

### Backend — Discovery endpoint (A1)

- **Before:** no CDS Hooks surface existed.
- **After:** `GET /cds-services` (`createCdsHooksRouter`) returns the CDS Hooks 1.0/2.0 discovery
  descriptor for `caresync-patient-view` (`hook: "patient-view"`). Mounted at `/cds-services`,
  deliberately outside `/api` and not behind `requireAuth` — the public sandbox carries no CareSync
  session token. The service id is exported as `CDS_PATIENT_VIEW_SERVICE_ID` (review follow-up:
  originally a duplicated literal, exported once A2 needed the same value, mirroring
  `riskAgent.ts`'s exported `MODEL` convention).
- **Files changed:** `apps/api/src/routes/cdsHooks.ts` (new), `apps/api/src/routes/cdsHooks.test.ts`
  (new), `apps/api/src/index.ts`.

### Backend — Patient-view service + pure card mapping (A2)

- **Before:** N/A — new capability.
- **After:** `POST /cds-services/caresync-patient-view` reads `context.patientId` from the request,
  looks up the S4 `analysis_cache` row (`readAnalysisCache`), and maps it to CDS cards via a pure
  function, `mapAnalysisResultToCards` (`cdsCardMapping.ts`). Per finding: `summary` (≤140 chars,
  ellipsis-truncated), `indicator` (`info`/`warning`/`critical`, derived from the finding's own
  severity/urgency, or the aggregate `riskLevel` for risk findings), `detail` (carrying a
  `(FHIR: ResourceType/id)` citation), `source.label`. `actionPlanner` tasks are never mapped —
  they're actions, not clinical findings. Cache miss → `cards: []`, never triggers
  `../agents/orchestrator`. Unknown service id → `404`; missing `context.patientId` → `400`.
- **Files changed:** `apps/api/src/routes/cdsCardMapping.ts` (new), `apps/api/src/routes/cdsCardMapping.test.ts`
  (new), `apps/api/src/routes/cdsHooks.ts`, `apps/api/src/routes/cdsHooks.test.ts`, `apps/api/src/index.ts`.

### Docs — Sandbox wiring + verification (B1, C1, C2)

- **After:** `docs/plans/caresync-ai/cds-hooks-sandbox.md` documents the confirmed-working steps for
  pointing the public `sandbox.cds-hooks.org` client at a tunneled local instance (via the sandbox's
  own gear-menu "Add CDS Services" dialog — its "Select a Service" box only searches an existing
  list), plus a documented limitation: the sandbox's "Change Patient" picker only offers patients from
  its own reference FHIR server (`launch.smarthealthit.org`), with no overlap with our cached
  patients.
- **Files changed:** `docs/plans/caresync-ai/cds-hooks-sandbox.md` (new),
  `docs/plans/caresync-ai/verification-s10.md` (new), `docs/plans/caresync-ai/review-s10.md` (new),
  `docs/plans/caresync-ai/issues.md`, `docs/plans/caresync-ai/implementation-plan.md`.

## Files Modified

| File | Change Description |
|------|---------------------|
| `apps/api/src/routes/cdsHooks.ts` | New — `createCdsHooksRouter`, `CDS_PATIENT_VIEW_SERVICE_ID`, discovery + patient-view routes |
| `apps/api/src/routes/cdsHooks.test.ts` | New — discovery shape, cache-hit/miss, 404, 400, no-auth |
| `apps/api/src/routes/cdsCardMapping.ts` | New — pure `mapAnalysisResultToCards`, `CdsCard` |
| `apps/api/src/routes/cdsCardMapping.test.ts` | New — every indicator tier, truncation, actionPlanner exclusion, empty-findings |
| `apps/api/src/index.ts` | Mounts `createCdsHooksRouter(db)` at `/cds-services` |
| `docs/plans/caresync-ai/implementation-plan.md` | Iteration 10 plan-review note; A1/A2/B1/C1/C2 checked off |
| `docs/plans/caresync-ai/issues.md` | S10 acceptance bullets checked off |
| `docs/plans/caresync-ai/cds-hooks-sandbox.md` | New — sandbox wiring steps + patient-picker limitation |
| `docs/plans/caresync-ai/verification-s10.md` | New — verification-before-completion artifact |
| `docs/plans/caresync-ai/review-s10.md` | New — two-axis (Standards + Spec) code-review artifact |

## Commits

| Commit | Description |
|--------|-------------|
| `94a7af4` | docs(S10): plan-readiness review — cache-only card mapping, CORS already open |
| `824013d` | feat(S10): A1 — CDS Hooks discovery endpoint |
| `b14c59d` | fix(S10): A1 review — export CDS_PATIENT_VIEW_SERVICE_ID instead of duplicating the literal |
| `bb4214c` | feat(S10): A2 — CDS Hooks patient-view service + pure card mapping |
| `17511c8` | fix(S10): A2 review — correct garbled cache-ownership comment in index.ts |
| `89a0fab` | docs(S10): B1 sandbox wiring doc + close out A1/A2/C1 checkboxes |
| `b28f4ea` | docs(S10): verification-before-completion pass |
| `2a8be30` | docs(S10): two-axis code-review artifact (Standards + Spec) |
| `195e15b` | docs(S10): C2 done — live public CDS Hooks sandbox smoke test |

## Testing & Verification

**How to verify this works:**
- `cd apps/api && npx jest cdsHooks.test.ts cdsCardMapping.test.ts`
- `cd apps/api && npx tsc --noEmit`
- Local live check: `PORT=4177 npx tsx src/index.ts`, then `curl` the discovery + patient-view routes
  (the dev DB already has a real cached Maria Chen analysis, so a cache-hit `curl` returns real
  populated cards)
- Public sandbox: see `docs/plans/caresync-ai/cds-hooks-sandbox.md`

**Test results (this session, 2026-07-07, fresh, re-confirmed before finishing):** targeted S10 suites
**2/2 passed, 14/14 tests**, `tsc --noEmit` exit 0. The full `npm run test:api` workspace suite has 7
pre-existing failing suites (50 tests) unrelated to this branch — `TypeError: fetch failed` in every
`FhirReadService`-dependent suite, because the local HAPI FHIR Docker container isn't running in this
environment (`docker ps` empty, confirmed fresh both earlier and just now); neither S10 test file is
among the failures.

## Notes

- **One plan-review finding, caught and resolved before implementation (not after):** the "reuse
  cached (or run) analysis" line in the original plan assumed a reusable non-streaming analysis
  function that doesn't exist, and CDS Hooks' synchronous-response requirement rules out inline
  live-orchestration anyway. Resolved by scoping to cache-only, documented in
  `implementation-plan.md` before A1/A2 were built.
- **Two review-driven fixes, each its own commit:** exporting `CDS_PATIENT_VIEW_SERVICE_ID` instead of
  duplicating the service-id literal (A1 review), and fixing a garbled cross-slice comment in
  `index.ts` (A2 review).
- **One duplication smell confirmed and left as a documented judgement call:** `cdsCardMapping.ts`'s
  three near-identical per-section mapping blocks (different field names/tier boundaries) — same
  tolerance this repo's S4/S9 reviews already applied to structurally similar shapes. Worth
  revisiting if a fourth finding category is ever added.
- **Live public-sandbox evidence, gathered with explicit user sign-off:** the actual
  `sandbox.cds-hooks.org` client, via an `ngrok` tunnel, discovered and called this service over the
  real internet; its own UI rendered the real request/response. That session's specific patient
  (from the sandbox's own reference FHIR server) had no cached analysis, so the honest response was
  `cards: []` — a genuine environment/data-overlap constraint, not a code defect. A populated-card
  response for the same route was proven separately via a local curl hit against the real dev DB's
  cached Maria Chen analysis.
- **Evidence strength:** local mock (Jest, in-memory SQLite) for the automated suite; local
  live/non-mocked for the curl smoke tests against the real dev DB; genuine target-environment for the
  public-sandbox round trip (§1 of `verification-s10.md` has the full detail per piece of evidence).
- **A pre-existing, unrelated leaked-looking credential was flagged mid-session, not fixed here:**
  `apps/api/.env` contains what looks like a live `GH_TOKEN` GitHub PAT in plaintext — outside this
  diff, already surfaced to the user, recommended for rotation.
- **Branch was pushed and a PR opened against `main` as part of this changelog's commit** (see the PR
  link in the handoff/session notes).
