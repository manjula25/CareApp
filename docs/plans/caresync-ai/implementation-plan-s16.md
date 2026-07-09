# Implementation Plan — S16: Risk Calibration v2 (Rubric Redesign + LLM-Variance Investigation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **PLAN_ID:** `caresync-ai` · **Slice:** S16 · **Date:** 2026-07-09
> **Status (2026-07-09):** Commit 2 shipped. The original temperature + seed pin was dropped (OpenAI Responses API rejects both — full evidence in [`variance-probe.md`](variance-probe.md) §"API constraint"); `varianceProbe.ts` + 5 TDD tests shipped as observability tools; the probe ran successfully against the API defaults and produced 81.25% per-patient agreement across 16 patients × 3 runs (≥80% threshold met). Commit 3's v2 rubric is independent of the pin and proceeds unchanged — it runs against the now-confirmed-stable substrate.
> **Specs (in dependency order):** `docs/plans/caresync-ai/grill-risk-calibration-v2.md` (7-question grill, S16 framing), `docs/plans/caresync-ai/prd-s16.md` (PRD D1–D11), `docs/plans/caresync-ai/design-risk-calibration-v2.md` (forward-looking design + S13 failure-mode map), `docs/plans/caresync-ai/verification-s13.md §4 + §6` (pre-pin vs post-revert specificity numbers + open follow-ups), `docs/plans/caresync-ai/design-risk-calibration.md` (S13's reverted rubric — audit-trail pattern this slice mirrors), `apps/api/src/agents/riskAgent.ts:11,85-100` (commit 3's targets), `apps/api/src/agents/{careGap,sdoh,actionPlanner}Agent.ts` (commit 2's targets), `apps/api/src/eval/labelFromBundle.ts` (S15's held-out label function — feeds the 2x2 gate's held-out arm), `apps/api/src/scripts/eval.ts` (the existing eval harness — runs as-is for the 2x2 gate; no flag changes).

**Goal:** Close sub-gap 3 of the HL7 evaluation's biggest-risk decomposition — the Risk agent's 9-FP rate — in a single 3-commit PR: (1) docs [DONE at 193dcdb], (2) `varianceProbe.ts` (LLM-variance observation tool — the temperature + seed pin was dropped per [`variance-probe.md`](variance-probe.md)'s API-constraint finding), (3) risk rubric v2 (few-shot examples + 0-anchors rule). 2x2 acceptance gate (dev-labeled + held-out, specificity + sensitivity) is the merge gate for commit 3.

**Architecture:** 1 new module (`eval/varianceProbe.ts` + its TDD test); 1 new artifact (`docs/plans/caresync-ai/design-risk-calibration-v2.md` — already in commit 1); 1 modified `riskAgent.ts` for the commit-3 prompt rewrite; 0 modified `*Agent.ts` files in commit 2 (the temperature + seed pin was removed per the API constraint). TDD where applicable (commits 2 and 3); data-driven for the planning commit. The 3 commits are independently revertable — same discipline as S13b / S14 / S15.

**Tech Stack delta:** no new external dependencies. Same Jest + tsx stack.

**Ponytail pass applied:** minimum new seams (1 new module, no flags); `varianceProbe.ts` follows the existing `eval/` pure-function + I/O-script pattern (peer to `labelFromBundle.ts` and `outreachSchema.ts`); no `--rubric` flag in `eval.ts` (2x2 baseline is the audit trail, not a runtime comparison); no feature flag in the agents themselves (per `prd-s16.md D5` — the 2x2 acceptance gate is the merge gate); no model-snapshot ID hunt (per grill §4 — uncertain, defer until a future slice picks a different lever); no cross-agent rubric work (per grill §8 — only Risk gets the v2 rubric); no in-app review queue.

**Domain source:** `apps/api/src/agents/riskAgent.ts:11` (`MODEL = 'gpt-5.5'`), `apps/api/src/agents/riskAgent.ts:85-100` (current 1-paragraph `buildPrompt` — commit 3's rewrite target), `apps/api/src/agents/riskAgent.test.ts` (existing TDD surface — 2 regression-guard tests + 2 S13-era rubric-pins tests + the `params.model === 'gpt-5.5'` test), `apps/api/src/fhir-data/seed-patients.ts` + `apps/api/src/fhir-data/population.ts:127-134` (the seed-text patterns the v2 rubric's worked examples must mirror), `apps/api/src/eval/labelFromBundle.ts` (S15's held-out label function — feeds the 2x2 gate's held-out arm), `apps/api/src/scripts/eval.ts` (the eval harness — runs as-is for the 2x2 gate).

**Project memory reference:** `never-override-real-with-fake.md` — `varianceProbe.ts` runs the real LLM, aborts when `OPENAI_API_KEY` is unset. `openai-responses-api-no-seed.md` — the temperature + seed pin is NOT viable on the Responses API; the API rejects `seed` on all models and rejects `temperature` on reasoning-tier models.

**Branch state (per skill warning):** implementation is on `feature/s16-risk-calibration-v2` (off `main` at `feca132`); commit 1 already pushed at `193dcdb`. Implementation of commits 2 and 3 below assumes a clean working tree on the S16 branch.

---

## Commit 1 — `docs(S16): grill + PRD + design-risk-calibration-v2` ✅ DONE at 193dcdb

**Goal:** Establish the S16 audit trail before any code lands. After this commit, the 3 planning artifacts are committed and the S16 design rationale is preserved.

**Architecture:** 3 new docs (`grill-risk-calibration-v2.md`, `prd-s16.md`, `design-risk-calibration-v2.md`) under `docs/plans/caresync-ai/`. No code/test changes.

**Spec:** `grill-risk-calibration-v2.md` (the grill — captures rejected alternatives + their reasoning) + `prd-s16.md` (the formal PRD) + `design-risk-calibration-v2.md` (mirrors S13's design-risk-calibration.md pattern).

**Status:** Already pushed. No further work in this commit.

---

## Commit 2 — `feat(S16): varianceProbe.ts — LLM-variance observation tool`

**Goal:** Ship `varianceProbe.ts` as a tool for measuring LLM-variance on the dev-labeled 16 patients (3 runs each, per-patient agreement matrix). Document the OpenAI Responses API's lack of `seed`/`temperature` support (the variance-collapse strategy in the original plan is not viable; see [`variance-probe.md`](variance-probe.md)). After this commit, future slices have an observation tool + an audit-trail disclosure.

**Architecture:** 1 new module `apps/api/src/eval/varianceProbe.ts` (script that runs the real LLM N=3 times against the dev-labeled 16 patients, emits a markdown agreement matrix; aborts when `OPENAI_API_KEY` is unset). 1 new TDD test file `apps/api/src/eval/varianceProbe.test.ts` (agreement math + LLM-required behavior + real-LLM-not-mock invariant, per `never-override-real-with-fake.md`). The agent files are **not** modified in this commit — the temperature + seed pin is dropped per the API constraint finding.

**Spec:** `prd-s16.md` D3 + D8 (commit 2 of S16's 3-commit decomposition, scope-reduced) + `design-risk-calibration-v2.md` §"Decisions D4" (deferred) + grill §4 (deferred) + [`variance-probe.md`](variance-probe.md) (the API constraint finding).

### Phase A — TDD red for `varianceProbe.ts`

- [ ] **A1. Read `apps/api/src/eval/labelFromBundle.test.ts`** for the existing TDD pattern in `eval/`. `varianceProbe.test.ts` follows the same pattern but uses a fake LLM client (like `riskAgent.test.ts:fakeStream`).

- [ ] **A2. Create `apps/api/src/eval/varianceProbe.test.ts`** with 3 test cases FIRST (RED — module doesn't exist yet):
  - **Test 1 (agreement math):** Given a fake LLM client that returns `riskLevel: 'critical'` for all 3 runs of patient A and `[critical, low, critical]` for patient B, the probe emits an agreement matrix showing patient A at 3/3 and patient B at 2/3.
  - **Test 2 (LLM-required):** With `process.env.OPENAI_API_KEY` deleted (or undefined), the probe's `main()` calls `console.error('OPENAI_API_KEY unset — variance probe requires the real LLM, aborting.')` and `process.exit(1)`. Test asserts the error message + non-zero exit.
  - **Test 3 (real-LLM-not-mock):** With `OPENAI_API_KEY` set, the probe's `main()` constructs a real `OpenAI` client (not `MOCK_*_OUTPUT` fallback) and runs the dev-labeled 16 patients. Test stubs the OpenAI client via `jest.mock('openai', ...)` to capture the `responses.create` call and assert it was made with the dev-labeled 16 patients' bundles. Guards the "real LLM, not mock" invariant per `never-override-real-with-fake.md`.
  - *Verify:* `cd apps/api && npx jest src/eval/varianceProbe.test.ts` → all 3 tests FAIL (module doesn't exist).

### Phase B — `varianceProbe.ts` implementation (GREEN)

- [ ] **B1. Create `apps/api/src/eval/varianceProbe.ts`** (peer to `eval/labelFromBundle.ts` and `eval/outreachSchema.ts`) with the structure sketched in the [pre-discussed pseudocode](#). Named export `computeAgreement` (so Test 1 can pin the math without invoking `main()`); `main()` is a thin orchestrator that aborts on `OPENAI_API_KEY` unset, runs the dev-labeled 16 patients through `runRiskAgent` 3 times each, and emits a markdown agreement matrix.
  - *Ponytail:* keep `devLabeledPatients()` in `varianceProbe.ts` for now (single consumer). Refactor to a shared `eval/devLabeledPatients.ts` if a second tool needs it.
  - *Verify:* `cd apps/api && npx jest src/eval/varianceProbe.test.ts` → all 3 tests pass.

### Phase C — Run probe + document the result

- [ ] **C1.** Run the probe: `cd apps/api && npx tsx src/eval/varianceProbe.ts`. **Expected behavior:** the probe aborts with the API rejection documented in [`variance-probe.md`](variance-probe.md) (`400 Unknown parameter: 'seed'.` or `400 Unsupported parameter: 'temperature' is not supported with this model.`).
  - *Verify:* the error message is captured in the output; no per-patient data is collected (the probe aborts before the first patient).
  - *If the API has changed since 2026-07-09* and the probe runs successfully: capture the per-patient agreement matrix and save it to `docs/plans/caresync-ai/variance-probe.md`. **Update the doc** to reflect the actual probe outcome (not the 2026-07-09 failure). The TDD contract is still satisfied.

### Phase D — Commit 2

- [ ] **D1.** `npx tsc --noEmit` clean; `npx jest --runInBand` all green.
- [ ] **D2.** Commit:
  ```
  feat(S16): varianceProbe.ts — LLM-variance observation tool

  - New apps/api/src/eval/varianceProbe.ts — runs the dev-labeled 16
    patients through the real LLM N=3 times, emits a markdown
    agreement matrix per patient. Aborts when OPENAI_API_KEY is unset
    (real LLM required, per never-override-real-with-fake.md).

  - New apps/api/src/eval/varianceProbe.test.ts — 3 TDD tests pinning
    the agreement math + the OPENAI_API_KEY env-gate + the real-LLM-
    not-mock invariant.

  - Probe run on 2026-07-09 aborts with 400 (API rejects seed +
    temperature on gpt-5.5). The original plan's temperature + seed
    pin is NOT viable on the OpenAI Responses API — see
    docs/plans/caresync-ai/variance-probe.md for the full root-cause
    analysis + cross-model evidence + 3 deferred-strategy options.

  - varianceProbe.ts is shipped as an observation tool for a future
    slice that picks a different variance-collapse lever (model
    swap, Chat Completions API, or prompt-only as the only remaining
    option). Commit 3's v2 rubric is independent of this finding.
  ```

  **Verify:** 3 new varianceProbe tests pass; tsc clean; probe.md captures the API rejection.

---

## Commit 3 — `feat(S16): risk rubric v2 — replace buildPrompt with few-shot + 0-anchors rule`

**Goal:** Replace the post-S13-revert 1-paragraph `buildPrompt` with the v2 rubric (3 calibration anchors + "0 anchors → low" hard rule + 3 worked examples using actual seed-text bundle shapes). Pass the 2x2 acceptance gate (dev-labeled specificity ≥30% AND sensitivity ≥67%, held-out specificity ≥30% AND sensitivity ≥50%). After this commit, the Risk agent's specificity recovers from 0% to ≥30% and the eval-report's Pillar P2 lifts from 4 to 5.

**Architecture:** Rewrite `apps/api/src/agents/riskAgent.ts`'s `buildPrompt` body with the v2 structure (per `design-risk-calibration-v2.md` §"The v2 rubric"). 3 new TDD tests in `riskAgent.test.ts` (3 anchor definitions present + "0 anchors → low" rule present + 3 worked examples present). No `eval.ts` changes; the eval imports `buildPrompt` and runs it as-is. Eval re-run regenerates `docs/eval-report.{md,json}` with the post-rubric numbers.

**Spec:** `prd-s16.md` D4 + D5 + D6 + D8 (commit 3 of S16's 3-commit decomposition) + `design-risk-calibration-v2.md` §"The v2 rubric" + grill §3 + §5 + §6.

### Phase A — TDD red for the v2 rubric structure

- [ ] **A1. Read `apps/api/src/agents/riskAgent.test.ts`** and locate the existing 2 S13-era regression-guard tests for `buildPrompt` (the "citation requirement" and "bundle embedding" tests, per `verification-s13.md §3`). These 2 tests stay.

- [ ] **A2. Add 3 new tests to `riskAgent.test.ts` for the v2 structure** (RED — they should fail because the current 1-paragraph prompt doesn't have any of these):
  - `it('buildPrompt lists the 3 calibration anchors verbatim (S16 commit 3)', ...)` — assert the test's input bundle's `buildPrompt(...)` output contains the substrings `"Anchor A: Multi-condition comorbidity"`, `"Anchor B: Recent inpatient discharge"`, `"Anchor C: Abnormal labs"`.
  - `it('buildPrompt enforces the "0 anchors → low" hard rule (S16 commit 3)', ...)` — assert `buildPrompt(...)` output contains the substring `"0 anchors met is ALWAYS riskLevel='low'"`.
  - `it('buildPrompt includes 3 worked examples using actual seed-text bundle shapes (S16 commit 3)', ...)` — assert the output contains the substrings `"Example 1 (0 anchors → low)"`, `"Example 2 (1 anchor → moderate)"`, `"Example 3 (2 anchors → high)"`, and references the seed-text patient IDs (`james-okafor`, `maria-chen`, `bob`).
  - Each test uses a fixture bundle (`{ resources: [], validIds: new Set() }` is fine — `buildPrompt` doesn't read the bundle contents for the v2 structure).
  - *Verify:* `cd apps/api && npx jest src/agents/riskAgent.test.ts -t "v2 structure"` → 3 new tests FAIL (current prompt doesn't have these strings).

### Phase B — GREEN: rewrite `buildPrompt`

- [ ] **B1. Read `apps/api/src/agents/riskAgent.ts:85-100`** (the current `buildPrompt` body). Note the existing 1-paragraph structure that the S13 revert preserved.

- [ ] **B2. Replace the `buildPrompt` body** with the v2 structure from `design-risk-calibration-v2.md` §"The v2 rubric". Specifically:
  - Keep the opening 4 lines (the "You are a clinical risk-assessment agent" + "You are the Risk agent on a care-coordination platform" + "Below is the patient's complete retrieved FHIR record" + the `<resource lines>` interpolation).
  - Add the 3 calibration anchors (A, B, C) verbatim.
  - Add the "0 anchors → low" hard rule verbatim.
  - Add the 3 worked examples using actual seed-text bundle shapes (james-okafor, maria-chen, and a synthetic `bob` synthesizing multi-condition + abnormal lab + recent discharge).
  - Keep the closing 3 lines (the citation requirement + the "narrate then call report_risk" instruction).
  - *Ponytail:* do not extract a sub-function like `formatAnchors()` — the prompt is a single string, the structure is best read top-to-bottom in the source. Inlining is the laziest fix.
  - *Verify:* `cd apps/api && npx jest src/agents/riskAgent.test.ts` → 9 + 3 = 12 tests pass (7 existing riskAgent tests + 2 temperature/seed tests from commit 2 + 3 new v2 structure tests).

- [ ] **B3. Do NOT change `runRiskAgent`** (the function that calls `buildPrompt` and streams to the SDK). The rewrite is body-only.
  - *Verify:* `grep -n "buildPrompt\|runRiskAgent" apps/api/src/agents/riskAgent.ts` returns the same call sites as before.

### Phase C — Run the 2x2 acceptance gate

- [ ] **C1. Quorum check:** OpenAI quota. Per the S15 handoff: "OpenAI quota: exhausted mid-eval." If exhausted, document the gate as "deferred — quota exhausted; will run on the next live window" in `verification-s16.md`; do NOT commit; branch stays open.
  - *Ponytail:* skip a `--rubric` flag in `eval.ts` (and the ship-then-cleanup cycle that follows). The v2 prompt is the only prompt after commit 3 lands; the baseline for the 2x2 is `verification-s13.md §4`'s pre-S13 30.8% specificity number, already in the audit trail. The eval imports `buildPrompt` from `riskAgent.ts` and runs it as-is.

- [ ] **C2. Run the gate:** `cd apps/api && npx tsx src/scripts/eval.ts --risk-only`.
  - *Verify:* the rendered `docs/eval-report.md` shows the new Risk section with both dev-labeled and held-out metrics.

- [ ] **C3. Extract the 4 numbers:**
  - Dev-labeled specificity (target ≥30%) and sensitivity (target ≥67%).
  - Held-out specificity (target ≥30%) and sensitivity (target ≥50%).

- [ ] **C4. If all 4 hit the thresholds:** the gate passes. Proceed to Phase D.
  - *If any misses:* the gate fails. Document in `verification-s16.md §6` (open follow-ups). Branch stays open. Iterate on the rubric in a follow-up commit (tighter anchor thresholds, adjusted "0 anchors → low" wording). Re-run the gate.

### Phase D — Commit 3

- [ ] **D1.** `npx tsc --noEmit` clean; `npx jest --runInBand` all green.
- [ ] **D2.** Commit:
  ```
  feat(S16): risk rubric v2 — replace buildPrompt with few-shot + 0-anchors rule

  Closes sub-gap 3 of the HL7 evaluation (Risk agent's 9-FP rate).

  - Rewrite apps/api/src/agents/riskAgent.ts:buildPrompt body with the
    v2 structure: 3 calibration anchors (multi-condition comorbidity,
    recent inpatient discharge, abnormal labs) + explicit "0 anchors
    met is ALWAYS riskLevel='low'" hard rule + 3 worked examples using
    actual seed-text bundle shapes from seed-patients.ts (james-okafor
    for Example 1, maria-chen for Example 2, a synthetic bob with
    multi-condition + abnormal lab + recent discharge for Example 3).

  - 3 new TDD pins in riskAgent.test.ts (anchors present, hard rule
    present, worked examples present). The 2 existing regression-guard
    tests (citation requirement + bundle grounding) stay. The 2
    S13-era rubric-pins tests stay for now — removed in a follow-up
    after the v2 design stabilizes.

  - 2x2 acceptance gate passes (see docs/eval-report.md):
      dev-labeled 16:  specificity ≥30% (was 0% pre-S16)
                        sensitivity ≥67%
      held-out 10:     specificity ≥30%
                        sensitivity ≥50%

  P2 4→5. Total 89.2 → ~91.0.
  ```

  **Verify:** 2x2 numbers in `docs/eval-report.md`; tsc + jest clean.

---

## Phase G — Post-merge verification

- [ ] **G1. `npm run eval` regenerated report shows:** Risk dev-labeled specificity ≥30% (was 0%), sensitivity ≥67%; Risk held-out specificity ≥30%, sensitivity ≥50%; P2 4→5 in the HL7 evaluation. The Status line reads "Status (S16): N clinician-validated (X%), 16 of 26 dev-labeled (Y%), 10 of 26 held-out (Z%)."
- [ ] **G2. Variance probe re-run** (post-merge) shows ≥80% per-patient agreement — the substrate check from commit 2's Phase F holds in production.
- [ ] **G3. Write `verification-s16.md`** per the 5-row matrix in `prd-s16.md D9` (commit 1's evidence + commit 2's evidence + commit 3's evidence + the 2x2 numbers + the variance probe pre/post numbers). Include the reversion contingency paragraph per `prd-s16.md D7`.
- [ ] **G4. Write `review-s16.md`** per the S14/S15 two-axis pattern (Standards + Spec).
- [ ] **G5. Re-run the post-S16 HL7 evaluation** (`reports/HL7-Challenge-Evaluation.2026-07-09-post-s16.md`) to capture the P2 lift and the new total. Mirror the S15 post-eval pattern from the S15 handoff.

---

## Rollback / safety

| Commit | Revert | Reverts |
|---|---|---|
| 1 (docs) | `git revert <sha>` | Drops the 3 planning docs. No code impact. |
| 2 (probe) | `git revert <sha>` | Drops `varianceProbe.ts` + its TDD test + the probe-outcome doc. The post-S15 state (no observation tool) returns. The API constraint finding is lost from the audit trail — re-deriving it would take another probe run. |
| 3 (rubric) | `git revert <sha>` (or apply the reversion paragraph from `prd-s16.md D7`: replace `buildPrompt` body with the v1 1-paragraph form) | The Risk agent reverts to over-calling (specificity 0%). The variance probe from commit 2 survives the revert. |

**Whole-PR revert:** `git revert <merge-sha>...<tip-sha>` reproduces pre-S16 state.

**Single-commit revert safety:** commit 3's reversion is mechanical — replace `buildPrompt` body with the 5-line v1 form, remove the 3 v2 structure TDD tests, keep the 2 regression-guard tests. The eval-report disclosure gets a "Status (S16 reverted)" banner. Same pattern as S13b's reversion.

---

## Definition of done

1. PR merged (or branch ready for merge pending user review).
2. Commit 2 ships: `varianceProbe.ts` + `varianceProbe.test.ts` (3 TDD tests passing) + `variance-probe.md` documenting the API constraint. Verification matrix signals #2 stands; #1 and #3 are deferred per the constraint.
3. Commit 3 ships: `buildPrompt` rewritten with v2 structure; 3 new TDD tests pinning the structure; 2x2 acceptance gate runs and the 4 numbers are extracted.
4. **Conditional:** if 2x2 passes → pillar P2 lifts 4→5; total 89.2 → ~91.0. If 2x2 fails → pillar P2 stays 4; the eval-report's "Status (S16)" banner documents the failure; the slice ships the rubric attempt + a documented failure to lift the pillar (audit trail preserved).
5. `verification-s16.md` ships with the (scope-reduced) verification matrix evidence + the reversion contingency paragraph.
6. `review-s16.md` ships with the Standards + Spec axes.
7. Post-S16 HL7 evaluation re-run captured at `reports/HL7-Challenge-Evaluation.2026-07-09-post-s16.md`.

---

## Open follow-ups (deferred — NOT in this slice)

1. **LLM-variance collapse** — the temperature + seed pin is not viable on the OpenAI Responses API (per [`variance-probe.md`](variance-probe.md)). Future slices must pick a different lever: model swap (different SDK call shape), Chat Completions API (accepts both params), or accept the variance as irreducible. The `varianceProbe.ts` shipped in commit 2 is the observation tool for whichever lever gets picked.
2. **Care Gap FN=10 / SDOH agreement regression** — same root cause as #1; if a future slice addresses the variance, these should improve in parallel.
3. **MODEL_CARD.md authoring** — Option B in the S15 handoff. Defer until S16's v2 rubric stabilizes the Risk numbers (commit 3's 2x2 gate passes); once stable, the model card is a 1-2 day deliverable.
4. **Clinician engagement** — S15's outreach log is the operational mechanism; engagement happens on its own clock, not gated by S16.
5. **In-app review queue** — deferred indefinitely (same call as S14 grill §7).
6. **Held-out inter-rater or hand-curated labels** — rejected in S15 grill §3; same call for S16.

---

## Files this slice modifies (summary)

**New (3 — all in commit 1):**
- `docs/plans/caresync-ai/grill-risk-calibration-v2.md`
- `docs/plans/caresync-ai/prd-s16.md`
- `docs/plans/caresync-ai/design-risk-calibration-v2.md`

**New (3 — in commit 2):**
- `apps/api/src/eval/varianceProbe.ts`
- `apps/api/src/eval/varianceProbe.test.ts`
- `docs/plans/caresync-ai/variance-probe.md` (probe outcome documentation — records the API rejection)

**New (1 — in commit 3's evidence):**
- `reports/HL7-Challenge-Evaluation.2026-07-09-post-s16.md`

**Modified (3 — all in commit 3):**
- `apps/api/src/agents/riskAgent.ts` (buildPrompt body rewrite only; no SDK call changes — the pin was dropped per API constraint)
- `apps/api/src/agents/riskAgent.test.ts` (3 new TDD pins for v2 structure)
- `docs/eval-report.md` + `docs/eval-report.json` (regenerated by commit 3's 2x2 gate run)
- `tasks/todo.md` (this slice's active section)

**Not modified (intentionally):**
- `apps/api/src/agents/{careGap,sdoh,actionPlanner}Agent.ts` and their test files — no changes in S16 (the temperature+seed pin was dropped per API constraint; commit 3 only touches `riskAgent.ts`).
- `apps/api/src/scripts/eval.ts` — no flag changes (the `--rubric` flag was dropped per ponytail simplification).
- `apps/api/src/agents/confidenceScorer.ts` — pre-S16 SDOH regex fix already on main at `feca132`.
- `apps/api/src/fhir-data/seed-patients.ts` — S13b's samuel-wright enrichment survives.
- `apps/api/src/eval/labelFromBundle.ts` — S15's held-out label function, unchanged.
- `apps/api/package.json` — no new scripts.
- All `MOCK_*_OUTPUT` fallbacks — untouched, per `never-override-real-with-fake.md`.