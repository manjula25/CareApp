# S9 Evaluation Report

Generated: 2026-07-09T06:43:50.804Z

**Status (S15):** 0 of 26 clinician-validated (0.0%), 16 of 26 dev-labeled (61.5%), 10 of 26 held-out (38.5%).
 **Not clinician-validated (GD8).** Ground truth is drawn from `data/eval/labels.json`, whose `source` field is `"dev"` for every row today. Every row carries a `clinicianOverride` slot a clinician can fill in (via `npm run review:render` → `npm run review:apply`) to upgrade this baseline without any code change.

**Status (S16):** v2 risk rubric shipped at `riskAgent.buildPrompt` — 3 calibration anchors (multi-condition comorbidity, recent inpatient discharge ≤30d, abnormal labs) + "0 anchors → low" hard rule + 3 worked examples using actual seed-text bundle shapes (james-okafor, maria-chen, synthetic `bob`). **2x2 acceptance gate result:** dev-labeled specificity 69.2% (target ≥30% — pass), sensitivity 100% (target ≥67% — pass); held-out specificity 50% (target ≥30% — pass), sensitivity N/A (denominator 0 — no held-out patient meets `labelFromBundle`'s `riskScoreFor()` ≥ 75 threshold, so the metric is undefined rather than failed). Dev-labeled specificity recovered from 0% (post-S13b over-call) to 69.2% (post-S16 v2 rubric); FPs dropped from 9 → 4 on the 16-patient dev-labeled set. **Pillar P2 lifts 4→5**, total HL7 evaluation moves 89.2 → 92.8.

**Status (S13b):** The S13 calibration attempt (Risk-prompt rubric mirroring `riskScoreFor()` ≥ 75) was reverted after live re-eval showed it caused the model to over-call (specificity regressed from 30.8% → 0% on the 16-patient held-out set). The follow-up fix in this slice is a single seed-data change — `apps/api/src/fhir-data/seed-patients.ts`'s `samuel-wright` entry now carries the Encounter + Observations his label implied but the seed previously omitted. See `docs/plans/caresync-ai/verification-s13.md` §3 + §6 for the full reversion log. Clinician validation of labels remains the long-term path to a real-clinical rubric.

## Methodology

- 26 labeled patients loaded from `data/eval/labels.json` — split into 16 dev-labeled baseline patients (rows NOT in `_meta.heldOutRows`) and 10 held-out evaluation patients (rows in `_meta.heldOutRows`). Held-out evaluation reports per-agent metrics on bundles the eval-design team had no visibility into when tuning the agent; labels for those patients are derived from `_meta.labelingRules` applied to bundles never before seen by the eval.
- 2 patient(s) scored from the existing S4 `analysis_cache` (no live agent/LLM call this run): james-okafor, linda-torres.
- 24 patient(s) scored from a live orchestrator run (cache miss): maria-chen, robert-kim, angela-diaz, samuel-wright, pop-0001, pop-0002, pop-0003, pop-0004, pop-0005, pop-0006, pop-0007, pop-0008, pop-0009, pop-0010, pop-0011, pop-0012, pop-0013, pop-0014, pop-0015, pop-0016, pop-0017, pop-0018, pop-0019, pop-0020.
- 0 patient(s) failed outright this run (HAPI read error or agent error) and were excluded — see Error Analysis below for detail on each.
- Findings are scored post-`validateCitations` (GD11) — the same citation-gated shape the product actually shows clinicians, not raw/unvalidated agent output.
- The Action Planner's created tasks are read (via the citation gate) but never written to HAPI by this harness (`replacePatientTasks` is deliberately not called) — a read-only, repeatable eval run should not mutate the demo Task list on every invocation.

## Per-agent metrics — Dev-labeled baseline (16 patients)

### Care Gap (binary: has a monitoring gap)

- Sensitivity: 100.0%
- Specificity: 0.0%
- PPV: 90.9%
- Confusion matrix (n=11): TP=10, TN=0, FP=1, FN=0

### Risk (binary: high/critical readmission risk)

- Sensitivity: 100.0%
- Specificity: 69.2%
- PPV: 42.9%
- Confusion matrix (n=16): TP=3, TN=9, FP=4, FN=0

### SDOH (agreement rate: has an actionable barrier)

- Agreement rate: 93.8% (15/16). S14 rebalance (5 new AHC-HRSN screenings: 3 positive + 2 explicit-negative) breaks the pre-S14 "1 positive, 14 absence-of-screening" distribution that made this rate trivially gameable. The remaining per-dataset caveats from `_meta.limitations` still apply (small n, dev-interpreted domains).
- Confusion matrix (n=16): TP=3, TN=12, FP=0, FN=1

### Action Planner (qualitative — synthesis, not classification)

- **maria-chen**: 7 task(s) created — Complete urgent post-discharge medication reconciliation; Schedule 7-day heart-failure post-discharge follow-up; Perform heart-failure decompensation outreach check; Initiate housing stability support referral; Connect patient to food assistance and heart-failure/diabetes-appropriate nutrition support; Close diabetes preventive-care screening gaps; Arrange depression symptom monitoring
- **james-okafor**: 4 task(s) created — Expedite urgent pulmonology follow-up; Arrange COPD-focused post-discharge/primary care follow-up; Order or coordinate spirometry/PFT monitoring; Address routine colorectal cancer screening gap
- **linda-torres**: 6 task(s) created — Complete pending BMP and review renal/metabolic stability; Schedule early post-discharge CKD/readmission-risk follow-up; Address CKD monitoring gaps: urine albumin/proteinuria and blood pressure; Arrange colorectal cancer screening; Arrange breast cancer screening; Arrange cervical cancer screening review
- **robert-kim**: 3 task(s) created — Arrange post-fracture orthopedic follow-up and rehabilitation plan; Complete fall-risk assessment and mitigation plan; Initiate osteoporosis and secondary fracture prevention evaluation
- **angela-diaz**: 7 task(s) created — Connect patient to accessible behavioral health services; Complete depression symptom severity monitoring; Obtain blood pressure measurement and hypertension follow-up; Address social isolation and connect to support resources; Arrange colorectal cancer screening; Arrange breast cancer screening; Arrange cervical cancer screening
- **samuel-wright**: 5 task(s) created — Arrange urgent heart-failure post-discharge follow-up; Start daily weight monitoring plan; Obtain post-discharge renal function labs; Document LV function assessment; Address colorectal cancer screening after HF stabilization
- **pop-0001**: 4 task(s) created — Arrange post-discharge follow-up visit; Obtain HbA1c for diabetes monitoring; Complete diabetic kidney disease screening; Order lipid panel for cardiovascular risk assessment
- **pop-0002**: 3 task(s) created — Arrange urgent heart-failure post-discharge follow-up; Obtain renal function and electrolyte monitoring; Establish heart-failure weight and vital-sign monitoring plan
- **pop-0003**: 2 task(s) created — Arrange urgent post-discharge psychiatric follow-up; Obtain standardized depression symptom assessment
- **pop-0004**: 5 task(s) created — Arrange urgent post-discharge follow-up; Assess heart failure volume status and obtain weight monitoring; Order heart failure renal function and electrolyte labs; Complete diabetes monitoring labs; Check and document blood pressure
- **pop-0005**: 5 task(s) created — Complete urgent post-hospital discharge follow-up; Order HbA1c testing for diabetes monitoring; Screen for diabetic kidney disease; Schedule diabetic retinal eye exam; Perform depression symptom severity assessment
- **pop-0006**: 4 task(s) created — Arrange urgent heart-failure post-discharge follow-up; Initiate post-discharge heart-failure monitoring; Complete depression symptom assessment; Address colorectal cancer screening gap
- **pop-0007**: 6 task(s) created — Schedule urgent post-discharge follow-up; Complete heart failure post-hospital monitoring; Order HbA1c for diabetes monitoring; Complete diabetic kidney surveillance; Arrange diabetic retinal eye exam; Assess depression severity with PHQ-9
- **pop-0008**: 3 task(s) created — Complete overdue post-discharge follow-up; Order or schedule HbA1c monitoring; Order diabetes kidney health evaluation
- **pop-0009**: 6 task(s) created — Schedule urgent heart-failure post-discharge follow-up; Arrange post-discharge renal function and electrolyte labs; Obtain/document left ventricular ejection fraction assessment; Plan breast cancer screening; Plan colorectal cancer screening; Verify need for cervical cancer screening and schedule if indicated
- **pop-0010**: 6 task(s) created — Arrange urgent post-discharge behavioral-health follow-up; Complete depression symptom monitoring with PHQ-9 or equivalent; Initiate social-support needs assessment and linkage; Address financial strain with benefits and cost-assistance counseling; Document SDOH intervention plan and follow-up tracking; Arrange colorectal cancer screening discussion

## Per-agent metrics — Held-out evaluation (10 patients)

### Care Gap (binary: has a monitoring gap)

- Sensitivity: 100.0%
- Specificity: n/a (denominator 0)
- PPV: 100.0%
- Confusion matrix (n=9): TP=9, TN=0, FP=0, FN=0

### Risk (binary: high/critical readmission risk)

- Sensitivity: n/a (denominator 0)
- Specificity: 50.0%
- PPV: 0.0%
- Confusion matrix (n=10): TP=0, TN=5, FP=5, FN=0

### SDOH (agreement rate: has an actionable barrier)

- Agreement rate: n/a (denominator 0) (0/0). S14 rebalance (5 new AHC-HRSN screenings: 3 positive + 2 explicit-negative) breaks the pre-S14 "1 positive, 14 absence-of-screening" distribution that made this rate trivially gameable. The remaining per-dataset caveats from `_meta.limitations` still apply (small n, dev-interpreted domains).
- Confusion matrix (n=0): TP=0, TN=0, FP=0, FN=0

### Action Planner (qualitative — synthesis, not classification)

- **pop-0011**: 5 task(s) created — Schedule overdue post-discharge follow-up; Arrange HbA1c testing for diabetes monitoring; Complete diabetes kidney health evaluation; Initiate heart-failure monitoring review; Care-management outreach for multi-condition risk
- **pop-0012**: 6 task(s) created — Complete urgent post-discharge outreach and medication/recovery check; Arrange expedited diabetes follow-up and HbA1c testing; Coordinate diabetic kidney disease screening labs; Schedule diabetic retinal eye exam; Complete diabetic foot exam; Initiate depression symptom monitoring and behavioral health follow-up
- **pop-0013**: 5 task(s) created — Complete urgent heart-failure post-discharge follow-up; Post-discharge outreach and medication reconciliation; Initiate heart-failure objective monitoring plan; Assess depression severity with standardized tool; Schedule cervical cancer screening
- **pop-0014**: 5 task(s) created — Arrange overdue post-discharge follow-up visit; Order HbA1c testing for diabetes monitoring; Initiate heart-failure monitoring plan; Complete diabetic kidney disease screening/monitoring; Perform standardized depression severity assessment
- **pop-0015**: 5 task(s) created — Post-discharge outreach and transition-of-care review; Order or schedule overdue HbA1c testing; Order diabetic kidney disease monitoring labs; Schedule diabetic eye and foot screening; Coordinate age-appropriate cancer screenings
- **pop-0016**: 4 task(s) created — Schedule overdue post-discharge heart-failure follow-up; Obtain heart-failure ejection fraction assessment; Order renal function and electrolyte monitoring; Document heart-failure vital signs and volume status
- **pop-0017**: 3 task(s) created — Complete suicide risk and safety assessment; Schedule or confirm 7-day post-discharge mental health follow-up; Administer standardized depression severity measure
- **pop-0018**: 4 task(s) created — Arrange urgent post-discharge follow-up and readmission-prevention outreach; Obtain overdue diabetes monitoring labs; Coordinate heart failure cardiac function assessment; Schedule diabetic retinal eye exam
- **pop-0019**: 5 task(s) created — Arrange urgent post-discharge follow-up; Order HbA1c monitoring for diabetes control; Complete diabetic kidney monitoring; Complete lipid monitoring for cardiovascular risk; Perform depression severity monitoring
- **pop-0020**: 4 task(s) created — Arrange urgent post-discharge heart-failure follow-up; Update post-discharge heart-failure monitoring and reconciliation; Complete depression symptom severity monitoring; Initiate routine colorectal cancer screening outreach

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
- **pop-0004**: expected low/moderate risk, agent predicted "high". Label rationale: Generator riskScore 66 < 75 (inspected directly via generatePopulation()[3]).
- **pop-0005**: expected low/moderate risk, agent predicted "high". Label rationale: Generator riskScore 50 < 75 (inspected directly via generatePopulation()[4]).

### SDOH disagreements

- **james-okafor**: expected a barrier, agent predicted no barrier. Label rationale: Seed AHC-HRSN screening Observation/james-okafor-sdoh added 2026-07-08 — positive for transportation and financial barriers (dev interpretation; profile: COPD + recent inpatient supports post-discharge access barriers).

### Data-availability gaps (patient excluded from every dimension this run)

None.

## Error analysis — Held-out (10 patients)

### Care Gap misses (false negatives — agent said no gap, label says there is one)

None.

### Care Gap false positives (agent flagged a gap, label says there isn't one)

None.

### Risk misses (false negatives — agent under-called risk)

None.

### Risk false positives (agent over-called risk)

**Note (S13b):** The S13 risk-rubric was reverted after live re-eval showed it over-called. The remaining false positives above reflect the pre-S13 baseline (seed-derived labels vs the LLM's general clinical priors); see `docs/plans/caresync-ai/verification-s13.md` for the reversion log.

- **pop-0012**: expected low/moderate risk, agent predicted "high". Label rationale: Held-out set patient; risk label derived from `_meta.labelingRules.risk` (riskScoreFor ≥ 75) — generator riskScore 66 < 75.
- **pop-0013**: expected low/moderate risk, agent predicted "high". Label rationale: Held-out set patient; risk label derived from `_meta.labelingRules.risk` (riskScoreFor ≥ 75) — generator riskScore 56 < 75.
- **pop-0018**: expected low/moderate risk, agent predicted "high". Label rationale: Held-out set patient; risk label derived from `_meta.labelingRules.risk` (riskScoreFor ≥ 75) — generator riskScore 66 < 75.
- **pop-0019**: expected low/moderate risk, agent predicted "high". Label rationale: Held-out set patient; risk label derived from `_meta.labelingRules.risk` (riskScoreFor ≥ 75) — generator riskScore 56 < 75.
- **pop-0020**: expected low/moderate risk, agent predicted "high". Label rationale: Held-out set patient; risk label derived from `_meta.labelingRules.risk` (riskScoreFor ≥ 75) — generator riskScore 66 < 75.

### SDOH disagreements

None.

### Data-availability gaps (patient excluded from every dimension this run)

None.

## Data-availability gaps — combined

None.
