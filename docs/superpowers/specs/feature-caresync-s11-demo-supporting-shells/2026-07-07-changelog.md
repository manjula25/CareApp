# Changelog: S11 — Demo-supporting + shell screens

**Type:** Feature

**Branch:** `feature/caresync-s11-demo-supporting-shells` (branched off `main` at the S10 merge,
`f3f4b77` — S11 is blocked by S5 + S7, both already merged)

**Date:** 2026-07-07

## Summary

Delivers the demo-supporting screen tier (GD9): SDOH resource directory + audited FHIR
`ServiceRequest` referral (M05), a real HEDIS-style diabetes/HbA1c measure with an illustrative
incentive-dollar estimate (W05/W07), and a Director-only team performance view computed live from
real Task ownership (W04) — plus navigation-only, honestly-labeled shells for the 11 remaining
undefined screens (W08–W11, W13, W15, W16, M06, M07, M09, M10). Three lower-priority items with no
mockup (M04, M08, W14) were deliberately capacity-flexed per the plan's own scope-flex clause,
recorded rather than built.

## Changes Made

### Backend + Frontend — SDOH resource directory + referral (A1)

- **Before:** no SDOH surface existed.
- **After:** `apps/api/src/sdoh/resources.ts` holds a static community-resource seed list (12
  entries, ≥2 per category). `FhirReadService.createServiceRequest` (mirrors `createTask`'s
  guard→POST→audit shape) writes a real, audited FHIR `ServiceRequest` on referral. `GET
  /api/sdoh/resources` + `POST /api/sdoh/referrals` are thin route shells. `Sdoh.tsx` (patient-scoped,
  `/patients/:id/sdoh`) renders category tabs + resource cards against
  `reference-materials/caresync-sdoh-mobile.html`'s content region, with a per-card referral
  mutation and honest inline success/error states.
- **Files changed:** `apps/api/src/sdoh/resources.ts`+test (new), `apps/api/src/fhir/client.ts`,
  `apps/api/src/fhir/client.test.ts`, `apps/api/src/routes/sdoh.ts`+test (new),
  `apps/api/src/index.ts`, `apps/web/src/api/client.ts`, `apps/web/src/pages/Sdoh.tsx`+test (new),
  `apps/web/src/App.tsx`, `apps/web/src/pages/PatientDetail.tsx`.

### Backend + Frontend — Quality/HEDIS view (A2)

- **Before:** no Quality/HEDIS surface existed. The reference mockup
  (`caresync-quality-roi.html`) is a pitch-deck-style mockup containing fabricated financial
  content (a `$4.78M` "ROI Calculator," a donut chart with invented cost-avoidance categories, a
  named-patient cost-savings table, a trend chart implying historical data this system doesn't
  have).
- **After:** `apps/api/src/quality/service.ts`'s `getDiabetesHba1cMeasure` computes ONE real HEDIS
  measure — "Comprehensive Diabetes Care: HbA1c Testing" — from two live FHIR bulk searches
  (Condition ICD-10-CM `E11.9`, Observation LOINC `4548-4`; 286 vs. 1 in the seeded environment,
  a genuine, stark care-gap signal). Gap count and an illustrative (clearly UI-labeled, not
  presented as real financial data) incentive-dollar estimate are derived from that real gap.
  `Quality.tsx` renders it with a native-Canvas gauge (`QualityGaugeChart.tsx`, no chart library,
  per GD10) and documents every dropped mockup element in a top-of-file deviation-note comment,
  same discipline as `Governance.tsx` (S8). Director-only gating (review-caught, see Commits).
- **Files changed:** `apps/api/src/fhir/client.ts` (`getResourceCountByCode`),
  `apps/api/src/quality/service.ts`+test (new), `apps/api/src/routes/quality.ts`+test (new),
  `apps/api/src/index.ts`, `apps/web/src/api/client.ts`,
  `apps/web/src/lib/qualityChartGeometry.ts`+test (new),
  `apps/web/src/components/QualityGaugeChart.tsx`+test (new), `apps/web/src/pages/Quality.tsx`+test
  (new), `apps/web/src/App.tsx`, `apps/web/src/components/AppShell.tsx`.

### Backend + Frontend — Team performance view (A3)

- **Before:** no team-performance surface existed.
- **After:** `FhirReadService.getTaskOwnershipSummary` (new sibling to `listTasks`, same
  Group→patients→`$everything` discovery pattern) extracts raw Task status + owner. Director-only
  `apps/api/src/team/service.ts`'s `getTeamPerformance` joins that against the real `users` table
  to compute live per-coordinator assigned/completed/completion-rate plus an unassigned count.
  `Team.tsx` renders a summary row + per-coordinator progress bars, with an honest empty/all-zero
  state (the seeded environment starts at 0 assigned/0 completed/7 unassigned since no frontend
  flow calls the existing S6 A1 assign endpoint yet — real current state, not a stub).
- **Files changed:** `apps/api/src/fhir/client.ts` (`getTaskOwnershipSummary`),
  `apps/api/src/team/service.ts`+test (new), `apps/api/src/routes/team.ts`+test (new),
  `apps/api/src/index.ts`, `apps/web/src/api/client.ts`, `apps/web/src/pages/Team.tsx`+test (new),
  `apps/web/src/App.tsx`, `apps/web/src/components/AppShell.tsx`.

### Frontend — Navigation-only shell screens (B1)

- **Before:** 11 screen IDs (W08, W09, W10, W11, W13, W15, W16, M06, M07, M09, M10) existed only
  as entries in `plan.md`'s GD9 screen-tier table, with no defined name/purpose anywhere in this
  repo, plus one bespoke pre-existing shell (`TaskCenter.tsx`, W13, S7 B3).
- **After:** one route→title table (`apps/web/src/lib/shellScreens.ts`) plus a parameterized
  `ComingSoon` component render all 11 — neutrally labeled ("Screen W08," etc.) for the 10
  genuinely-undefined IDs, and folding W13's real "Task Management Center" identity into the same
  shared pattern (same `/task-center` route, same nav link, bespoke file deleted). Reachable via
  one new "More" nav link (all roles) → `/more` index, since none of the 11 has a defined
  role-owner.
- **Files changed:** `apps/web/src/lib/shellScreens.ts` (new), `apps/web/src/pages/ComingSoon.tsx`+test,
  `apps/web/src/pages/ShellScreenPage.tsx`+test (new), `apps/web/src/pages/MoreScreens.tsx`+test
  (new), `apps/web/src/App.tsx`, `apps/web/src/components/AppShell.tsx`+test,
  `apps/web/src/pages/TaskCenter.tsx` (deleted).

### Capacity-flex decision (A4) — deferred, recorded

- M04 (Patient quick profile), M08 (Today/Schedule), W14 (Care Plan builder) were **not built**
  this pass. None has a reference mockup; M04/M08 each meaningfully overlap an already-shipped
  screen (`PatientDetail.tsx`, `TaskQueue.tsx`) without a mockup to define what's distinct; W14 is
  a new FHIR `CarePlan` write surface, not a partial-depth read view. Per the plan's own scope-flex
  clause ("stop at capacity, record what's partial"), this was a deliberate, documented decision,
  not a silent gap.
- **Files changed:** `docs/plans/caresync-ai/tasks/todo.md` (capacity-flex rationale recorded).

### Verification + Review

- `docs/plans/caresync-ai/verification-s11.md` — fresh command evidence (API/web/E2E all green),
  definition-of-done check (5/5 S11 acceptance bullets met), spec-drift check, review-notes
  summary, domain-term documentation check, evidence-boundary labeling.
- `docs/plans/caresync-ai/review-s11.md` — two-axis (Standards + Spec) review. One hard Standards
  finding (an undocumented `Team.tsx`/`Governance.tsx` component duplication) found and fixed;
  zero Spec findings.
- Two new Playwright E2E specs (`apps/web/e2e/sdoh-referral.spec.ts`,
  `apps/web/e2e/director-quality.spec.ts`) drive the real API + live HAPI, no mocks.

## Files Modified

| File | Change Description |
|------|---------------------|
| `apps/api/src/fhir/client.ts` | New methods: `createServiceRequest`, `getResourceCountByCode`, `getTaskOwnershipSummary` (all additive) |
| `apps/api/src/sdoh/resources.ts` | New — static community-resource list + `listResourcesByCategory` |
| `apps/api/src/quality/service.ts` | New — real diabetes/HbA1c HEDIS measure aggregate, Director-only |
| `apps/api/src/team/service.ts` | New — live coordinator workload/completion aggregate, Director-only |
| `apps/api/src/routes/{sdoh,quality,team}.ts` | New — thin router shells over the above |
| `apps/api/src/index.ts` | Mounts `/api/sdoh`, `/api/quality`, `/api/team` |
| `apps/web/src/pages/Sdoh.tsx` | New — M05 SDOH directory + referral screen |
| `apps/web/src/pages/Quality.tsx` | New — W05/W07 Quality/HEDIS screen |
| `apps/web/src/pages/Team.tsx` | New — W04 Team performance screen |
| `apps/web/src/components/{QualityGaugeChart,StatTile}.tsx` | New — native-Canvas gauge; shared stat-tile atom (review fix) |
| `apps/web/src/lib/{qualityChartGeometry,shellScreens}.ts` | New — chart layout math; shell route→title table |
| `apps/web/src/pages/{ShellScreenPage,MoreScreens}.tsx` | New — shared shell renderer + reachability index |
| `apps/web/src/pages/TaskCenter.tsx` | Deleted — folded into the shared shell pattern |
| `apps/web/src/pages/ComingSoon.tsx` | Extended with an optional `title` prop |
| `apps/web/e2e/{sdoh-referral,director-quality}.spec.ts` | New — C2 E2E coverage |
| `docs/plans/caresync-ai/tasks/todo.md` | New — active-slice mirror, checkboxes, A4 capacity-flex rationale |
| `docs/plans/caresync-ai/verification-s11.md` | New — verification-before-completion artifact |
| `docs/plans/caresync-ai/review-s11.md` | New — two-axis code-review artifact |

## Commits

| Commit | Description |
|--------|-------------|
| `f699bd9` | feat(S11): A1 — SDOH resource directory + referral (M05) |
| `4eb6f9f` | feat(S11): A2 — Quality/HEDIS view (W05/W07) |
| `6748d80` | fix(S11): A2 review — gate quality/HEDIS aggregate Director-only |
| `3c819ed` | feat(S11): A3 — Team performance view (W04) |
| `37a2df2` | docs(S11): capacity-flex A4 — defer M04/M08/W14 |
| `7b05a3d` | feat(S11): B1 — navigation-only shell screens |
| `7f57b5d` | test(S11): C2 — Playwright E2E for SDOH referral + Quality view |
| `bfffef8` | docs(S11): close out A1-A3/B1/C1-C2 checkboxes with commit/review refs |
| `e6154b7` | docs(S11): verification-before-completion pass |
| `23069ff` | refactor(S11): review fix — extract shared StatTile component |
| `87c34c4` | docs(S11): two-axis code-review artifact (Standards + Spec) |

## Testing & Verification

**How to verify this works:**
- `cd apps/api && npx jest --runInBand` (requires the local HAPI FHIR container running + seeded:
  `npm run fhir:up && npm run fhir:import`)
- `cd apps/web && npx vitest run`
- `npx playwright test --config=apps/web/playwright.config.ts --workers=1` (full E2E suite)
- `npx tsc --noEmit` in both `apps/api` and `apps/web`

**Test results (this session, 2026-07-07, fresh, re-confirmed before finishing):** `apps/api` —
**37 suites / 232 tests passed**; `apps/web` — **27 files / 225 tests passed**; Playwright E2E —
**16/16 passed** with `--workers=1` (the default concurrent-workers run intermittently shows 2
pre-existing, unrelated failures from HAPI request contention under load — confirmed by re-running
serially). `tsc --noEmit` exit 0 in both workspaces.

## Notes

- **One review-driven backend fix, its own commit:** A2's `assertDirector` gate was initially
  omitted with a doc comment incorrectly claiming Population's aggregates were merely
  clinical-scope-gated (they're actually Director-only end-to-end) — this created a real UI/API
  scope mismatch (frontend already Director-only, backend wasn't). Fixed in `6748d80`: gated
  Director-only to match the real Population/Governance precedent, both test suites re-verified
  green.
- **One review-driven frontend fix, its own commit:** `Team.tsx` had reimplemented an
  undocumented, near-verbatim copy of `Governance.tsx`'s stat-tile component. Extracted to
  `apps/web/src/components/StatTile.tsx` in `23069ff`, used by both screens.
- **Two duplication smells confirmed and left as documented judgement calls:** the
  `assertDirector` role-check function is now duplicated across 3 modules
  (`governance/quality/team` `service.ts`), and `AppShell.tsx`'s 5 sequential role-gated nav-link
  blocks share one shape — both flagged in `review-s11.md`, both non-blocking, matching this
  repo's established tolerance for structurally similar shapes (see S10's review).
- **Honest-staging discipline was the central design constraint for A2**: the reference mockup's
  ROI donut chart, named-patient cost-savings table, ROI calculator, and trend chart were all
  fabricated content with no real backing data in this system and were deliberately dropped, not
  ported — documented in `Quality.tsx`'s own deviation-note comment.
- **A4's capacity-flex decision is a deliberate, recorded scope reduction**, not a missed
  requirement — `issues.md`'s S11 acceptance criteria checklist never references M04/M08/W14; the
  plan's own text explicitly allows scope to flex to capacity.
- **Evidence strength:** local, but against a real, seeded HAPI FHIR server (not a mocked FHIR
  layer) for every test touching `FhirReadService`; the 2 new E2E specs are local-mock/packaged-UI
  strength (real headless Chromium against the real local API + local HAPI) — not
  target-environment or client-accepted evidence.
- **An unrelated HAPI container restart mid-session** (operator action, investigating transient
  test flakiness) wiped the container's non-persistent data; reseeded via `npm run fhir:import`
  before the final test confirmation above. Not a code defect, not part of this diff.
