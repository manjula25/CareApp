# Changelog: S5 — Population Dashboard + drill-in (Director)

**Type:** Feature

**Branch:** `feature/caresync-s5-population-dashboard` (branched off `feature/caresync-s4-agent-graph-cache`)

**Date:** 2026-07-05

## Summary

Delivers the Director's entry narrative (W02). On login a Director now lands on a Population Dashboard — ~500 patients as a native-Canvas risk×urgency scatter, a critical-zone count, a projected cost-avoidance figure, and KPI tiles — all computed live from a **population aggregate API over HAPI** (no chart library, GD10; no precomputed analytics store). Clicking a scatter quadrant drills to a filtered patient list and then into the existing patient detail view. This slice also finally loads the population cohort deferred from S1 — as a **deterministic procedural generator** (user-approved over running real Synthea, for testability/reproducibility) — and hardens the FHIR import to survive that ~10× larger payload.

## Changes Made

### Backend — Population cohort + per-patient RiskAssessment

- **Before:** HAPI held only the ~6 curated hero patients; no population-scale data existed (S1 deferred it as unused).
- **After:** A deterministic (`mulberry32`-seeded, no `Math.random()`/`Date.now()`) generator emits 500 patients (`pop-0001`..`pop-0500`, disjoint from hero ids) across all seven diabetes/CHF/depression condition mixes, with varied gender/age and US Core race+ethnicity extensions (the latter a deliberate hook for S8 demographic-parity, GD12). Each patient gets a `RiskAssessment` whose `prediction[0].probabilityDecimal` comes from a **documented heuristic** (base + per-condition + encounter-recency + comorbidity bonus, clamped), matching the exact shape the existing read path parses — so a meaningful, countable critical zone (`riskScore >= CRITICAL_RISK_THRESHOLD = 75`) exists in real data, not hardcoded.
- **Files changed:** `apps/api/src/fhir-data/population.ts` (new), `apps/api/src/fhir-data/seed-patients.ts` (`RaceEthnicity` type + field).

### Backend — Import robustness (real bug fixed)

- **Before:** `buildBundle()` assembled the whole cohort into a single `type:'batch'` POST. With ~2,500 entries this kept HAPI busy long enough that undici's headers timeout fired **before** the response returned — even though HAPI committed every entry — so `npm run fhir:import` reported a spurious failure on a successful load.
- **After:** `importBundle()` chunks the entries into 250-per-request batch POSTs; each returns well within the timeout, progress is logged, and the PUT-based idempotency is preserved. Re-run to completion with exit 0; hero patients + Coordinator Group intact.
- **Files changed:** `apps/api/src/scripts/import-fhir.ts`.

### Backend — Population aggregate API (audited, Director-only)

- **Before:** N/A.
- **After:** A `population/` service exposes `getPopulationScatter(actor)` → per-patient `{id, riskScore, urgency, x, y}` and `getPopulationSummary(actor)` → `{criticalZoneCount, projectedCostAvoidance, teamKpis}`, over `GET /api/population/scatter` and `/summary`. Reads go through the audited `FhirReadService` via a new `getPopulationRiskProfile` that bulk-reads RiskAssessment + Encounter and **paginates** (`_count=1000` + follows `link[rel=next]`, so it can't silently truncate). `criticalZoneCount` filters real scores against the imported `CRITICAL_RISK_THRESHOLD`; `projectedCostAvoidance` is a **pure, documented formula** (`Σ(riskScore/100) × AVOIDED_READMISSION_RATE × READMISSION_UNIT_COST_USD`) with named POC-assumption constants, fixture-tested to an exact value. Because `hasScope` grants both director and coordinator the clinical/demographic domains, Director-only is enforced by an explicit `assertDirector` role check that writes a **denial audit** and 403s a non-director; the success path audits the aggregate read once. `teamKpis` is an honest `{criticalZonePatients, totalPatients}` placeholder — no assignment data exists until S6/S7.
- **Files changed:** `apps/api/src/population/service.ts` (new), `apps/api/src/routes/population.ts` (new), `apps/api/src/fhir/client.ts` (`fetchPages`, `getPopulationRiskProfile`), `apps/api/src/index.ts` (route registration).

### Frontend — Director home route

- **Before:** `roleHome` sent director → `/coming-soon`.
- **After:** `roleHome` sends director → `/population` (coordinator → `/panel` unchanged); `/population` is registered behind the existing auth-gated `AppShell` layout and wrapped in a Director-only `RoleGuard role="director"` (new optional `role` prop that redirects a mismatched role to its own home).
- **Files changed:** `apps/web/src/auth/useAuth.tsx`, `apps/web/src/auth/RoleGuard.tsx`, `apps/web/src/App.tsx`.

### Frontend — W02 Population Dashboard (mockup fidelity ~83%)

- **Before:** `/population` was a placeholder.
- **After:** The full W02 dashboard driven by the aggregate API: a KPI tile row (critical-zone count and cost-avoidance are the **computed** API values, not the mockup's static `23`/`$247,400`; Total Patients and High Risk derived honestly from the data; Tasks Open / Readmissions Prevented as labeled `—` placeholders), a **native Canvas** risk×urgency scatter reusing the S4 canvas seam (pure `paintScatterFrame` + pure geometry, thin `useRef`/`getContext` component — no chart library), and Care Team / HEDIS / Activity panels as documented "Coming in a later slice" placeholders. All mockup deviations are recorded in-file with rationale, per CLAUDE.md.
- **Files changed:** `apps/web/src/pages/Population.tsx`, `apps/web/src/components/PopulationScatterChart.tsx` (new), `apps/web/src/lib/populationScatterGeometry.ts` (new), `apps/web/src/api/client.ts` (typed `getPopulationScatter`/`getPopulationSummary`).

### Frontend — Drill-in (cluster → filtered list → detail)

- **Before:** N/A.
- **After:** "Cluster" is modeled as a risk/urgency **quadrant** (thresholds ≥60/≥60, reusing `lib/patient.ts`'s amber-risk cutoff), not pixel-proximity clustering. A canvas click is mapped to its quadrant via `pixelToQuadrant`/`unprojectPoint` — the exact mathematical inverse of the paint projection (shared `interpolate` + padding constants), so hit-testing can't drift from what's drawn. The click filters the already-fetched scatter client-side and navigates to a new Director-only `/population/patients` route with the filtered ids in router `state`; that list page resolves names via the **existing** `getPatient(id)` per id (`useQueries`, isolated per-row failures) and links into the **unmodified** `PatientDetail` — no new backend endpoint, no new detail screen. Also hoisted the shared risk-dot Tailwind class map into `lib/patient.ts` as `RISK_DOT_CLASS` (was duplicated in `PatientPanel`).
- **Files changed:** `apps/web/src/pages/PopulationPatientList.tsx` (new), `apps/web/src/lib/populationScatterGeometry.ts` (quadrant model), `apps/web/src/components/PopulationScatterChart.tsx` (`onQuadrantClick`), `apps/web/src/pages/Population.tsx` (filter + navigate), `apps/web/src/lib/patient.ts` (`RISK_DOT_CLASS`), `apps/web/src/pages/PatientPanel.tsx` (use shared map), `apps/web/src/App.tsx` (route).

### This session's closeout — verification, code-review, and fixes found in review

Every task ran through subagent-driven-development's implementer→reviewer loop (test-first). Findings caught and fixed by review, not shipped: A1's critical-zone comment misstated its own threshold (≤168h vs the real ≤720h) + a dead-code `% items.length`; B2 dropped the mockup's quadrant divider lines/labels without documenting the deviation. The B3 reviewer hand-verified the geometry inverse (highest-risk correctness item) as a true bijection. `verification-before-completion` re-ran all evidence fresh and fixed stale `[ ]` checkboxes; `code-review` (Standards + Spec axes, parallel sub-agents) found 0 hard violations / 0 missing-or-wrong acceptance-bullet requirements — only non-blocking judgement-call smells and already-disclosed, approved deviations.

## Files Modified

| File | Change Description |
|------|---------------------|
| `apps/api/src/fhir-data/population.ts` | New — deterministic 500-patient generator + risk heuristic + `CRITICAL_RISK_THRESHOLD` |
| `apps/api/src/fhir-data/seed-patients.ts` | `RaceEthnicity` type + optional field (US Core, for S8) |
| `apps/api/src/scripts/import-fhir.ts` | Chunked ($batch) import so the ~2,500-entry cohort load doesn't hit the fetch headers timeout |
| `apps/api/src/population/service.ts` | New — `getPopulationScatter`/`getPopulationSummary`, pure cost formula, `assertDirector` + denial audit |
| `apps/api/src/routes/population.ts` | New — `/api/population/scatter` + `/summary`, 403/401 handling |
| `apps/api/src/fhir/client.ts` | New `fetchPages` (pagination) + `getPopulationRiskProfile` (audited bulk read) |
| `apps/api/src/index.ts` | Register `/api/population` router |
| `apps/web/src/auth/useAuth.tsx` | `roleHome` director → `/population` |
| `apps/web/src/auth/RoleGuard.tsx` | Optional `role` prop → role-mismatch redirect |
| `apps/web/src/App.tsx` | `/population` + `/population/patients` routes, Director-only |
| `apps/web/src/api/client.ts` | Typed `getPopulationScatter`/`getPopulationSummary` + interfaces |
| `apps/web/src/pages/Population.tsx` | W02 dashboard: computed KPI tiles, scatter, placeholders, quadrant-click drill-in |
| `apps/web/src/components/PopulationScatterChart.tsx` | New — native Canvas scatter + `onQuadrantClick` |
| `apps/web/src/lib/populationScatterGeometry.ts` | New — pure projection/quadrant math + inverse |
| `apps/web/src/pages/PopulationPatientList.tsx` | New — filtered drill-in list over existing `getPatient` |
| `apps/web/src/lib/patient.ts` | `RISK_DOT_CLASS` shared risk-dot class map |
| `apps/web/src/pages/PatientPanel.tsx` | Use shared `RISK_DOT_CLASS` |
| `apps/web/e2e/director-population.spec.ts` | New — Director login → dashboard → scatter click → filtered list → detail |
| `docs/plans/caresync-ai/{implementation-plan,issues}.md` | S5 task/AC checkboxes corrected to done |
| `docs/plans/caresync-ai/{verification,review}.md` | S5 verification + code-review gates recorded (S4 rotated to `-s4`) |

## Commits

| Commit | Description |
|--------|-------------|
| `b9783b0` | feat(S5): population cohort generator + Director home route (A1, B1) |
| `15b9b69` | feat(S5): population aggregate API + W02 dashboard (A2, B2) |
| `ed99a3b` | feat(S5): population scatter drill-in to filtered patient list (B3) |
| `9aeb1fd` | test(S5): Playwright E2E for the Director population flow (C2) |
| `b79fbe4` | docs(S5): verification-before-completion artifacts + checkbox closeout |
| `426db40` | docs(S5): two-axis code-review artifact (Standards + Spec) |

## Testing & Verification

**How to verify this works:**
- Load the cohort: `npm run fhir:import` (needs Docker HAPI up; idempotent)
- `cd apps/api && npx jest --runInBand` (serial — parallel workers flake on shared-HAPI contention, a pre-existing environment issue, not an S5 regression)
- `cd apps/web && npm test`
- `cd apps/web && npx playwright test` (needs Docker HAPI + API:4000/Vite:5173 via `playwright.config.ts`)

**Test results (this session, 2026-07-05, fresh):** API **23/23 suites, 106/106 tests** (serial), web **12/12 files, 108/108 tests**, E2E **8/8** (incl. the new Director flow, standalone + under 5-worker parallel load), both `tsc --noEmit` exit 0. Live HAPI confirmed at 506 patients / 506 RiskAssessments. Full evidence + strength-labeling in `docs/plans/caresync-ai/verification.md`; Standards/Spec findings in `docs/plans/caresync-ai/review.md`.

## Notes

- **Deterministic generator, not real Synthea** — a deliberate, user-approved substitution for testability/reproducibility (exact seeded counts, no Java/network dependency, no flaky demographics). Documented in `population.ts` and `verification.md`; the plan/issues "Synthea" wording is otherwise unchanged.
- **Evidence strength:** local mock / packaged UI — headless Playwright + Jest/Vitest against a local dev stack and disposable Docker HAPI. Not target-environment or client-accepted.
- **Non-blocking debt (from `review.md`):** patient-row JSX duplicated between `PopulationPatientList` and `PatientPanel`; `/scatter` + `/summary` share an identical error→403 block (matches the existing `analysis.ts` pattern); `RaceEthnicity` has no consumer until S8; mild condition-library primitive obsession. None block this branch.
- **Prose-only scope deferred (correctly, not in the 5 acceptance bullets):** team KPIs / coordinator workload (needs S6/S7 assignment data), HEDIS, cost-avoidance updating on assignment (PRD stories 7–9) — all shipped as honest placeholders, not faked.
- **`docs/agents/domain.md` / `docs/domain/*` still don't exist** — the same pre-existing, deferred gap noted in every prior slice's verification; S5 documents its new terms inline instead.
