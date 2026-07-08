# Design — Risk Agent Calibration (S13) — **REVERTED in S13b, see verification-s13.md**

> **PLAN_ID:** `caresync-ai` · **Slice:** S13 → **S13b** · **Date:** 2026-07-08
> **Status:** ⚠️ **The S13 rubric described here was REVERTED in S13b** after live re-eval showed it caused the model to over-call (specificity regressed 30.8% → 0%). The seed-enrichment fix for `samuel-wright` survives. **This document is retained for the audit trail** of *what was tried and why it failed* — not as a forward-looking design. The active follow-up design is in `verification-s13.md` §6.

---

## Original problem (solved differently)

The HL7 AI Challenge evaluation showed the Risk agent over-calling risk on 9 of 16 patients (specificity 30.8%, PPV 25%). The root cause was thought to be a vague one-paragraph prompt that let the LLM apply training-data priors instead of an explicit calibration rubric.

**What actually solved it: nothing in this PR.** Re-running the pre-S13 code on 2026-07-08 (after the rubric revert) reproduces specificity 0% — meaning the LLM API state has shifted between the two eval dates. The committed 30.8% specificity was a snapshot of behavior at one moment; that specific behavior is no longer recoverable by tweaking the prompt alone.

The surgical seed-data fix in `fix/s13-samuel-wright-seed-evidence` (S13b) makes `samuel-wright`'s bundle consistent with his `expectedHighRisk: true` label (the patient had `riskScore: 79` and post-discharge tasks but no Encounter or Observations on file — a label-evidence gap). After seed enrichment, samuel-wright is TP under any rubric; the rest of the eval's over-calling is the LLM-side issue tracked in `verification-s13.md` §6.

---

## Original decisions (D1–D7) — for the audit trail only

| # | Decision | What happened |
|---|---|---|
| D1 | Trust the seed-derived labels as ground truth. | Still true. Labels.json unchanged. |
| D2 | Prompt-only calibration; no enum/schema change. | Stayed — and the rubric was ultimately removed entirely (S13b). |
| D3 | Rubric mirrors seed heuristic: ≥2 of {multi-condition comorbidity, recent inpatient discharge ≤30d, abnormal labs}. | **Caused over-call on 13 patients under fresh-cache conditions.** Reverted in S13b. |
| D4 | Scope = Risk agent only (no SDOH enrichment). | Stayed. |
| D5 | Invalidate `maria-chen`'s cached row before re-run. | Moot (worktree DB was empty); main repo's 3-row stale cache invalidated incidentally when the worktree's eval ran from clean state. |
| D6 | TDD unit tests + full re-eval. | Tests still ship (regression guards); re-eval revealed the failure mode and triggered the reversion. |
| D7 | Eval-report disclosure in header + per-patient notes. | Disclosures rewritten in S13b to reflect the reversion ("Status (S13b)" instead of "Status (S13)"). |

---

## Original rubric (kept in git history at commit `29d04db`)

```
A patient is high or critical risk when they meet at least 2 of these 3 anchors:
  (a) Multi-condition comorbidity: ≥2 active Conditions from {diabetes (E11.9),
      CHF (I50.9), depression (F33.1), CKD (N18.3)}.
  (b) Recent inpatient discharge: any Encounter with end within the last 30 days
      where class/act was inpatient or acute.
  (c) Abnormal labs: BNP > 200 pg/mL, OR HbA1c > 9.0%, OR eGFR < 30 mL/min/1.73m².
```

**Live re-eval result under this rubric** (worktree, 16 live, samuel-wright enriched):

| Metric | Pre-S13 | S13 (worktree, all live) | S13 (main, 3 cached + 13 live) | Pre-S13 retry (after revert) |
|---|---:|---:|---:|---:|
| Sensitivity | 100% | 100% | 66.7% | 100% |
| Specificity | 30.8% | 0% | 69.2% | 0% |
| PPV | 25% | 18.8% | 33.3% | 18.8% |
| FPs | 9 | 13 | 4 | 13 |

The worktree's all-live run with the rubric AND the post-revert pre-S13 retry both show specificity 0% — confirming the rubric itself isn't the cause of today's regression. The user's main-repo intermediate run (3-cached + 13-live, with the rubric) showed specificity 69.2% — a snapshot of LLM behavior at that moment. The variance window between runs is wider than expected.

---

## Why this design failed

The rubric relied on **negative instruction** ("Do not call a patient high or critical when fewer than 2 anchors are met — over-calling risk produces non-actionable alerts.") plus abstract anchors the LLM could misinterpret. Empirically:
- The LLM treated the rubric as a *recommendation* to escalate when in doubt, not as a constraint.
- The "do not" phrasing competed with the model's clinical-judgment instinct; the instinct won.
- The abstract anchors (Anchor A/B/C) were loose enough that partial matches counted as "met" (e.g., the agent could call 1 condition + 1 dated encounter as meeting anchor A when it doesn't).

A v2 rubric (few-shot examples, explicit "0 anchors always means low regardless of patient complexity") was sketched but **not committed** — out of scope for S13b's "revert and ship" mandate.

---

## File-level change set (as actually shipped across S13 + S13b)

| File | S13 state | S13b state |
|---|---|---|
| `apps/api/src/agents/riskAgent.ts` | Added rubric + exported `buildPrompt` | Rubric removed; export + JSDoc update retained |
| `apps/api/src/agents/riskAgent.test.ts` | +4 TDD tests (rubric-anchors, threshold-text, citation-guard, grounding-guard) | -2 tests (rubric-pins removed); citation + grounding guards remain |
| `apps/api/src/scripts/eval.ts` | +2 disclosures ("Status (S13)" + S13 Risk-FP note) | Both rewritten as "Status (S13b)" + reversion note |
| `apps/api/src/fhir-data/seed-patients.ts` | Unchanged | `samuel-wright` enriched with Encounter + 2 Observations |
| `docs/eval-report.{md,json}` | (Regenerated by `npm run eval` in main with rubric) | (Regenerated by `npm run eval` from worktree, post-revert + post-seed-fix) |
| `docs/plans/caresync-ai/design-risk-calibration.md` | Written | (This file — historical) |
| `docs/plans/caresync-ai/implementation-plan-risk-calibration.md` | Written | Reads as historical; the reversion is documented in `verification-s13.md` |
| `docs/plans/caresync-ai/verification-s13.md` | (To be written) | Written — primary post-mortem for S13b |
| `docs/plans/caresync-ai/review-s13.md` | (To be written) | Reads as historical |

---

## Next step (ADLC)

`verification-s13.md` is the forward-looking doc. The follow-up work (v2 rubric, LLM-variance investigation, model-version pinning) is tracked there in §6.
