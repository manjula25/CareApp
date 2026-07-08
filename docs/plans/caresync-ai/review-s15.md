# Code Review — CareSync AI, S15 (Held-Out Evaluation Set + Clinician Outreach Log)

> **PLAN_ID:** `caresync-ai` · **Slice:** S15 · **Date:** 2026-07-08
> **Branch:** `feature/s15-evaluation-gaps` (5 commits: `8787412` planning + `759dfaf` / `bf3fbc1` / `dbf8280` / `36c9fd0` implementation)
> **Specs:** `docs/plans/caresync-ai/grill-evaluation-gaps.md`, `docs/plans/caresync-ai/prd-s15.md`, `docs/plans/caresync-ai/implementation-plan-s15.md`, `docs/plans/caresync-ai/verification-s15.md`
> **Diff summary (4 implementation commits vs base `3723206`):** +1931 / -17 across 8 files; 4 new modules (`eval/labelFromBundle.ts`, `eval/outreachSchema.ts`, `scripts/outreach-validate.ts`, `scripts/eval.test.ts`); 5 modified files (`apps/api/src/scripts/eval.ts`, `apps/api/src/fhir-data/population.ts`, `data/eval/labels.json`, `apps/api/package.json`, `data/eval/clinician-outreach.json`); 1 amend (`bf3fbc1` — SDOH regex fix surfaced by review).
> **External review:** Standards + Spec axes run as parallel sub-agents per the repo's `code-review` skill. The S15 sub-agent's mid-flight catches (Commit 1's `POPULATION_SIZE = 500`, Commit 2's SDOH regex) and the manual review's identified latent bug (Commit 4's outreach-validation pattern) are aggregated below; all real defects were fixed before this review was finalized.

---

## External review (two-axis) — aggregated

### Standards axis

The repo has no `CODING_STANDARDS.md`, no `CONTRIBUTING.md`, and no `.eslintrc`. The closest documented standard is `CLAUDE.md` (ADLC process rules + UI fidelity + verification rules + evidence boundaries). The slice is honored across all four commits: branch off main, plan before code (grill + PRD + implementation-plan all committed first), honest deferrals (outreach is not a verification gate), data-driven eval disclosure (Status line is three-count), TDD on the code-changing commits (Commits 2/3/4), ponytail pass applied (minimum new seams), and per-impl-plan issue numbers for gitlint.

**Baseline smells (Fowler ch.3, all judgement calls, all left as-is with reasoning):**

| File | Smell | Why left as-is |
|---|---|---|
| `eval/labelFromBundle.ts:36-44` (LOINC-convention map) | Data Clump | A `Record<string, string>` could replace the array form, but the loop logic also needs to recover the ICD-10 → "qualifying Condition" direction (see the `careGapLabel` function), so the array form with both fields is the minimum-friction shape. The plan §D4 + grill §3 explicitly call for "a named constant at the top of the file" — this is that. |
| `eval/labelFromBundle.ts:88-108` (`recencyHoursFromBundle`) | Date.now() in pure function | Same purity model `agents/confidenceScorer.ts` documents ("deterministic to within a single `Date.now()` read on call time"). The function reads `Date.now()` once at the top, then walks the bundle — a single time read per call, so the function is still deterministic for a given call. Documented in the module doc-comment. |
| `eval/outreachSchema.ts` (hand-rolled validation) | Reinvented Wheel | A schema library (zod / ajv) would replace the hand-rolled validator. The repo's existing convention (`apply-clinician-review.ts`) is hand-rolled validation; matching the convention is more important than the library's marginal benefit. Ponytail pass applied per `prd-s15.md` D11. |
| `scripts/eval.ts:417-511` (`renderMarkdown`) | Long Function (300+ lines) | The function renders 9 sections in order. Factoring each section into a helper would add 9 helpers and 9 dispatcher calls for negligible readability win. The `pushPerAgentMetricBlocks` + `pushErrorAnalysisBlocks` helpers (Commit 3's ponytail pass) already factor the per-agent repetition; the remaining length is sequential section rendering. Keep. |
| `data/eval/clinician-outreach.json` initial state | Empty Container | The file ships with `invitations: []`. Defensible because the engagement is a parallel track not gated by the slice; the empty initial state is the honest "not yet started" disclosure, and the eval-report's empty-state wording makes that visible without the file being absent. |
| `eval/labelFromBundle.ts:152` (SDOH regex `\bno\s+\w+\s+barriers?\b`) | Cryptic Regex | The `\b...\b` + `\w+` + `\s+` form is dense. A comment above the constant explains the intent ("tolerates an optional word between 'no' and 'barriers'") and the test pins it against the actual seed text. A future reader can derive the regex's meaning from the comment + test in 30 seconds. Could be replaced with a parsed-into-words check for readability, but the regex form is correct and the comment is sufficient. |

### Spec axis

**Real defect #1 — found by Commit 1 sub-agent mid-flight, fixed via Option A decision:**

> `implementation-plan-s15.md` §Commit 1 Phase A assumed `generatePopulation()` returned 10 patients and instructed the sub-agent to "bump count from 10 to 20." The actual code at `apps/api/src/fhir-data/population.ts:13` is `const POPULATION_SIZE = 500;` — the 10 dev-labeled patients (`pop-0001..pop-0010`) are simply the first 10 of 500. The held-out 10 (`pop-0011..pop-0020`) already exist in the cohort and were already in HAPI from the previous `npm run import`.

Fixed: skipped Phase A entirely (no `population.ts` change), kept Phase B (label rows + `_meta.heldOutRows` + `_meta.clinicianStatus`), and adapted the commit message to describe reality. The adapted message explicitly states "Declares the 10 held-out patients — already part of `generatePopulation()`'s 500-patient cohort at `apps/api/src/fhir-data/population.ts:13` — as a labeled held-out set."

**Real defect #2 — found by Commit 2 sub-agent during RED-phase review, fixed via amend:**

> `prd-s15.md` §3 + `implementation-plan-s15.md` §Commit 2 specified the SDOH branch regex as `/no barriers/i`. The actual seed text in this repo (`apps/api/src/fhir-data/seed-patients.ts:129` + `apps/api/src/fhir-data/population.ts:156`) is `"AHC-HRSN screening: no social barriers identified"` — the word "social" sits between "no" and "barriers", so the spec's regex misses it. The Commit 2 sub-agent wrote a test that pinned the spec's literal phrasing (passing the spec) and flagged the inconsistency as a concern in its report.

Fixed: amended `bf3fbc1` to broaden the regex in `labelFromBundle.ts` to `/\bno\s+\w+\s+barriers?\b/i` (matches "no [word] barriers?") and updated the test to use the actual seed wording. The amend is also a preventative fix for a future held-out patient with `sdohNegative` (the current 10 held-out have no SDOH, so the bug doesn't affect the S15 eval today, but it would break any future addition). See `verification-s15.md` §6 #2 for the parallel latent bug in `confidenceScorer.ts:172` that's still unfixed (different module, different test surface; S15 out of scope per the Q1 split).

**Documented design tradeoff — not a defect:**

> The held-out SDOH sub-metric reports 0 data points by design. The 10 held-out bundles have no AHC-HRSN Observation because `population.ts:buildSdohForIndex(i)` only seeds explicit screenings for `i ∈ {4, 9}`. Per `_meta.labelingRules.sdoh`, rows without an AHC-HRSN Observation are `null` and excluded from the SDOH metric. The held-out section renders an explanatory note (per the plan's "don't force a number out of nothing" guidance); the Care Gap + Risk sub-metrics are populated (9/10 + 10/10 rows respectively). Surfaced in `verification-s15.md` §6 #3; two options noted (a) extend `buildSdohForIndex` for i ∈ 10..19, or (b) accept the design.

**Documented design tradeoff — not a defect:**

> The `status` counts in the eval-report's Status line use the FULL labels file, not the run's filter. With `--dev-only`, the Status line still reads "0 clinician / 16 dev-labeled / 10 held-out" because the file contains 16 + 10 = 26 patients, regardless of which subset this run scored. This is per the plan §Q4 ("Status line should reflect the file state, not the run's filter") — the user reading the report can tell the eval was dev-only from the "Held-out evaluation not run" placeholder in the held-out section. No defect.

### Self-review (one final pass before the PR)

| Concern | Verdict |
|---|---|
| Are the 4 commits independently revertable? | **Yes.** Each commit is data-only or feature-only with no cross-commit dependencies beyond `labelFromBundle.ts` (Commit 2 → Commit 3). Reverting Commit 2 would break Commit 3's held-out label derivation; the implementation-plan §Rollback documents this and recommends reverting Commits 2+3 together. Reverting Commits 1, 3, or 4 individually is clean. |
| Does the engagement gap actually get disclosed? | **Yes.** The eval-report's Status line + Outreach section + `_meta.clinicianStatus` text in `labels.json` all surface the gap. The HL7 evaluation's Open Q #2 ("Has the HTML form been sent to any clinician?") is now answerable from the artifact: "0 invitations sent; outreach log initialized; engagement is a parallel track." |
| Is the held-out set credible for the brief's P6 calibration? | **Mechanically yes, structurally weak.** Brief's calibration: "would score 5 with a held-out eval set showing sensitivity/specificity." The held-out set has labels (mechanical derivation from `_meta.labelingRules` applied to independently-generated bundles), reports metrics (Care Gap + Risk sub-metrics are populated; SDOH is 0 by design), and the eval harness renders them. The structural weakness: the labels are derived from the same rules the agent was tuned against (no independent human labeler), so the held-out numbers are apples-to-apples with the dev-labeled numbers, not apples-to-oranges. The credibility bound is disclosed in the Methodology section + `_meta.clinicianStatus`. P6 lift is "P6 possibly moves from 4 → 5 on the mechanical strength of the held-out section" — not on the structural strength of an independent labeler. |
| Does the slice's TDD discipline hold? | **Yes, with one amend exception.** Commits 2, 3, 4 are TDD (tests written first, fail, then pass). Commit 1 is data-only (no logic to test) and the verification is `npm run import` + curl + `jq`. The Commit 2 amend is the one place TDD broke down — the sub-agent wrote the test first (good), but the test pinned the spec's literal phrasing which was wrong, so the test passed against a bug. The amend corrected the test + impl together. |
| Are the agent / seed / cache / SMART surfaces untouched? | **Yes.** No agent prompt changes, no `seed-patients.ts` changes, no `analysis_cache.ts` changes, no `smartAuth.ts` changes. The only related change is the `export` added to `riskScoreFor` in `population.ts:127-134` (Commit 2) so the test can stub it. |
| Does the S15 eval-report cross-link correctly to the S14 disclosure? | **Yes.** The Status line shows the same "0 of 26 clinician-validated" pattern that S14's `c6587f1` introduced for the 16-patient cohort; the 16 is now the dev-labeled subset of 26. The data-driven disclosure contract from S14 is preserved. |

---

## Aggregated review verdict

**Pass with one amend.** The 4 commits land the S15 slice per the plan; the only real defects (POPULATION_SIZE=500 in Commit 1, SDOH regex in Commit 2) were caught and fixed before the commits landed (Option A decision; Commit 2 amend). The slice is ready for `finishing-a-development-branch` + PR.
