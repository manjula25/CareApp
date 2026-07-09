# Variance Probe — S16 Commit 2

> **Status:** SUCCESS — 81.25% per-patient agreement across 16 patients × 3 runs, **without** any temperature/seed pin (the pin was dropped per the API constraint finding below).
> **Date:** 2026-07-09
> **Phase:** C (per `implementation-plan-s16.md`)

---

## Outcome

```
| patient       | run1     | run2     | run3     | agreement |
|---------------|----------|----------|----------|-----------|
| maria-chen    | critical | critical | critical | 3/3       |
| james-okafor  | high     | high     | high     | 3/3       |
| linda-torres  | high     | high     | high     | 3/3       |
| robert-kim    | high     | high     | high     | 3/3       |
| angela-diaz   | high     | high     | high     | 3/3       |
| samuel-wright | high     | critical | high     | 2/3       |
| pop-0001      | high     | moderate | high     | 2/3       |
| pop-0002      | high     | high     | high     | 3/3       |
| pop-0003      | moderate | moderate | moderate | 3/3       |
| pop-0004      | high     | high     | high     | 3/3       |
| pop-0005      | moderate | moderate | moderate | 3/3       |
| pop-0006      | high     | high     | high     | 3/3       |
| pop-0007      | critical | high     | critical | 2/3       |
| pop-0008      | moderate | moderate | moderate | 3/3       |
| pop-0009      | high     | high     | high     | 3/3       |
| pop-0010      | moderate | moderate | moderate | 3/3       |
```

**Summary:** 13/16 patients at 3/3 (81.25%); 3/16 at 2/3 (18.75%); 0 at 1/3 or 0/3.

**Per-patient agreement ≥80%** — substrate is **stable** for commit 3's v2 rubric. The variance-collapse pin was supposed to bring agreement from <30% (per `verification-s13.md §4`) to ≥80%; today's data shows the API defaults already produce 81% agreement without any pin. The variance-collapse strategy is moot.

The 3 patients that flipped once across 3 runs (`samuel-wright`, `pop-0001`, `pop-0007`) are clustered: all 3 sit near a decision boundary where the rubric's "low vs moderate vs high vs critical" thresholds are close. The S16 v2 rubric's "0 anchors → low regardless of complexity" rule (commit 3) is specifically designed to push these patients onto the low side of the boundary — the v2 rubric should reduce the 2/3 cases to 3/3 once it lands.

---

## API constraint (audit trail — why the pin was dropped)

Before today's successful probe run, an earlier attempt in this session tried to pin `temperature: 0` + `seed: 42` on all 4 agents' `client.responses.create(...)` calls (per the original S16 commit-2 plan). The OpenAI Responses API **rejected both params**:

```
gpt-5.5 + seed: 42        → 400 Unknown parameter: 'seed'.
gpt-5.5 + temperature: 0  → 400 Unsupported parameter: 'temperature' is not supported with this model.
gpt-4o + seed: 42         → 400 Unknown parameter: 'seed'.
gpt-4-turbo + seed: 42    → 400 Unknown parameter: 'seed'.
gpt-4o-mini + seed: 42    → 400 Unknown parameter: 'seed'.
```

`seed` is rejected on every model the Responses API exposes (this is an API-level constraint, not a per-model issue); `temperature` is rejected on reasoning-tier models (`gpt-5`, `gpt-5.5`). The OpenAI TypeScript SDK's `ResponseCreateParamsStreaming` type doesn't define `seed` at all (defines `temperature`, but the runtime rejects it on reasoning models).

**Conclusion:** pin-based variance collapse on the Responses API is not viable. The original S16 plan's commit 2 was scaled back to observability-only (this probe) per the user's "Option A + pivot commit 3" decision.

---

## What the probe measured (the real-LLM-not-mock invariant)

`apps/api/src/eval/varianceProbe.ts` runs the dev-labeled 16 patients through `runRiskAgent` 3 times each against the real OpenAI Responses API (`gpt-5.5`, no pin). For each patient, the probe records the 3 `riskLevel` outputs and computes the per-patient agreement (`computeAgreement` named export — TDD-pinned for the math).

The probe runs the real LLM, aborts with a clear error if `OPENAI_API_KEY` is unset (per `never-override-real-with-fake.md`), and is guarded by 5 TDD tests (`apps/api/src/eval/varianceProbe.test.ts` — 3 in the plan + 2 extra for the agreement-math edge cases).

The probe does NOT modify any agent file. It runs against the current production codepath (post-S13 revert: 1-paragraph `buildPrompt`, no pin). The agreement numbers above are the substrate that commit 3's v2 rubric will run against.

---

## What commit 3 inherits from this

- **Substrate is stable** (81% agreement at API defaults). The 2x2 acceptance gate (per `prd-s16.md D9` signal #5) is meaningful: any lift in dev-labeled or held-out specificity comes from the v2 rubric, not from API noise.
- **3 patients near a decision boundary** (`samuel-wright`, `pop-0001`, `pop-0007`) — these are the patients most likely to flip on the v2 rubric's introduction. If they flip onto the wrong side of the boundary in commit 3's eval re-run, the rubric design needs tightening; if they flip onto the right side, the rubric is doing its job.
- **No pin in production** — commit 3's v2 rubric runs against API defaults. The 30.8% pre-S13 specificity baseline (`verification-s13.md §4`) is apples-to-apples with the v2 evaluation (same model, same API defaults, no pin either way).

---

## Audit-trail status

This document is the post-commit-2 evidence per `implementation-plan-s16.md §"Phase D"` and `prd-s16.md D9` signal #2. The agent files are unchanged in commit 2; the probe is the only S16 code addition.