# S9 Evaluation Report

Generated: 2026-07-07T08:52:19.424Z

**Status: DEV-LABELED BASELINE, NOT CLINICIAN-VALIDATED (GD8).** Ground truth is drawn from `data/eval/labels.json`, whose `source` field is `"dev"` for every row today. Every row carries a `clinicianOverride` slot a clinician can fill in later to upgrade this baseline without any code change. Do not present these numbers as clinician-reviewed.

## Methodology

- 16 labeled patients loaded from `data/eval/labels.json` (6 curated hero/panel patients + 10 deterministic `pop-XXXX` procedural patients — the plan's "~5 curated hero + ~10 Synthea" with the disclosed S5 substitution: no real Synthea/Java in this repo).
- 1 patient(s) scored from the existing S4 `analysis_cache` (no live agent/LLM call this run): maria-chen.
- 15 patient(s) scored from a live orchestrator run (cache miss): james-okafor, linda-torres, robert-kim, angela-diaz, samuel-wright, pop-0001, pop-0002, pop-0003, pop-0004, pop-0005, pop-0006, pop-0007, pop-0008, pop-0009, pop-0010.
- 0 patient(s) failed outright this run (HAPI read error or agent error) and were excluded — see Error Analysis below for detail on each.
- Findings are scored post-`validateCitations` (GD11) — the same citation-gated shape the product actually shows clinicians, not raw/unvalidated agent output.
- The Action Planner's created tasks are read (via the citation gate) but never written to HAPI by this harness (`replacePatientTasks` is deliberately not called) — a read-only, repeatable eval run should not mutate the demo Task list on every invocation.

## Per-agent metrics

### Care Gap (binary: has a monitoring gap)

- Sensitivity: 100.0%
- Specificity: 0.0%
- PPV: 90.9%
- Confusion matrix (n=11): TP=10, TN=0, FP=1, FN=0

### Risk (binary: high/critical readmission risk)

- Sensitivity: 100.0%
- Specificity: 30.8%
- PPV: 25.0%
- Confusion matrix (n=16): TP=3, TN=4, FP=9, FN=0

### SDOH (agreement rate: has an actionable barrier)

- Agreement rate: 100.0% (16/16). Read alongside the SDOH limitation noted in `data/eval/labels.json` `_meta.limitations` — only one positive example (maria-chen) exists in this dataset, so this rate is easy to game with an always-negative predictor.

### Action Planner (qualitative — synthesis, not classification)

- **maria-chen**: 9 task(s) created — Complete urgent post-discharge medication reconciliation; Ensure heart-failure follow-up occurs within 7 days of discharge; Arrange prompt potassium and renal-function reassessment; Initiate housing stability referral; Initiate food assistance and nutrition-support referral; Close diabetes monitoring gaps and address poor glycemic control; Screen and support depression symptoms; Schedule age-appropriate cancer screening review; Arrange osteoporosis screening
- **james-okafor**: 4 task(s) created — Complete urgent pulmonology follow-up coordination; Arrange COPD-focused post-discharge/chronic disease management visit; Order or schedule spirometry/pulmonary function testing; Initiate colorectal cancer screening outreach
- **linda-torres**: 6 task(s) created — Ensure timely BMP completion and review for CKD/readmission risk; Arrange CKD kidney function monitoring follow-up; Order or schedule urine albumin assessment for CKD risk stratification; Schedule colorectal cancer screening discussion/test; Schedule breast cancer screening mammography; Address cervical cancer screening status
- **robert-kim**: 4 task(s) created — Arrange urgent post-fracture follow-up and recovery coordination; Initiate falls risk assessment and prevention plan; Order or coordinate osteoporosis/fragility-fracture evaluation; Assess and start osteoporosis pharmacotherapy if appropriate
- **angela-diaz**: 6 task(s) created — Complete high-risk post-assessment outreach and care plan review; Schedule and complete blood pressure recheck; Perform depression symptom severity monitoring; Initiate colorectal cancer screening; Initiate breast cancer screening; Initiate cervical cancer screening
- **samuel-wright**: 5 task(s) created — Complete urgent daily weight monitoring plan; Arrange rapid heart-failure follow-up visit; Obtain blood pressure and vital-sign assessment; Order or coordinate renal function and electrolyte labs; Provide sodium-restricted diet education
- **pop-0001**: 5 task(s) created — Complete early post-discharge outreach and reconciliation; Arrange HbA1c testing for diabetes monitoring; Arrange diabetic kidney disease surveillance labs; Obtain blood pressure measurement after discharge; Schedule lipid panel for diabetes cardiovascular risk management
- **pop-0002**: 5 task(s) created — Schedule urgent heart-failure post-discharge follow-up; Complete early post-discharge heart-failure outreach; Order/check renal function and electrolyte labs; Arrange ejection fraction/cardiac function assessment; Establish weight and blood pressure monitoring plan
- **pop-0003**: 6 task(s) created — Arrange urgent post-discharge mental-health follow-up; Complete post-discharge transition outreach and safety check; Perform standardized depression symptom monitoring; Address overdue cervical cancer screening; Address overdue breast cancer screening; Address overdue colorectal cancer screening
- **pop-0004**: 6 task(s) created — Arrange rapid post-discharge follow-up and medication/symptom review; Initiate heart-failure weight and volume-status monitoring; Order/reconcile heart-failure renal function and electrolyte labs; Complete overdue diabetes HbA1c monitoring; Complete diabetic kidney health evaluation; Obtain blood pressure measurement for diabetes cardiovascular risk management
- **pop-0005**: 9 task(s) created — Complete high-risk post-discharge follow-up; Arrange urgent diabetes glycemic monitoring; Arrange diabetes kidney health evaluation; Assess depression severity and adherence risk; Schedule diabetic foot exam; Schedule diabetic retinal eye exam; Address colorectal cancer screening gap; Address breast cancer screening gap; Address osteoporosis screening gap
- **pop-0006**: 5 task(s) created — Schedule urgent heart-failure post-discharge follow-up; Complete heart-failure monitoring and safety checks; Perform post-discharge medication reconciliation and adherence review; Screen and monitor depression symptoms; Plan age-appropriate colorectal cancer screening
- **pop-0007**: 9 task(s) created — Complete immediate post-discharge outreach and medication/follow-up reconciliation; Arrange early heart failure follow-up and monitoring; Order diabetes HbA1c testing; Order diabetes kidney monitoring; Assess depression symptoms and behavioral health follow-up needs; Schedule diabetic retinal eye exam; Address colorectal cancer screening gap; Address breast cancer screening gap; Address cervical cancer screening gap
- **pop-0008**: 5 task(s) created — Arrange overdue post-discharge follow-up; Order HbA1c testing for diabetes monitoring; Order diabetic kidney disease screening; Schedule diabetic retinal eye exam; Complete annual diabetic foot exam
- **pop-0009**: 7 task(s) created — Schedule urgent post-discharge heart-failure follow-up; Obtain renal function and electrolyte labs after HF discharge; Arrange LVEF/cardiac function assessment; Establish post-discharge HF weight and vital-sign monitoring; Address colorectal cancer screening gap; Address breast cancer screening gap; Address cervical cancer screening gap
- **pop-0010**: 3 task(s) created — Arrange urgent post-hospital mental health follow-up; Complete depression symptom monitoring assessment; Initiate colorectal cancer screening outreach

## Error analysis (mandatory — GD8, the P6 4→5 lever)

### Care Gap misses (false negatives — agent said no gap, label says there is one)

None.

### Care Gap false positives (agent flagged a gap, label says there isn't one)

- **maria-chen**: agent flagged a gap, label expects none. Label rationale: Diabetes (E11.9) has Observation/maria-chen-hba1c on file; CHF (I50.9) has Observation/maria-chen-bnp on file — both the conditions this dataset's Observation coding actually covers are monitored. Her depression (F33.1) has no corresponding Observation type established anywhere in this codebase, so that dimension is intentionally left out of this boolean rather than guessed at.

### Risk misses (false negatives — agent under-called risk)

None.

### Risk false positives (agent over-called risk)

- **james-okafor**: expected low/moderate risk, agent predicted "high". Label rationale: Seed riskScore 62 < 75.
- **linda-torres**: expected low/moderate risk, agent predicted "high". Label rationale: Seed riskScore 71 < 75 (just under threshold).
- **robert-kim**: expected low/moderate risk, agent predicted "high". Label rationale: Seed riskScore 45 < 75.
- **angela-diaz**: expected low/moderate risk, agent predicted "high". Label rationale: Seed riskScore 58 < 75.
- **pop-0002**: expected low/moderate risk, agent predicted "high". Label rationale: Generator riskScore 38 < 75 (inspected directly via generatePopulation()[1]).
- **pop-0004**: expected low/moderate risk, agent predicted "high". Label rationale: Generator riskScore 66 < 75 (inspected directly via generatePopulation()[3]).
- **pop-0005**: expected low/moderate risk, agent predicted "high". Label rationale: Generator riskScore 50 < 75 (inspected directly via generatePopulation()[4]).
- **pop-0006**: expected low/moderate risk, agent predicted "high". Label rationale: Generator riskScore 46 < 75 (inspected directly via generatePopulation()[5]).
- **pop-0009**: expected low/moderate risk, agent predicted "high". Label rationale: Generator riskScore 48 < 75 (inspected directly via generatePopulation()[8]).

### SDOH disagreements

None.

### Data-availability gaps (patient excluded from every dimension this run)

None.
