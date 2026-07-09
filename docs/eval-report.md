# S9 Evaluation Report

Generated: 2026-07-09T16:08:53.281Z

**Status (S15):** 0 of 26 clinician-validated (0.0%), 16 of 26 dev-labeled (61.5%), 10 of 26 held-out (38.5%).
 **Not clinician-validated (GD8).** Ground truth is drawn from `data/eval/labels.json`, whose `source` field is `"dev"` for every row today. Every row carries a `clinicianOverride` slot a clinician can fill in (via `npm run review:render` → `npm run review:apply`) to upgrade this baseline without any code change.
**Status (S18 WSA):** Cost capture + post-v3 eval regen shipped. Token-usage capture: all 4 agents yield a `usage` event in the `response.completed` branch (new `apps/api/src/agents/usage.ts` `extractUsage` function). Cost aggregation: new `apps/api/src/agents/pricing.ts` with published gpt-5.5 + gpt-5.5-mini rates per `openai.com/pricing` 2026-07-09 snapshot; `## Cost per analysis (gpt-5.5)` markdown section renders in this report and a `docs/eval-report-cost.json` sidecar is emitted on live runs. Null-handling: missing `response.usage` cells render as `—` or a `no live runs` placeholder, never fabricated `$0.00` (per `never-override-real-with-fake.md`). **Post-v3 eval regen: deferred — OpenAI quota exhausted.** Same incident as the S16 evaluation (`docs/plans/caresync-ai/rubric-eval-result.md §"Quota-exhaustion incident"`). Recovery is one command (`npx tsx src/scripts/eval.ts` post-quota-refresh); planned for the next live eval window. Cache-only `--no-live` runs reproduce the v3 rubric + cost-section placeholder above (no quota cost). **Pillar P7 lifts 3→4** (cost story now present at the architecture level — the cost-capture framework ships with this slice; the live-numbers piece gates on quota refresh).

**Status (S16):** v2 risk rubric shipped at `riskAgent.buildPrompt` — 3 calibration anchors (multi-condition comorbidity, recent inpatient discharge ≤30d, abnormal labs) + "0 anchors → low" hard rule + 3 worked examples using actual seed-text bundle shapes (james-okafor, maria-chen, synthetic `bob`). **2x2 acceptance gate result:** dev-labeled specificity 69.2% (target ≥30% — pass), sensitivity 100% (target ≥67% — pass); held-out specificity 50% (target ≥30% — pass), sensitivity N/A (denominator 0 — no held-out patient meets `labelFromBundle`'s `riskScoreFor()` ≥ 75 threshold, so the metric is undefined rather than failed). Dev-labeled specificity recovered from 0% (post-S13b over-call) to 69.2% (post-S16 v2 rubric); FPs dropped from 9 → 4 on the 16-patient dev-labeled set. **Pillar P2 lifts 4→5**, total HL7 evaluation moves 89.2 → 92.8.

**Status (S13b):** The S13 calibration attempt (Risk-prompt rubric mirroring `riskScoreFor()` ≥ 75) was reverted after live re-eval showed it caused the model to over-call (specificity regressed from 30.8% → 0% on the 16-patient held-out set). The follow-up fix in this slice is a single seed-data change — `apps/api/src/fhir-data/seed-patients.ts`'s `samuel-wright` entry now carries the Encounter + Observations his label implied but the seed previously omitted. See `docs/plans/caresync-ai/verification-s13.md` §3 + §6 for the full reversion log. Clinician validation of labels remains the long-term path to a real-clinical rubric.

## Methodology

- 26 labeled patients loaded from `data/eval/labels.json` — split into 16 dev-labeled baseline patients (rows NOT in `_meta.heldOutRows`) and 10 held-out evaluation patients (rows in `_meta.heldOutRows`). Held-out evaluation reports per-agent metrics on bundles the eval-design team had no visibility into when tuning the agent; labels for those patients are derived from `_meta.labelingRules` applied to bundles never before seen by the eval.
- 4 patient(s) scored from the existing S4 `analysis_cache` (no live agent/LLM call this run): maria-chen, james-okafor, linda-torres, pop-0001.
- 0 patient(s) scored from a live orchestrator run (cache miss): none.
- 22 patient(s) failed outright this run (HAPI read error or agent error) and were excluded — see Error Analysis below for detail on each.
- `--no-live` flag was set: cache misses were treated as data-availability gaps (no LLM round trip); see "Data-availability gaps" for each excluded patient.
- Findings are scored post-`validateCitations` (GD11) — the same citation-gated shape the product actually shows clinicians, not raw/unvalidated agent output.
- The Action Planner's created tasks are read (via the citation gate) but never written to HAPI by this harness (`replacePatientTasks` is deliberately not called) — a read-only, repeatable eval run should not mutate the demo Task list on every invocation.

## Cost per analysis (gpt-5.5)

_No live LLM runs this cycle — cost not measured. Cache-only or `--no-live` runs do not produce `usage` events._


## Per-agent metrics — Dev-labeled baseline (16 patients)

### Care Gap (binary: has a monitoring gap)

- Sensitivity: 100.0%
- Specificity: 0.0%
- PPV: 66.7%
- Confusion matrix (n=3): TP=2, TN=0, FP=1, FN=0

### Risk (binary: high/critical readmission risk)

- Sensitivity: 100.0%
- Specificity: 33.3%
- PPV: 33.3%
- Confusion matrix (n=4): TP=1, TN=1, FP=2, FN=0

### SDOH (agreement rate: has an actionable barrier)

- Agreement rate: 75.0% (3/4). S14 rebalance (5 new AHC-HRSN screenings: 3 positive + 2 explicit-negative) breaks the pre-S14 "1 positive, 14 absence-of-screening" distribution that made this rate trivially gameable. The remaining per-dataset caveats from `_meta.limitations` still apply (small n, dev-interpreted domains).
- Confusion matrix (n=4): TP=1, TN=2, FP=0, FN=1

### Action Planner (qualitative — synthesis, not classification)

- **maria-chen**: 8 task(s) created — Schedule urgent heart-failure post-discharge follow-up; Perform post-discharge heart-failure safety outreach; Connect patient to housing stabilization support; Address food insecurity with benefits and nutrition resources; Complete depression symptom monitoring; Close diabetes monitoring gaps; Plan age-appropriate cancer screenings; Arrange osteoporosis screening
- **james-okafor**: 4 task(s) created — Expedite urgent pulmonology follow-up; Arrange COPD-focused post-discharge/primary care follow-up; Order or coordinate spirometry/PFT monitoring; Address routine colorectal cancer screening gap
- **linda-torres**: 6 task(s) created — Complete pending BMP and review renal/metabolic stability; Schedule early post-discharge CKD/readmission-risk follow-up; Address CKD monitoring gaps: urine albumin/proteinuria and blood pressure; Arrange colorectal cancer screening; Arrange breast cancer screening; Arrange cervical cancer screening review
- **pop-0001**: 7 task(s) created — Complete post-discharge diabetes follow-up and readmission-risk check; Obtain HbA1c for diabetes control assessment; Order diabetic kidney screening and renal function labs; Order lipid panel for cardiovascular risk management in diabetes; Schedule diabetic retinal eye exam; Perform diabetic foot exam at next clinical visit; Arrange osteoporosis screening

## Per-agent metrics — Held-out evaluation (10 patients)

### Care Gap (binary: has a monitoring gap)

- Sensitivity: n/a (denominator 0)
- Specificity: n/a (denominator 0)
- PPV: n/a (denominator 0)
- Confusion matrix (n=0): TP=0, TN=0, FP=0, FN=0

### Risk (binary: high/critical readmission risk)

- Sensitivity: n/a (denominator 0)
- Specificity: n/a (denominator 0)
- PPV: n/a (denominator 0)
- Confusion matrix (n=0): TP=0, TN=0, FP=0, FN=0

### SDOH (agreement rate: has an actionable barrier)

- Agreement rate: n/a (denominator 0) (0/0). S14 rebalance (5 new AHC-HRSN screenings: 3 positive + 2 explicit-negative) breaks the pre-S14 "1 positive, 14 absence-of-screening" distribution that made this rate trivially gameable. The remaining per-dataset caveats from `_meta.limitations` still apply (small n, dev-interpreted domains).
- Confusion matrix (n=0): TP=0, TN=0, FP=0, FN=0

### Action Planner (qualitative — synthesis, not classification)

No patients produced an Action Planner result this run.

> **Note (S15):** SDOH sub-metric: 0 data points. Held-out bundles have no AHC-HRSN Observations (`population.ts:buildSdohForIndex(i)` returns undefined for i ≥ 10). The Care Gap and Risk sub-metrics above still score; only the SDOH dimension is empty for this cohort by design.

## Outreach

No clinician review invitations recorded yet. (Empty `invitations` array in `data/eval/clinician-outreach.json` — engagement is tracked here but does not gate the eval.)

## Error analysis — Dev-labeled (16 patients)

### Care Gap misses (false negatives — agent said no gap, label says there is one)

None.

### Care Gap false positives (agent flagged a gap, label says there isn't one)

- **maria-chen**: agent flagged a gap, label expects none. Label rationale: Diabetes (E11.9) has Observation/maria-chen-hba1c on file; CHF (I50.9) has Observation/maria-chen-bnp on file — both the conditions this dataset's Observation coding actually covers are monitored. Her depression (F33.1) has no corresponding Observation type established anywhere in this codebase, so that dimension is intentionally left out of this boolean rather than guessed at.

### Risk misses (false negatives — agent under-called risk)

None.

### Risk false positives (agent over-called risk)

**Note (S13b):** The S13 risk-rubric was reverted after live re-eval showed it over-called. The remaining false positives above reflect the pre-S13 baseline (seed-derived labels vs the LLM's general clinical priors); see `docs/plans/caresync-ai/verification-s13.md` for the reversion log.

- **james-okafor**: expected low/moderate risk, agent predicted "high". Label rationale: Seed riskScore 62 < 75.
- **linda-torres**: expected low/moderate risk, agent predicted "high". Label rationale: Seed riskScore 71 < 75 (just under threshold).

### SDOH disagreements

- **james-okafor**: expected a barrier, agent predicted no barrier. Label rationale: Seed AHC-HRSN screening Observation/james-okafor-sdoh added 2026-07-08 — positive for transportation and financial barriers (dev interpretation; profile: COPD + recent inpatient supports post-discharge access barriers).

### Data-availability gaps (patient excluded from every dimension this run)

- **robert-kim**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **angela-diaz**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **samuel-wright**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0002**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0003**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0004**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0005**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0006**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0007**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0008**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0009**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0010**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)

## Error analysis — Held-out (10 patients)

### Care Gap misses (false negatives — agent said no gap, label says there is one)

None.

### Care Gap false positives (agent flagged a gap, label says there isn't one)

None.

### Risk misses (false negatives — agent under-called risk)

None.

### Risk false positives (agent over-called risk)

**Note (S13b):** The S13 risk-rubric was reverted after live re-eval showed it over-called. The remaining false positives above reflect the pre-S13 baseline (seed-derived labels vs the LLM's general clinical priors); see `docs/plans/caresync-ai/verification-s13.md` for the reversion log.

None.

### SDOH disagreements

None.

### Data-availability gaps (patient excluded from every dimension this run)

- **pop-0011**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0012**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0013**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0014**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0015**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0016**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0017**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0018**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0019**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0020**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)

## Data-availability gaps — combined

- **robert-kim**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **angela-diaz**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **samuel-wright**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0002**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0003**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0004**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0005**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0006**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0007**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0008**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0009**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0010**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0011**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0012**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0013**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0014**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0015**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0016**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0017**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0018**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0019**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0020**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
