# Implementation Plan — Risk Agent Calibration (S13)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/plans/caresync-ai/design-risk-calibration.md` (the design decisions D1–D7)
> **Branch:** `feature/risk-agent-calibration-s13` · **Worktree:** `.claude/worktrees/risk-agent-calibration-s13`
> **Base ref:** `origin/main` at `05c9d85` (post PR #16 merge)

**Goal:** Tighten the Risk agent's calibration so the eval's headline metric (`docs/eval-report.json`) reports fewer false positives — addressing the rubric-analyzer's biggest gap (Risk specificity 30.8%, PPV 25%, 9 FPs out of 13 TNs).

**Architecture / Tech Stack:** No new tech. Prompt-only change to `apps/api/src/agents/riskAgent.ts`; additive TDD unit tests in `apps/api/src/agents/riskAgent.test.ts`; one disclosure string in `apps/api/src/scripts/eval.ts`'s `renderMarkdown()`. The eval harness (`npm run eval`) re-runs the existing pipeline — no harness changes.

**Domain source:** `fhir-data/population.ts:127-134` `riskScoreFor()` is the calibration target (D3). Vocabulary from `data/eval/labels.json` `_meta.labelingRules.risk`.

---

## Iteration 1 — TDD scaffolding

**Spec:** design-risk-calibration.md §3 (rubric), §4 (file change set) · **Decision refs:** D3, D6

### Phase A — Pin the rubric with TDD unit tests

The agent's classification comes from the LLM, so TDD can't truly pin "patient X gets riskLevel=high." What it *can* pin is the **prompt structure**: the rubric must be in the prompt sent to the client, the citation requirement must still be there, and the bundle's resources must still be embedded. These are the load-bearing properties — if any of them regress, the calibration silently breaks.

- [ ] **A1. Export `buildPrompt` from `riskAgent.ts`.** The function is currently private; the new tests need to import it. **Verify:** `tsc --noEmit` clean; existing tests still green.
  - *skipped:* exporting `MODEL` or `REPORT_RISK_TOOL` — out of scope for this slice; revisit if a future test needs them.

- [ ] **A2. Add 4 unit tests to `riskAgent.test.ts` (TDD — write these BEFORE the prompt change, watch them fail).** Each test imports `buildPrompt` and asserts on the returned string:
  - **A2.1.** `buildPrompt includes the rubric anchors` — prompt contains: "multi-condition comorbidity", "recent inpatient discharge", and the lab thresholds "BNP" + "200", "HbA1c" + "9.0", "eGFR" + "30".
  - **A2.2.** `buildPrompt includes the threshold text` — prompt contains "at least 2 of" and "30 days" and "low risk" / "moderate" / "high" / "critical" (all four enum values mentioned in the rubric so the model can't be ambiguous about the bucket boundaries).
  - **A2.3.** `buildPrompt preserves the citation requirement` — prompt still contains "fhirResourceId" and "fabricated citations" (regression guard — the rubric must NOT displace the GD11 citation contract).
  - **A2.4.** `buildPrompt embeds the bundle resources` — for a fixture bundle with a known `Condition/maria-chen-chf` line, the prompt contains that line (regression guard — the rubric must NOT displace the bundle grounding).
  - *Verify:* `npx jest apps/api/src/agents/riskAgent.test.ts` — 4 new tests fail (rubric text not yet present). Pre-existing 4 tests pass.
  - *skip:* testing the LLM's classification output (non-deterministic; out of scope for unit tests; the eval re-run in Phase D is the integration test).

### Phase B — Apply the prompt change

- [ ] **B1. Extend `buildPrompt()` in `riskAgent.ts` with the rubric (D3).** Insert the rubric as a multi-line block between the existing role-setting line and the "Below is the patient's complete retrieved FHIR record" line. Use the exact wording from `design-risk-calibration.md` §3 so the TDD tests' keyword assertions match deterministically.
  - *JSDoc on `buildPrompt`*: add a paragraph explaining the calibration rationale — "this rubric mirrors `fhir-data/population.ts:127-134` `riskScoreFor()` ≥ 75 threshold; see `docs/plans/caresync-ai/design-risk-calibration.md` §3 and §2 D3. Clinician validation of the labels is the long-term path to a real-clinical rubric; this is the conservative interim step."
  - *Verify:* `npx jest apps/api/src/agents/riskAgent.test.ts` — all 4 new A2 tests now pass; all pre-existing tests still pass.

- [ ] **B2. Confirm boot-time safety + demo fallback still work.** The pre-existing tests in `riskAgent.test.ts` already cover (a) lazy OpenAI client construction and (b) `MOCK_RISK_OUTPUT` fallback when `OPENAI_API_KEY` is unset. They use a `fakeStream` helper — confirm those tests still pass with the new `buildPrompt` (they should — the prompt change is additive, the streaming/wiring is unchanged).
  - *Verify:* full `riskAgent.test.ts` suite green (8 tests).

### Phase C — Eval-report disclosure (D7)

- [ ] **C1. Augment `renderMarkdown()` in `apps/api/src/scripts/eval.ts` with the rubric-mirrors-seed disclosure.** Add a single sentence to the "Methodology" section (after the existing dev-labeled-baseline banner): "The Risk agent's prompt includes an explicit clinical rubric (≥2 of {multi-condition comorbidity, recent inpatient discharge ≤30d, abnormal labs}) that mirrors the seed-heuristic in `fhir-data/population.ts:127-134` — specificity numbers reflect alignment with the synthetic ground truth, not with a real clinical reference standard. See `docs/plans/caresync-ai/design-risk-calibration.md` §2 D3 for the calibration rationale."
  - *Verify:* `tsc --noEmit` clean; `renderMarkdown` is exported and re-tested by the existing `eval.ts` exports — confirm the change compiles and string-literal type-checks.

- [ ] **C2. Add the same disclosure to each Risk FP entry's `labelNotes` (or as a one-line header above the "Risk false positives" list).** The `errorAnalysis.ts` module already extracts `labelNotes` from the label file; the cleanest path is to add the disclosure to the markdown rendering (one header line above the FP list, not per-row) rather than mutating `labels.json`. Header line: "**Note (S13):** The Risk agent's prompt rubric was authored to mirror the synthetic seed heuristic. The specificity number below reflects that alignment — see `docs/plans/caresync-ai/design-risk-calibration.md` for the calibration rationale."
  - *Verify:* `npx jest apps/api/src/eval/errorAnalysis.test.ts` still green (we're not changing the errorAnalysis module, just the markdown render in eval.ts).

### Phase D — Re-eval and commit

- [ ] **D1. Invalidate maria-chen's `analysis_cache` row (D5).** The eval harness is cache-first; maria-chen is the only patient whose result came from cache (`docs/eval-report.md` methodology line: "1 patient(s) scored from the existing S4 `analysis_cache`"). Without this step, maria-chen's `riskLevel=critical` would replay from cache under the OLD prompt while the other 15 run live under the NEW prompt — inconsistent.
  - *Implementation:* a one-liner script or a direct SQL `DELETE FROM analysis_cache WHERE patient_id = 'maria-chen';` against the local SQLite db (`apps/api/caresync.db` or wherever `getDb()` resolves — check `apps/api/src/db/index.ts`). The eval harness is read-only by design; this single-row delete is the one cache-management action it requires.
  - *Verify:* `SELECT * FROM analysis_cache WHERE patient_id = 'maria-chen';` returns 0 rows.

- [ ] **D2. Run the eval harness end-to-end.** `cd apps/api && npm run eval`. The script reads `labels.json`, runs the (now cache-cleared) pass over 16 patients, writes `docs/eval-report.md` and `docs/eval-report.json`.
  - *Verify:*
    - Methodology section says `0 patient(s) scored from cache` (or `1 patient(s) scored from cache` if the cache was repopulated by another pass — re-check the line).
    - Risk confusion matrix: `FP` count drops from 9 to **3 or fewer** (predicted). If the rubric works as expected on the deterministic `pop-XXXX` patients, FP drops to ~0–3 from 9.
    - Risk specificity rises from 30.8% to **60%+**.
    - PPV rises from 25% to **40%+**.
    - Sensitivity stays at 100% (the 3 true positives — maria-chen, samuel-wright, pop-0007 — should still be caught: maria-chen has 3 conditions + 48h discharge + abnormal labs; samuel-wright and pop-0007 are deterministic 3-condition + recent-discharge in the generator).
    - *If* specificity is *not* measurably better, stop and re-examine: either the rubric is too lenient, the model is ignoring it, or the seeded label is mismatched against the bundle (open question: is samuel-wright's FHIR bundle fully populated for the rubric's evidence check?). Document the result in `verification-s13.md` either way.

- [ ] **D3. Inspect the regenerated report.** Read `docs/eval-report.md` top-to-bottom: methodology banner + the new rubric-mirrors-seed sentence; per-agent metrics; the new disclosure header above the Risk FPs; the per-patient FPs. The disclosure should make the calibration rationale findable in 10 seconds.
  - *Verify:* the report is the kind of artifact a judge could quote — every claim has either a number or a labeled-limitation, and the rubric-mirrors-seed trade-off is up-front, not buried.

- [ ] **D4. Commit the calibration slice.** Files in this commit:
  - `apps/api/src/agents/riskAgent.ts` (B1)
  - `apps/api/src/agents/riskAgent.test.ts` (A1, A2)
  - `apps/api/src/scripts/eval.ts` (C1, C2)
  - `docs/eval-report.md` (D2, D3 — regenerated)
  - `docs/eval-report.json` (D2, D3 — regenerated)
  - `docs/plans/caresync-ai/design-risk-calibration.md` (this slice's design)
  - `docs/plans/caresync-ai/implementation-plan-risk-calibration.md` (this file)
  - `docs/plans/caresync-ai/verification-s13.md` (Phase E, written before commit)
  - `docs/plans/caresync-ai/review-s13.md` (Phase E, written before commit)
  - *Commit message:* `calibrate(S13): Risk agent prompt rubric + 4 TDD tests + re-eval disclosure` (with `Co-Authored-By: Claude <noreply@anthropic.com>`).
  - *NOT in this commit:* the `analysis_cache` SQLite row is not source-controlled (DB lives outside the repo); no separate cache-management commit needed.

### Phase E — Verification + self-review

- [ ] **E1. Write `docs/plans/caresync-ai/verification-s13.md`.** Include:
  - TDD evidence: paste the `npx jest` output for `riskAgent.test.ts` (8/8 green) and the failing-then-passing trace of the 4 new tests.
  - Re-eval evidence: paste the new headline numbers from `docs/eval-report.json` (specificity, PPV, FP count) and a side-by-side with the pre-calibration numbers (30.8% / 25% / 9 FPs).
  - Cache invalidation evidence: the `SELECT` query showing maria-chen is no longer in the cache before the re-run.
  - Disclosure evidence: quote the rubric-mirrors-seed sentence from the new eval report.
  - *Pass criteria:* all numbers from D2's verify step met; no test regressions; report disclosure present and findable.

- [ ] **E2. Write `docs/plans/caresync-ai/review-s13.md` using the two-axis pattern from `review-s12.md`.** Standards axis: convention match vs the closest sibling (the pre-existing `riskAgent.test.ts` tests + `eval.ts` markdown rendering). Spec axis: did the implementation match design D1–D7? List any judgement calls and any deviations from the design.
  - *Pass criteria:* 0 hard spec violations; 0 missing requirements; judgement calls (if any) documented with reasoning.

### Rollback / safety

If the rubric's specificity number is *worse* than 30.8% (the calibration backfired), or if sensitivity drops below 100% (we lose a true positive), revert the prompt change and document the result in `verification-s13.md` — the eval harness + label file are unchanged, so reverting is a single `git revert` (or `git checkout HEAD~1 -- apps/api/src/agents/riskAgent.ts`).

The pre-existing `MOCK_RISK_OUTPUT` fallback is unaffected by this change — demo-fallback still works the same way (S12 B.1).

---

## Open question

`samuel-wright` and `pop-0007` are the two remaining expected-true-high-risk patients. Both have `seed riskScore = 79` and `92` respectively, so the new rubric should still classify them as high — but the rubric's evidence check (Conditions + Encounter recency + Observations) is computed from the **FHIR bundle** the agent sees, not from the deterministic generator. If their bundles are missing one of the rubric anchors (e.g., no BNP Observation), the agent will (correctly) call them moderate and the eval will report a sensitivity miss. If that happens, that's an honest finding — but flag it in `verification-s13.md` and consider whether the labels or the generator need adjustment (NOT in this slice — track as cross-slice debt).

---

## Next step (ADLC)

Drive this plan with `subagent-driven-development` (TDD: Phase A tests first, then Phase B; commit per phase). After the slice ships: `verification-before-completion` and `code-review` per the lifecycle, then `finishing-a-development-branch` for the PR.