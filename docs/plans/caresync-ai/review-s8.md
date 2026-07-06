# Code Review — CareSync AI, S8 (AI Governance & audit dashboard, W06)

> **PLAN_ID:** `caresync-ai` · **Slice:** S8 · **Date:** 2026-07-06
> **Diff:** `main` (`1701001`) `...HEAD` (`6267623` at review time), 3 commits.
> **Spec sources:** `docs/plans/caresync-ai/issues.md` S8, `implementation-plan.md` Iteration 8,
> `verification-s8.md`. This repo has no `CODING_STANDARDS.md`/`CONTRIBUTING.md` and `CLAUDE.md`'s
> "Code style" section is an empty placeholder — the Standards axis instead measured the diff against
> the closest established sibling module (`population/service.ts` + `routes/population.ts`, S5's
> Director-only aggregate pattern) plus the fixed Fowler smell baseline. Prior review preserved at
> `review-s7.md` (S1–S7 cumulative).

## Standards

**Convention match: strong.** `governance/service.ts`/`routes/governance.ts` closely mirror
`population/service.ts`/`routes/population.ts` — same `assertDirector` shape (role check → denial
audit → throw `DirectorOnlyError`), same single-error-type → 403 mapping, same doc-comment density
explaining *why* (POC assumptions, deviation notes, honest-empty-state framing). `fhir/client.ts`'s
new `getPatientDemographics` follows `getPopulationRiskProfile`'s bulk-read/single-audit pattern and
reuses the existing `'demographic'` scope domain rather than inventing one. `apps/web/src/api/client.ts`
additions match the file's existing doc-comment-per-interface style. `Governance.tsx` follows
`Population.tsx`'s "own only `.main`" convention and documents every intentional mockup deviation.

**Hard finding, fixed during this review:** `governance/service.ts` had more pure logic than
`population/service.ts` (`bucketFor`, `stratify`, `ageFromBirthDate`, `extractConfidences`) but, unlike
`population/service.ts`'s `projectedCostAvoidance` (which has its own `service.test.ts` "so it's
unit-testable against a fixed fixture"), none of it had a direct unit test — boundary cases (confidence
exactly 0.5/0.7/0.85, a birthdate landing exactly on today's month/day) were only incidentally covered
via HTTP fixtures. **Fixed**: exported all four helpers and added
`apps/api/src/governance/service.test.ts` (15 tests covering every stated boundary + the
skip-undefined-group rule + empty-input cases). Re-verified: `tsc --noEmit` clean, 176/176 API tests
pass (commit `249a9af`).

**Baseline smell found, left as-is (judgement call, not fixed):** Duplicated Code — the identical
try/catch → `DirectorOnlyError`/`ScopeDeniedError` → 403 block appears 4x verbatim in
`routes/governance.ts` (audit/model/parity/eval), extending a pattern `population.ts` already
establishes at 2 sites. Not new duplication shape, and refactoring it here (e.g. a
`withDirectorErrorMapping(handler)` wrapper) would leave `population.ts` inconsistent with it unless
also refactored — out of scope for this slice. Left as a documented judgement call rather than fixed
unilaterally; worth revisiting if a fifth Director-only router is added.

Not flagged, considered and dismissed: the 4x route-handler shape above also isn't a Shotgun Surgery
risk in practice yet (all 4 handlers changed together, in the same commit, when this module was
authored — the risk is hypothetical, not observed); `extractOmbCategoryDisplay`'s `any` usage matches
existing untyped-FHIR-resource conventions elsewhere in `client.ts`; `parseNonNegativeInt` is a stated,
deliberate new pagination convention (no prior list endpoint paginates), not a silent deviation;
`Governance.tsx`'s 315 lines are comment-heavy mockup-deviation documentation, not unexplained
complexity.

## Spec

**Verdict: clean.** No missing/partial requirements, no scope creep, no wrong-implementation findings
survive verification.

- **Phase A test rigor** (the area most worth checking closely): `routes/governance.test.ts` genuinely
  satisfies the plan's specific bullets, not just happy-path/401/403. The `/model` test hand-computes
  exact bucket counts from seeded confidences (plan A2: *"distribution computed from seeded cache rows
  matches expected buckets"*). The `/parity` test seeds a real, deliberately-imbalanced HAPI fixture and
  asserts the Black/female/65+ group's avg risk exceeds the White/male/18-34 group's (plan A3: *"a
  known-imbalanced fixture yields the expected disparity direction"*). This review's own fix (above)
  closes the one remaining gap — pure-function boundary cases weren't previously pinned directly.
- **Phase B ≥80% fidelity bar**: `Governance.tsx`'s header comment enumerates every dropped mockup
  element with a stated no-backing-data reason; structural regions (banner / 4-tile zone-2 / 3-column
  zone-3, native Canvas per GD10) are preserved. Estimate (~80-85%) is plausible and not contradicted
  by the diff.
- **Phase C verification claims**: `apps/web/e2e/director-governance.spec.ts` exists and covers exactly
  what `verification-s8.md` claims (login → nav → audit rows / model version / confidence canvas /
  parity canvas / eval empty-state), against real `data-testid`s in `Governance.tsx`.
- **GD10 (native Canvas, no chart library)**: confirmed — `ConfidenceChart.tsx`/`ParityRadarChart.tsx`
  import only React hooks and draw via `<canvas>` directly.
- **Director-only gating, routing, nav**: `App.tsx`'s `/governance` is `RoleGuard role="director"`;
  `AppShell.tsx`'s nav link only renders for `user.role === 'director'`; `assertDirector` denies
  non-Directors with an audit row — matching every A1–A3/B acceptance bullet in `issues.md`.
- **The two pre-disclosed deviations** (no `confidence` field on agent outputs; underspecified
  eval-JSON path) are both real and honestly handled, not silently degraded — `extractConfidences`
  reads an optional runtime field with no fabrication; `EVAL_REPORT_PATH` resolves to
  `docs/eval-report.json`, consistently referenced by both the endpoint and its test, and documents the
  contract S9 must honor.

No discrepancies found between `verification-s8.md`'s narrative and the actual diff contents.

## Summary

**Standards:** 1 hard finding (fixed in this review — missing unit tests for pure helpers), 1 baseline
smell (judgement call, left as-is — duplicated error-mapping block, matches an existing 2x pattern
extended to 4x). Worst issue: the missing-unit-test gap, now closed.
**Spec:** 0 findings. Worst issue: none.

## Next step

`finishing-a-development-branch` — push, open the PR against `main`, and merge.
