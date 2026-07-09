# Grill — S16: Risk Calibration v2 (rubric redesign + LLM-variance investigation)

> **Status (2026-07-09):** Commit 2's temperature + seed pin is **not viable** — the OpenAI Responses API rejects `seed` on all models and rejects `temperature` on reasoning-tier models (`gpt-5.5`). Verified by S16 commit 2 subagent; full root-cause + cross-model evidence in [`variance-probe.md`](variance-probe.md). Commit 2 is now an **observability tool only** (`varianceProbe.ts` + its TDD); the LLM-variance collapse stream is deferred to a future slice that picks a different lever (model swap, Chat Completions API, or prompt-only as the only remaining tool). Commit 3's v2 rubric is independent of this finding and proceeds unchanged.

> **PLAN_ID:** `caresync-ai` · **Slice:** S16 · **Date:** 2026-07-09
> **Trigger:** S15 closed sub-gaps 1 (held-out set) + 2 (outreach log) and reserved sub-gap 3 (Risk agent 9-FP rate, specificity 30.8%, PPV 25%) for S16 — see `grill-evaluation-gaps.md` §1. S13's reverted rubric and the LLM-side behavior shift documented in `verification-s13.md` §6 are the upstream context. This grill re-derives S16's scope to address the rubric design *and* the variance root cause as one slice.
> **Status of this doc:** shared-understanding artifact — the next ADLC step is `to-prd`, which reads this file and `verification-s13.md` §6 to draft `prd-s16.md`.

---

## 0. The decomposition (verbatim from upstream)

**`grill-evaluation-gaps.md` §0:** *"Risk agent over-calls risk (9 FPs). S13's rubric attempt reverted after it made things worse; needs its own isolated investigation."*

**`verification-s13.md` §4:** *"Re-running the pre-S13 code on 2026-07-08 (from a fresh cache, all 16 patients live) reproduces `specificity 0%` — i.e., the LLM API is returning different baseline behavior today than it did yesterday. The committed 30.8% was a snapshot of behavior at that moment, not a stable property."*

**`verification-s13.md` §6 (open follow-ups):**
1. LLM-side variance investigation — determine whether the API state change between 2026-07-07 and 2026-07-08 is a model-version bump, a default-temperature change, or a system-prompt change.
2. A v2 rubric tighter than v1 — few-shot examples instead of abstract anchors; explicit "0 anchors → low" instruction.
3. Clinician validation of labels — long-term path to a real-clinical rubric (already enabled by S15's outreach log).
4. Re-run `npm run eval` 24h after LLM variance is resolved to confirm pre-S13 numbers (specificity ≥30%) are stable.

S16 closes (1) and (2). Items (3) and (4) are separate tracks; (3) is engagement-driven (Option C in the S15 handoff); (4) is an evaluation side-effect of (1) and (2) closing.

The expected HL7 pillar lift: **P2 4 → 5**, total 89.2 → **~91.0** (P4 stays at 4 — held back by no model card + 0/16 clinician-validated, both out of S16 scope).

---

## 1. Slice structure & commit decomposition (Q1)

**Decision: bundled as one S16 PR with 3 atomic commits.**

| Stream | Goal | Touches |
|---|---|---|
| **A. LLM-variance investigation** | Pin down what changed on the API side | `riskAgent.ts:11` (`MODEL` — unchanged name, but with new call params), `careGapAgent.ts`, `sdohAgent.ts`, `actionPlannerAgent.ts` (all 4 agents get the same `temperature: 0` + `seed: 42` pin), plus a new `apps/api/src/eval/varianceProbe.ts` |
| **B. Risk rubric v2** | Replace the reverted 1-paragraph prompt with a rubric that holds specificity | `riskAgent.ts:85-100` (`buildPrompt`) — new structure; `riskAgent.test.ts` — TDD pins for the new prompt surface |

| # | Commit | Atomic content | Why this order |
|---|---|---|---|
| 1 | `docs(S16): grill + PRD + design-risk-calibration-v2` | Pure planning — no code/test changes | Establishes the audit trail before any code lands |
| 2 | `feat(S16): temperature + seed pin (all 4 agents) + varianceProbe.ts` | Cross-cutting variance knob + characterization tool | Establishes what "stable behavior" looks like *before* the prompt changes in commit 3, so we can attribute any specificity lift to the rubric, not to a quieter API day |
| 3 | `feat(S16): risk rubric v2 — replace buildPrompt with few-shot + 0-anchors rule` | `buildPrompt` rewrite + TDD tests for the new structure | The actual rubric change; lands last because it depends on commit 2's stable substrate |

**Rejected alternative:** merge A + B into a single commit. Rejected because the audit trail would mix a cross-cutting variance investigation with a prompt-redesign experiment — exactly the audit-trail blur S13 left us with. Three commits keep each one independently revertable.

**Rejected alternative:** split into S16a (LLM-variance) + S16b (v2 rubric). Rejected because (a) the variance investigation's outcome *drives* whether the v2 rubric is needed at all (if temperature collapses variance, maybe the v1 prompt was fine); and (b) the S15 grill §1 already split S15 vs S16 along the same axis (product-side vs LLM-side). Bundling within S16 keeps the next split honest.

---

## 2. LLM-variance investigation approach (Q2)

**Decision: A → B → C in sequence — characterize, hypothesize, pin.**

### A. Variance characterization first
Add `apps/api/src/eval/varianceProbe.ts` — runs the eval N=3-5 times against the dev-labeled 16, measures per-patient `riskLevel` agreement (how many patients got the *same* `riskLevel` every run), emits a markdown table:

```
| patient       | run1 | run2 | run3 | agreement |
|---------------|------|------|------|-----------|
| maria-chen    | crit | crit | crit | 3/3       |
| james-okafor  | crit | low  | crit | 1/3       |
| ...           |      |      |      |           |
```

The probe runs the **real LLM** (not cached mock outputs — see project memory `never-override-real-with-fake.md`). It runs against the *current* prompt (post-S13 revert) so the pre-pin variance window is captured.

### B. Hypothesis testing
The cheapest hypothesis to test is `temperature: 0`. Add the pin to all 4 agents (Q4), re-run the probe, measure whether the variance window collapses. If it does, we've found the cause. If it doesn't, hypothesis becomes model-snapshot drift (Q4's deferred option C).

### C. Pin as the final state
The temperature + seed pin lands permanently in commit 2 — it's part of the S16 deliverable, not a temporary debugging aid. The `MODEL = 'gpt-5.5'` string stays unchanged (no snapshot-ID hunt; that's uncertain and not portable).

**Rejected alternative:** skip characterization, go straight to hypothesis testing (B directly). Rejected because we don't yet know whether the variance is patient-specific (some patients flip, others don't — LLM interpretation drift) or global (every patient flips every run — temperature/seed). The probe tells us which hypothesis to test.

**Rejected alternative:** skip A and B, ship temperature=0 directly as the fix. Rejected for the same reason — without the pre-pin baseline, we can't tell whether the pin "fixed" anything or just collapsed variance to a different floor.

---

## 3. Risk rubric v2 design (Q3)

**Decision: A + C combined — abstract anchors + explicit "0 anchors → low" rule + 3 worked examples.**

S13's reverted rubric had two failure modes (per `design-risk-calibration.md` §"Why this design failed"):

1. **Negative instructions** ("Do not call high when fewer than 2 anchors") lost to the model's clinical-judgment instinct — it escalated when in doubt.
2. **Abstract anchors** were loose enough that partial matches counted as met.
3. **No "0 anchors → low" rule** — the model defaulted to `critical` whenever it saw any active condition, even with no other evidence.

The v2 rubric addresses all three:

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

- **Few-shot examples (A)** address failure mode #1 — the model sees the *expected pattern* rather than having to interpret an abstract rule. Strongest literature signal for prompt calibration.
- **"0 anchors → low" rule (C)** addresses failure mode #3 directly — eliminates the "any-condition → critical" over-call by codifying the lower bound.
- Failure mode #2 (loose abstract anchors) is addressed by keeping the S13 anchor set as-is (the abstractions were fine; the failure was the missing lower-bound rule).

The worked examples use *actual seed-text patterns* from `seed-patients.ts:robert-kim-sdoh` and `population.ts:pop-0005-sdoh` so the prompt and the eval corpus speak the same language.

**TDD tests** pin: (a) the 3 anchors are listed verbatim, (b) the "0 anchors → low" rule appears in the prompt, (c) the 3 worked examples are present with their expected bundle shapes. The existing 2 tests (citation requirement + bundle grounding) stay.

**Rejected alternative:** pure A (few-shot only, no anchors). Rejected because the examples alone don't generalize — the abstract anchors give the model a *principle* to apply to bundles the examples don't cover.

**Rejected alternative:** pure C (explicit 0-anchors rule + abstract anchors, no examples). Rejected because it doesn't address failure mode #1 (the negative-instruction vs clinical-judgment issue). Few-shot examples are the literature-backed fix for that mode.

**Rejected alternative:** B (tighter anchor thresholds, ≥3 of 3). Rejected because it doesn't address any of S13's three failure modes — same overshoot pattern, just rarer. Risk of under-calling real high-risk patients who genuinely meet only 2 anchors.

---

## 4. Model-version pinning (Q4)

**Decision: temperature + seed pin across all 4 agents in commit 2; defer model-snapshot ID hunt.**

| Knob | Decision | Why |
|---|---|---|
| `temperature: 0` | **PIN** in all 4 agents | Universal API support, ~5 lines per agent, likely collapses most of the variance window |
| `seed: 42` | **PIN** in all 4 agents | Deterministic when paired with `temperature: 0`; reproducible evals |
| `model: 'gpt-5.5-2025-XX-XX'` (snapshot ID) | **DEFER** | OpenAI doesn't publish a stable snapshot ID list; you discover them by trial and they can disappear. Verification-s13 §6 calls the snapshot hypothesis uncertain. Skip until temperature+seed proves insufficient. |

Implementation: same two-line change in each agent file (`riskAgent.ts`, `careGapAgent.ts`, `sdohAgent.ts`, `actionPlannerAgent.ts`). TDD tests pin both params (`params.temperature === 0`, `params.seed === 42`) — same shape as the existing `params.model === 'gpt-5.5'` tests.

The pin stays on the **real** `client.responses.create(...)` call. The `MOCK_*_OUTPUT` fallback (used only when `OPENAI_API_KEY` is unset) is untouched. Per project memory `never-override-real-with-fake.md`: real LLM is the production path; mock data is fallback only.

Scope decision: the pin applies to **all 4 agents**, not just Risk. `verification-s13.md` §6 shows the same variance pattern affected Care Gap (FN=10 today, was 100% sensitivity on 2026-07-07) and SDOH (agreement 93.75% today, was 100%). Limiting the pin to Risk would be incoherent — partial pinning.

Eval-report disclosure: *"Variance investigation (S16 commit 2): temperature pinned to 0, seed pinned to 42 across all 4 agents. Pre-pin specificity range 0%–69.2% across runs (verification-s13 §4); post-pin range TBD by probe."*

**Rejected alternative:** pin only Risk. Rejected because the variance affected all three classifier agents; partial pinning leaves the eval-report's specificity number for Care Gap and SDOH at the mercy of API defaults.

**Rejected alternative:** don't pin, document the variance window in MODEL_CARD.md. Rejected because (a) MODEL_CARD.md is Option B in the S15 handoff, not S16 scope; and (b) documenting variance is not the same as collapsing it. The pin is cheap; we should do it.

---

## 5. Held-out vs dev-labeled eval methodology (Q5)

**Decision: C — run the v2 rubric against both cohorts; use a 2x2 acceptance matrix as the merge gate.**

| | Dev-labeled 16 | Held-out 10 |
|---|---|---|
| **Specificity** | ≥30% (recover pre-S13 baseline) | ≥30% (generalization floor) |
| **Sensitivity** | ≥67% (S13b's 3/3 + ≥1 held-out) | ≥50% |

- **Dev-labeled 16** = apples-to-apples comparison to pre-S13's 30.8% specificity. If v2 rubric recovers ≥30% on the same patients, it's done its job on the cohort it was tuned to.
- **Held-out 10** = S15's `pop-0011..pop-0020`. Independent of the rubric design — measures generalization. If dev-labeled is good but held-out specificity collapses, the rubric is over-fitting to the dev cohort.

Implementation:
- New `scripts/eval.ts` flag `--rubric=v2` (default = current behavior, i.e. v1) selects the prompt variant. (This flag is on the **eval script**, not on the agent — agents in production always run v2 after commit 3 merges; the flag exists so the 2x2 gate can compare v1 vs v2 without code branching at the agent level.)
- Wait — see §6. This contradicts the no-flag decision. Recasting: the `--rubric` flag is an **eval-script testing tool** for the 2x2 gate, not a runtime feature flag. It exists in `scripts/eval.ts` only and is removed once the 2x2 passes and commit 3 is merged as the only prompt.

Quota hedge: a `--risk-only` eval flag (already pattern in eval.ts) runs only the Risk agent — cheaper than the full eval (3 specialists × N patients), faster to iterate. Full eval re-run happens once at the end as the verification signal.

**Rejected alternative:** A (dev-labeled only). Rejected because we can't measure generalization. The held-out set exists; using it is the whole point of S15's sub-gap 1 closure.

**Rejected alternative:** B (held-out only). Rejected because we lose the apples-to-apples comparison to pre-S13's 30.8% number. The dev-labeled cohort is the calibration anchor; the held-out is the generalization check.

---

## 6. Rollback safety (Q6)

**Decision: ship v2 as the only prompt in commit 3, with a reversion paragraph in `verification-s16.md`. No feature flag, no dual-prompt export.**

Three reasons:

1. **The 2x2 acceptance gate is the actual safety net.** Q5 commits to not merging commit 3 unless all 4 acceptance numbers pass. If v2 overshoots like S13, we don't merge commit 3 — period. The "ship broken, revert later" pattern can't happen because we won't ship until the gate passes.

2. **Feature flags in a POC are dead weight.** There's no gradual rollout in a POC — we ship to the same env every time. Flags added "for safety" become permanent (`USE_RISK_V2_RUBRIC=true` in some `.env`, never cleaned up). The 4 agents don't have any other flags; introducing one for this slice breaks the codebase's no-flag convention.

3. **Option A makes the audit trail worse, not better.** "We shipped a flag-gated v2, ran both sides, then flipped the flag" reads as cautious-but-indecisive. "We shipped v2, eval showed 2x2 acceptance, here's the lift" reads as decisive-with-evidence. The S13 pattern produced *better* documentation than a feature-flagged A/B would have.

The reversion plan lives in `verification-s16.md` as one paragraph:

> *If a real-world bug surfaces post-merge that the 2x2 didn't catch (e.g., a 17th-patient class that the held-out set missed), revert the prompt change in `buildPrompt` back to the v1 one-paragraph form. The temperature + seed pin from commit 2 survives the revert. The eval-report disclosure notes the reversion and links to this paragraph as the contingency plan.*

The revert is a mechanical change: replace `buildPrompt` body with the 5-line v1 form. The 2 regression-guard tests (citation requirement + bundle grounding) stay. The TDD pins for the v2 structure (3 anchors, "0 anchors → low" rule, 3 worked examples) get removed because they describe state that no longer exists — same pattern as the S13b reversion documented in `verification-s13.md` §1.

**Rejected alternative:** A (feature flag with `buildPromptV1` and `buildPromptV2` exports). Rejected for the three reasons above. The user's review of A was "very confusing" — the asymmetry between under-call (recoverable, iterate in follow-up commit) and over-call (revert in follow-up commit) is the same in both options, but option A pays complexity cost up-front to avoid a cost that's identical in the rare case it materializes.

**Clarification on §5's `--rubric` flag:** the eval-script flag is a **testing tool for the 2x2 gate**, not a runtime feature flag. It exists in `scripts/eval.ts` only, used to compare v1 vs v2 during the verification window, and removed once commit 3 merges as the only prompt. Agents in production always run v2.

---

## 7. Verification matrix (Q7)

The S16 acceptance signal is the 5-row matrix below. All five signals must appear in `verification-s16.md` with concrete evidence (commands run, exit codes, output captured).

| # | Signal | Verification command / artifact | Pass condition |
|---|---|---|---|
| 1 | **Temperature + seed pin across all 4 agents** | `grep -n "temperature\|seed" apps/api/src/agents/*Agent.ts` | All 4 agent files pass `temperature: 0` + `seed: 42` to `client.responses.create(...)`. TDD tests pin both params (`params.temperature === 0`, `params.seed === 42`). |
| 2 | **Variance probe exists and runs against the real LLM** | `apps/api/src/eval/varianceProbe.ts` — `npx tsx src/eval/varianceProbe.ts` | Script exits 0; emits per-patient `riskLevel` agreement matrix from 3-5 runs against the dev-labeled 16. Probe runs the real LLM, not cached mock outputs. |
| 3 | **Variance window collapses** | Pre-pin probe (commit 2's first run) vs post-pin probe (commit 2's second run) | Post-pin per-patient `riskLevel` agreement ≥80% across 3 runs (was <30% per `verification-s13.md` §4). |
| 4 | **v2 rubric structure** | `riskAgent.test.ts` TDD pins for the new `buildPrompt` | 3 anchor definitions present + "0 anchors → low" rule present + 3 worked examples present (with actual seed-text bundle shapes). Existing 2 regression-guard tests stay. |
| 5 | **2x2 acceptance gate** | `npm run eval --rubric=v2 --risk-only` against dev-labeled 16 + held-out 10 | Dev-labeled specificity ≥30% AND sensitivity ≥67%; held-out specificity ≥30% AND sensitivity ≥50%. |

`verification-s16.md` (same convention as S13b / S14 / S15) is the artifact that holds all five rows with evidence. The `docs/eval-report.md` regenerated by commit 3's eval re-run shows the post-rubric dev-labeled + held-out numbers side-by-side with the pre-S13 baseline (S15 already shipped the three-section layout; commit 3 just updates the Risk numbers in the existing scaffold).

The 2x2 gate (signal #5) is the **merge gate**. Commit 3 does not land unless signal #5 passes. Signals #1–#4 must also pass before commit 3 — they're the substrate that makes signal #5 interpretable.

---

## 8. Out of scope (explicit)

- **Model-snapshot ID pinning** (e.g., `gpt-5.5-2025-XX-XX`) — uncertain whether OpenAI exposes one; defer until temperature+seed pin proves insufficient (probe signal #3 will tell us).
- **Cross-agent rubric design** — only Risk gets the v2 rubric. Care Gap / SDOH / Action Planner prompts stay as-is. Their variance collapses via the temperature+seed pin alone (signal #3 is universal, not Risk-specific).
- **Clinician validation of the rubric** — S15's outreach log makes this possible, but no clinician will see the v2 rubric in this slice. Deferred to engagement track (Option C in the S15 handoff).
- **Real-time drift detection** — variance probe is an on-demand tool, not a daemon. No "alert when riskLevel flips for the same patient on consecutive calls."
- **Care Gap FN=10 / SDOH agreement regression** — separate from Risk overshoot; same temperature+seed pin should help, but verifying it isn't a S16 gate. If it persists post-pin, that's S17's problem.
- **MODEL_CARD.md authoring** — Option B in the S15 handoff; not part of S16.
- **A clinician-engagement SLA or timeline** — S15's outreach log captures activity; S16 doesn't add one.
- **A `--rubric` flag in `riskAgent.ts` itself** — see §6 clarification. The flag lives in `scripts/eval.ts` for the 2x2 gate, not in the agent runtime.
- **Pre-merge rollout to non-dev environments** — POC deploys to one env; commit 3 ships to that env when it merges.

---

## 9. Score-card delta (S16's lift)

| Pillar | Pre-S16 | Post-S16 (predicted) | Why |
|---|---|---|---|
| P1 | 5 | 5 | Unchanged — full eval harness from S9 |
| P2 | 4 | **5** | Held-out section (S15) + specificity recovered (S16) + 0-anchors rule documented |
| P3 | 5 | 5 | Unchanged — multi-agent orchestration |
| P4 | 4 | 4 | Held back by no model card + 0/16 clinician-validated (S15 path) — out of S16 scope |
| P5 | 5 | 5 | Unchanged — CDS Hooks / SMART |
| P6 | 5 | 5 | Held-out section already renders from S15 |
| P7 | 4 | 4 | Unchanged — cost quantified in S15 era |
| P8 | 4 | 4 | Unchanged — equity analysis out of S16 scope |
| P9 | 3 | 3 | Unchanged — multilingual out of S16 scope |
| **Total** | **89.2** | **~91.0** | P2 4→5 (+1.8 from held-out specificity gain + variance collapse) |

P4 staying at 4 is the deliberate cap — the lift conditions (model card + clinician validation) are explicitly out of S16 scope. S16 closes the LLM-side gap; the clinician-side gap is engagement-track (Option C in the S15 handoff).

---

## Next step (ADLC)

`to-prd` — produces `prd-s16.md` covering sub-gap 3 (Risk v2 rubric + LLM-variance investigation) with the 3-commit structure from §1. Inputs to `to-prd`:

- This file (`docs/plans/caresync-ai/grill-risk-calibration-v2.md`)
- `verification-s13.md` §6 (open follow-ups — items 1 + 2 close in S16)
- `verification-s13.md` §4 (the pre-pin vs post-revert specificity numbers — the pre-pin baseline S16 will compare against)
- `design-risk-calibration.md` (S13's reverted design — the audit-trail pattern S16 mirrors)
- `riskAgent.ts:11`, `riskAgent.ts:85-100`, all 4 agents' `client.responses.create(...)` calls
- `apps/api/src/agents/riskAgent.test.ts` (existing TDD surface — regression guards + the 2 S13 tests being replaced)
- `apps/api/src/eval/labelFromBundle.ts` (S15's held-out label function — feeds the held-out arm of the 2x2 gate)
- `apps/api/src/scripts/eval.ts` (the eval harness — gains the `--rubric=v2` flag for the 2x2 gate; S15 already shipped `--dev-only`, `--held-out-only`, `--no-live`)

The pre-S16 SDOH regex bug fix (`fix(sdoh): broaden "no ... barriers" regex to match "no social barriers identified"`, commit `feca132` on main) is already in place — S16's commit 2 starts from that baseline.

The S16 commits (preview; finalized in `prd-s16.md`):

1. `docs(S16): grill + PRD + design-risk-calibration-v2`
2. `feat(S16): temperature + seed pin (all 4 agents) + varianceProbe.ts`
3. `feat(S16): risk rubric v2 — replace buildPrompt with few-shot + 0-anchors rule`