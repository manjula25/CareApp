# S9 Evaluation Report

Generated: 2026-07-08T18:01:27.879Z

**Status (S15):** 0 of 26 clinician-validated (0.0%), 16 of 26 dev-labeled (61.5%), 10 of 26 held-out (38.5%).
 **Not clinician-validated (GD8).** Ground truth is drawn from `data/eval/labels.json`, whose `source` field is `"dev"` for every row today. Every row carries a `clinicianOverride` slot a clinician can fill in (via `npm run review:render` → `npm run review:apply`) to upgrade this baseline without any code change.

**Status (S13b):** The S13 calibration attempt (Risk-prompt rubric mirroring `riskScoreFor()` ≥ 75) was reverted after live re-eval showed it caused the model to over-call (specificity regressed from 30.8% → 0% on the 16-patient held-out set). The follow-up fix in this slice is a single seed-data change — `apps/api/src/fhir-data/seed-patients.ts`'s `samuel-wright` entry now carries the Encounter + Observations his label implied but the seed previously omitted. See `docs/plans/caresync-ai/verification-s13.md` §3 + §6 for the full reversion log. Clinician validation of labels remains the long-term path to a real-clinical rubric.

## Methodology

- 26 labeled patients loaded from `data/eval/labels.json` — split into 16 dev-labeled baseline patients (rows NOT in `_meta.heldOutRows`) and 10 held-out evaluation patients (rows in `_meta.heldOutRows`). Held-out evaluation reports per-agent metrics on bundles the eval-design team had no visibility into when tuning the agent; labels for those patients are derived from `_meta.labelingRules` applied to bundles never before seen by the eval.
- 2 patient(s) scored from the existing S4 `analysis_cache` (no live agent/LLM call this run): james-okafor, linda-torres.
- 0 patient(s) scored from a live orchestrator run (cache miss): none.
- 14 patient(s) failed outright this run (HAPI read error or agent error) and were excluded — see Error Analysis below for detail on each.
- `--no-live` flag was set: cache misses were treated as data-availability gaps (no LLM round trip); see "Data-availability gaps" for each excluded patient.
- Findings are scored post-`validateCitations` (GD11) — the same citation-gated shape the product actually shows clinicians, not raw/unvalidated agent output.
- The Action Planner's created tasks are read (via the citation gate) but never written to HAPI by this harness (`replacePatientTasks` is deliberately not called) — a read-only, repeatable eval run should not mutate the demo Task list on every invocation.

## Per-agent metrics — Dev-labeled baseline (16 patients)

### Care Gap (binary: has a monitoring gap)

- Sensitivity: 100.0%
- Specificity: n/a (denominator 0)
- PPV: 100.0%
- Confusion matrix (n=1): TP=1, TN=0, FP=0, FN=0

### Risk (binary: high/critical readmission risk)

- Sensitivity: n/a (denominator 0)
- Specificity: 0.0%
- PPV: 0.0%
- Confusion matrix (n=2): TP=0, TN=0, FP=2, FN=0

### SDOH (agreement rate: has an actionable barrier)

- Agreement rate: 50.0% (1/2). S14 rebalance (5 new AHC-HRSN screenings: 3 positive + 2 explicit-negative) breaks the pre-S14 "1 positive, 14 absence-of-screening" distribution that made this rate trivially gameable. The remaining per-dataset caveats from `_meta.limitations` still apply (small n, dev-interpreted domains).
- Confusion matrix (n=2): TP=0, TN=1, FP=0, FN=1

### Action Planner (qualitative — synthesis, not classification)

- **james-okafor**: 4 task(s) created — Expedite urgent pulmonology follow-up; Arrange COPD-focused post-discharge/primary care follow-up; Order or coordinate spirometry/PFT monitoring; Address routine colorectal cancer screening gap
- **linda-torres**: 6 task(s) created — Complete pending BMP and review renal/metabolic stability; Schedule early post-discharge CKD/readmission-risk follow-up; Address CKD monitoring gaps: urine albumin/proteinuria and blood pressure; Arrange colorectal cancer screening; Arrange breast cancer screening; Arrange cervical cancer screening review

## Per-agent metrics — Held-out evaluation (10 patients)

_(Held-out evaluation not run — --dev-only flag passed.)_

## Outreach

No clinician review invitations recorded yet. (Empty `invitations` array in `data/eval/clinician-outreach.json` — engagement is tracked here but does not gate the eval.)

## Error analysis — Dev-labeled (16 patients)

### Care Gap misses (false negatives — agent said no gap, label says there is one)

None.

### Care Gap false positives (agent flagged a gap, label says there isn't one)

None.

### Risk misses (false negatives — agent under-called risk)

None.

### Risk false positives (agent over-called risk)

**Note (S13b):** The S13 risk-rubric was reverted after live re-eval showed it over-called. The remaining false positives above reflect the pre-S13 baseline (seed-derived labels vs the LLM's general clinical priors); see `docs/plans/caresync-ai/verification-s13.md` for the reversion log.

- **james-okafor**: expected low/moderate risk, agent predicted "high". Label rationale: Seed riskScore 62 < 75.
- **linda-torres**: expected low/moderate risk, agent predicted "high". Label rationale: Seed riskScore 71 < 75 (just under threshold).

### SDOH disagreements

- **james-okafor**: expected a barrier, agent predicted no barrier. Label rationale: Seed AHC-HRSN screening Observation/james-okafor-sdoh added 2026-07-08 — positive for transportation and financial barriers (dev interpretation; profile: COPD + recent inpatient supports post-discharge access barriers).

### Data-availability gaps (patient excluded from every dimension this run)

- **maria-chen**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **robert-kim**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **angela-diaz**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **samuel-wright**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0001**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
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

_(Held-out error analysis not run — `--dev-only` flag passed.)_

## Data-availability gaps — combined

- **maria-chen**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **robert-kim**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **angela-diaz**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **samuel-wright**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0001**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0002**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0003**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0004**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0005**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0006**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0007**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0008**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0009**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
- **pop-0010**: No findings produced for this patient in this eval run (HAPI read failure, or a live-agent-run failure with no cache fallback) — excluded from every metric dimension, not silently dropped. (error: data-availability: no-live-flag)
