# CareSync AI — HL7 AI Challenge 2026 Evaluation (Re-run)

**Submission:** CareSync AI — Multi-Agent FHIR Care Orchestrator for High-Risk Patients
**Judge:** Cascade (AI)
**Date:** 2026-07-07 (re-run after eval harness execution + clinician review tool)
**Rubric:** HL7-Challenge-Brief.md

---

## A. Tier 0 — Gates

| Gate | Result | Justification |
|------|--------|---------------|
| **G1** HL7 substance | **PASS** | Seven HL7 standards are load-bearing: FHIR R4 (all patient data I/O via HAPI v7.2.0), SMART on FHIR Backend Services (RS256 JWT assertion, client_credentials token exchange, Bearer on every HAPI call), CDS Hooks (discovery + patient-view service), FHIR Task (AI-generated work items with priority/owner/citations), FHIR Subscription (rest-hook with `application/fhir+json` payload), FHIR SDC/AHC-HRSN (SDOH screening Observations), and terminology bindings (LOINC 4548-4, ICD-10-CM E11.9, SNOMED CT, RxNorm, OMB race/ethnicity). Removing any standard breaks a load-bearing path. |
| **G2** AI centrality | **PASS** | Four specialist LLM agents (Risk, Care Gap, SDOH, Action Planner) running on OpenAI `gpt-5.5` via the Responses API with streaming and structured function-tool output. The orchestrator (`orchestrator.ts:41-91`) runs three agents concurrently via `Promise.race` over async iterators, then the Action Planner synthesizes their structured outputs. No rule-based system could replicate the cross-domain synthesis over a full FHIR bundle. Removing the LLM removes the entire reasoning capability. |
| **G3** Safety/privacy/guardrails | **PASS** | Citation enforcement (`citationValidator.ts:29-73`) validates every agent finding's `fhirResourceId` against the retrieved bundle's `validIds` set — hallucinated IDs are dropped before reaching the UI. Streamed narration is redacted in real time (`redactUnvalidatedCitations`). Role-based scopes (`scopes.ts`: Director/Coordinator/Social Worker × demographic/clinical/sdoh) are enforced on every FHIR read (`FhirReadService.guard:364-369`). Audit trail (`audit.ts:12-16`) records every access. Human-in-the-loop: all AI outputs become FHIR Tasks with `status: 'requested'` requiring coordinator action. SMART token scoping (`SmartTokenClient`, `system/*.read`). Demographic parity metrics computed from real HAPI demographics (`governance/service.ts:260-291`). |
| **G4** Honest staging | **PASS** | Disciplined culture of documented deviations: `Governance.tsx:12-60` drops fabricated mockup chips and replaces numbers with honest "—" placeholders. `Quality.tsx:13-40` explicitly drops $624K/$4.78M fabricated figures. `Population.tsx:20-48` drops fabricated trends and inert buttons. `governance/service.ts:81-99` documents that confidence buckets show zero (not fabricated) because agents don't yet emit confidence. The eval harness's label file (`data/eval/labels.json`) includes a `_meta.limitations` array documenting that Care Gap specificity rests on a single negative example and SDOH agreement is easy to game with an always-negative predictor — honest disclosure of statistical fragility, not overclaiming. `plan.md` §3 contains a standards conformance matrix with Built/Partial/Envisioned status per standard. |
| **G5** Ethical/regulatory (flag) | **PASS** (no flag) | No FDA SaMD claim anywhere. System is framed as a care-coordination support tool. All AI-generated Tasks start as `requested` — no autonomous clinical decision-making. CDS Hooks service is cache-only (returns `cards: []` on miss). Eval report header explicitly states "DEV-LABELED BASELINE, NOT CLINICIAN-VALIDATED (GD8)." |

**No hard gates failed. Submission is competitive.**

---

## B. Built vs. Prototyped vs. Envisioned

**Built:** Full FHIR R4 read/write layer against HAPI v7.2.0; SMART Backend Services (assertion minting, token exchange, caching, Bearer attachment); CDS Hooks discovery + patient-view service with card mapping; four LLM agents (Risk, Care Gap, SDOH, Action Planner) with structured output and streaming; citation enforcement (validation + redaction); FHIR Task lifecycle (create, assign, transition, list, detail); FHIR Subscription (rest-hook creation, webhook receiver, SSE relay to web); role-based auth (3 roles, 3 domains) with audit trail; mobile coordinator app (TaskQueue, TaskDetail with complete/defer/escalate); patient detail with live agent graph and SSE streaming; population dashboard (500-patient cohort, risk×urgency scatter, critical-zone count); governance dashboard (audit trail, confidence distribution, demographic parity); quality/HEDIS measure (diabetes HbA1c testing rate); SDOH resource directory + audited FHIR ServiceRequest referrals; team performance view; 12 E2E Playwright test specs; **evaluation harness** (`npm run eval`) with pure `computeMetrics` (sensitivity/specificity/PPV) + `computeErrorAnalysis` modules, 16-patient dev-labeled ground-truth file, cache-first/live-fallback harness, JSON + Markdown report generation, and unit tests for both pure modules — **run against live HAPI + LLM** producing committed `docs/eval-report.json` with actual metrics (Care Gap sensitivity 100%/specificity 0%/PPV 90.9%, Risk sensitivity 100%/specificity 30.8%/PPV 25%, SDOH agreement 100%) and per-patient error analysis (10 disagreements: 1 Care Gap FP, 9 Risk FPs); **clinician review tool** (`npm run review:render`) generating a self-contained HTML form for clinicians to endorse/override/abstain on every label × dimension, with localStorage draft persistence and JSON export of reviewed labels.

**Prototyped:** SMART token is minted and attached but HAPI does not enforce it (stock Docker image ships no interceptor config — documented honestly in `plan.md` §3 and `index.ts:45-51`). Confidence distribution endpoint exists and reads an optional `confidence` field, but today's agents don't emit per-finding confidence — buckets show zero honestly. Clinician review tool is built but no clinician has yet used it — labels remain dev-labeled (`source: "dev"` on all 16 rows). Risk agent over-calls risk (9 false positives, specificity 30.8%) — the eval reveals this honestly but the agent has not been tuned to address it.

**Envisioned:** Multi-EHR deployment; population-level outcome tracking (historical snapshots for trend analysis); batch analysis endpoint; formal governance frame alignment (model cards, named regulatory pathway); clinician validation of eval labels (tool is built, path exists, no clinician has used it yet); multilingual support; low-connectivity/offline operation; Risk agent calibration to reduce false-positive rate.

---

## C. Tier 1 — Pillars

### P1 — HL7 Standards Leverage and Interoperability (18%)

**Score: 5/5 — Contribution: 18.0**

Seven HL7 standards are load-bearing, not cosmetic. FHIR R4 is the data backbone — every agent reads a `PatientBundle` of real FHIR resources and every finding cites a `ResourceType/id` validated against that bundle. SMART on FHIR Backend Services implements the full RFC 7523 `private_key_jwt` flow (RS256 assertion, client_credentials exchange, token caching, Bearer attachment on every HAPI call). CDS Hooks provides spec-compliant discovery and patient-view card delivery. FHIR Task is the action layer — AI outputs become structured Tasks with priority, owner, citations, and domain tags. FHIR Subscription enables real-time push to the mobile coordinator app. FHIR SDC/AHC-HRSN screening data feeds the SDOH agent. Terminology bindings (LOINC, ICD-10, SNOMED CT, RxNorm, OMB categories) are used in seed data, quality measures, and agent prompts. The eval harness itself reads FHIR bundles via `FhirReadService.getPatientBundle` (`Patient/{id}/$everything`) — the same FHIR-native path the production analysis route uses.

**Evidence:** `fhir/client.ts:325-399` (FhirReadService), `smart/assertion.ts:11-22`, `smart/tokenClient.ts:17-55`, `smart/tokenServer.ts:21-58`, `routes/cdsHooks.ts:26-80`, `fhir/subscription.ts:55-83`, `routes/events.ts:62-87`, `quality/service.ts:28-31`, `scripts/eval.ts:169` (harness uses `getPatientBundle`), `scripts/import-fhir.ts:25-48`.

### P2 — Clinical and Health Impact (18%)

**Score: 4/5 — Contribution: 14.4**

The system targets the top 5% of complex patients (diabetes + CHF + depression) who account for ~50% of healthcare costs. The Risk agent produces 30-day readmission probability from real FHIR Observations (BNP, HbA1c, eGFR) and Conditions. The Care Gap agent identifies overdue preventive screenings. The SDOH agent screens for transportation, food, housing, and utility barriers via AHC-HRSN. The Action Planner synthesizes these into prioritized FHIR Tasks — actionable work items, not passive alerts. A real HEDIS measure (diabetes HbA1c testing rate) is computed from live FHIR counts. The eval harness has been **run** and produces actual metrics: Care Gap sensitivity 100% (10/10 TP, 0 FN), Risk sensitivity 100% (3/3 TP, 0 FN), SDOH agreement 100% (16/16). The error analysis reveals the Risk agent over-calls risk (9 false positives, specificity 30.8%, PPV 25%) — an honest, actionable finding. Labeling rules are derived from established LOINC conventions (HbA1c for diabetes, BNP for CHF, eGFR for CKD). Held back from 5 because all impact is demonstrated on Synthea/synthetic data with no clinician-validated outcomes or pilot results, and the Risk agent's high false-positive rate (9 FPs) means the system would generate excessive unnecessary alerts in production without calibration.

**Evidence:** `riskAgent.ts:67-82`, `careGapAgent.ts:67-82`, `sdohAgent.ts:73-88`, `actionPlannerAgent.ts:87-108`, `quality/service.ts:50-60`, `data/eval/labels.json` `_meta.labelingRules.careGap` (LOINC-derived labeling), `population/service.ts:24-60`, `docs/eval-report.json:4` (headline), `docs/eval-report.json:9-37` (metrics), `docs/eval-report.json:220-295` (error analysis).

### P3 — AI / GenAI Innovation and Substance (18%)

**Score: 5/5 — Contribution: 18.0**

The multi-agent orchestration is genuinely inventive. Three bundle-driven agents run concurrently via `Promise.race` over async iterators, interleaving streamed reasoning tokens in real time (`orchestrator.ts:41-91`). A fourth agent (Action Planner) synthesizes the three agents' structured outputs without seeing the raw FHIR bundle — it can only cite IDs the upstream agents already cited (`actionPlannerAgent.ts:79-85`). Citation enforcement is specifically engineered against the hallucination failure mode: every finding's `fhirResourceId` is validated against the bundle's `validIds` set, unvalidated citations in streamed narration are redacted in real time via a bounded lookahead buffer (`citationValidator.ts:106-132`). The eval harness scores agents post-`validateCitations` — the same citation-gated shape the product surfaces to clinicians — not raw/unvalidated output, which would be gaming the metric. Structured output via function tools (not free text) ensures the model commits to a schema before narration. This is not an off-the-shelf model on a solved problem — it is an architecture purpose-built for clinical AI safety.

**Evidence:** `orchestrator.ts:41-91`, `citationValidator.ts:29-132`, `riskAgent.ts:34-65`, `actionPlannerAgent.ts:79-108`, `eval/computeMetrics.ts:6-8` (scores post-validation findings), `routes/analysis.ts:268-352`.

### P4 — Trust, Safety, Governance and Explainability (13%)

**Score: 4/5 — Contribution: 10.4**

Citation enforcement is the core trust innovation — every agent finding is validated against the retrieved FHIR bundle before reaching a human, and unvalidated citations are redacted in real time during streaming. Human-in-the-loop is architectural: all AI outputs become FHIR Tasks with `status: 'requested'`, requiring a coordinator to accept, complete, defer, or escalate. Audit trail records every FHIR access (actor, action, resource, outcome) with denial logging. Role-based scopes enforce per-domain access. Demographic parity metrics are computed from real HAPI patient demographics and stratified by dimension (`governance/service.ts:260-291`). The eval harness's label file explicitly documents its own limitations: Care Gap specificity rests on a single negative example, and SDOH agreement is easy to game — honest disclosure of statistical fragility. The `computeErrorAnalysis` module extracts per-patient false negatives and false positives, which is the data a governance committee would need to review agent performance. The committed eval report (`docs/eval-report.json`) contains the actual error analysis: 1 Care Gap false positive (maria-chen — agent flagged a gap despite HbA1c and BNP on file) and 9 Risk false positives (agent over-called risk on patients with seed riskScore < 75). The clinician review tool (`render-clinician-review.ts`) generates a self-contained HTML form that shows each label, the agent's actual prediction, and lets a clinician endorse/override/abstain per dimension — creating a built path from dev-labeled to clinician-validated with no code change. Held back from 5 because: no formal governance frame alignment (no model card, no named regulatory pathway), no bias mitigation beyond measurement, and confidence distribution shows zero because agents don't yet emit per-finding confidence.

**Evidence:** `citationValidator.ts:29-73`, `scopes.ts:5-13`, `audit.ts:12-16`, `governance/service.ts:155-291`, `eval/errorAnalysis.ts:59-116` (per-patient error extraction), `docs/eval-report.json:220-295` (committed error analysis), `scripts/render-clinician-review.ts:1-455` (clinician review tool), `data/eval/labels.json` `_meta.limitations`, `Governance.tsx:12-60`.

### P5 — Transformative Vision and Ambition (12%)

**Score: 5/5 — Contribution: 12.0**

Restructuring care coordination around AI agents that reason over a patient's full FHIR record — and deliver actionable FHIR Tasks rather than passive alerts — is a genuine paradigm shift. The multi-agent decomposition mirrors how real care teams work: a risk specialist, a care gap analyst, a social worker, and a care coordinator each contributing their domain expertise. The ambition is anchored by a demonstrated core: the orchestrator runs, the agents produce structured findings, the Action Planner creates FHIR Tasks, the CDS Hooks service delivers cards to the EHR, the mobile app pushes task assignments via FHIR Subscription, the governance dashboard tracks audit trail and demographic parity, and the eval harness provides a repeatable framework to measure agent accuracy. The vision uses AI plus HL7 to attempt something neither could do alone: AI provides the cross-domain reasoning, HL7 provides the interoperability backbone that makes the output actionable inside existing clinical workflows.

**Evidence:** `orchestrator.ts:41-91`, `routes/cdsHooks.ts:26-80`, `routes/events.ts:62-87`, `PatientDetail.tsx:1-60`, `TaskQueue.tsx:1-40`, `Governance.tsx:1-60`, `scripts/eval.ts:1-422` (eval harness), `plan.md`.

### P6 — Proof, Demonstration and Evaluation Design (8%)

**Score: 5/5 — Contribution: 8.0**

**Upgraded from 4→5.** The evaluation harness is built, unit-tested, **and has been run** against a live HAPI + LLM instance, producing committed `docs/eval-report.json` and `docs/eval-report.md` with actual metrics. The architecture is disciplined: pure, I/O-free `computeMetrics` (`eval/computeMetrics.ts:176-226`) computes sensitivity/specificity/PPV from confusion matrices with honest `null` returns on zero denominators. Pure `computeErrorAnalysis` (`eval/errorAnalysis.ts:59-116`) extracts per-patient false negatives, false positives, SDOH disagreements, and data-availability gaps. Both modules have unit tests with hand-built fixtures independent of the label file. The harness ran over 16 patients (1 cached, 15 live, 0 failures) and produced real numbers: **Care Gap** sensitivity 100%, specificity 0%, PPV 90.9% (TP=10, FP=1, FN=0, TN=0); **Risk** sensitivity 100%, specificity 30.8%, PPV 25% (TP=3, FP=9, FN=0, TN=4); **SDOH** agreement 100% (16/16). The mandatory error analysis (GD8's 4→5 lever) is present and honest: it names the 1 Care Gap FP (maria-chen — agent flagged a gap despite HbA1c and BNP on file) and all 9 Risk FPs (agent over-called risk on patients with seed riskScore < 75). A clinician review tool (`render-clinician-review.ts`, `npm run review:render`) generates a self-contained HTML form that shows each label alongside the agent's actual prediction and lets a clinician endorse/override/abstain per dimension — creating a built path from dev-labeled to clinician-validated. The label file's `_meta.limitations` honestly documents that Care Gap specificity rests on a single negative example and SDOH agreement is easy to game. This is the full P6 loop: harness → run → metrics → error analysis → clinician review path.

**Evidence:** `eval/computeMetrics.ts:1-227`, `eval/errorAnalysis.ts:1-117`, `eval/computeMetrics.test.ts:1-180`, `eval/errorAnalysis.test.ts:1-172`, `scripts/eval.ts:1-422`, `scripts/render-clinician-review.ts:1-455`, `data/eval/labels.json:1-356`, `docs/eval-report.json:1-296` (committed run results), `docs/eval-report.md:1-88` (human-readable report), `apps/api/package.json:14` (`"eval"` script), `apps/api/package.json:15` (`"review:render"` script), `package.json:18` (root `"eval"` script), `package.json:19` (root `"review:render"` script).

### P7 — Efficiency and Economic Soundness (5%)

**Score: 3/5 — Contribution: 3.0**

No fatal cost flaw. Three agents run concurrently (not sequentially), reducing wall-clock latency. The Action Planner is a fourth call but synthesizes already-parsed outputs (smaller prompt than a full bundle). Cache avoids re-running the LLM for the same patient. The eval harness itself is cache-first, avoiding redundant LLM calls on repeated eval runs. Cost-avoidance projection uses documented assumptions ($15,200/readmission, 20% avoidance rate — labeled as POC assumptions). However, no detailed cost analysis per patient analysis, no token usage estimates, and the four-LLM-call overhead is not quantified against the value of prevented readmissions. Credible reasoning is present but thin.

**Evidence:** `orchestrator.ts:41-46` (concurrent agents), `scripts/eval.ts:162-167` (cache-first), `population/service.ts:43-55`, `routes/analysis.ts:8` (cache read/write).

### P8 — Experience: Clinician and Patient (4%)

**Score: 4/5 — Contribution: 3.2**

CDS Hooks cards deliver AI findings inside the EHR — zero new app for clinicians, ambient integration via the existing patient-view workflow. The mobile coordinator app (TaskQueue, TaskDetail) is well-fitted to the care coordinator's daily workflow: priority-sorted task cards, one-tap complete/defer/escalate, live assignment notifications via SSE, patient phone number for call action. The PatientDetail page shows a real-time agent graph (Canvas 2D, 5-node orchestrator + agents with animated dispatch/synthesis particles) and live streaming reasoning tokens per agent. Role-based UI ensures each role sees only what's relevant. Held back from 5 because no evidence of real user engagement (all tested on Synthea data, no clinician feedback documented).

**Evidence:** `routes/cdsHooks.ts:26-80`, `TaskQueue.tsx:1-40`, `TaskDetail.tsx:1-40`, `AgentGraph.tsx:1-50`, `PatientDetail.tsx:1-60`, `AppShell.tsx:48-60`, `App.tsx:26-98`.

### P9 — Equity, Access and Scalability (4%)

**Score: 3/5 — Contribution: 2.4**

The SDOH agent screens for transportation, food, housing, utility, and safety barriers via AHC-HRSN — social determinants that disproportionately affect underserved populations. Community resource directory includes Medicaid-specific programs. Demographic parity metrics are computed from real patient demographics (US Core race/ethnicity extensions) and stratified by age band, sex, race, and ethnicity. The eval label file's `_meta.limitations` honestly documents that SDOH ground truth has only one positive example, making the agreement rate easy to game — this is the kind of honest equity-adjacent disclosure the rubric rewards. FHIR portability means any FHIR R4 server qualifies. However: no multilingual support, no low-connectivity/offline consideration, parity metrics show zero data today, and no demonstrated equitable performance across populations. Equity is addressed as a first-class architectural concern but the evidence is design-level, not yet results-level.

**Evidence:** `sdohAgent.ts:73-88`, `sdoh/resources.ts:1-50`, `governance/service.ts:260-291`, `fhir/client.ts:297-323`, `Governance.tsx:54-60`, `data/eval/labels.json` `_meta.limitations`.

---

### Weighted Total

| Pillar | Score | Weight | Contribution |
|--------|:-----:|:------:|:------------:|
| P1 HL7 Standards Leverage | 5 | 18% | 18.0 |
| P2 Clinical Impact | 4 | 18% | 14.4 |
| P3 AI/GenAI Innovation | 5 | 18% | 18.0 |
| P4 Trust/Safety/Governance | 4 | 13% | 10.4 |
| P5 Transformative Vision | 5 | 12% | 12.0 |
| P6 Proof/Demo/Eval Design | 5 | 8% | 8.0 |
| P7 Efficiency/Economics | 3 | 5% | 3.0 |
| P8 Experience | 4 | 4% | 3.2 |
| P9 Equity/Access/Scalability | 3 | 4% | 2.4 |
| **WEIGHTED TOTAL** | | **100%** | **89.4 / 100** |

---

## D. Tier 2 — AI-Leverage Multiplier

**M = 1.15** | **Mode: tie-breaker**

The multi-agent architecture with citation enforcement is not achievable without LLMs — the specialist sub-agent decomposition mirrors clinical team structure in a way that is genuinely inventive, and the citation validation architecture is specifically engineered around the LLM's confabulation failure mode. The eval harness scores agents post-validation and has been run to produce actual metrics with error analysis, closing the loop between AI output and measurable accuracy. The clinician review tool creates a path from dev-labeled to clinician-validated. AI is the irreplaceable engine.

---

## E. Band, Strongest Dimension, Biggest Risk/Gap

**Band: Finalist (85+)**

**Strongest dimension:** P1 + P3 together — seven load-bearing HL7 standards feeding a genuinely novel multi-agent AI architecture with citation enforcement. The standards are not a checkbox; they are the grounding layer that makes the AI safe, and the AI is not decorative; it is the reasoning engine that no rule system could replicate.

**Biggest risk/gap:** P2/P4 — the eval harness reveals that the Risk agent over-calls risk (9 false positives, specificity 30.8%, PPV 25%), meaning the system would generate excessive unnecessary alerts in production without calibration. The eval also shows Care Gap specificity at 0% (1 FP on the single negative example — maria-chen). These are honest, actionable findings, but they reveal that the agents need tuning before clinical deployment. Additionally, labels remain dev-labeled (no clinician has used the review tool yet), and the dataset's limitations (1 negative Care Gap example, 1 positive SDOH example) mean the metrics are illustrative rather than statistically robust.

---

## F. Open Questions for the Team

1. **P2/P4:** The eval reveals the Risk agent has 9 false positives (specificity 30.8%, PPV 25%) — it over-calls risk on patients with seed riskScore < 75. Is there a plan to calibrate the Risk agent's threshold or prompt to reduce false positives? This is the most actionable finding from the eval.

2. **P6:** The clinician review tool (`npm run review:render`) is built but no clinician has used it yet — all 16 labels remain `source: "dev"`. Has the HTML form been sent to any clinician for review? If not, what is the timeline?

3. **P6:** The label file documents that Care Gap specificity rests on a single negative example (maria-chen) and SDOH agreement on a single positive example. Is there a plan to enrich the procedural patient generator to seed baseline Observations and AHC-HRSN screenings, or to add more curated patients with diverse label profiles?

4. **P4:** No formal governance frame alignment (model card, NIST AI RMF, WHO guidance, named regulatory pathway) is evidenced in the codebase or docs. Is there a plan to align with a recognized risk management framework?

5. **P7:** The four-LLM-call-per-patient cost is not quantified. What is the estimated cost per patient analysis at current token prices, and how does it compare to the projected cost avoidance per prevented readmission?

6. **P9:** No multilingual support or low-connectivity consideration is evidenced. Is there a plan for non-English populations or offline/graceful-degradation operation for resource-limited settings?

7. **P1 (SMART):** The SMART Backend Services token is minted, exchanged, cached, and attached to every HAPI call, but HAPI itself does not enforce it (documented honestly). Is there a plan to deploy a FHIR server that enforces SMART scopes?

---

## G. One-Line Verdict

A finalist-tier submission whose widest-in-field standards footprint and most inventive AI architecture are now anchored by a built, run, and committed evaluation harness with actual metrics and honest error analysis — the P6 loop is closed from design to execution, with the remaining gap being Risk agent calibration (9 FPs) and clinician validation of labels.
