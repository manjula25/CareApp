# Implementation Plan — Risk Agent Calibration (S13) — **REVERTED in S13b**

> **PLAN_ID:** `caresync-ai` · **Slice:** S13 → **S13b** · **Date:** 2026-07-08
> **Status:** ⚠️ **The S13 rubric this plan describes was REVERTED in S13b.** This document is retained for the audit trail of the original plan; the actual current implementation lives in `feature/risk-agent-calibration-s13` (PR #19, merged into `main`) + the follow-up branch `fix/s13-samuel-wright-seed-evidence`. See `verification-s13.md` for the post-mortem and `design-risk-calibration.md` for the design rationale (and why the rubric didn't work).

---

## Original plan (S13) — for the audit trail

**Goal:** Tighten the Risk agent's calibration so the eval's headline metric (`docs/eval-report.json`) reports fewer false positives — addressing the rubric-analyzer's biggest gap (Risk specificity 30.8%, PPV 25%, 9 FPs out of 13 TNs).

**Architecture / Tech Stack:** No new tech. Prompt-only change to `apps/api/src/agents/riskAgent.ts`; additive TDD unit tests in `apps/api/src/agents/riskAgent.test.ts`; one disclosure string in `apps/api/src/scripts/eval.ts`'s `renderMarkdown()`. The eval harness (`npm run eval`) re-runs the existing pipeline — no harness changes.

**Domain source:** `fhir-data/population.ts:127-134` `riskScoreFor()` is the calibration target. Vocabulary from `data/eval/labels.json` `_meta.labelingRules.risk`.

---

## Original Iteration 1 — TDD scaffolding (now historical)

**Spec:** design-risk-calibration.md §3 (rubric), §4 (file change set) · **Decision refs:** D3, D6

### Phase A — Pin the rubric with TDD unit tests [DONE in S13, REMOVED in S13b]

- [x] A1. Export `buildPrompt` from `riskAgent.ts`. **Verify:** pre-existing tests still green.
- [✅→❌ removed] A2. Add 4 unit tests to `riskAgent.test.ts` (TDD — write these BEFORE the prompt change, watch them fail):
  - A2.1 — rubric anchors (multi-condition, recent inpatient discharge, abnormal labs)
  - A2.2 — threshold text + 4 tier names
  - A2.3 — citation guard (KEPT in S13b)
  - A2.4 — bundle grounding guard (KEPT in S13b)

  **S13 outcome:** all 4 tests added, all 4 green after rubric insertion.
  **S13b outcome:** A2.1 + A2.2 removed (the rubric they pinned no longer exists); A2.3 + A2.4 retained. Final: 7 tests passing.

### Phase B — Apply the prompt change [DONE in S13, REVERTED in S13b]

- [✅→❌ reverted] B1. Extend `buildPrompt()` with the rubric (D3). Insert the rubric as a multi-line block.
- [x] B2. Confirm boot-time safety + demo fallback still work. **Verify:** full `riskAgent.test.ts` suite green (8 tests in S13; 7 in S13b).

### Phase C — Eval-report disclosure (D7) [DONE in S13, REWRITTEN in S13b]

- [✅→🔁 rewritten] C1. Augment `renderMarkdown()` with rubric-mirrors-seed sentence. **S13b rewrite:** the sentence now documents the S13b reversion.
- [✅→🔁 rewritten] C2. Add the same disclosure to each Risk FP header. **S13b rewrite:** header now references the pre-S13 baseline.

### Phase D — Re-eval and commit [DONE]

- [no-op] D1. Invalidate maria-chen's `analysis_cache` row. **Outcome:** worktree DB was empty; main's cache got incidentally bypassed when the eval ran from the worktree.
- [✅] D2. Run the eval harness end-to-end. **S13 outcome:** rubric produced specificity 0% in fresh-cache worktree runs (worse than pre-S13 30.8%). **S13b outcome:** post-revert fresh-cache eval reproduces the same specificity 0% — meaning the rubric itself was not load-bearing for the regression; today's LLM is producing different baseline behavior than on 2026-07-07 (the pre-S13 committed report date).
- [❌ skipped] D3. Inspect the regenerated report; commit the regenerated `docs/eval-report.{md,json}`. **Outcome:** skipped both times — the regenerated numbers were worse than the pre-S13 committed snapshot and not worth committing. The pre-S13 report remains the committed artifact pending the LLM-variance follow-up.
- [✅ in S13; ❌ not in S13b] D4. Commit the slice. **S13 outcome:** committed as PR #19 (now merged). **S13b outcome:** to be committed on `fix/s13-samuel-wright-seed-evidence`.

### Phase E — Verification + self-review [DONE]

- [x] E1. Write `docs/plans/caresync-ai/verification-s13.md`.
- [x] E2. Write `docs/plans/caresync-ai/review-s13.md` using the two-axis pattern.

---

## S13b additions [ACTIVE work]

- [x] **Enrich `samuel-wright`'s seed.** Added Encounter (CHF inpatient, 36h ago) + 2 Observations (BNP 380, K+ 3.5) in `apps/api/src/fhir-data/seed-patients.ts`. Re-imported FHIR via `npm run import` (idempotent — used PUT).
- [x] **Rewrite the S13 disclosures** in `apps/api/src/scripts/eval.ts` from "rubric-mirrors-seed" to "S13b = reversion + seed enrichment."
- [x] **Trim the TDD tests** from 4 to 2 (kept the citation + grounding guards).
- [x] **Refresh `verification-s13.md`** with S13b reversion log + LLM-variance diagnosis + cross-slice follow-up list.
- [ ] **Commit + push + PR** `fix/s13-samuel-wright-seed-evidence` against `main`.

---

## Rollback / safety (S13b)

The pre-S13 commit `16fbf64 fix(S12): real-implementation primary, mock fallback only` (the parent of S13) is the safe rollback point for the entire S13 effort — `git revert 29d04db 29d04db^` (or a 2-commit revert) puts `main` back to a state where:
- The Risk agent uses the original 1-paragraph prompt.
- `riskAgent.test.ts` is back to its pre-S13 form.
- `eval.ts` has no "Status (S13)" disclosures.
- `seed-patients.ts`'s `samuel-wright` is back to its 1-condition, no-encounter form (so any pre-S13 cached analysis of him would still be valid — though the LLM-variance question becomes moot since the LLM is what it is today regardless).

---

## Open follow-ups (now in `verification-s13.md` §6)

1. LLM-side variance investigation.
2. v2 rubric (few-shot examples, "0 anchors always means low").
3. Clinician validation of labels via `npm run review:render`.
4. Re-run eval after variance resolution to confirm the rubric's intended effect.
