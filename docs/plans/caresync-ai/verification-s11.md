# Verification — CareSync AI, S11 (Demo-supporting + shell screens)

> **PLAN_ID:** `caresync-ai` · **Slice:** S11 · **Date:** 2026-07-07
> **Stage:** Phase 5 (`verification-before-completion`), run on
> `feature/caresync-s11-demo-supporting-shells` (base `f3f4b77` = `main`, tip `bfffef8`, 8
> commits: `f699bd9` A1 SDOH, `4eb6f9f`/`6748d80` A2 Quality/HEDIS + review fix, `3c819ed` A3
> Team, `37a2df2` A4 capacity-flex decision (docs-only), `7b05a3d` B1 shells, `7f57b5d` C2 E2E,
> `bfffef8` checkbox closeout). Read `docs/plans/caresync-ai/implementation-plan.md` Iteration 11
> and `docs/plans/caresync-ai/issues.md` S11 for the plan this verifies against — not re-derived
> here. Built via `subagent-driven-development`: one implementer subagent per task, one
> independent reviewer subagent per task re-reading the diff and re-running tests itself (not
> trusting the implementer's self-report) — matching this branch's own S7/S8/S10 precedent of
> one review pass per task plus a consolidated verification pass, rather than a second, separate
> per-task code-quality reviewer subagent.

## 1. Fresh command evidence (this session, 2026-07-07)

Every command below was re-run fresh in this final pass, on top of each task's own independent
reviewer runs (§4).

| Command | Result |
|---|---|
| `docker ps` / `curl http://localhost:8080/fhir/metadata` | HAPI FHIR container **up**, seeded (2390 resources imported this session) |
| `cd apps/api && npx jest --runInBand` | **37 suites / 232 tests passed** |
| `cd apps/api && npx tsc --noEmit` | exit 0 |
| `cd apps/web && npx vitest run` | **27 files / 225 tests passed** (canvas `getContext` "Not implemented" lines are pre-existing jsdom noise from the `ConfidenceChart`/`QualityGaugeChart` Canvas components, not failures) |
| `cd apps/web && npx tsc --noEmit` | exit 0 |
| `npx playwright test --config=apps/web/playwright.config.ts --workers=1` | **16/16 E2E specs passed** (all specs in the suite, including the 2 new S11 specs) |

**Note on E2E concurrency:** the default (parallel-workers) Playwright run intermittently shows 2
failures — `coordinator-panel.spec.ts` and `agent-graph-cache.spec.ts`, both pre-existing S2/S3/S7
specs unrelated to this diff — caused by HAPI request contention when multiple browser contexts
hit the same dev-mode API server concurrently (`Loading panel…`/`Loading patient…` never resolving
within the assertion timeout). Re-running the identical two specs alone with `--workers=1`: both
pass. This is the same class of local-environment load flakiness already documented in this
session's A1/A2/A3 implementer and reviewer reports (HAPI-under-load, not a code defect) — the
`--workers=1` serial run above is the evidence of record.

## 2. Definition-of-done check (S11 acceptance, `issues.md`)

All 5 acceptance bullets confirmed against the actual code and this session's evidence:

1. **"SDOH resource directory lists community resources by category; a referral creates a FHIR
   ServiceRequest."** — `apps/api/src/sdoh/resources.ts`'s `listResourcesByCategory` (12 seed
   resources, ≥2 per category); `FhirReadService.createServiceRequest`
   (`apps/api/src/fhir/client.ts`) does the guard→POST `/ServiceRequest`→`writeAudit` write,
   proven against real HAPI in both `fhir/client.test.ts` and `routes/sdoh.test.ts`, and
   end-to-end in the browser via `apps/web/e2e/sdoh-referral.spec.ts` (§1). **Met.**
2. **"Quality/HEDIS view shows measure progress and incentive dollars at stake, derived from
   FHIR data."** — `apps/api/src/quality/service.ts`'s `getDiabetesHba1cMeasure` computes a real
   rate/gap from two live FHIR bulk searches (Condition E11.9, Observation LOINC 4548-4 — 286 vs.
   1 in the seeded environment); the incentive-dollar figure is a documented, UI-labeled
   illustrative estimate derived from the real gap count, not a fabricated financial record.
   Proven end-to-end via `apps/web/e2e/director-quality.spec.ts` (§1). **Met**, with the mockup's
   unbacked ROI donut/cost-events-table/ROI-calculator/trend-chart content deliberately dropped
   (§3) rather than faked.
3. **"Team performance view shows coordinator workload and completion rates."** —
   `apps/api/src/team/service.ts`'s `getTeamPerformance` computes live per-coordinator
   assigned/completed/completion-rate plus an unassigned count, from real Task ownership/status
   data (`FhirReadService.getTaskOwnershipSummary`) joined against the real `users` table. **Met.**
   The fresh-environment numbers are honestly small (1 coordinator, 0 assigned/0 completed/7
   unassigned) because no frontend flow calls the pre-existing S6 A1 assign endpoint yet — this
   is real, correct current state, not a stubbed value; the aggregate will reflect a live
   assignment/completion the moment one happens.
4. **"Shell screens exist in navigation with consistent design-system styling and placeholder
   content."** — all 11 IDs (W08, W09, W10, W11, W13, W15, W16, M06, M07, M09, M10) render via
   one shared, parameterized `ComingSoon` component driven by a route→title table
   (`apps/web/src/lib/shellScreens.ts`), reachable via a new "More" nav link visible to every
   role. **Met.**
5. **"No shell screen presents placeholder data as if it were real/functional (honest
   staging)."** — the 10 genuinely-undefined screen IDs are labeled neutrally ("Screen W08",
   etc.) rather than with invented feature names that would misrepresent a planned feature that
   doesn't exist; every shell shows explicit "not yet built" copy. **Met.**

**5 of 5 acceptance bullets met.** `implementation-plan.md`'s Iteration 11 checkboxes (A1, A2,
A3, B1, C1, C2) are `[x]`; A4 is `[x]` with an explicit, recorded capacity-flex decision (§3)
rather than a build.

## 3. Spec-drift check (issues.md / implementation-plan.md vs. code)

Two real plan-vs-reality decisions, both made deliberately during implementation (not silent
deviations discovered after the fact):

- **A2's mockup (`caresync-quality-roi.html`) is a pitch-deck-style mockup full of fabricated
  financial content** — a `$4.78M` "ROI Calculator," a donut chart with invented cost-avoidance
  categories, a "Recent Prevented Cost Events" table naming specific patients with dollar amounts
  for outcomes that never occurred in this system, and a trend chart implying historical
  snapshot data that doesn't exist. Per CLAUDE.md's gate G4 and this repo's established
  honest-staging precedent (`Governance.tsx`'s own deviation-note doc comment, S8), none of this
  was ported. **Resolution:** A2 computes and ships exactly ONE real measure (diabetes HbA1c
  testing rate, from live FHIR data) plus one clearly-labeled illustrative dollar estimate;
  everything else is dropped and the drop is documented in `Quality.tsx`'s own doc comment. This
  is a scope reduction in service of honesty, decided and recorded before/during implementation,
  not a shortcut.
- **A4 (M04 Patient quick profile, M08 Today/Schedule, W14 Care Plan builder) has no reference
  mockup**, unlike A1/A2, and each of the three meaningfully overlaps an already-shipped screen
  (`PatientDetail.tsx` for M04, `TaskQueue.tsx` for M08) without a mockup to define what's
  distinctly different about the new one; W14 is a new FHIR `CarePlan` write surface, not a
  partial-depth read view like the other two. **Resolution:** deferred per this task's own
  ponytail instruction ("stop at capacity, record what's partial") — recorded in
  `tasks/todo.md` and here, not silently dropped.

No scope creep: `git diff f3f4b77..HEAD --stat` shows new files scoped to `apps/api/src/{sdoh,
quality,team}/`, `apps/api/src/routes/{sdoh,quality,team}.ts` (+tests), 3 new/edited
`FhirReadService` methods (`createServiceRequest`, `getResourceCountByCode`,
`getTaskOwnershipSummary` — all additive, no existing method signature changed), a handful of new
`apps/web/src/pages/*` screens + their tests, `apps/web/src/lib/shellScreens.ts`, 2 new Playwright
specs, and doc updates. No existing route, aggregate, or auth behavior was touched — confirmed by
each task's independent reviewer reading the relevant diff slice, and by this pass's fresh full
test-suite run showing zero regressions to A1 as later tasks landed (§1).

Other checks:
- **`implementation-plan.md` Iteration 11's checkboxes** — A1, A2, A3, A4, B1, C1, C2 are all
  `[x]`, matching actual state (verified by reading the file directly, not assumed).
- **New persisted state**: none beyond what each task's own plan called for — A1 writes one
  audited FHIR `ServiceRequest` per referral (no new DB table); A2/A3 are pure read aggregates,
  no writes.
- **Auth**: every new route (`sdoh.ts`, `quality.ts`, `team.ts`) uses `requireAuth`, matching
  every existing route's convention; `quality.ts`/`team.ts` are Director-only (`assertDirector`,
  matching Population's/Governance's real precedent — an A2-review-caught and corrected
  inconsistency, see §4); `sdoh.ts` is open to all three roles (all hold `'sdoh'` scope), matching
  the existing `scopes.ts` domain map, not a new permission model.

## 4. Review notes

Each task was built by an implementer subagent under an explicit TDD requirement (failing test
first, confirmed red for the right reason, then green) and then independently re-reviewed by a
separate reviewer subagent that re-read the diff and re-ran the tests itself rather than trusting
the implementer's self-report — matching this branch's own established per-task review
granularity (S7/S8/S10 git history: one implementer commit per task, self-review + TDD, then a
consolidated verification/two-axis-review pass at the end, not a second per-task reviewer
commit).

Review verdicts:
- **A1 (SDOH):** APPROVED_WITH_NITS — two non-blocking nits (an unused `category` parameter on
  `createServiceRequest`, and the frontend not exercising the server's `?category=` filter path).
  Neither affects correctness or spec conformance; left as-is.
- **A2 (Quality/HEDIS):** APPROVED_WITH_NITS on first pass — one real issue found: a doc comment
  in `quality/service.ts` incorrectly claimed Population's aggregates were merely
  `clinical`-scope-gated (they are actually Director-only end-to-end), creating an actual
  UI/API scope mismatch (the frontend route was already Director-only; the backend wasn't).
  **Fixed and re-verified** (commit `6748d80`): the aggregate is now Director-only, matching the
  real Population/Governance precedent, with both test suites re-run green (232/219 API tests,
  225/206 web tests before/after — see the fix commit's own verification).
- **A3 (Team):** APPROVED — no issues found on review (one informational nit about
  `ownerCoordinatorId`'s exact semantics under a hypothetical future owner shape, not a bug
  today).
- **B1 (Shells):** APPROVED — no issues found.

No `BLOCKED`/`NEEDS_CONTEXT` escalations were needed for any task.

## 5. Domain-term documentation check

New domain concepts introduced by S11 are documented inline via doc comments at their
introduction point, consistent with the "Domain rule:"/deviation-note convention established
since S2:
- `CARESYNC_REFERRAL_TAG` and the audited-`ServiceRequest`-write shape (`fhir/client.ts`).
- The "Comprehensive Diabetes Care: HbA1c Testing" measure definition and its illustrative-dollar
  convention (`quality/service.ts`, `Quality.tsx`'s deviation-note doc comment — the most
  extensive of this slice's doc comments, given the honest-staging stakes).
- The Team-performance aggregation shape and the "live, not snapshot" convention (`team/service.ts`).
- The shell-screen route→title table and the "neutral label, no invented feature names"
  convention (`shellScreens.ts`).

`docs/agents/domain.md` and `docs/agents/issue-tracker.md` still don't exist — the same
pre-existing, deferred gap noted in every prior slice's verification since S5, unchanged by S11.

## 6. Evidence-boundary labeling (CLAUDE.md)

Per CLAUDE.md's evidence-boundaries rule:
- §1's Jest/Vitest/tsc results are **local** strength, but exercised against a **real, seeded HAPI
  FHIR server** (not an in-memory/mocked FHIR layer) for every test that touches `FhirReadService`
  — stronger than a pure-mock unit-test run, but still local, not target-environment.
- §1's Playwright E2E run is **local mock / packaged-UI** strength (per
  `frontend-e2e-verification`'s own labeling convention) — a real headless Chromium driving the
  real rendered app against the real local API + local HAPI, proving the SDOH referral write and
  the Quality view's live-computed figures actually render and function end-to-end in a browser,
  not just at the API layer. Not target-environment or client-accepted evidence.
- No claim of hardware, cloud, or client-accepted acceptance is made anywhere in this document.

## 7. Gate outcome

**PASS.** All command evidence in this environment is green for what S11's code actually does
(§1), no spec drift survives unresolved (§3 — both real deviations were deliberate, documented
honesty/capacity decisions, not silent shortcuts), the one real review-caught issue (A2's
Director-gating mismatch) was fixed and re-verified (§4), and all 5 acceptance bullets are met
(§2). `implementation-plan.md`'s Iteration 11 checkboxes are all `[x]`.

## Next step

`code-review`, covering the full branch diff since `main` along the Standards and Spec axes.
