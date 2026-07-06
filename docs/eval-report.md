# S9 Evaluation Report

Generated: 2026-07-06T15:59:33.941Z

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

- **maria-chen**: 9 task(s) created — Complete urgent post-discharge medication reconciliation; Schedule heart-failure post-discharge follow-up by 2026-07-11; Escalate abnormal potassium and kidney function for clinical review; Activate housing navigator referral; Connect patient to food assistance and heart-failure/diabetes-appropriate nutrition support; Address poor diabetes control and kidney-protection monitoring gaps; Coordinate depression symptom monitoring and support; Close routine diabetes screening gaps: retinal and foot exams; Plan age-appropriate preventive screenings
- **james-okafor**: 5 task(s) created — Complete urgent pulmonology follow-up; Coordinate COPD post-discharge management visit; Obtain smoking status and tobacco-use assessment; Arrange COPD monitoring with spirometry or pulmonary function testing; Address colorectal cancer screening gap
- **linda-torres**: 3 task(s) created — Complete repeat BMP for CKD post-discharge monitoring; Arrange CKD urine albumin/protein assessment; Obtain and document blood pressure measurement
- **robert-kim**: 4 task(s) created — Coordinate high-risk post-hip-fracture transition plan; Arrange fall-risk assessment and mitigation; Initiate osteoporosis evaluation and secondary fracture prevention; Order or verify bone-health laboratory assessment
- **angela-diaz**: 6 task(s) created — Complete post-discharge blood pressure recheck; Assess depression symptoms and adherence barriers; Coordinate high-risk readmission follow-up plan; Verify or schedule colorectal cancer screening; Verify or schedule breast cancer screening; Verify or schedule cervical cancer screening
- **samuel-wright**: 5 task(s) created — Arrange urgent heart-failure follow-up / care-management contact; Close overdue daily weight monitoring gap; Reinforce sodium-restricted diet education; Obtain current heart-failure vital signs; Coordinate renal function and electrolyte labs
- **pop-0001**: 6 task(s) created — Complete post-discharge transition-of-care outreach; Arrange prompt diabetes follow-up visit; Order overdue diabetes laboratory monitoring: HbA1c and kidney function; Order urine albumin-creatinine ratio screening; Schedule diabetic retinal eye exam; Complete comprehensive diabetic foot exam
- **pop-0002**: 4 task(s) created — Arrange urgent post-discharge heart-failure follow-up; Obtain renal function and electrolyte labs for heart-failure management; Coordinate LVEF/echocardiography assessment; Initiate colorectal cancer screening outreach
- **pop-0003**: 6 task(s) created — Complete urgent post-discharge behavioral health outreach and follow-up; Administer depression severity monitoring; Review readmission risk and update care plan; Arrange cervical cancer screening; Arrange breast cancer screening; Arrange colorectal cancer screening
- **pop-0004**: 4 task(s) created — Arrange urgent post-discharge follow-up; Assess heart failure status and safety labs; Order overdue HbA1c monitoring; Order diabetic kidney disease screening
- **pop-0005**: 4 task(s) created — Arrange urgent post-discharge follow-up visit; Obtain overdue HbA1c for diabetes monitoring; Complete diabetic kidney-health monitoring; Screen and monitor depressive symptoms
- **pop-0006**: 5 task(s) created — Schedule urgent heart-failure post-discharge follow-up; Obtain post-discharge renal function and electrolyte labs; Set up heart-failure home vital sign and weight monitoring; Perform medication reconciliation and heart-failure self-management teach-back; Screen and reassess depression symptoms
- **pop-0007**: 6 task(s) created — Complete urgent post-discharge outreach and follow-up scheduling; Arrange heart failure renal function and electrolyte monitoring; Arrange diabetes HbA1c and kidney monitoring; Coordinate medication reconciliation with heart failure and diabetes focus; Order diabetes lipid monitoring; Complete depression symptom severity screening
- **pop-0008**: 5 task(s) created — Schedule urgent post-discharge follow-up; Order HbA1c testing for diabetes monitoring; Order diabetic kidney health screening; Schedule diabetic retinal eye exam; Complete diabetic foot exam
- **pop-0009**: 6 task(s) created — Schedule 7-day heart-failure post-discharge follow-up; Obtain urgent heart-failure monitoring data; Perform post-discharge outreach and home self-management check; Address missing breast cancer screening; Address missing colorectal cancer screening; Address missing cervical cancer screening
- **pop-0010**: 4 task(s) created — Complete suicide-risk reassessment and safety check; Schedule overdue post-discharge behavioral-health follow-up; Initiate standardized depression symptom monitoring; Create readmission-prevention follow-up plan

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
