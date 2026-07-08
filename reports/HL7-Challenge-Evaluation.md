# CareSync AI — HL7 AI Challenge 2026 Evaluation

**Submission:** CareSync AI — Multi-Agent FHIR Care Orchestrator for High-Risk Patients
**Judge:** Cascade (AI)
**Date:** 2026-07-07
**Rubric:** HL7-Challenge-Brief.md (updated 2026-07-07)

---

## A. Tier 0 — Gates

| Gate | Result | Justification |
|------|--------|---------------|
| **G1** HL7 substance | **PASS** | Seven HL7 standards are load-bearing: FHIR R4 (all patient data I/O via HAPI v7.2.0), SMART on FHIR Backend Services (RS256 JWT assertion, client_credentials token exchange, Bearer on every HAPI call), CDS Hooks (discovery + patient-view service), FHIR Task (AI-generated work items with priority/owner/citations), FHIR Subscription (rest-hook with `application/fhir+json` payload), FHIR SDC/AHC-HRSN (SDOH screening Observations), and terminology bindings (LOINC 4548-4, ICD-10-CM E11.9, SNOMED CT, RxNorm, OMB race/ethnicity). Removing any standard breaks a load-bearing path. |
| **G2** AI centrality | **PASS** | Four specialist LLM agents (Risk, Care Gap, SDOH, Action Planner) running on OpenAI `gpt-5.5` via the Responses API with streaming and structured function-tool output. The orchestrator (`orchestrator.ts:41-91`) runs three agents concurrently via `Promise.race` over async iterators, then the Action Planner synthesizes their structured outputs. No rule-based system could replicate the cross-domain synthesis over a full FHIR bundle. Removing the LLM removes the entire reasoning capability. |
| **G3** Safety/privacy/guardrails | **PASS** | Citation enforcement (`citationValidator.ts:29-73`) validates every agent finding's `fhirResourceId` against the retrieved bundle's `validIds` set — hallucinated IDs are dropped before reaching the UI. Streamed narration is redacted in real time (`redactUnvalidatedCitations`). Role-based scopes (`scopes.ts`: Director/Coordinator/Social Worker × demographic/clinical/sdoh) are enforced on every FHIR read (`FhirReadService.guard:364-369`). Audit trail (`audit.ts:12-16`) records every access. Human-in-the-loop: all AI outputs become FHIR Tasks with `status: 'requested'` requiring coordinator action. SMART token scoping (`SmartTokenClient`, `system/*.read`). Demographic parity metrics computed from real HAPI demographics (`governance/service.ts:260-291`). |
| **G4** Honest staging | **PASS** | Disciplined culture of documented deviations: `Governance.tsx:12-60` drops fabricated mockup chips and replaces numbers with honest "—" placeholders. `Quality.tsx:13-40` explicitly drops $624K/$4.78M fabricated figures, keeping only the one real HEDIS measure. `Population.tsx:20-48` drops fabricated trends and inert buttons. `governance/service.ts:81-99` documents that confidence buckets show zero (not fabricated) because agents don't yet emit confidence. `plan.md` §3 contains a standards conformance matrix with Built/Partial/Envisioned status per standard, including the honest SMART limitation (HAPI doesn't enforce the token). |
| **G5** Ethical/regulatory (flag) | **PASS** (no flag) | No FDA SaMD claim anywhere. System is framed as a care-coordination support tool. All AI-generated Tasks start as `requested` — no autonomous clinical decision-making. CDS Hooks service is cache-only (returns `cards: []` on miss) to avoid live AI runs inside EHR synchronous timeouts. `plan.md` GD5: "Standalone care-coordination app using SMART app-to-server auth. No EHR launch claimed." |

**No hard gates failed. Submission is competitive.**

---

## B. Built vs. Prototyped vs. Envisioned

**Built:** Full FHIR R4 read/write layer against HAPI v7.2.0; SMART Backend Services (assertion minting, token exchange, caching, Bearer attachment); CDS Hooks discovery + patient-view service with card mapping; four LLM agents (Risk, Care Gap, SDOH, Action Planner) with structured output and streaming; citation enforcement (validation + redaction); FHIR Task lifecycle (create, assign, transition, list, detail); FHIR Subscription (rest-hook creation, webhook receiver, SSE relay to web); role-based auth (3 roles, 3 domains) with audit trail; mobile coordinator app (TaskQueue, TaskDetail with complete/defer/escalate); patient detail with live agent graph and SSE streaming; population dashboard (500-patient cohort, risk×urgency scatter, critical-zone count); governance dashboard (audit trail, confidence distribution, demographic parity); quality/HEDIS measure (diabetes HbA1c testing rate from live FHIR counts); SDOH resource directory + audited FHIR ServiceRequest referrals; team performance view; 12 E2E Playwright test specs.

**Prototyped:** SMART token is minted and attached but HAPI does not enforce it (stock Docker image ships no interceptor config — documented honestly in `plan.md` §3 and `index.ts:45-51`). Confidence distribution endpoint exists and reads an optional `confidence` field, but today's agents don't emit per-finding confidence — buckets show zero honestly. Evaluation harness (`npm run eval`) is designed and the governance tile reads its output path, but `getEvalSummary` returns `{ available: false }` — the harness itself is not yet shipped.

**Envisioned:** Multi-EHR deployment; population-level outcome tracking (historical snapshots for trend analysis); batch analysis endpoint; formal governance frame alignment (model cards, named regulatory pathway); multilingual support; low-connectivity/offline operation.

---

## C. Tier 1 — Pillars

### P1 — HL7 Standards Leverage and Interoperability (18%)

**Score: 5/5 — Contribution: 18.0**

Seven HL7 standards are load-bearing, not cosmetic. FHIR R4 is the data backbone — every agent reads a `PatientBundle` of real FHIR resources and every finding cites a `ResourceType/id` validated against that bundle. SMART on FHIR Backend Services implements the full RFC 7523 `private_key_jwt` flow (RS256 assertion, client_credentials exchange, token caching, Bearer attachment on every HAPI call). CDS Hooks provides spec-compliant discovery and patient-view card delivery. FHIR Task is the action layer — AI outputs become structured Tasks with priority, owner, citations, and domain tags. FHIR Subscription enables real-time push to the mobile coordinator app. FHIR SDC/AHC-HRSN screening data feeds the SDOH agent. Terminology bindings (LOINC, ICD-10, SNOMED CT, RxNorm, OMB categories) are used in seed data, quality measures, and agent prompts. The AI would be impossible without the interoperability layer — it consumes FHIR-native data as first-class grounding.

**Evidence:** `fhir/client.ts:325-399` (FhirReadService), `smart/assertion.ts:11-22`, `smart/tokenClient.ts:17-55`, `smart/tokenServer.ts:21-58`, `routes/cdsHooks.ts:26-80`, `routes/cdsCardMapping.ts:45-68`, `fhir/subscription.ts:55-83`, `routes/events.ts:62-87`, `quality/service.ts:28-31`, `scripts/import-fhir.ts:25-48`, `docker-compose.yml:1-25`.

### P2 — Clinical and Health Impact (18%)

**Score: 4/5 — Contribution: 14.4**

The system targets the top 5% of complex patients (diabetes + CHF + depression) who account for ~50% of healthcare costs. The Risk agent produces 30-day readmission probability from real FHIR Observations (BNP, HbA1c, eGFR) and Conditions. The Care Gap agent identifies overdue preventive screenings. The SDOH agent screens for transportation, food, housing, and utility barriers via AHC-HRSN. The Action Planner synthesizes these into prioritized FHIR Tasks — actionable work items, not passive alerts. A real HEDIS measure (diabetes HbA1c testing rate) is computed from live FHIR counts. Population dashboard shows 500-patient risk scatter with critical-zone identification. The improvement is traceable to the AI capability (cross-domain synthesis no rule engine could replicate). Held back from 5 because all impact is demonstrated on Synthea synthetic data with no clinician-validated outcomes or pilot results.

**Evidence:** `riskAgent.ts:67-82` (prompt built from FHIR bundle), `careGapAgent.ts:67-82`, `sdohAgent.ts:73-88` (AHC-HRSN screening), `actionPlannerAgent.ts:87-108` (synthesizes three agents' outputs), `quality/service.ts:50-60` (HEDIS measure), `population/service.ts:24-60` (scatter + cost avoidance), `fhir-data/population.ts:1-40` (500-patient cohort).

### P3 — AI / GenAI Innovation and Substance (18%)

**Score: 5/5 — Contribution: 18.0**

The multi-agent orchestration is genuinely inventive. Three bundle-driven agents run concurrently via `Promise.race` over async iterators, interleaving streamed reasoning tokens in real time (`orchestrator.ts:41-91`). A fourth agent (Action Planner) synthesizes the three agents' structured outputs without seeing the raw FHIR bundle — it can only cite IDs the upstream agents already cited (`actionPlannerAgent.ts:79-85`). This decomposition mirrors a real care team (risk specialist, care gap analyst, social worker, care coordinator) in a way no monolithic prompt could. Citation enforcement is specifically engineered against the hallucination failure mode: every finding's `fhirResourceId` is validated against the bundle's `validIds` set, unvalidated citations in streamed narration are redacted in real time via a bounded lookahead buffer (`citationValidator.ts:106-132`). Structured output via function tools (not free text) ensures the model commits to a schema before narration. This is not an off-the-shelf model on a solved problem — it is an architecture purpose-built for clinical AI safety.

**Evidence:** `orchestrator.ts:41-91`, `citationValidator.ts:29-132`, `riskAgent.ts:34-65` (function tool schema), `actionPlannerAgent.ts:79-108` (union of cited IDs), `routes/analysis.ts:25-76` (SSE streaming + cache replay).

### P4 — Trust, Safety, Governance and Explainability (13%)

**Score: 4/5 — Contribution: 10.4**

Citation enforcement is the core trust innovation — every agent finding is validated against the retrieved FHIR bundle before reaching a human, and unvalidated citations are redacted in real time during streaming. Human-in-the-loop is architectural: all AI outputs become FHIR Tasks with `status: 'requested'`, requiring a coordinator to accept, complete, defer, or escalate. Audit trail records every FHIR access (actor, action, resource, outcome) with denial logging. Role-based scopes enforce per-domain access (Social Workers cannot see clinical data). Demographic parity metrics are computed from real HAPI patient demographics (age/sex/race/ethnicity via US Core extensions) and stratified by dimension (`governance/service.ts:260-291`). The governance dashboard renders real audit trail, confidence distribution, and parity radar — with honest "—" placeholders where data is absent. Held back from 5 because: no formal governance frame alignment (no model card, no named regulatory pathway), no bias mitigation beyond measurement, and confidence distribution shows zero because agents don't yet emit per-finding confidence (honestly documented but still a gap).

**Evidence:** `citationValidator.ts:29-73`, `scopes.ts:5-13`, `audit.ts:12-16`, `governance/service.ts:155-291`, `routes/governance.ts:20-88`, `Governance.tsx:12-60` (documented deviations), `routes/tasks.ts:62-89` (status transitions).

### P5 — Transformative Vision and Ambition (12%)

**Score: 5/5 — Contribution: 12.0**

Restructuring care coordination around AI agents that reason over a patient's full FHIR record — and deliver actionable FHIR Tasks rather than passive alerts — is a genuine paradigm shift. The multi-agent decomposition mirrors how real care teams work: a risk specialist, a care gap analyst, a social worker, and a care coordinator each contributing their domain expertise. The ambition is anchored by a demonstrated core: the orchestrator runs, the agents produce structured findings, the Action Planner creates FHIR Tasks, the CDS Hooks service delivers cards to the EHR, the mobile app pushes task assignments via FHIR Subscription, and the governance dashboard tracks audit trail and demographic parity. The vision uses AI plus HL7 to attempt something neither could do alone: AI provides the cross-domain reasoning, HL7 provides the interoperability backbone that makes the output actionable inside existing clinical workflows.

**Evidence:** `orchestrator.ts:41-91` (working core), `routes/cdsHooks.ts:26-80` (EHR delivery), `routes/events.ts:62-87` (real-time push), `PatientDetail.tsx:1-60` (agent graph + live streaming), `TaskQueue.tsx:1-40` (mobile coordinator), `Governance.tsx:1-60` (governance dashboard), `plan.md` (architecture and vision).

### P6 — Proof, Demonstration and Evaluation Design (8%)

**Score: 3/5 — Contribution: 4.8**

A working proof-of-concept of the core claim is demonstrated: the multi-agent orchestrator runs end-to-end on Synthea complex patients, streaming reasoning via SSE, producing citation-validated findings, creating FHIR Tasks, and delivering CDS Hooks cards. 12 E2E Playwright test specs cover patient analysis, coordinator live assignment, governance, population, quality, SDOH referral, task queue/detail, and social worker denial. Cached results enable replay without re-calling the LLM. However, the evaluation harness (`npm run eval`) is designed but not yet shipped — `getEvalSummary` (`governance/service.ts:316-325`) returns `{ available: false }` honestly. No held-out eval data, no sensitivity/specificity/PPV numbers, no baseline comparison. The evaluation design is documented in `plan.md` but not yet executable. Honest scope is acknowledged throughout.

**Evidence:** `routes/analysis.ts:1-80` (SSE streaming + cache), `apps/web/e2e/` (12 test specs), `governance/service.ts:293-325` (eval summary returns `available: false`), `plan.md` (eval harness design).

### P7 — Efficiency and Economic Soundness (5%)

**Score: 3/5 — Contribution: 3.0**

No fatal cost flaw. Three agents run concurrently (not sequentially), reducing wall-clock latency. The Action Planner is a fourth call but synthesizes already-parsed outputs (smaller prompt than a full bundle). Cache avoids re-running the LLM for the same patient. Cost-avoidance projection uses documented assumptions ($15,200/readmission, 20% avoidance rate — labeled as POC assumptions in `population/service.ts:43-55`). HEDIS quality measure includes an illustrative $5,000/gap-closed figure (labeled illustrative in `quality/service.ts:33-38`). However, no detailed cost analysis per patient analysis, no token usage estimates, and the four-LLM-call overhead is not quantified against the value of prevented readmissions. Credible reasoning is present but thin.

**Evidence:** `orchestrator.ts:41-46` (concurrent agents), `population/service.ts:43-55` (cost assumptions), `quality/service.ts:33-38` (illustrative dollars), `routes/analysis.ts:8` (cache read/write).

### P8 — Experience: Clinician and Patient (4%)

**Score: 4/5 — Contribution: 3.2**

CDS Hooks cards deliver AI findings inside the EHR — zero new app for clinicians, ambient integration via the existing patient-view workflow. The mobile coordinator app (TaskQueue, TaskDetail) is well-fitted to the care coordinator's daily workflow: priority-sorted task cards, one-tap complete/defer/escalate, live assignment notifications via SSE, patient phone number for call action. The PatientDetail page shows a real-time agent graph (Canvas 2D, 5-node orchestrator + agents with animated dispatch/synthesis particles) and live streaming reasoning tokens per agent. Role-based UI ensures each role sees only what's relevant. Held back from 5 because no evidence of real user engagement (all tested on Synthea data, no clinician feedback documented).

**Evidence:** `routes/cdsHooks.ts:26-80` (CDS Hooks), `TaskQueue.tsx:1-40` (mobile task queue), `TaskDetail.tsx:1-40` (task detail with transitions), `AgentGraph.tsx:1-50` (Canvas 2D agent graph), `PatientDetail.tsx:1-60` (live streaming), `AppShell.tsx:48-60` (live assignment toast), `App.tsx:26-98` (role-based routing).

### P9 — Equity, Access and Scalability (4%)

**Score: 3/5 — Contribution: 2.4**

The SDOH agent screens for transportation, food, housing, utility, and safety barriers via AHC-HRSN — social determinants that disproportionately affect underserved populations. Community resource directory includes Medicaid-specific programs (e.g., "Free for Medicaid" transit assistance). Demographic parity metrics are computed from real patient demographics (US Core race/ethnicity extensions) and stratified by age band, sex, race, and ethnicity — rendered on the governance dashboard as a radar chart. FHIR portability means any FHIR R4 server qualifies, including community/rural health systems. However: no multilingual support, no low-connectivity/offline consideration, parity metrics show zero data today (honestly — no cached analyses with risk scores yet), and no demonstrated equitable performance across populations. Equity is addressed as a first-class architectural concern, not a footnote, but the evidence is design-level, not yet results-level.

**Evidence:** `sdohAgent.ts:73-88` (AHC-HRSN screening), `sdoh/resources.ts:1-50` (community resources), `governance/service.ts:260-291` (parity metrics), `fhir/client.ts:297-323` (US Core race/ethnicity extensions), `Governance.tsx:54-60` (parity radar), `scripts/import-fhir.ts:25-48` (OMB category codings).

---

### Weighted Total

| Pillar | Score | Weight | Contribution |
|--------|:-----:|:------:|:------------:|
| P1 HL7 Standards Leverage | 5 | 18% | 18.0 |
| P2 Clinical Impact | 4 | 18% | 14.4 |
| P3 AI/GenAI Innovation | 5 | 18% | 18.0 |
| P4 Trust/Safety/Governance | 4 | 13% | 10.4 |
| P5 Transformative Vision | 5 | 12% | 12.0 |
| P6 Proof/Demo/Eval Design | 3 | 8% | 4.8 |
| P7 Efficiency/Economics | 3 | 5% | 3.0 |
| P8 Experience | 4 | 4% | 3.2 |
| P9 Equity/Access/Scalability | 3 | 4% | 2.4 |
| **WEIGHTED TOTAL** | | **100%** | **86.2 / 100** |

---

## D. Tier 2 — AI-Leverage Multiplier

**M = 1.15** | **Mode: tie-breaker**

The multi-agent architecture with citation enforcement is not achievable without LLMs — the specialist sub-agent decomposition mirrors clinical team structure in a way that is genuinely inventive, and the citation validation architecture is specifically engineered around the LLM's confabulation failure mode. AI is the irreplaceable engine.

---

## E. Band, Strongest Dimension, Biggest Risk/Gap

**Band: Finalist (85+)**

**Strongest dimension:** P1 + P3 together — seven load-bearing HL7 standards feeding a genuinely novel multi-agent AI architecture with citation enforcement. The standards are not a checkbox; they are the grounding layer that makes the AI safe, and the AI is not decorative; it is the reasoning engine that no rule system could replicate.

**Biggest risk/gap:** P6 — the evaluation harness is designed but not shipped. The core claim (AI-generated Tasks improve care coordination for high-risk patients) is demonstrated end-to-end on Synthea data but not yet validated against a labeled gold standard with sensitivity/specificity/PPV metrics. No clinician has reviewed agent outputs for face validity (not evidenced). This is the gap between a compelling demo and a credible proof.

---

## F. Open Questions for the Team

1. **P6:** The evaluation harness (`npm run eval`) is designed and the governance tile reads its output path, but `getEvalSummary` returns `{ available: false }`. What is the timeline for delivering the eval report, and will it include sensitivity/specificity/PPV against a labeled gold standard? What baseline will be used for comparison?

2. **P4:** No formal governance frame alignment (model card, NIST AI RMF, WHO guidance, named regulatory pathway) is evidenced in the codebase or docs. Is there a plan to align with a recognized risk management framework?

3. **P2:** All impact is demonstrated on Synthea synthetic data. Has any clinician reviewed the agent outputs for face validity? If so, what was the feedback?

4. **P7:** The four-LLM-call-per-patient cost is not quantified. What is the estimated cost per patient analysis at current token prices, and how does it compare to the projected cost avoidance per prevented readmission?

5. **P9:** No multilingual support or low-connectivity consideration is evidenced. Is there a plan for non-English populations or offline/graceful-degradation operation for resource-limited settings?

6. **P1 (SMART):** The SMART Backend Services token is minted, exchanged, cached, and attached to every HAPI call, but HAPI itself does not enforce it (documented honestly). Is there a plan to deploy a FHIR server that enforces SMART scopes (e.g., HAPI with a custom interceptor, or a managed FHIR service like Azure API for FHIR)?

---

## G. One-Line Verdict

A finalist-tier submission with the widest standards footprint and most inventive AI architecture in the field — seven load-bearing HL7 standards, a multi-agent orchestrator with real-time citation enforcement, and a disciplined honest-staging culture — whose critical gap is the unshipped evaluation harness that would transform a compelling demo into a credible proof.
