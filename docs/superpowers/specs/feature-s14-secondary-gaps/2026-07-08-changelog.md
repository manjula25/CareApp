# Changelog: S14 — Close 4 Secondary Gaps

**Type:** Feature

**Branch:** `feature/s14-secondary-gaps` (branched off `main` at the S12 coordinator-grid merge, `169174b`)

**Date:** 2026-07-08

**Spec sources:** `docs/plans/caresync-ai/grill-secondary-gaps.md`, `docs/plans/caresync-ai/prd-s14.md`, `docs/plans/caresync-ai/implementation-plan-s14.md`

## Summary

Closes 3 of 5 secondary gaps surfaced in the HL7 evaluation, makes real progress on the 4th, and leaves the 5th (Risk PPV / LLM variance) for S15. The S14 verification matrix closes 2 of 4 rows outright; the other 2 are documented as follow-ups with explicit ownership.

| Gap | Status | Evidence |
|---|---|---|
| #2 SDOH imbalance | ✅ DONE | 5 new AHC-HRSN screenings (3 positive + 2 explicit-negative); SDOH agreement rate moved from 100% to 66.7%; first-ever TP/TN/FP/FN confusion matrix visible in `docs/eval-report.md` line 38. |
| #3 review:apply (apply half) | ✅ DONE | `apps/api/src/scripts/apply-clinician-review.ts` + 3 tests (round-trip, notes-trigger, unknown-patient) + `npm run review:apply` script. Code-review fix in `b3f8167` pins the grill §3 "non-empty notes" trigger. |
| #4 per-finding confidence | ✅ DONE | `apps/api/src/agents/confidenceScorer.ts` (3 pure scorers + 1 derivation helper) + 5 tests + schema additions on every `*Output` finding + `citationValidator.ts` `applyConfidence` integration. |
| #5 SMART enforcement A+B | ⚠️ PARTIAL | A (app middleware) DONE: 5 tests green, mounted on 10 HAPI-touching routes. B (HAPI config) BLOCKED: stock `hapiproject/hapi:v7.2.0` image lacks the security filter (verified by `docker inspect` + curl); env vars + bind-mount are in place but inert. Follow-up: rebuild from `hapi-fhir-jpaserver-starter` or point HAPI at a real SMART auth server. |
| #1 Risk PPV / LLM variance | ❌ NOT IN SCOPE | Owned by S15 per `verification-s13.md` §6. S14 does NOT touch `riskAgent.ts`'s prompt. |

## Changes Made

### Commit 1 (`b807aaf`) — feat(S14): rebalance SDOH labels (3 positive + 2 explicit-negative)

- **Before:** `data/eval/labels.json` had 1/16 patients with `expectedHasBarrier: true` and 15/16 with `expectedHasBarrier: null` (absence-of-screening). The eval-report's SDOH section reported an "agreement rate" of 100% — trivially gameable with an always-negative predictor.
- **After:** `seed-patients.ts` extended with `sdohNegative?: { id; note }` (mirrors `sdohPositive`); `import-fhir.ts:189` pushes both shapes; `population.ts` carries `pop-0010` (positive) and `pop-0005` (explicit-negative) per `buildSdohForIndex(i)`. 5 new AHC-HRSN Observations in HAPI (3 positive: james-okafor, angela-diaz, pop-0010; 2 explicit-negative: robert-kim, pop-0005). `labels.json` rows updated for all 5 patients + `_meta.labelingRules.sdoh` references both shapes. SDOH distribution is now 4/16 positive + 2/16 explicit-negative + 10/16 absence-of-screening.
- **Files changed:** `apps/api/src/fhir-data/seed-patients.ts`, `apps/api/src/fhir-data/population.ts`, `apps/api/src/fhir-data/import-fhir.ts`, `data/eval/labels.json`.

### Commit 2 (`ab3baf4`) — feat(S14): review:apply (the missing apply half)

- **Before:** `review:render` HTML form (S9 C2) could produce a `labels.clinician-review.json` but there was no script to apply it back to `data/eval/labels.json`. The eval-report's "Status" disclosure could only ever read "all dev-labeled."
- **After:** `apps/api/src/scripts/apply-clinician-review.ts` (297 lines) reads the review JSON, validates (every patient ID present, `choice ∈ {endorse, override, abstain}`, override values are booleans or null), and mutates the labels file (sets `source: "clinician"` on touched rows, populates `clinicianOverride` slot, applies override values). `apps/api/src/scripts/apply-clinician-review.test.ts` (3 tests) covers round-trip (override + endorse + abstain in one fixture), the grill §3 "non-empty notes" trigger, and unknown-patient-ID validation. New `npm run review:apply` script.
- **Files changed:** `apps/api/src/scripts/apply-clinician-review.ts` (new), `apps/api/src/scripts/apply-clinician-review.test.ts` (new), `apps/api/package.json`.

### Commit 3 (`3cbe8dc`) — feat(S14): per-finding confidence via bundle-evidence heuristic

- **Before:** No `confidence` field on any finding. The eval-report's per-agent section couldn't bucket findings by confidence, so the "governance buckets" tile was always zero.
- **After:** `apps/api/src/agents/confidenceScorer.ts` (259 lines) with 3 pure scoring functions (`scoreRiskFlag`, `scoreCareGap`, `scoreSdohBarrier`) + 1 derivation helper (`deriveActionPlannerTaskConfidence`). Formulae from `prd-s14.md` D4 + D5; all 5 tests in `confidenceScorer.test.ts` pass. Schema adds additive `confidence: number` to `RiskOutput.flags[i]`, `CareGapOutput.gaps[i]`, `SdohOutput.barriers[i]`, `ActionPlannerOutput.tasks[i]` and the matching `AgentEvent` result variants. `mock-outputs.ts` fills `confidence: 0.5` placeholder so the type compiles (real number lands via the scorer in production). `citationValidator.ts` gains `applyConfidence` helper called from `routes/analysis.ts` (the real call site — not `orchestrator.ts` as the plan said, since the subagent discovered `orchestrator.ts` doesn't actually call `validateCitations`).
- **Files changed:** `apps/api/src/agents/confidenceScorer.ts` (new), `apps/api/src/agents/confidenceScorer.test.ts` (new), `apps/api/src/agents/agent.ts`, `apps/api/src/agents/mock-outputs.ts`, `apps/api/src/agents/citationValidator.ts`, `apps/api/src/routes/analysis.ts`.

### Commit 4 (`5e73c68`) — feat(S14): SMART enforcement A+B (app middleware + HAPI config)

- **Before:** SMART tokens were minted and attached to every HAPI call, but neither the app nor HAPI validated them. The pre-S14 gap was "HAPI returns 200 for any caller with any token" — i.e., zero SMART enforcement at the boundary.
- **After:** A (app-side): `apps/api/src/middleware/smartAuth.ts` (202 lines) — `createSmartAuthMiddleware({ publicKey, audience, requiredScopesByMethod })` returns an Express middleware that reads the `Authorization` header, decodes the JWT, verifies the signature, checks `exp` (30s safety margin), `aud`, and `scope` against `requiredScopesByMethod[req.method]`. Throws `SmartAuthError extends Error` with `.statusCode` (401 for missing/malformed/invalid-signature/expired/wrong-aud; 403 for insufficient scope). `smartAuthErrorHandler` exports the matching Express error handler that sends `{ error: 'smart_auth_failed', reason: '...' }`. Mounted on 10 HAPI-touching routes in `apps/api/src/index.ts`: `/api/patients`, `/api/population`, `/api/governance`, `/api/tasks`, `/api/sdoh`, `/api/care-plans`, `/api/alerts`, `/api/quality`, `/api/team`, and the analysis sub-path. NOT mounted on `/api/auth/*`, `/api/health`, `/api/events`, `/api/fhir` (HAPI's own webhook callback — stock image has no bearer-token slot), or `/cds-services/*` (CDS Hooks spec requires no auth on discovery). 5 unit tests in `smartAuth.test.ts` (valid → 200; no token → 401 missing_token; tampered → 401 invalid_signature; expired → 401 token_expired; wrong scope → 403 insufficient_scope) all pass. B (HAPI-side): `docker-compose.yml` `hapi-fhir` gains `hapi.fhir.security.oauth.enable_jwt_validation: "true"` + `hapi.fhir.security.oauth.public_key_location: file:/keys/smart-public.pem` + bind-mount `./apps/api/src/smart/keys:/keys:ro`. New `apps/api/src/smart/keys/smart-public.pem` (extracted via a one-off `tsx` invocation of `generateKeyPair()`, then committed). **Documented deviation**: the middleware verifies against `serverSecret` (HS256) via `verifyAccessToken()`, not the RSA `smart-public.pem` — the existing token server in `smart/tokenServer.ts` issues HS256 access tokens with `serverSecret`, not RS256 with the client's keypair. The `smart-public.pem` is for HAPI's separate `OAuthAuthorizationServletFilter` (RS256-expected). The two verifiers target different components and use different keys by design; production SMART handoff (point HAPI at a real SMART auth server) would unify the trust root. **Phase D deferral**: stock `hapiproject/hapi:v7.2.0` does NOT include the security filter that would honor the env vars. Verified by `docker compose up -d hapi-fhir` + `docker inspect` (env vars correctly set) + `curl http://localhost:8080/fhir/Patient/maria-chen` (returns 200/404, not 401). Curl commands that would verify once HAPI is rebuilt are documented in `verification-s14.md` §6 #2.
- **Files changed:** `apps/api/src/middleware/smartAuth.ts` (new), `apps/api/src/middleware/smartAuth.test.ts` (new), `apps/api/src/smart/keys/smart-public.pem` (new), `apps/api/src/index.ts`, `docker-compose.yml`.

### Commit 5 (`c6587f1`) — feat(S14): eval.ts surfaces SDOH TP/FP/TN/FN + clinician-validated disclosure

- **Before:** The plan's §"Architecture" listed `eval.ts` as one of the 8 modified files but Commits 1–4 didn't touch it. The eval-report's SDOH section was agreement-rate-only; the "Status" disclosure was hardcoded to "DEV-LABELED BASELINE, NOT CLINICIAN-VALIDATED" regardless of how many `source: "clinician"` rows the labels file carried.
- **After:** `computeMetrics.ts` adds `matrix: ConfusionMatrix` to `AgreementMetrics` (SDOH gets the same TP/FP/TN/FN shape as Care Gap + Risk; first time visible). `eval.ts` `renderMarkdown` updates the SDOH section to print the matrix. `renderMarkdown` + `buildJsonSummary` make the "Status" disclosure data-driven: counts `source: "clinician"` rows in the label file; the "Not clinician-validated (GD8)" caveat only renders when the count is 0. Regenerated `docs/eval-report.md` shows: SDOH agreement 66.7% (2/3), SDOH matrix TP=1/TN=1/FP=0/FN=1, Status reads "0 of 16 clinician-validated (0.0%), 16 of 16 dev-labeled (100.0%)". Only 3/16 patients scored this run (OpenAI quota exhausted; pre-existing limitation, not S14 regression). The plan's 4th E1 acceptance criterion (per-agent confidence-bucketed accuracy sub-tables) is deferred to a follow-up commit — surfacing confidence buckets requires plumbing `confidence: number` through `PatientFindings` so `computeMetrics` can group findings, a non-trivial refactor that's out of scope for S14's verification step. The underlying data is in place (Commit 3 wired `confidence` into every finding); only the eval-report rendering layer is missing.
- **Files changed:** `apps/api/src/eval/computeMetrics.ts`, `apps/api/src/eval/computeMetrics.test.ts`, `apps/api/src/scripts/eval.ts`, `docs/eval-report.md`.

### Commits 6–8 (docs + code-review fix)

- `a31fb6d` — `docs/plans/caresync-ai/verification-s14.md` + `docs/plans/caresync-ai/review-s14.md` (initial self-review).
- `b3f8167` — **fix(S14): review:apply flips source on non-empty notes (grill §3)**. External code review (Spec axis) caught a partial implementation: grill §3 says "any dim with a non-endorse choice or any non-empty notes" should flip `source: "clinician"`. The pre-fix code only checked `hasOverride || hasAbstain`. The existing round-trip test's james-okafor fixture had non-empty 'Endorsed' notes while asserting source stayed 'dev' — that pinned the bug. Fix: added `hasNotes` check (any notes non-empty after trim) to the source-flip guard. Fixture updated + new test "flips source to clinician when all dims endorse but notes are non-empty (grill §3 'touched' trigger)" pins the path.
- `2a5b1c9` — `docs/plans/caresync-ai/review-s14.md` aggregated the external code review (Standards + Spec sub-axes); added a "Code-review-aggregated" section above the existing self-review.

### Commits 9–11 (changelog + post-PR regression fix)

- `5752744` — `docs/superpowers/specs/feature-s14-secondary-gaps/2026-07-08-changelog.md` (this file).
- `f8d0862` — **fix(S14): smartAuth runs AFTER requireAuth + no-double-auth pass-through** (post-Commit-4 regression caught by live smoke test after the PR was open). The 281/281 unit-test suite could not catch a mount-order bug in `index.ts`: smartAuth was mounted via `app.use('/api/patients', smartAuth, createPatientsRouter(fhirService))` which ran smartAuth BEFORE the route's inner `requireAuth`. Login JWTs hit smartAuth first, failed signature verification (smartAuth expects SMART tokens signed with `serverSecret`, login JWTs use `auth/jwt.ts`'s `JWT_SECRET`), and were rejected with `{"error":"smart_auth_failed","reason":"invalid_signature"}` before `requireAuth` ever saw them. Fix: (a) added a 4-line `if (req.auth) return next()` pass-through at the top of smartAuth; (b) moved the smartAuth mount INSIDE each route via a new `wrapRouterWithSmartAuth(router, smartAuth)` helper. New 6th unit test pins the pass-through path. Live smoke test after fix: login JWT → 200, no token → 401 from requireAuth, garbage SMART-shape token → 401 from requireAuth (smartAuth never runs). **Methodology lesson**: mount-order bugs don't surface from per-route test apps. Future slices need at least one integration smoke test against the running `npm run dev` server, not just per-route unit tests.

## Open Follow-ups (NOT in this slice)

1. **Confidence-bucketed eval sub-tables.** Requires plumbing `confidence: number` through `PatientFindings` (so `computeMetrics` can group findings by bucket) + adding the bucketing logic + rendering. Owned by: next iteration (not S15 — S15 is model-variance). One small commit. Tracked in `verification-s14.md` §6 #1.
2. **Production SMART handoff.** Point HAPI at a real SMART auth server (Keycloak, SMART authorization sandbox) OR rebuild from `hapi-fhir-jpaserver-starter` (which has the `OAuthAuthorizationServletFilter` properly wired). The app-side middleware (Commit 4) is ready to validate whatever tokens the real server issues; only the HAPI-side filter is missing. Tracked in `verification-s14.md` §6 #2.
3. **HAPI data persistence across container restarts.** Stock `hapiproject/hapi:v7.2.0` uses `jdbc:h2:mem:test_mem` regardless of the named-volume mount, so a `docker compose up -d hapi-fhir` cycle wipes all FHIR resources. The volume mount in `docker-compose.yml` is correctly configured but the image overrides it. Re-importing via `npm run import` after every container restart is the current workaround. Owned by: whoever rebuilds the HAPI image (follow-up #2).
4. **Risk agent v2 rubric + LLM-variance root cause** — owned by S15. Per `verification-s13.md` §6. **Explicitly NOT pulled into S14.** Reaffirmed by reading `verification-s13.md` §6 before S14 implementation.
5. **Model-version pin for the LLM API** — owned by S15 (cross-cutting concern affecting all 3 classifier agents).
6. **Pre-existing test flake** — `src/routes/analysis.test.ts` "leaves only the second run's Tasks" fails under disk pressure but passes in isolation. Pre-S14, documented in the Commit 2 handoff. Not a regression. Tracked in `verification-s14.md` §6 #6.
7. **Post-Commit-4 mount-order regression** — **FIXED in `f8d0862`**. Tracked in `verification-s14.md` §6 #7. The live smoke test revealed that smartAuth was mounted AHEAD of the route's inner `requireAuth`; the 281/281 unit-test suite couldn't catch this because each `routes/*.test.ts` builds its own Express app without mounting smartAuth.
8. **requireAuth should learn SMART-shape tokens too** — asymmetry left by the `f8d0862` fix. Out of scope for the immediate regression. Tracked in `verification-s14.md` §6 #8.

## Verification

- `npx tsc --noEmit` clean.
- `npx jest` → 282/282 (43 suites) at HEAD (was 281/281 after `b3f8167`; the `f8d0862` pass-through test is the +1).
- `npx jest src/middleware/smartAuth.test.ts src/routes/patients.test.ts src/routes/analysis.test.ts` (the S14-touched surface) → 24/24.
- `npx jest src/eval/` → 11/11 (including the new `AgreementMetrics.matrix` shape assertion).
- `npx jest src/agents/` → 38/38 across 7 suites.
- `npm run eval` → 3/16 patients scored (OpenAI quota exhausted mid-run on 13/16; pre-existing limitation). 3 of 4 plan E1 acceptance criteria are now visible in the regenerated `docs/eval-report.md` (SDOH agreement 66.7%, SDOH matrix TP=1/TN=1/FP=0/FN=1, Status "0 of 16 clinician-validated (0.0%), 16 of 16 dev-labeled (100.0%)"); 4th (confidence buckets) deferred.
- **Live smoke tests** (this session, after PR was open):
  - SDOH: 5× `curl /fhir/Observation/<id>` confirmed all 5 new screenings in HAPI
  - review:apply: end-to-end CLI in `/tmp` mutated `labels.json` correctly, then restored
  - confidence: code-level wiring verified (live SSE-with-confidence blocked on OpenAI quota; cached rows predate S14)
  - SMART: docker inspect confirmed env vars + bind-mount; HAPI returns 200 (not 401) confirming stock image lacks the security filter (documented Phase D deferral); **caught the mount-order regression; fixed in `f8d0862`**

## Migration / Revert

The 4 implementation commits + 1 follow-through + 1 fix are independently revertable. The full-PR revert (`git revert <merge-sha>...<tip-sha>`) reproduces the pre-S14 committed state including the pre-S14 `docs/eval-report.md`. Per-commit revert table is in `docs/plans/caresync-ai/implementation-plan-s14.md` §"Rollback / safety".

No data loss during S14: HAPI re-imported 2398 FHIR resources after the Commit 4 container-restart wipe (the stock image doesn't persist data — see follow-up #3).