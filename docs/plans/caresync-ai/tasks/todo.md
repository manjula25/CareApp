# Active slice: S11 — Demo-supporting + shell screens

## Approved: yes

Source: `implementation-plan.md` → "Iteration 11 — S11 Demo-supporting + shell screens — 2026-07-04".
Spec: `prd.md` (stories 8, 9, 26, 30; GD9 tiers). Decisions: GD9 (three screen tiers), GD10
(design-system fidelity), honest staging (no placeholder-as-real). Blocked by S5 + S7 — both
merged to `main` (PR #8, #9) — unblocked.

**Goal:** Breadth once the design system is established. Build the demo-supporting tier to
designed/partial depth — SDOH resource directory + referral (M05), Quality/HEDIS (W05/W07),
Team performance (W04), Patient quick profile (M04), Today/Schedule (M08), Care Plan builder
(W14) — and navigation-only shells for the remaining screens (W08–W11, W13, W15, W16, M06,
M07, M09, M10) with honest placeholder content. Scope flexes to remaining capacity; the six
demo-critical screens keep priority.

**Architecture:** Mostly frontend against the established design system + existing aggregate
APIs, with two small real backends: SDOH referral creates a FHIR `ServiceRequest` (audited
write, S3 client); Quality/HEDIS derives measure progress + incentive dollars from FHIR data
(small `quality/` aggregate). Shells are routed `ComingSoon`-style pages with consistent
styling and explicitly-staged placeholder content (never presented as functional). Reference
mockups: `caresync-sdoh-mobile.html`, `caresync-quality-roi.html`.

**Ponytail pass applied:** demo-supporting screens to partial depth only (GD9) — not full
features; shells reuse the existing `ComingSoon` component, not bespoke pages; referral is one
`ServiceRequest` write reusing the S3 client; HEDIS is a derived aggregate, not a measure
engine; capacity-flexed — demo-critical screens always win; honest staging enforced (no
fake-functional content).

## Phase A — Demo-supporting screens (partial depth)

- [x] A1. SDOH resource directory + referral (M05, `caresync-sdoh-mobile.html`). List
  community resources by category (transportation/food/housing/mental health); a referral
  creates a FHIR `ServiceRequest` (audited).
  - Domain rule: referral creates a FHIR ServiceRequest (S11 acceptance, story 30); write audited.
  - Test (Supertest): referral POSTs a resolvable ServiceRequest; (Vitest) directory renders by category.
  - Commit `f699bd9`, reviewed APPROVED_WITH_NITS (non-blocking).
- [x] A2. Quality/HEDIS view (W05/W07, `caresync-quality-roi.html`). Measure progress +
  incentive dollars at stake, derived from FHIR data; native Canvas charts (GD10). Story 9.
  - Test: aggregate computes measure progress over seeded data; view renders it.
  - Real HEDIS measure computed live from FHIR (diabetes Condition E11.9 vs. HbA1c Observation
    LOINC 4548-4 — 286 vs. 1 in the seeded environment); incentive-dollar figure is explicitly
    labeled illustrative, not a real financial record. Mockup's fabricated ROI donut/cost-events
    table/ROI calculator/trend chart dropped entirely (no real backing data) — documented in
    `Quality.tsx`'s deviation-note doc comment, same discipline as `Governance.tsx`.
  - Commit `4eb6f9f` + review fix `6748d80` (gated Director-only to match Population/Governance's
    actual precedent, corrected a misleading doc comment). Re-reviewed APPROVED.
- [x] A3. Team performance (W04). Coordinator workload + completion rates from
  Task/assignment data. Story 8.
  - Computed live from real Task ownership/status (Director-only, matching Population/
    Governance/Quality). Fresh-environment state is honestly 0 assigned/0 completed/7
    unassigned (no frontend UI calls the existing assign endpoint yet) — this is correct,
    not a bug; the aggregate updates the moment a live assignment/completion happens.
  - Commit `3c819ed`, reviewed APPROVED (no issues).
- [x] A4. Remaining supporting screens as capacity allows. Patient quick profile (M04),
  Today/Schedule (M08), Care Plan builder (W14 — FHIR CarePlan, story 26) to partial depth.
  - ponytail: build in priority order; stop at capacity, record what's partial (honest staging).
  - **Capacity-flex decision (2026-07-07): deferred, not built this pass.** None of M04/M08/
    W14 has a reference mockup (unlike A1/A2), and each meaningfully overlaps existing,
    already-shipped screens without a clear differentiated spec: M04 "Patient quick profile"
    would duplicate `GET /api/patients/:id` + `PatientDetail.tsx` (S1/S7) without a mockup to
    define what's distinctly "quick" about it; M08 "Today/Schedule" would duplicate
    `listTasks`/`TaskQueue.tsx` (S7 B1, already priority+due-sorted) without a mockup to
    define a distinct schedule/calendar treatment; W14 "Care Plan builder" is a new FHIR
    `CarePlan` write surface — real new backend scope, not a partial-depth read view like the
    other two. Per this task's own ponytail note ("stop at capacity, record what's partial")
    and the iteration's scope-flex clause, A1 (SDOH)/A2 (Quality)/A3 (Team) — the three items
    with real mockups or unambiguous specs and no existing-screen overlap — were built to
    completion instead; M04/M08/W14 are left for a future slice once mockups or a sharper
    spec exist. No shell/placeholder was built for these three either (that would misrepresent
    them as "coming soon" nav entries when they're not in the B1 shell list).

## Phase B — Shell screens

- [x] B1. Navigation-only shells. W08, W09, W10, W11, W13, W15, W16, M06, M07, M09, M10 as
  styled placeholder pages in navigation.
  - ponytail: one `ComingSoon` component driven by a route→title table (the S1 `ComingSoon`
    page already exists) — 11 rows of data, not 11 files.
  - Domain rule: no shell presents placeholder data as real/functional (S11 acceptance — honest staging, gate G4).
  - Test (Vitest): each shell route renders with consistent styling + an explicit "coming soon / not yet functional" treatment.
  - None of these 11 IDs has a defined name/purpose anywhere in this repo's docs, so the 10
    genuinely-undefined ones are labeled neutrally ("Screen W08", etc.) rather than inventing
    plausible-sounding feature names. W13 already had a real, shipped identity ("Task
    Management Center", S7 B3) — folded its bespoke `TaskCenter.tsx` into the shared
    table/component (same route, same nav link) rather than leaving a near-duplicate file.
    Reachable via one new "More" nav link (all roles) → `/more` index, since none of the 11
    has a defined role-owner.
  - Commit `7b05a3d`, reviewed APPROVED (no issues).

## Phase C — Verification

- [x] C1. `npm run test:api` (referral + HEDIS aggregate) + `npm run test:web` (screens/shells).
  - API: 37 suites / 232 tests pass (against live seeded HAPI). Web: 27 files / 225 tests pass.
- [x] C2. Frontend E2E (`frontend-e2e-verification`) for the demo-supporting screens that
  carry real behavior (SDOH referral, Quality view render). Shells covered by render tests.
  - `apps/web/e2e/sdoh-referral.spec.ts` + `director-quality.spec.ts`, both driving the real
    API + live HAPI (no mocks). Full `apps/web/e2e` suite: 16/16 pass with `--workers=1` (the
    default concurrent run shows 2 pre-existing, unrelated failures from HAPI contention under
    load, confirmed by re-running serially — not a regression). Commit `7f57b5d`.
  - Evidence strength (per CLAUDE.md's evidence boundaries): local mock / packaged-UI —
    headless Playwright against the local dev stack, not target-environment or
    client-accepted evidence.

## Rollback / safety

ServiceRequest writes audited + HAPI-reversible. Shells are inert. Honest-staging is the
safety property here: partial/placeholder content is explicitly labeled so the demo never
overclaims (G4).

## Definition of done (S11) — maps to `issues.md`

- SDOH directory lists resources by category; referral creates a ServiceRequest (A1).
- Quality/HEDIS shows measure progress + incentive dollars from FHIR data (A2).
- Team performance shows workload + completion rates (A3).
- Shell screens exist in nav with consistent styling + placeholder content (B1).
- No shell presents placeholder data as real (B1 — honest staging).
