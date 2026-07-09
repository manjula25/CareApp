# Design — Risk Agent Calibration v2 (S16)

> **Status (2026-07-09):** D4's temperature + seed pin is **not viable** — the OpenAI Responses API rejects `seed` on all models and rejects `temperature` on reasoning-tier models. Verified by commit 2 subagent; see [`variance-probe.md`](variance-probe.md). D4 is deferred; commit 2 ships the `varianceProbe.ts` observation tool without the pin. D2's v2 rubric design stands unchanged — it's independent of the pin.

> **PLAN_ID:** `caresync-ai` · **Slice:** S16 · **Date:** 2026-07-09
> **Status:** Forward-looking design — feeds `prd-s16.md` → `implementation-plan-s16.md` → code.
> **Audit-trail ancestors:** `docs/plans/caresync-ai/design-risk-calibration.md` (S13's reverted design — same pattern, this doc mirrors it). The S13 reversion post-mortem (`docs/plans/caresync-ai/verification-s13.md §4 + §6`) is the upstream evidence base for what was tried, why it failed, and where the variance lives.

---

## Problem (today's state, post-S15, pre-S16)

**Verification-s13.md §4 (live re-eval on 2026-07-08):** the post-S13b Risk agent produces:

```
=== Risk (binary: high/critical readmission risk) ===
- Sensitivity: 100.0%
- Specificity: 0.0%
- PPV: 18.8%
- Confusion matrix (n=16): TP=3, TN=0, FP=13, FN=0
```

13 of 16 patients are called `critical` regardless of bundle content — including `james-okafor` (1 Condition: COPD, 0 Encounters, 0 Observations) and `pop-0001` (1 Condition: diabetes, 0 Observations). The model ignores the bundle content and falls back to training-data priors.

**Two contributing causes:**

1. **The prompt itself** (post-S13 revert, the S13 attempt was undone): the current `buildPrompt` is the original one-paragraph clinical-judgment instruction with no calibration anchor (see `apps/api/src/agents/riskAgent.ts:85-100`). It tells the model to "narrate reasoning" and "call the report_risk tool" but doesn't *constrain* how to map bundle content to `riskLevel`.

2. **The LLM API state** (`verification-s13.md §4`): the same pre-S13 code, run on 2026-07-08 from a fresh cache, reproduces `specificity 0%`. The committed pre-S13 30.8% was a snapshot of behavior at one moment (2026-07-07); today's behavior is to call any patient with an active Condition `critical` by default. Whether the change is a model-version bump, a default-temperature change, or a system-prompt change — unknown. The committed baseline is no longer recoverable by tweaking the prompt alone.

S16 closes this by addressing **both** causes: a tighter rubric structure (commit 3) + a cross-agent temperature + seed pin (commit 2).

---

## Decisions (D1–D6)

| # | Decision | Rationale |
|---|---|---|
| **D1** | Trust the seed-derived labels as ground truth. | S13 D1 — still true. `data/eval/labels.json` is unchanged. |
| **D2** | Replace the 1-paragraph prompt with a v2 rubric: 3 calibration anchors + explicit "0 anchors → low" rule + 3 worked examples. | S13's failure mode #1 (negative-instruction vs clinical-judgment) requires an affirmative design. Few-shot examples are the literature-backed fix. |
| **D3** | Anchor set mirrors S13 D3 verbatim. | S13's anchors (multi-condition comorbidity, recent inpatient discharge ≤30d, abnormal labs) are correct as abstractions; the failure was the missing lower-bound rule, not the anchors themselves. |
| **D4** | Add `temperature: 0` + `seed: 42` to all 4 agents' `client.responses.create(...)` calls. | The same variance window affected Risk, Care Gap, and SDOH per `verification-s13.md §6`. Partial pinning is incoherent. |
| **D5** | Ship the v2 rubric as the only prompt — no `buildPromptV1`/`buildPromptV2` split, no `USE_RISK_V2_RUBRIC` env var. | The 2x2 acceptance gate (D7) is the merge gate. If the rubric overshoots, the branch stays open; no revert commit needed. |
| **D6** | Use S15's held-out set (10 procedural patients) as one arm of the 2x2 acceptance gate; use the dev-labeled 16 as the other arm. | Held-out = generalization check; dev-labeled = apples-to-apples with pre-S13 baseline of 30.8% specificity. |

---

## The v2 rubric (commit 3's `buildPrompt` body)

The new `buildPrompt` body in `apps/api/src/agents/riskAgent.ts`:

```
You are a clinical risk-assessment agent. Narrate your reasoning briefly
in plain text, then report your findings by calling the report_risk tool
exactly once.

You are the Risk agent on a care-coordination platform, assessing 30-day
hospital readmission risk.

Below is the patient's complete retrieved FHIR record (one resource per
line, as `ResourceType/id: <resource JSON>`).

<resource lines>

## Calibration anchors (3 of 3)

  Anchor A: Multi-condition comorbidity — ≥2 active Conditions from
            {diabetes E11.9, CHF I50.9, depression F33.1, CKD N18.3}
  Anchor B: Recent inpatient discharge — any Encounter with class/act
            inpatient or acute, ending within the last 30 days
  Anchor C: Abnormal labs — BNP > 200 pg/mL, OR HbA1c > 9.0%, OR
            eGFR < 30 mL/min/1.73m²

## Hard rule — read this before anchoring

A patient with 0 anchors met is ALWAYS riskLevel='low' — even if they
have multiple active Conditions, are on multiple medications, or have
a complex chart. Do not escalate on complexity alone. The single most
common over-call pattern is "any active Condition → high/critical";
that mapping is incorrect. Default to 'low' when no anchors are met;
justify 'moderate', 'high', or 'critical' explicitly by the number of
anchors met and the cited resources.

## Worked examples

These three examples use the actual seed-text bundle shapes from this
codebase's `data/eval/labels.json`. Use them as calibration anchors for
your reasoning — not as the only valid pattern, but as the lower/upper
bounds.

  Example 1 (0 anchors → low):
    Bundle: [Patient/james-okafor, Condition/COPD (J44.9)]
    Result: riskScore ~15, riskLevel 'low', 0 flags
    Reasoning: 1 active Condition, no inpatient discharge, no abnormal
               labs. 0 anchors met → low, per the hard rule above.

  Example 2 (1 anchor → moderate):
    Bundle: [Patient/maria-chen, Condition/CHF (I50.9),
             Observation/BNP-380]
    Result: riskScore ~55, riskLevel 'moderate', 1 flag
             ("Elevated BNP consistent with CHF exacerbation")
    Reasoning: 1 anchor met (abnormal lab: BNP > 200). 1 anchor is
               'moderate', not 'high'.

  Example 3 (2 anchors → high):
    Bundle: [Patient/bob, Condition/diabetes (E11.9),
             Condition/CHF (I50.9), Observation/HbA1c-10.2,
             Encounter/inpatient-discharge 3 days ago]
    Result: riskScore ~85, riskLevel 'high', 3 flags
             ("Comorbid diabetes + CHF",
              "Uncontrolled diabetes (HbA1c 10.2)",
              "Recent inpatient discharge")
    Reasoning: 2 anchors met (multi-condition comorbidity +
               abnormal labs); recent discharge pushes to 'high'.

Every flag you report MUST cite the exact `ResourceType/id` of a
resource listed above via `fhirResourceId`. Never cite a resource id
that is not listed above — fabricated citations are dropped and
undermine clinical trust.

Briefly narrate your clinical reasoning, then call the `report_risk`
tool exactly once with the structured result.
```

The 3 worked examples use **actual seed-text bundle shapes** from the repo (Example 1 ≈ `seed-patients.ts:james-okafor`, Example 2 ≈ `seed-patients.ts:maria-chen`, Example 3 synthesizes `seed-patients.ts` patterns: multi-condition + abnormal lab + recent discharge). TDD tests pin the bundle shapes so the examples and the eval corpus stay in sync.

---

## Why this design should hold specificity (the S13 failure-mode map)

Mapping each S13 failure mode to the v2 fix:

| S13 failure mode (per `design-risk-calibration.md`) | v2 fix |
|---|---|
| **#1: Negative instructions lost to the model's clinical-judgment instinct.** ("Do not call high when fewer than 2 anchors" — the model escalated when in doubt.) | **Few-shot examples (3 of 3).** The model sees the *expected pattern* in three concrete cases rather than having to interpret an abstract negative rule. Literature on instruction-following shows few-shot consistently outperforms negative-instruction for calibration tasks. |
| **#2: Abstract anchors were loose enough that partial matches counted as met.** (1 condition + 1 dated encounter counted as meeting Anchor A.) | **Tighter worked-example anchors + same abstract anchors.** The 3 examples show what "Anchor A met" actually means in practice (the multi-condition example cites *two* specific ICD-10 codes, not just "≥1 condition"). The abstract anchors stay as the principle, but the examples give the model a concrete implementation pattern. (If v2 still drifts here, v3 would replace abstract anchors with explicit LOINC/ICD-10 lookup tables — out of S16 scope.) |
| **#3: No "0 anchors → low" lower bound.** (Model defaulted to `critical` whenever it saw any active Condition.) | **Hard rule + Example 1.** The "0 anchors → low regardless of complexity" rule is a positive, affirmative instruction that *constrains the lower bound*. Example 1 (0 anchors → low with no flags) shows the model that a single-anchor patient with no other evidence produces `riskLevel: 'low'`, not `moderate` or `high`. This is the most direct fix for the S13b live result (specificity → 0% because the model wasn't told what *not* to do). |

Plus the **temperature + seed pin** (D4, commit 2) addresses the API-state variance independently of the prompt design. Even if the v2 prompt is imperfect, the variance window collapses from <30% agreement to ≥80%, which makes the eval-report's specificity number interpretable as a property of the prompt rather than a snapshot of API noise.

---

## File-level change set (planned)

| File | S16 commit | Change |
|---|---|---|
| `docs/plans/caresync-ai/grill-risk-calibration-v2.md` | #1 (docs) | New — this design's upstream shared-understanding artifact |
| `docs/plans/caresync-ai/prd-s16.md` | #1 (docs) | New — this design's PRD |
| `docs/plans/caresync-ai/design-risk-calibration-v2.md` | #1 (docs) | New — this file |
| `apps/api/src/agents/riskAgent.ts` | #2 + #3 | Add `temperature: 0` + `seed: 42` (commit 2); rewrite `buildPrompt` body (commit 3) |
| `apps/api/src/agents/careGapAgent.ts` | #2 | Add `temperature: 0` + `seed: 42` |
| `apps/api/src/agents/sdohAgent.ts` | #2 | Add `temperature: 0` + `seed: 42` |
| `apps/api/src/agents/actionPlannerAgent.ts` | #2 | Add `temperature: 0` + `seed: 42` |
| `apps/api/src/agents/riskAgent.test.ts` | #2 + #3 | Pin temperature + seed (commit 2); add 3 v2 structure tests (commit 3) |
| `apps/api/src/agents/careGapAgent.test.ts` | #2 | Pin temperature + seed |
| `apps/api/src/agents/sdohAgent.test.ts` | #2 | Pin temperature + seed |
| `apps/api/src/agents/actionPlannerAgent.test.ts` | #2 | Pin temperature + seed |
| `apps/api/src/eval/varianceProbe.ts` | #2 | New — runs the real LLM N times, emits per-patient agreement matrix |
| `apps/api/src/eval/varianceProbe.test.ts` | #2 | New — pins agreement math, LLM-required behavior, error path |
| `apps/api/src/scripts/eval.ts` | #3 | Add transient `--rubric=v2` flag for the 2x2 verification window (removed once commit 3 merges as the only prompt) |
| `docs/eval-report.md` | #3 | Regenerated by `npm run eval --rubric=v2 --risk-only` — Risk dev-labeled + held-out numbers updated |
| `docs/eval-report.json` | #3 | Regenerated (matches markdown) |

**Not modified:**
- `apps/api/src/agents/confidenceScorer.ts` — pre-S16 SDOH regex fix already landed on main at `feca132`.
- `apps/api/src/fhir-data/seed-patients.ts` — S13b's samuel-wright enrichment already merged.
- `apps/api/src/eval/labelFromBundle.ts` — S15's held-out label function, unchanged.
- `apps/api/package.json` — no new scripts.

---

## Why this design should not need a reversion (vs S13)

S13's reversion was triggered by **live eval showing specificity regressed to 0% after the rubric landed**. The rubric shipped because the rubric-pins tests passed (TDD-level) but the live LLM behavior didn't match the TDD expectation. The reversion was honest but costly.

S16's design has three structural defenses against the same trap:

1. **2x2 acceptance gate as the merge gate.** Commit 3 does not merge unless all 4 numbers pass. If v2 overshoots like S13, commit 3 stays open — no merge, no production impact, no reversion commit needed. The branch just doesn't ship.

2. **Temperature + seed pin (commit 2) lands first.** Without it, v2's specificity lift is confounded with API variance. With it, the 2x2 numbers are attributable to the rubric design alone.

3. **Variance probe measures substrate stability.** The probe emits a per-patient agreement matrix. If the matrix shows <80% agreement even after the pin, that signals *the variance root cause is not temperature* and a different fix is needed — caught before commit 3 lands, not after.

If a real-world bug surfaces post-merge that the 2x2 didn't catch, the reversion is mechanical: replace `buildPrompt` body with the v1 form (5 lines); remove the 3 v2-structure TDD tests; keep the temperature + seed pin; the 2 regression-guard tests (citation + grounding) stay. Documented in `verification-s16.md` as the contingency paragraph (per `prd-s16.md D7`).

---

## Next step (ADLC)

`prd-s16.md` is committed; the next ADLC step is `writing-plans` — produces `implementation-plan-s16.md` covering the 3-commit structure with phase-level TDD guidance, the 2x2 gate verification commands, and the rollback contingency. Inputs to `writing-plans`:

- This file (`docs/plans/caresync-ai/design-risk-calibration-v2.md`)
- `prd-s16.md` (the PRD)
- `grill-risk-calibration-v2.md` (the grill — captured the rejected alternatives + their reasoning)
- `verification-s13.md §4 + §6` (the empirical evidence + open follow-ups)
- `apps/api/src/agents/riskAgent.ts:11,85-100` (commit 3's targets)
- All 4 agents' `client.responses.create(...)` calls (commit 2's targets)
- `apps/api/src/eval/varianceProbe.ts` (commit 2's new file)
- `apps/api/src/scripts/eval.ts` (commit 3's transient `--rubric=v2` flag)
- `apps/api/src/agents/riskAgent.test.ts` (existing TDD surface — commit 2 pins + commit 3 additions)

The three S16 commits (preview; finalized in `prd-s16.md §"Downstream artifacts"`):

1. `docs(S16): grill + PRD + design-risk-calibration-v2`
2. `feat(S16): temperature + seed pin (all 4 agents) + varianceProbe.ts`
3. `feat(S16): risk rubric v2 — replace buildPrompt with few-shot + 0-anchors rule`