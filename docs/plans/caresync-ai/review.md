# Code Review — CareSync AI, S5 (Population Dashboard + drill-in, Director)

> **PLAN_ID:** `caresync-ai` · **Slice:** S5 · **Date:** 2026-07-05
> **Fixed point:** `9e2f01c` (last S4 commit) → `HEAD` (`b79fbe4`), fully committed. Two-axis review
> (Standards + Spec) run as parallel sub-agents over `git diff 9e2f01c...HEAD` (31 files, +2396/−106).
> Spec sources: `implementation-plan.md` Iteration 5, `issues.md` S5, `prd.md` Director stories 1–4.
> Prior slice's review preserved at `review-s4.md`.
>
> Commits reviewed:
> - `b9783b0` feat(S5): population cohort generator + Director home route (A1, B1)
> - `15b9b69` feat(S5): population aggregate API + W02 dashboard (A2, B2)
> - `ed99a3b` feat(S5): population scatter drill-in to filtered patient list (B3)
> - `9aeb1fd` test(S5): Playwright E2E for the Director population flow (C2)
> - `b79fbe4` docs(S5): verification-before-completion artifacts + checkbox closeout

## Standards

**Hard documented-standard violations: none found.** Checked against CLAUDE.md's specific rules:
- FHIR reads are audited exactly once per aggregate (`apps/api/src/fhir/client.ts:293` success audit;
  `apps/api/src/population/service.ts` denial audit on the Director-only gate) — consistent with the
  existing `getAssignedPanel` "audit once per externally-observable action" precedent, and documented.
- Mockup fidelity deviations (`apps/web/src/pages/Population.tsx` top-of-file comment,
  `apps/web/src/components/PopulationScatterChart.tsx` doc comment) are explicitly recorded with
  rationale, per the CLAUDE.md rule to document intentional deviations.
- `any` usage in `client.ts`'s new `getPopulationRiskProfile`/`fetchPages` matches the pre-existing
  idiom already used throughout that file for FHIR bundle parsing — not a new deviation.
- Tests are colocated (`*.test.ts`/`*.test.tsx` next to source) throughout.

**Baseline smells (judgement calls, all non-blocking):**
1. `apps/web/src/pages/PopulationPatientList.tsx` — patient-row markup duplicated from
   `PatientPanel.tsx` rather than shared (**Duplicated Code**), despite the file's own comment
   defending the split. (Note: the shared risk-dot class map WAS hoisted to `lib/patient.ts` as
   `RISK_DOT_CLASS` during B3 review; the remaining duplication is the row JSX itself.)
2. `apps/api/src/routes/population.ts` — `/scatter` and `/summary` handlers repeat an identical
   error→403 try/catch (**Duplicated Code**); noted as following (not introducing) the same repeated
   pattern already present 3× in `routes/analysis.ts`.
3. `apps/api/src/fhir-data/seed-patients.ts` — `RaceEthnicity` field added for the not-yet-built S8
   demographic-parity feature (GD12), with no current consumer (**Speculative Generality**). Mild —
   it is a deliberate, spec-referenced hook for the next-but-one slice, not idle abstraction.
4. `apps/api/src/fhir-data/population.ts` — `ConditionKey`/`CONDITION_LIBRARY`/`CONDITION_MIXES` mild
   **Primitive Obsession**; adding a 4th condition would touch three separate spots.

None override or contradict a documented CLAUDE.md standard.

## Spec

Reviewed against `issues.md`'s 5 S5 acceptance bullets, `implementation-plan.md` Iteration 5
(A1–C2), and PRD Director stories 1–4.

**Verified as correctly implemented (not just claimed):**
- `getPopulationScatter`/`getPopulationSummary` (`population/service.ts:110-139`) genuinely compute
  from live HAPI reads via `FhirReadService.getPopulationRiskProfile` (`client.ts:286-314`), which
  pages with `_count=1000` + `fetchPages` following `link[rel=next]` — no truncation, no hardcoded
  numbers. `criticalZoneCount` filters real scores against `CRITICAL_RISK_THRESHOLD`;
  `projectedCostAvoidance` is a documented pure formula, fixture-tested to an exact value.
- Director-only enforcement is real at both layers: `assertDirector` (`service.ts:22-31`, denial
  audit written) and `RoleGuard role="director"` (`App.tsx:27,35`); `roleHome` (`useAuth.tsx:64-68`)
  routes director→`/population`, coordinator→`/panel`.
- Drill-in (`PopulationPatientList.tsx`) reuses the existing `getPatient(id)`/`/patients/:id`
  endpoint unmodified — no new detail screens (confirmed via `git diff --stat`).
- API-boundary tests (`routes/population.test.ts`) are real Supertest calls against live HAPI
  (not mocked): scatter ≥400 points, summary > 0, Coordinator 403 + denial-audit row, 401
  unauthenticated.

**Findings (both low-severity, self-disclosed in `verification.md`, confirmed independently):**
1. **Spec-text deviation (disclosed, approved):** plan/issues text says "Synthea import (~500),"
   but `population.ts` is a deterministic mulberry32 procedural generator, not real Synthea —
   documented in-code and in `verification.md` as a deliberate, user-approved substitution for
   testability/reproducibility.
2. **Prose-only gap (not an acceptance bullet):** PRD story 8 / plan prose promise "team KPIs"
   (coordinator workload); shipped `teamKpis` is `{criticalZonePatients, totalPatients}` and the
   Care Team panel is an honest "Coming in a later slice" placeholder — correctly deferred, since it
   needs S6/S7 assignment data. Not one of the 5 issues.md acceptance bullets, so not a missing
   acceptance criterion.

No scope creep beyond spec; no acceptance-bullet requirement missing or wrong.

## Summary

- **Standards:** 0 hard violations; 4 non-blocking judgement-call smells. Worst within axis: the
  duplicated patient-row markup between `PopulationPatientList` and `PatientPanel` (#1) — a
  reasonable-to-defer reuse opportunity, not a defect.
- **Spec:** 0 missing/wrong acceptance-bullet requirements; 2 low-severity items, both already
  disclosed in `verification.md`. Worst within axis: the "Synthea" spec-text vs. procedural-generator
  wording gap (#1) — a user-approved, documented substitution, not undisclosed drift.

**Outcome:** no blocking findings on either axis. The four Standards smells and two Spec items are
all judgement calls or already-disclosed, approved deviations — none require a code change before
shipping S5. Left as-is deliberately (documented here for the record).

## Next step

`finishing-a-development-branch`.
