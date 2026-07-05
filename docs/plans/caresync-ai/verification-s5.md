# Verification — CareSync AI, S5 (Population Dashboard + drill-in, Director)

> **PLAN_ID:** `caresync-ai` · **Slice:** S5 · **Date:** 2026-07-05
> **Stage:** Phase 5 (`verification-before-completion`), run on `feature/caresync-s5-population-dashboard`
> (base `9e2f01c` = last S4 commit, tip `9aeb1fd`, 4 commits: `b9783b0` A1+B1, `15b9b69` A2+B2,
> `ed99a3b` B3, `9aeb1fd` C2). Read `docs/plans/caresync-ai/implementation-plan.md` Iteration 5 and
> `docs/plans/caresync-ai/issues.md` S5 for the plan this verifies against — not re-derived here.
> Prior slice's verification preserved at `verification-s4.md`.

## 1. Fresh command evidence (this session, 2026-07-05)

All commands re-run fresh in this session against the live local stack (Docker HAPI FHIR healthy,
DB migrated/seeded, hero patients + the deterministic ~500-patient S5 cohort imported — confirmed
`GET /fhir/Patient?_summary=count` → `506`, `GET /fhir/RiskAssessment?_summary=count` → `506`).

| Command | Result |
|---|---|
| `cd apps/api && npx jest --runInBand` | **23 suites / 106 tests passed** |
| `npm run test:web` | **12 files / 108 tests passed** |
| `cd apps/web && npx playwright test` (full suite, 5 workers) | **8/8 specs passed**, incl. the new `director-population.spec.ts` |
| `cd apps/api && npx tsc --noEmit` | exit 0 |
| `cd apps/web && npx tsc --noEmit` | exit 0 |

**On `test:api` under the default parallel runner — a real environment finding, not a product bug.**
`npm run test:api` (Jest's default parallel workers) is flaky against the single shared live HAPI
container across this whole POC, independent of S5: concurrent workers contend for the same HAPI
instance and hit its default 5s request timeouts. Confirmed serial (`--runInBand`) is clean at
23/23 suites, 106/106 tests, and confirmed the parallel-run failures never touch `population`,
`pop-*` ids, or files this slice changed. Recorded here rather than silently re-run-until-green,
consistent with S3's precedent for the same class of shared-HAPI environmental coupling.

**Import robustness fix, discovered and fixed in this session.** The original single `$batch` POST
of the full cohort (hero + ~500 population patients, ~2,500 entries) exceeded undici's headers
timeout even though HAPI committed every entry — `npm run fhir:import` reported a spurious failure
while the data actually loaded correctly. Fixed by chunking the import into 250-entry POSTs
(`apps/api/src/scripts/import-fhir.ts`); re-run to completion with exit 0, confirmed idempotent
(hero patients + Coordinator Group intact, `maria-chen` still resolves).

## 2. Definition-of-done check (S5 acceptance, `issues.md`)

All 5 acceptance bullets confirmed against the actual code and this session's live evidence, not
just the plan doc's claim. Checkboxes in `issues.md` and `implementation-plan.md` Iteration 5 were
stale (`[ ]` despite full implementation) — corrected to `[x]` as part of this pass:

1. **Director login routes to W02 (not the Coordinator panel)** — `roleHome()` (`useAuth.tsx`,
   task B1) maps `director → /population`; `RoleGuard`'s `role` prop redirects a non-director away.
   Confirmed live in `director-population.spec.ts`: login as `director@caresync.demo` →
   `toHaveURL(/\/population$/)`.
2. **Scatter renders ~500 patients from real HAPI-derived aggregates, native Canvas, no chart
   library** — `getPopulationScatter()` (A2) bulk-reads RiskAssessment + Encounter via
   `FhirReadService.getPopulationRiskProfile` (paginated, `_count=1000` + `link[rel=next]`
   fallback); `PopulationScatterChart.tsx` (B2) paints with plain `CanvasRenderingContext2D` calls
   only (`apps/web/package.json` has no charting dependency added). Confirmed live: `kpi-total-
   patients` tile reads `506`, matching the real imported cohort exactly.
3. **Critical-zone count + cost-avoidance computed from patient data, not hardcoded** —
   `criticalZoneCount` filters real risk scores against `CRITICAL_RISK_THRESHOLD` imported from
   `fhir-data/population.ts` (not a literal); `projectedCostAvoidance` is a pure, named-constant
   formula (`expectedReadmissions × AVOIDED_READMISSION_RATE × READMISSION_UNIT_COST_USD`),
   fixture-tested to an exact number. Confirmed live: E2E asserts `criticalZoneCount > 0` and the
   cost tile is a real dollar figure that is explicitly **not** the mockup's static `$247,400`.
4. **Drill-down: cluster → filtered list → patient detail navigation works** — B3's quadrant click
   (risk/urgency thresholds ≥60/≥60) filters the in-memory scatter client-side and navigates to
   `/population/patients` with the filtered ids in router `state`; the list page reuses the
   existing `getPatient(id)`/`/patients/:id` unmodified. Confirmed live end-to-end in
   `director-population.spec.ts`: scatter click → `Critical — Act Now` filtered list → first row →
   `PatientDetail` renders `Active Conditions`.
5. **API-boundary tests for the population aggregate endpoints over seeded data** —
   `apps/api/src/routes/population.test.ts` (Supertest vs live HAPI): Director scatter ≥400 points,
   Director summary `criticalZoneCount > 0` / `projectedCostAvoidance > 0`, Coordinator → 403 + a
   `denied` row in `audit_log`, unauthenticated → 401. All passing in the §1 serial run.

No drift between what's claimed done and what the code does.

## 3. Spec-drift check (issues.md / implementation-plan.md vs. code)

- **`issues.md` S5 acceptance checkboxes were stale** (`[ ]` despite full implementation) — fixed
  to `[x]` in this pass (see §2).
- **`implementation-plan.md` Iteration 5 A1/A2/B1/B2/B3/C1/C2 were unchecked** — all now `[x]`,
  matching the actual committed state.
- **One implementation-pattern decision not spelled out in the plan, made and documented during
  this pass:** the plan's A1 wording said "Synthea import (~500)" without specifying real Synthea
  vs. a procedural stand-in. The user was asked directly (not decided silently) and chose a
  **deterministic procedural generator** over running actual Synthea — for testability/
  reproducibility (exact counts, no network/Java dependency, no flaky demographics). Documented in
  `population.ts`'s module doc comment and reflected in this file's evidence; `implementation-
  plan.md`'s A1 bullet text is otherwise unchanged since it doesn't literally mandate real Synthea.
- **B2's mockup deviations are documented in-code** (`Population.tsx`/`PopulationScatterChart.tsx`
  top-of-file comments): no week-over-week trend lines, Tasks Open/Readmissions Prevented as
  labeled placeholders, Care Team/HEDIS/Activity panels as "coming in a later slice" (no S6+ data
  exists yet), Run-Batch-Analysis/Deploy-All-Agents buttons omitted, canvas glow-pulse/tooltip and
  quadrant divider lines/labels deferred — all with reasons, not silent omissions. Mockup fidelity
  independently estimated at **~83%** during code review (§4), clearing CLAUDE.md's ≥80% bar.
- **No new backend endpoints were added by B3** (confirmed via `git diff --stat` in code review) —
  the drill-in reuses `/api/patients/:id` unmodified, consistent with the plan's "reuse the
  existing list/detail screens with a filter param, not new screens."
- Iteration 6+ (S6–S9) content already drafted in `implementation-plan.md`, per prior slices'
  verifications — not touched by this pass, still out of scope for S5.

## 4. Backend + frontend review pass (ahead of the formal `code-review` skill)

Every task (A1, A2, B1, B2, B3) went through subagent-driven-development's two-stage loop this
session: an implementer subagent (test-first/TDD) followed by an independent reviewer subagent that
re-read the code and re-ran the tests rather than trusting the implementer's report.

- **A1** — one review round: a documentation-accuracy bug (critical-zone comment said "≤168h" when
  the code's actual reachable threshold was "≤720h") and a dead-code `% items.length`. Both fixed
  and re-verified (8/8 green) before commit.
- **A2** — PASS on first review. Reviewer independently confirmed pagination actually returns the
  full cohort (not silently truncated at HAPI's default page size), the cost formula is genuinely
  pure and exactly fixture-matched, and the Director-only denial audit really writes a row (traced
  the code path, not just the test name).
- **B1** — PASS on first review. Nested-`RoleGuard` redirect logic confirmed sound, no double-
  redirect, unauthenticated still routes to `/login` first.
- **B2** — one review round: the quadrant divider lines/labels were dropped from the mockup without
  being listed in the deviation comment (CLAUDE.md requires deviations be *recorded*, not just
  made). Fixed by documenting the deviation (chose not to implement the visual feature — picking
  real risk/urgency quadrant thresholds is B3's job, not B2's). Reviewer's independent fidelity
  estimate: ~83%, clearing the ≥80% bar; computed-not-hardcoded verdict confirmed by grep (only
  hit for the mockup's `23`/`$247,400`/`847` literals is inside a doc comment disclaiming them).
- **B3** — PASS on first review. The highest-risk item — whether `pixelToQuadrant`/`unprojectPoint`
  are a genuine mathematical inverse of the paint projection, or a second hand-rolled formula that
  could silently drift — was verified by the reviewer working the algebra by hand. Confirmed a true
  bijective inverse sharing the same `interpolate` helper and padding constants, so hit-testing
  cannot drift from what's drawn. Two non-blocking nits (a duplicated `DOT_CLASS` map, a stale
  comment) were fixed directly after review rather than sent back through another subagent round.

This session also authored and hardened the S5 E2E spec itself (`director-population.spec.ts`):
one real flake was found and fixed (a filtered-list row briefly renders as a non-`Link` `<div>`
while its per-id fetch is in flight — the spec now waits for that state to clear before clicking)
and one timeout was legitimately widened (the population aggregate bulk-reads ~500 patients from
live HAPI and is the slowest fetch in the whole E2E suite, especially under 5-worker parallel
contention with other specs' API calls).

The formal `code-review` skill (Standards + Spec axes over the full branch diff since `main`) is
the next gate and is not pre-empted here.

## 5. Domain-term documentation check

New domain terms introduced by S5 — "population aggregate" (`getPopulationScatter`/
`getPopulationSummary`), "critical zone" (`CRITICAL_RISK_THRESHOLD`), "urgency" (encounter-recency
decay, distinct from `riskScore`), and the risk/urgency "quadrant" model (Critical — Act Now /
Monitor — Trending Up / Stable — Routine / Watch — Overdue Contact) — are documented inline via
module/function doc comments in `population.ts`, `population/service.ts`, and
`populationScatterGeometry.ts`, consistent with the "Domain rule:"/"ponytail:" annotation
convention already established in `implementation-plan.md` Iteration 5 and used by S2/S3.
`docs/agents/domain.md` still doesn't exist — the same pre-existing, deferred gap noted in every
prior slice's verification, unchanged by S5.

## 6. Evidence-boundary labeling (CLAUDE.md)

Per CLAUDE.md's evidence-boundaries rule: all evidence in this document is **local mock / packaged
UI strength** — a headless Playwright run and a Jest/Vitest suite against a local dev stack and a
disposable local Docker HAPI container. This is real, stronger than a curl-level check, and proves
the actual rendered UI and the actual HAPI-backed aggregates work together — but it is **not**
target-environment, client-accepted, or production-hardware evidence. No such claim is made here.

## 7. Gate outcome

**PASS.** All fresh command evidence is green (§1, serial run — the parallel-run flakiness is a
pre-existing, documented environmental coupling unrelated to this slice's code). Definition-of-done
(§2) and spec-drift (§3) checks found only stale-checkbox bookkeeping and one already-resolved
implementation-pattern decision, both fixed. Review passes (§4) caught and fixed two real, minor
findings (a documentation-accuracy bug in A1, an undocumented mockup deviation in B2) and one E2E
flake — none were product-behavior defects, and none remain open.

## Next step

`code-review`, covering the full branch diff since `main` along the Standards and Spec axes.
