# PRD — S16: Risk Agent Calibration v2 (Rubric Redesign + LLM-Variance Investigation)

> **Status (2026-07-09):** D2's temperature + seed pin is **not viable** — the OpenAI Responses API rejects `seed` on all models and rejects `temperature` on reasoning-tier models. Verified by commit 2 subagent; see [`variance-probe.md`](variance-probe.md). D2 is now deferred; commit 2 ships the `varianceProbe.ts` observation tool without the pin. D3 (varianceProbe.ts design) stands. D4–D11 stand (v2 rubric design + 2x2 gate + commit 3) — they don't depend on the pin.

> **PLAN_ID:** `caresync-ai` · **Slice:** S16 · **Status:** Ready for `writing-plans` (ADLC: specify → plan)
> **Author:** Manjula / Bitcot · 2026-07-09
> **Upstream artifacts:** `docs/plans/caresync-ai/grill-risk-calibration-v2.md` (7-question grill, 2026-07-09), `docs/plans/caresync-ai/design-risk-calibration.md` (S13's reverted rubric — audit trail), `docs/plans/caresync-ai/verification-s13.md §4 + §6` (LLM-variance evidence + open follow-ups), `reports/HL7-Challenge-Evaluation.2026-07-08-post-s15.md §E` (sub-gap 3 that motivates S16), `apps/api/src/agents/riskAgent.ts:11,85-100` (the current model + prompt — S16's targets), `apps/api/src/agents/{careGap,sdoh,actionPlanner}Agent.ts` (the other 3 agents that share the temperature/seed pin), `apps/api/src/eval/labelFromBundle.ts` (S15's held-out label function — feeds the 2x2 gate's held-out arm), `apps/api/src/agents/riskAgent.test.ts` (existing TDD surface).
> **Tracker note:** This POC is Jira-free and file-backed (per `CLAUDE.md`). No issue-tracker publish and no triage labels applied — this file is the artifact. The slice name `S16` continues the existing `S#` convention used by S1–S15.

---

## Problem Statement

The HL7 AI Challenge evaluation report (`reports/HL7-Challenge-Evaluation.2026-07-08-post-s15.md §E`) identifies P2 as the pillar bounded by the Risk agent's 9-FP rate (specificity 30.8%, PPV 25%). S13 attempted a prompt-rubric calibration, but the live re-eval showed it caused the model to over-call (specificity regressed to 0%), and the rubric was reverted in S13b. The remaining risk lives in two places:

1. **The prompt itself** — the post-S13 revert is the original one-paragraph clinical-judgment instruction. The S13 attempt followed `docs/plans/caresync-ai/design-risk-calibration.md` §"Why this design failed" analysis: the rubric used negative instructions ("Do not call high when fewer than 2 anchors") that lost to the model's clinical-judgment instinct, abstract anchors that allowed partial matches, and no "0 anchors → low" lower bound.

2. **The LLM API state** — `verification-s13.md §4` shows the same code re-run on 2026-07-08 reproduces `specificity 0%` whereas the 2026-07-07 snapshot showed `specificity 30.8%`. The committed baseline number was a snapshot of LLM behavior at one moment; that specific behavior is no longer recoverable by tweaking the prompt alone. §6 lists the LLM-side variance investigation as the first open follow-up.

S15 closed sub-gaps 1 (held-out set) + 2 (outreach log) and reserved sub-gap 3 (Risk rubric) as S16's scope — see `grill-evaluation-gaps.md` §1. S16 closes sub-gap 3 by addressing both places the risk lives: a tighter rubric structure that addresses all three S13 failure modes, plus a cross-agent variance knob (temperature + seed pin) that addresses the API-state shift.

From a **clinical evaluator's** perspective, the agent currently calls every patient with any active condition `critical` regardless of bundle content — meaning the eval-report's Risk sensitivity=100%/specificity=0% number is not a real measurement, it's a snapshot of an over-eager prompt + an under-controlled API. A clinician reading the eval can't tell whether the agent's over-call is a rubric problem or an API problem; S16 separates the two and ships a fix for each.

From a **submission-reviewer / judge** perspective, the HL7 rubric's P2 asks for an agent that calibrates risk accurately without over-calling. The S13 attempt + reversion is documented in the audit trail (`design-risk-calibration.md` + `verification-s13.md`), and S16's design doc (`design-risk-calibration-v2.md`) closes the loop with a v2 rubric + the variance root cause.

---

## Solution

S16 closes sub-gap 3 in a single three-commit PR. Each commit is atomic, the PR is reviewable as a unit, and the verification matrix in §5 is the unified acceptance signal: a fresh `npm run eval --risk-only --rubric=v2` re-run against dev-labeled 16 + held-out 10 produces numbers that satisfy the 2x2 acceptance gate, and a separate variance probe run shows the per-patient `riskLevel` agreement has collapsed to ≥80%.

The three commits, in order:

1. **`docs(S16): grill + PRD + design-risk-calibration-v2`**. Pure planning — `docs/plans/caresync-ai/grill-risk-calibration-v2.md` (the shared-understanding artifact), `docs/plans/caresync-ai/prd-s16.md` (this file), and `docs/plans/caresync-ai/design-risk-calibration-v2.md` (the forward-looking design doc, mirrors S13's `design-risk-calibration.md` pattern). No code/test changes.

2. **`feat(S16): temperature + seed pin (all 4 agents) + varianceProbe.ts`**. Cross-cutting variance knob:
   - Add `temperature: 0` and `seed: 42` to the `client.responses.create(...)` call in `apps/api/src/agents/riskAgent.ts`, `careGapAgent.ts`, `sdohAgent.ts`, and `actionPlannerAgent.ts`. Same two-line change in each file.
   - Add `apps/api/src/eval/varianceProbe.ts` — a script that runs the dev-labeled 16 patients through `runRiskAgent` N=3-5 times and emits a per-patient `riskLevel` agreement matrix. Runs the real LLM, not cached mock outputs.
   - TDD tests in each `*Agent.test.ts` pin both new params (`params.temperature === 0`, `params.seed === 42`).
   - Eval-report disclosure: *"Variance investigation (S16): temperature pinned to 0, seed pinned to 42 across all 4 agents. Pre-pin specificity range 0%–69.2%; post-pin range TBD by probe."*

3. **`feat(S16): risk rubric v2 — replace buildPrompt with few-shot + 0-anchors rule`**. The actual rubric change:
   - Replace `apps/api/src/agents/riskAgent.ts`'s `buildPrompt` body with the v2 prompt: 3 calibration anchors (multi-condition comorbidity, recent inpatient discharge ≤30d, abnormal labs — same as S13's D3), the explicit "0 anchors → low regardless of complexity" hard rule, and 3 worked examples using actual seed-text bundle shapes.
   - TDD tests in `apps/api/src/agents/riskAgent.test.ts`: (a) 3 anchor definitions present, (b) "0 anchors → low" rule present verbatim, (c) 3 worked examples present with their expected bundle shapes. Existing 2 regression-guard tests (citation requirement + bundle grounding) stay.
   - Eval re-run: `npm run eval --risk-only` (default, v2 prompt) against dev-labeled 16 + held-out 10. Must pass the 2x2 acceptance gate (see D6). On success, `--rubric` flag removed from `scripts/eval.ts` and the rubric=v1 path closed.
   - Eval-report disclosure: *"S16: rubric v2 (few-shot examples + 0-anchors rule) replaces the S13-reverted 1-paragraph prompt. Pre-rubric v2 sensitivity=100%/specificity=0%; post-rubric v2 numbers in §X."*

After S16 lands, the eval-report's Risk section shows:
- **Dev-labeled 16:** specificity ≥30% (recovered from 0%; matches pre-S13 baseline of 30.8%), sensitivity ≥67%.
- **Held-out 10:** specificity ≥30%, sensitivity ≥50%.
- **Variance probe:** per-patient `riskLevel` agreement ≥80% (was <30%).

The S16 score-card delta: **P2 4 → 5**, total 89.2 → **~91.0**. P4 stays at 4 — held back by no model card + 0/16 clinician-validated, both explicitly out of S16 scope.

The reversion plan lives in `verification-s16.md` as one paragraph: *"If a real-world bug surfaces post-merge that the 2x2 didn't catch, revert the prompt change in `buildPrompt` back to the v1 one-paragraph form. The temperature + seed pin from commit 2 survives the revert."* The revert is mechanical — same pattern as S13b.

---

## User Stories

### Risk rubric v2

1. As a **clinical evaluator** reading the eval-report, I want the Risk agent's sensitivity and specificity numbers to reflect a *calibrated* rubric rather than the model's defaults, so that I can interpret the agent's accuracy as a property of the prompt design, not of API noise.
2. As a **clinical evaluator**, I want the Risk agent to follow the "0 anchors → low regardless of complexity" rule deterministically, so that single-diagnosis patients (e.g., one COPD diagnosis with no other evidence) are not escalated to high/critical.
3. As a **clinical evaluator**, I want 3 worked examples in the rubric that match the actual seed-text bundle shapes I see in `data/eval/labels.json`, so that the rubric and the eval corpus speak the same language.
4. As a **clinical evaluator**, I want to compare the dev-labeled and held-out Risk metrics side-by-side after S16, so that I can see whether the rubric over-fits to the dev cohort (specificity collapses on held-out) or generalizes (held-out specificity ≥30%).
5. As a **submission reviewer / judge**, I want `design-risk-calibration-v2.md` to mirror S13's `design-risk-calibration.md` audit-trail pattern (decisions, rejected alternatives, why this design works where S13 didn't), so that S16's design rationale is preserved even if the rubric changes again in a future slice.
6. As a **reviewer** of the S16 PR, I want commit 3 to be a single targeted change to `buildPrompt` plus its TDD pins, so that the rubric change is reviewable in isolation from the variance knob and the planning docs.

### LLM-variance investigation

7. As a **clinical evaluator**, I want the eval-report to disclose that the model's API state has been observed to shift between runs (pre-pin specificity range 0%–69.2%), so that I'm not falsely confident that a single specificity number is stable across deployments.
8. As an **eval operator** running `npm run eval`, I want the Risk agent to use `temperature: 0` and a fixed seed, so that re-running the eval produces the same `riskLevel` for the same patient across runs — within the limits of what API determinism can guarantee.
9. As an **eval operator**, I want `apps/api/src/eval/varianceProbe.ts` to produce a per-patient `riskLevel` agreement matrix from N=3-5 runs against the dev-labeled 16, so that I can see exactly which patients are flaky and quantify the variance window before and after the pin.
10. As an **eval operator**, I want the variance probe to run the **real LLM** (not cached mock outputs), so that the agreement matrix reflects actual API behavior, not a synthetic-output loop that masks the variance source.
11. As a **developer**, I want the temperature + seed pin to apply to **all 4 agents** (Risk, Care Gap, SDOH, Action Planner), so that cross-agent eval-report comparisons don't suffer from one agent being pinned and another being flappy.

### Verification & acceptance

12. As a **release engineer**, I want commit 3 to not merge unless the 2x2 acceptance gate passes — dev-labeled specificity ≥30% AND sensitivity ≥67%, held-out specificity ≥30% AND sensitivity ≥50% — so that the rubric ships with evidence it works, not with a reversion plan as the primary deliverable.
13. As a **release engineer**, I want the variance probe to run before and after the pin, so that the eval-report can cite a concrete pre-pin vs post-pin agreement number as evidence the pin collapsed the variance.
14. As a **release engineer**, I want `verification-s16.md` to enumerate the 5-row verification matrix from §5 of the S16 grill, with concrete commands run + exit codes + output captured, so that the slice is provably complete, not just "tests pass."
15. As an **engagement-track coordinator**, I want S16 to **not** depend on clinician validation of the rubric for its acceptance gate, so that the slice ships whether or not a clinician volunteers to review.

### Rollback safety

16. As a **release engineer**, I want the reversion plan documented in `verification-s16.md` as one paragraph (revert `buildPrompt` to v1 form; temperature + seed pin survives the revert), so that if a post-merge bug surfaces the path to recovery is one commit, not a design investigation.
17. As a **developer** maintaining `riskAgent.ts`, I want the v2 prompt to land as the **only** prompt (no `buildPromptV1`/`buildPromptV2` export split, no `USE_RISK_V2_RUBRIC` env var), so that the codebase's no-flag convention is preserved and the audit trail doesn't read as "shipped cautiously, then cautiously enabled."
18. As a **reviewer**, I want a TDD test that pins the `"0 anchors → low"` rule's presence in `buildPrompt` output, so that any future prompt-edit that accidentally removes the rule fails CI before merge.

### Cross-cutting

19. As a **release engineer**, I want the pre-S16 SDOH regex bug fix (commit `feca132` on main) to be the baseline for S16, so that S16's eval-report numbers reflect a clean SDOH scorer — not the latent bug that mis-classified "no social barriers identified" as positive before the fix.
20. As a **developer**, I want S16's commit chain to have 3 atomic commits (planning / variance / rubric), each independently revertable, so that if any one of the three turns out to be wrong, the other two keep shipping without rework.

---

## Implementation Decisions

### D1. Slice structure
S16 covers sub-gap 3 (Risk v2 rubric + LLM-variance) in a single three-commit PR:
1. **docs** — grill + PRD + design-risk-calibration-v2
2. **feat** — temperature + seed pin (all 4 agents) + varianceProbe.ts
3. **feat** — risk rubric v2

Rationale: the variance investigation is the *root cause* of S13's reversion. A v2 rubric without diagnosing the variance would re-create S13's reversion pattern. Bundling the variance work (commit 2) before the rubric (commit 3) means commit 3's specificity lift can be attributed to the rubric, not to a quieter API day.

### D2. Temperature + seed pin (all 4 agents)
- `temperature: 0` and `seed: 42` are added to `client.responses.create(...)` calls in:
  - `apps/api/src/agents/riskAgent.ts`
  - `apps/api/src/agents/careGapAgent.ts`
  - `apps/api/src/agents/sdohAgent.ts`
  - `apps/api/src/agents/actionPlannerAgent.ts`
- Same two-line change in each file: spread `...{ temperature: 0, seed: 42 }` into the call's parameter object (or explicit properties).
- TDD tests pin both params in each file's existing `*.test.ts` — same shape as the existing `params.model === 'gpt-5.5'` assertion.
- The pin lands on the **real** call, NOT on the `MOCK_*_OUTPUT` fallback. The fallback stays as it is (per project memory `never-override-real-with-fake.md`): it activates only when `OPENAI_API_KEY` is unset for a local demo.
- Rationale: verification-s13.md §6 shows the same variance pattern affected Risk (specificity 0%), Care Gap (FN=10), and SDOH (agreement 93.75%) — all three classifier agents regressed at once. Limiting the pin to Risk leaves Care Gap and SDOH at the mercy of API defaults.

### D3. `varianceProbe.ts` design
- New file: `apps/api/src/eval/varianceProbe.ts`.
- Invocation: `npx tsx src/eval/varianceProbe.ts` (no `npm` script needed initially; can add later if a `--watch` or `--runs=N` flag is added).
- Behavior:
  - Iterates over the dev-labeled 16 patients (read from `data/eval/labels.json`).
  - For each patient, calls `runRiskAgent(bundle)` N=3-5 times (default 3).
  - Records `riskLevel` for each run.
  - Computes per-patient agreement (number of runs that produced the same `riskLevel` / total runs).
  - Emits a markdown table to stdout (and optionally a JSON sidecar for programmatic inspection).
- Runs the **real** LLM (not mock, not cached). When `OPENAI_API_KEY` is unset, the script prints `OPENAI_API_KEY unset — variance probe requires the real LLM, aborting.` and exits non-zero.
- Doesn't modify `apps/api/src/scripts/eval.ts` — it's a separate tool, similar to how `scripts/outreach-validate.ts` is separate from `scripts/eval.ts`.
- Quota-cost: 16 patients × 3 runs × 1 agent = 48 LLM calls per probe execution. At ~5-10s per call (current throughput), ~4-8 min per probe. Run twice (pre-pin, post-pin) = ~8-16 min total.

### D4. v2 rubric structure (`buildPrompt` rewrite)
The new `buildPrompt` body in `apps/api/src/agents/riskAgent.ts`:

```
## Calibration anchors (3 of 3)
  Anchor A: Multi-condition comorbidity (≥2 of {diabetes E11.9, CHF I50.9,
            depression F33.1, CKD N18.3})
  Anchor B: Recent inpatient discharge (Encounter with class=inpatient in last 30d)
  Anchor C: Abnormal labs (BNP>200, HbA1c>9.0%, eGFR<30)

## Hard rule
A patient with 0 anchors met is ALWAYS riskLevel='low' — even if they have
multiple active conditions. Do not escalate on complexity alone. This is the
most common over-call pattern; defaulting to high/critical without ≥1 anchor
is incorrect.

## Worked examples (must use actual seed-text patterns)
Ex 1 (0 anchors → low):  Patient/diabetes-only → low, 0 flags
Ex 2 (1 anchor → moderate): Patient/CHF+BNP-380 → moderate, 1 flag
Ex 3 (2 anchors → high): Patient/diabetes+CHF+recent-disch+HbA1c-10 → high, 3 flags
```

Three new TDD tests in `riskAgent.test.ts`:
- (a) The 3 anchor definitions appear verbatim in `buildPrompt` output.
- (b) The "0 anchors → low" rule appears verbatim in `buildPrompt` output.
- (c) The 3 worked examples appear with their expected bundle shapes (test asserts the example patient IDs are the actual seed-text patient IDs from `seed-patients.ts`).

The 2 existing regression-guard tests (citation requirement + bundle grounding) stay. The 2 S13-era rubric-specific tests stay for now; if commit 3 lands cleanly, they get removed in a follow-up.

### D5. No feature flag (single-prompt land)
- The v2 prompt is the **only** prompt in commit 3.
- `buildPromptV1` and `buildPromptV2` exports are NOT introduced.
- `USE_RISK_V2_RUBRIC` env var is NOT introduced.
- Rationale:
  - The 2x2 acceptance gate (D6) is the merge gate — commit 3 doesn't land unless all 4 numbers pass. If v2 overshoots, the branch stays open, no merge, no revert commit needed.
  - Feature flags in a POC are dead weight — no gradual rollout, no A/B in production.
  - The codebase has no other flags; introducing one breaks the no-flag convention.

A `--rubric` flag IS introduced in `apps/api/src/scripts/eval.ts` (D6), but it's a **testing tool** for the 2x2 gate, not a runtime feature flag. It exists to compare v1 vs v2 during the verification window and is removed once commit 3 merges as the only prompt.

### D6. 2x2 acceptance gate (verification + merge gate)
| | Dev-labeled 16 | Held-out 10 |
|---|---|---|
| **Specificity** | ≥30% (recover pre-S13 baseline of 30.8%) | ≥30% (generalization floor) |
| **Sensitivity** | ≥67% (S13b's 3/3 + ≥1) | ≥50% |

- `scripts/eval.ts` gains a `--rubric=v2` flag (default = current behavior, i.e. v1) for the verification window. After commit 3 merges, the flag is removed and `--risk-only` runs v2 unconditionally.
- During the verification window, the eval operator runs both `--rubric=v1` (baseline) and `--rubric=v2` (candidate), compares the numbers, confirms the 2x2 passes, then merges commit 3.
- `--risk-only` flag (already pattern from S15 era) restricts the eval to the Risk agent only — cheaper for iteration.
- Gate enforcement: commit 3 is held until the 2x2 numbers appear in `docs/eval-report.md` (regenerated by `npm run eval --rubric=v2 --risk-only`).

### D7. Reversion plan in `verification-s16.md`
> *If a real-world bug surfaces post-merge that the 2x2 didn't catch (e.g., a 17th-patient class that the held-out set missed), revert the prompt change in `buildPrompt` back to the v1 one-paragraph form. The temperature + seed pin from commit 2 survives the revert. The eval-report disclosure notes the reversion and links to this paragraph as the contingency plan.*

Mechanical revert: replace `buildPrompt` body with the v1 5-line prompt (the post-S13 form). The 2 regression-guard TDD tests stay. The 3 new TDD tests for v2 structure get removed (they describe state that no longer exists) — same pattern as S13b's rubric-pins removal.

### D8. File-level change set
**New files (2):**
- `apps/api/src/eval/varianceProbe.ts`
- `apps/api/src/eval/varianceProbe.test.ts` (TDD-pin: probe runs the real LLM, exits 0 when key is set, exits non-zero when key is unset; per-patient agreement math is right)

**New artifacts (1):**
- `docs/plans/caresync-ai/design-risk-calibration-v2.md` (mirrors S13's `design-risk-calibration.md` audit-trail pattern)

**Modified files (5):**
- `apps/api/src/agents/riskAgent.ts` — add `temperature: 0` + `seed: 42` to the create call (commit 2); rewrite `buildPrompt` body (commit 3)
- `apps/api/src/agents/careGapAgent.ts` — add `temperature: 0` + `seed: 42` to the create call (commit 2 only)
- `apps/api/src/agents/sdohAgent.ts` — add `temperature: 0` + `seed: 42` to the create call (commit 2 only)
- `apps/api/src/agents/actionPlannerAgent.ts` — add `temperature: 0` + `seed: 42` to the create call (commit 2 only)
- `apps/api/src/agents/riskAgent.test.ts` — pin `temperature` + `seed` params (commit 2); add 3 v2 structure tests (commit 3)
- `apps/api/src/agents/careGapAgent.test.ts`, `sdohAgent.test.ts`, `actionPlannerAgent.test.ts` — pin `temperature` + `seed` params (commit 2 only)
- `apps/api/src/scripts/eval.ts` — gain `--rubric=v2` flag for the verification window (commit 3); flag removed once commit 3 merges
- `docs/eval-report.md` + `docs/eval-report.json` — regenerated by commit 3's eval re-run

**Not modified:**
- `apps/api/src/agents/confidenceScorer.ts` — pre-S16 SDOH regex fix already landed on main at `feca132`; S16 commits build on top.
- `apps/api/src/fhir-data/seed-patients.ts` — S13b's samuel-wright enrichment survives; no new seed edits.
- `apps/api/src/eval/labelFromBundle.ts` — S15's held-out label function feeds the 2x2 gate's held-out arm; no change.
- `apps/api/package.json` — no new scripts (variance probe runs via `npx tsx`).

### D9. Verification matrix (S16's 5 signals, scope-reduced)
| # | Signal | Verification command / artifact | Pass condition |
|---|---|---|---|
| 1 | ~~Temperature + seed pin in all 4 agents~~ — **deferred** | The OpenAI Responses API rejects `seed` on all models and rejects `temperature` on reasoning-tier models. Per [`variance-probe.md`](variance-probe.md). | n/a — deferred to a future slice that picks a different variance-collapse lever |
| 2 | varianceProbe.ts exists, runs against the real LLM (when supported) | `npx tsx src/eval/varianceProbe.ts` | Script exits 0 when the API supports the call; emits per-patient `riskLevel` agreement matrix from 3 runs against the dev-labeled 16. **Today:** exits non-zero with the documented API rejection; the TDD contract is still satisfied. |
| 3 | ~~Variance window collapses~~ — **n/a** | n/a | The pin-based collapse strategy is not viable on the Responses API. Future slices pick a different lever. |
| 4 | v2 rubric structure | `riskAgent.test.ts` TDD pins for the new `buildPrompt` | 3 anchor definitions present + "0 anchors → low" rule present + 3 worked examples present (with actual seed-text bundle shapes) |
| 5 | 2x2 acceptance gate | `npx tsx src/scripts/eval.ts --risk-only` against dev-labeled 16 + held-out 10 | Dev-labeled specificity ≥30% AND sensitivity ≥67%; held-out specificity ≥30% AND sensitivity ≥50% |

Signals #4 and #5 stand unchanged. Signals #1 and #3 are deferred per the API constraint. Signal #2 is conditional on the API supporting the call (it doesn't today; the probe's TDD contract is still satisfied). Signal #5 is the merge gate.

### D10. Score-card delta (scope-reduced)
| Pillar | Pre-S16 | Post-S16 (predicted) | Why |
|---|---|---|---|
| P1 | 5 | 5 | Unchanged — full eval harness from S9 |
| P2 | 4 | **5** *(if commit 3's 2x2 gate passes)* | Held-out section (S15) + specificity recovered by v2 rubric. Variance collapse deferred (API constraint). |
| P3 | 5 | 5 | Unchanged |
| P4 | 4 | 4 | Held back by no model card + 0/16 clinician-validated (out of S16 scope) |
| P5 | 5 | 5 | Unchanged |
| P6 | 5 | 5 | Held-out section already from S15 |
| P7 | 4 | 4 | Unchanged |
| P8 | 4 | 4 | Unchanged |
| P9 | 3 | 3 | Unchanged |
| **Total** | **89.2** | **~91.0** *(if 2x2 passes)* | P2 4→5 (+1.8). If 2x2 fails, P2 stays 4; total 89.2. |

The pillar lift is now conditional on commit 3's rubric alone (no substrate-stability contribution from the pin). If the v2 rubric doesn't recover ≥30% specificity, the pillar stays 4 and the slice ships a 1.8-point net loss in expected lift. The contingency plan in commit 3's commit message handles that path.

### D11. Engagement operationalization
- S16 does **not** commit a clinician-engagement timeline. The S15 outreach log is the operational mechanism; S16 makes the v2 rubric available for clinician review via the same `npm run review:render` path that already exists.
- The S16 PR's `verification-s16.md` documents the action item: "When engagement lands, the next eval re-run picks up the v2 rubric's `source: 'clinician'` rows automatically (S14's `c6587f1` made the disclosure data-driven)."

---

## Testing Decisions

### T1. What makes a good test for S16
- **External behavior only** — test the `buildPrompt` output content (not internal helpers), the `varianceProbe.ts` I/O (not its iteration order), the `eval.ts --rubric=v2` rendered output (not its branching), and the post-pin agent params (not the SDK call mechanics).
- **No mock-LLM behavior tests.** Per project memory `never-override-real-with-fake.md`, the real LLM is the production path. Mock LLM tests are acceptable for unit-level surface (existing fakeStream pattern) but the **variance probe and the live eval re-run are real-LLM tests**, run against the actual API.
- **Real-but-small fixtures.** Anchor definitions, "0 anchors → low" rule, and worked examples are all literal text in the prompt — fixtures are strings of expected substrings.

### T2. Prior art
- **`apps/api/src/agents/riskAgent.test.ts:fakeStream`** — the existing fake-client pattern (mimics the real SDK's `responses.create` contract). Reused for the temperature/seed pinning tests. Doesn't replace the real-LLM variance probe or the live eval re-run.
- **`apps/api/src/eval/labelFromBundle.test.ts`** — the S15 TDD pattern for pure functions in `apps/api/src/eval/`. `varianceProbe.test.ts` follows the same fixture + assertion style for its real-LLM orchestration math.
- **`apps/api/src/scripts/outreach-validate.ts`** — the I/O script pattern for `eval/` validation tools. `varianceProbe.ts` follows the same pattern (path resolved from `__dirname`, `main()` guarded by `require.main === module`).
- **`apps/api/src/agents/riskAgent.test.ts` existing tests** — the citation-requirement and bundle-grounding regression guards. S16's new TDD pins for `buildPrompt` structure live alongside these; the regression guards stay.

### T3. What gets tested in each new / modified file
**`riskAgent.test.ts` (commit 2 — temperature/seed pin):**
- 1 test that the `client.responses.create` call's params include `temperature: 0` (same shape as the existing `params.model === 'gpt-5.5'` test).
- 1 test that the params include `seed: 42`.

**`careGapAgent.test.ts` / `sdohAgent.test.ts` / `actionPlannerAgent.test.ts` (commit 2):**
- Same 2 tests per file — `temperature: 0` and `seed: 42` params.

**`riskAgent.test.ts` (commit 3 — v2 rubric):**
- 3 new TDD pins: 3 anchor definitions, "0 anchors → low" rule, 3 worked examples. Each test imports `buildPrompt`, runs it on a fixture bundle, asserts the expected substring is present.
- 2 existing regression-guard tests stay.
- The 2 S13-era rubric-pins tests get removed in a follow-up if commit 3 lands cleanly.

**`varianceProbe.ts` (commit 2 — new file):**
- `varianceProbe.test.ts` includes:
  - 1 test that the script exits 0 when `OPENAI_API_KEY` is set (uses a fake LLM client like `riskAgent.test.ts:fakeStream` for unit-level testability).
  - 1 test that the script exits non-zero with the expected message when `OPENAI_API_KEY` is unset.
  - 1 test that per-patient agreement math is correct (3 runs, all same `riskLevel` → 3/3; 2-of-3 same → 2/3).
  - The agreement-matrix output format is tested by snapshot or string-match.

**`scripts/eval.ts` (commit 3 — `--rubric` flag, transient):**
- 1 test (integration, not unit) that `--rubric=v2` selects the v2 prompt and `--rubric=v1` selects the v1 prompt.
- The flag is removed in the same commit that follows commit 3's merge — not ship-with-cleanup, but ship-then-cleanup to keep the audit trail honest.

### T4. Integration tests in `verification-s16.md`
- 1 `npx tsx src/eval/varianceProbe.ts` (commit 2) — emits pre-pin agreement matrix; matrix shows <80% agreement.
- 1 `npm run eval --rubric=v2 --risk-only` against dev-labeled 16 + held-out 10 (commit 3) — 2x2 numbers extracted; both quadrants hit the thresholds.
- 1 `grep -n "temperature\|seed" apps/api/src/agents/*Agent.ts` (commit 2) — all 4 files show both params.
- 1 re-run `npx tsx src/eval/varianceProbe.ts` (commit 2's post-pin state) — agreement matrix shows ≥80%.

### T5. What does NOT get tested
- The internal iteration order of `varianceProbe.ts` — only the agreement matrix output is tested.
- The output of `buildPrompt` beyond the 3 anchored substrings (anchors, rule, examples) — full-string snapshot is too brittle for prompt design.
- The exact `temperature` / `seed` values of the OpenAI SDK response stream — only the request params are tested.
- Care Gap FN=10 or SDOH agreement-after-pin — separate from Risk overshoot; out of S16 scope (T7 in grill §8).

---

## Out of Scope

- **Model-snapshot ID pinning** (e.g., `gpt-5.5-2025-XX-XX`) — uncertain whether OpenAI exposes one; defer until temperature+seed proves insufficient (probe signal #3 will tell us).
- **Cross-agent rubric design** — only Risk gets the v2 rubric. Care Gap / SDOH / Action Planner prompts stay as-is.
- **Clinician validation of the rubric** — S15's outreach log makes this possible, but no clinician will see the v2 rubric in this slice.
- **Real-time drift detection** — variance probe is an on-demand tool, not a daemon.
- **Care Gap FN=10 / SDOH agreement regression** — same temperature+seed pin should help; verifying it isn't a S16 gate.
- **MODEL_CARD.md authoring** — Option B in the S15 handoff; not part of S16.
- **A clinician-engagement SLA or timeline** — S15's outreach log captures activity; S16 doesn't add one.
- **A `--rubric` flag in `riskAgent.ts`** — see D5. The flag lives in `scripts/eval.ts` only for the verification window.
- **Pre-merge rollout to non-dev environments** — POC deploys to one env; commit 3 ships to that env when it merges.
- **SDOH regex or seed enrichment** — pre-S16 SDOH fix already on main (`feca132`); S13b's samuel-wright enrichment already merged; no new data edits.

---

## Further Notes

### Sequencing within S16
The three commits land in the order: #1 (planning docs) → #2 (variance) → #3 (rubric). Rationale:
- #1 is the planning artifact chain — establishes the audit trail before any code lands.
- #2 establishes what "stable behavior" looks like *before* the prompt changes in commit 3. Without #2 first, a specificity lift in #3 could be misattributed to the rubric when the API just happened to have a quieter day.
- #3 is the actual rubric change — depends on #2's stable substrate (pinned temperature + seed) so the 2x2 gate attributes the lift to the rubric design alone.

This order is the *recommended* merge order; if the user prefers a different order, the 2x2 gate and the verification matrix are the same (still runs against the merged state).

### Upstream dependencies
- `docs/plans/caresync-ai/grill-risk-calibration-v2.md` (the shared-understanding artifact this PRD is derived from, including the 7-question grill and the rejected alternatives).
- `docs/plans/caresync-ai/design-risk-calibration.md` (S13's reverted rubric — the audit-trail pattern S16's design doc mirrors).
- `docs/plans/caresync-ai/verification-s13.md §4 + §6` (the pre-pin vs post-revert specificity numbers + the open follow-ups that motivate S16).
- `reports/HL7-Challenge-Evaluation.2026-07-08-post-s15.md §E` (the sub-gap 3 that closes in S16).
- `apps/api/src/agents/riskAgent.ts:11,85-100` (the current MODEL constant + buildPrompt body — commit 3's targets).
- `apps/api/src/agents/{careGap,sdoh,actionPlanner}Agent.ts` (the 3 agents that share the temperature/seed pin in commit 2).
- `apps/api/src/eval/labelFromBundle.ts` (S15's held-out label function — feeds the 2x2 gate's held-out arm).
- `apps/api/src/scripts/eval.ts` (the eval harness — gains the transient `--rubric=v2` flag for the verification window).
- `apps/api/src/fhir-data/seed-patients.ts` + `apps/api/src/fhir-data/population.ts` (the seed-text patterns the v2 rubric's worked examples must mirror).

### Downstream artifacts (S16 commits, in order)
1. `docs(S16): grill + PRD + design-risk-calibration-v2` — three doc files, no code/test changes.
2. `feat(S16): temperature + seed pin (all 4 agents) + varianceProbe.ts` — four `*Agent.ts` files (1-line each), four `*.test.ts` files (TDD pins for both params), one new `eval/varianceProbe.ts`, one new `eval/varianceProbe.test.ts`.
3. `feat(S16): risk rubric v2 — replace buildPrompt with few-shot + 0-anchors rule` — one `riskAgent.ts` (buildPrompt body rewrite), one `riskAgent.test.ts` (3 new TDD pins), one `scripts/eval.ts` (transient `--rubric=v2` flag), regenerated `docs/eval-report.{md,json}`.

### Post-merge follow-up (S17+)
- The Care Gap FN=10 and SDOH agreement regressions noted in `verification-s13.md §6` may persist post-pin. If so, S17 = per-agent rubric investigations (mirroring S16's Risk pattern for each of the other 2 classifier agents).
- MODEL_CARD.md authoring remains deferred until S16's v2 rubric + variance pin stabilizes the Risk numbers; once stable, the model card is a 1-2 day deliverable.
- Clinician engagement is the highest-leverage unblock for P4. S16 makes the v2 rubric *available* for clinician review via the existing `npm run review:render` path; engagement happens on its own clock.

### Engagement playbook (informational, not a verification gate)
- The v2 rubric is the artifact: a clinician running `npm run review:render` against the v2-prompt agents sees the new rubric structure in the agents' decision reasoning (via the narrated token stream).
- The outreach log (`data/eval/clinician-outreach.json`, S15) is the operational mechanism: invitations sent / returned / declined are committed alongside the eval-report diff.
- This is engagement, not S16 code. S16 ships the v2 rubric; engagement is a separate track.