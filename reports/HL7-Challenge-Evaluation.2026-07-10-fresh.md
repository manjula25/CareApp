# CareSync AI — HL7 AI Challenge 2026 Fresh Evaluation Report

**Submission:** CareSync AI — Multi-Agent FHIR Care Orchestrator for High-Risk Patients
**Judge:** Cascade (AI), acting as HL7 AI Challenge 2026 judge — critic mode
**Date:** 2026-07-10
**Rubric:** `reference-materials/HL7-Challenge-Brief.md` (Gates G1–G5, Pillars P1–P9, AI-Leverage Multiplier)
**Method:** Every gate and pillar scored from direct source-code evidence in the repository. No claims inferred from documentation alone where code contradicts or qualifies them. Eval report (`docs/eval-report.md`) cross-checked against the code that produces it.

---

## A. Tier 0 — Gates

| Gate | Result | Justification |
|------|--------|---------------|
| **G1** HL7 substance | **PASS** | Seven HL7 standards are structurally load-bearing in the code: FHIR R4 (`fhir/client.ts` — `FhirReadService`, `$everything` bundle fetch, Task CRUD, RiskAssessment reads, US Core demographics), SMART on FHIR Backend Services (`smart/assertion.ts` RS256 JWT, `smart/tokenServer.ts` RFC 7523 token exchange with multi-client scope validation, `smart/tokenClient.ts` cached Bearer, `middleware/smartAuth.ts` per-route scope enforcement with RS256 JWKS support), CDS Hooks (`routes/cdsHooks.ts` discovery + patient-view), FHIR Subscription (`fhir/subscription.ts` rest-hook with `payload: 'application/fhir+json'`, `routes/events.ts` webhook → SSE relay), FHIR SDC/AHC-HRSN (SDOH agent reads `QuestionnaireResponse`, LOINC 71802-3), and LOINC/SNOMED CT/ICD-10 terminology bindings (LOINC 4548-4, 30934-4, 62238-1 in `confidenceScorer.ts`; ICD-10 E11.9, I50.9, F33.1, N18.3 in seed data + risk anchors). Removing any breaks a core workflow. |
| **G2** AI centrality | **PASS** | Four LLM agents (Risk, CareGap, SDOH, ActionPlanner) on OpenAI `gpt-5.5` via the Responses API with structured-output function tools are the engine. The orchestrator (`agents/orchestrator.ts`) runs three concurrently via race-based async-iterator merge and feeds their outputs to the fourth. No rule-based fallback exists — the mock fallback explicitly labels itself `[demo fallback — OPENAI_API_KEY is unset]` and is not a replacement. |
| **G3** Safety/privacy/guardrails | **PASS** | Architecture addresses patient-safety hazards at the design level: (1) Citation enforcement — every agent finding's `fhirResourceId` is validated against the bundle's `validIds` set in `citationValidator.ts` before reaching the client or HAPI; hallucinated citations are dropped. (2) Free-text narration is redacted via `redactUnvalidatedCitations` + `NarrationBuffer` with 96-char lookahead. (3) Role-based scope enforcement (`auth/scopes.ts` → `FhirReadService.guard()`) with denial audit logging. (4) SMART Backend Services per-route scope enforcement (`middleware/smartAuth.ts` with `requiredScopesByRoute`, RS256/HS256 dual mode). (5) FHIR Task human-in-the-loop. (6) Deterministic `clampRiskLevel` safety net (`confidenceScorer.ts:312-330`). (7) Audit trail in SQLite (`db/audit.ts`). |
| **G4** Honest staging | **PASS** | `plan.md` §3 "Standards conformance matrix" explicitly distinguishes Built vs. Partial vs. Envisioned for each standard. The SMART note is particularly honest: "HAPI itself does not yet require or validate that token — the stock `hapiproject/hapi` Docker image ships no shell/wget/curl, so no bearer-token authorization interceptor could be configured." Code comments throughout (e.g., `routes/events.ts` noting the webhook is "NOT auth'd — HAPI calls this server-to-server") are consistently transparent about POC-scoped tradeoffs. `labels.json._meta` discloses that procedural patients substitute for real Synthea. |
| **G5** Ethical/regulatory posture | **PASS** (no flag) | No FDA SaMD claim. The system is framed as a care-coordination support tool, not autonomous clinical decision-making. FHIR Tasks require human coordinator action. No deceptive use pathway. `SUBMISSION.md` §3.2 explicitly positions as "decision-support tool, not autonomous decision-maker." |

**No hard gates failed.**

---

## B. Built vs. Prototyped vs. Envisioned

**Built:** Full-stack monorepo — Express/TypeScript API + Vite/React/TypeScript frontend + HAPI FHIR R4 in Docker. Four live LLM agents (Risk, CareGap, SDOH, ActionPlanner) on OpenAI gpt-5.5 with structured output + citation validation + confidence scoring + deterministic risk-level clamping. SMART Backend Services token issuance/exchange/caching with multi-client scope validation. CDS Hooks discovery + patient-view service. FHIR Subscription rest-hook → SSE relay. Role-based access control (Director/Coordinator/Social Worker) with scope enforcement + audit trail. Population dashboard, patient detail with canvas agent graph, governance dashboard with demographic parity computed from real FHIR demographics, task management, mobile-responsive task queue/detail. 14 Playwright E2E specs. Eval harness with sensitivity/specificity/PPV + error analysis over 26 labeled patients. Cost capture with per-token pricing (`pricing.ts`, `usage.ts`) producing real per-patient cost numbers.

**Prototyped:** Risk agent prompt calibration (v3 rubric with 3 anchors, 2 hard rules, 5 worked examples — iterated through S13→S16→S17 with measured specificity improvement). Variance probe characterizing LLM output stability (81.25% per-patient agreement across 3 runs). Clinician outreach pipeline (schema exists in `outreachSchema.ts`, email drafted in `s18-clinician-engagement.md`, 0 invitations sent).

**Envisioned:** Per-user SMART EHR/standalone launch (documented, not wired). HAPI-side bearer-token enforcement (requires custom Java build). Clinician-validated eval labels (slot reserved, 0/26 validated). Multilingual support. Offline/low-connectivity operation. Model card / NIST AI RMF documentation. Population-level analytics dashboard.

---

## C. Tier 1 — Pillars

| Pillar | Score | Justification | Weight | Contribution |
|--------|:-----:|---------------|:------:|:------------:|
| **P1** HL7 Standards Leverage & Interoperability | **5** | Seven HL7 standards are load-bearing in the codebase: FHIR R4 (HAPI reads/writes, `$everything`, Task CRUD, RiskAssessment, US Core demographics), SMART on FHIR Backend Services (RS256 JWT assertion in `smart/assertion.ts`, RFC 7523 token exchange in `smart/tokenServer.ts` with multi-client scope validation, cached Bearer in `smart/tokenClient.ts`, per-route scope enforcement in `middleware/smartAuth.ts` with RS256 JWKS support), CDS Hooks (discovery + patient-view in `routes/cdsHooks.ts`), FHIR Subscription (rest-hook with `payload: 'application/fhir+json'` in `fhir/subscription.ts`, webhook → SSE relay in `routes/events.ts`), FHIR SDC/AHC-HRSN (SDOH agent reads `QuestionnaireResponse`, LOINC 71802-3), LOINC (4548-4, 30934-4, 62238-1, 71802-3 in `confidenceScorer.ts`), SNOMED CT / ICD-10 (E11.9, I50.9, F33.1, N18.3 in seed data + risk anchors), US Core race/ethnicity extensions (demographic parity in `governance/service.ts`). Every standard has a real code path, not just a mention. | 18% | **18.0** |
| **P2** Clinical & Health Impact | **4** | The target population (high-risk complex patients driving ~50% of costs) and the intervention point (care coordination with AI-generated FHIR Tasks) are well-grounded. The eval harness measures sensitivity/specificity/PPV on 26 labeled patients with honest error analysis. Post-v3 eval results: Risk sensitivity 66.7% (1 FN on pop-0007, riskScore 92 — a regression from 100%), specificity 84.6% (improved from 69.2%); Care Gap sensitivity 100%, specificity 0% (1 FP on maria-chen); SDOH agreement 93.8%. Real per-patient cost: $0.3950. However: 0/26 clinician-validated labels, held-out set has 0 positive risk labels (sensitivity structurally N/A), Care Gap specificity rests on 1 negative example, SDOH has only 3 positive examples. The sensitivity regression on pop-0007 (a genuine 3-condition comorbidity + recent discharge patient) is a new concern — the deterministic clamp may be over-correcting. No pilot results, no clinician engagement. Architecture designed for impact; evidence is prototyped, not demonstrated. | 18% | **14.4** |
| **P3** AI/GenAI Innovation & Substance | **5** | Multi-agent orchestration with parallel dispatch (`orchestrator.ts` race-based merge of 3 concurrent async iterators) feeding a synthesis agent is genuinely novel. Citation enforcement is a real architectural innovation: structured-output function tools constrain the model to cite `ResourceType/id`, `citationValidator.ts` validates every citation against the bundle's `validIds` set, hallucinated citations are dropped, and free-text narration is redacted via a streaming `NarrationBuffer` with 96-char lookahead. The deterministic `clampRiskLevel` safety net is a non-trivial hybrid AI/deterministic design. The v3 risk rubric (3 calibration anchors, 2 hard rules, 5 worked examples with actual seed-text bundle shapes) is itself an LLM prompt-engineering artifact mapping clinical priors onto the in-app risk enum. Per-finding confidence scoring is deterministic and auditable (not model self-report). S18 WSA adds real cost capture with per-token pricing (`pricing.ts`, `usage.ts`). | 18% | **18.0** |
| **P4** Trust, Safety, Governance & Explainability | **4** | Strong safety-by-design: citation validation (GD11), narration redaction, role-based scopes with denial audit, SMART per-route scope enforcement with RS256 JWKS support, deterministic risk-level clamping, per-finding confidence scoring (bundle-evidence heuristic, not model self-report), demographic parity computed from real FHIR US Core race/ethnicity extensions (`governance/service.ts:getParityMetrics`), audit trail persisted in SQLite, model performance monitoring with confidence distribution. However: no model card, no named regulatory pathway (NIST AI RMF / FDA pathway), no bias mitigation beyond measurement (parity is computed but no mitigation action is taken on observed disparities), 0/26 clinician-validated labels. The confidence scorer is deterministic and auditable but is a heuristic, not a calibrated probability. The sensitivity regression (pop-0007 FN) suggests the clamp may be suppressing genuine high-risk findings — a safety net that under-calls is itself a safety concern. | 13% | **10.4** |
| **P5** Transformative Vision & Ambition | **5** | Restructuring care coordination around AI agents that reason over a patient's full FHIR record and deliver actionable FHIR Tasks (not passive alerts) is a genuine paradigm shift. The multi-agent decomposition mirrors clinical team structure (risk scorer, care gap detector, SDOH screener, action planner). CDS Hooks integration embeds findings in the EHR workflow. Mobile coordinator app extends the reach. The vision is ambitious but anchored — it doesn't claim to replace clinical judgment, and the architecture is built, not slideware. The S17 production hardening PRD shows a credible path forward (Keycloak, rebuilt HAPI, PostgreSQL, route-level scopes). | 12% | **12.0** |
| **P6** Proof, Demonstration & Evaluation Design | **4** | The eval harness is real and committed: `computeMetrics.ts` computes sensitivity/specificity/PPV with honest null-on-zero-denominator behavior; `errorAnalysis.ts` extracts per-patient FPs/FNs with label notes; `labels.json` has 26 patients with documented labeling rules, limitations, and held-out rows; `varianceProbe.ts` characterizes LLM output stability (81.25% per-patient agreement); `pricing.ts` + `usage.ts` produce real per-patient cost numbers ($0.3950/patient avg, $8.69/22-patient cohort). Post-v3 results: Risk dev specificity 84.6% (2 FPs), sensitivity 66.7% (1 FN); held-out specificity 100% (0 FPs), sensitivity N/A (0 positives). Care Gap dev specificity 0% (1 FP), sensitivity 100%. SDOH agreement 93.8% (1 FN). However: all labels are dev-labeled (0 clinician-validated), held-out sensitivity is structurally undefined, Care Gap specificity rests on 1 negative example (and is 0%), SDOH has only 3 positive examples. The sensitivity regression (100% → 66.7%) is a new concern that the harness correctly surfaces but the team has not yet addressed. Clinician outreach pipeline exists but has sent 0 invitations. | 8% | **6.4** |
| **P7** Efficiency & Economic Soundness | **4** | Parallel agent dispatch minimizes wall-clock latency (3 agents concurrent, 1 sequential). Cache-first replay (`analysis_cache` in SQLite) eliminates redundant LLM calls on repeat views. `?live=1` forces fresh runs for judges. S18 WSA cost capture produces real numbers: $0.3950/patient avg, $8.69/22-patient live cohort, projected $395/1000-patient monthly cohort. Per-token pricing table in `pricing.ts` (gpt-5.5: $0.025/1k input, $0.10/1k output; gpt-5.5-mini seeded for S19 per-agent routing). However: 4 parallel LLM calls per patient has non-trivial cost; the `CostROI.tsx` page exists but is a shell-tier screen; no explicit ROI model beyond the submission doc's projected claims. | 5% | **4.0** |
| **P8** Experience — Clinician & Patient | **4** | CDS Hooks cards deliver findings inside the EHR UI (zero new app for clinicians). Mobile-responsive PWA for care coordinators (task queue + task detail with citations, patient phone, call action). PatientDetail page (62KB) has a canvas-based agent graph animation with SSE streaming (real-time reasoning visualization). Role-based UI guards (Social Worker denied clinical views, Director sees aggregate dashboards). 14 Playwright E2E specs covering agent-graph-cache, patient-analysis, coordinator-panel, director-governance, director-population, task-queue, task-detail, sdoh-referral, social-worker-denied, etc. However: no usability testing evidence, no clinician feedback on the UI, 15 screens without mockups are shell-tier (`ComingSoon.tsx`, `ShellScreenPage.tsx`). | 4% | **3.2** |
| **P9** Equity, Access & Scalability | **3** | SDOH screening agent (AHC-HRSN, LOINC 71802-3) and demographic parity metrics (by age/sex/race/ethnicity from real US Core extensions in `governance/service.ts`) directly address equity. FHIR portability means any CDS Hooks-compliant EHR qualifies. Social Worker role with SDOH-domain scope. However: no multilingual support, no offline/low-connectivity operation, parity is measured but no mitigation action is taken on observed disparities, the ~500-patient cohort is deterministic procedural data (not real Synthea — disclosed honestly in `labels.json._meta`), only 3 positive SDOH examples in eval data. | 4% | **2.4** |

**WEIGHTED TOTAL: 78.8 / 100**

> Calculation: 18.0 + 14.4 + 18.0 + 10.4 + 12.0 + 6.4 + 4.0 + 3.2 + 2.4 = **78.8**

---

## D. Tier 2 — AI-Leverage Multiplier

**M = 1.15** | **Mode: tie-breaker** | *Rationale: The multi-agent architecture with citation enforcement, structured-output function tools, streaming narration redaction, and deterministic risk-level clamping is not achievable without LLMs. The specialist sub-agent decomposition mirrors clinical team structure in a genuinely inventive way. The citation-validation architecture is specifically engineered around the LLM's confabulation failure mode — this is AI as the irreplaceable engine, not AI as a feature.*

**Multiplied score: 78.8 × 1.15 = 90.6 / 100**

---

## E. Band, Strongest Dimension, Biggest Risk/Gap

**Band:** **Finalist (85–100)** — the multiplied score of 90.6 places this in the Finalist band.

**Strongest dimension:** **P1 + P3** together — seven load-bearing HL7 standards feeding a genuinely inventive multi-agent AI architecture with citation enforcement. The citation-validation gate (structured output → `validIds` check → drop hallucinated → redact narration via 96-char lookahead `NarrationBuffer`) is a real architectural innovation specifically designed for the clinical LLM safety problem. The deterministic `clampRiskLevel` hybrid AI/deterministic design and the v3 risk rubric (3 anchors, 2 hard rules, 5 worked examples with actual seed-text patient IDs) are non-trivial prompt-engineering artifacts.

**Biggest risk/gap:** **P4 (Trust, Safety, Governance)** — four holdbacks:
1. **No model card / NIST AI RMF / named regulatory pathway.** The system has strong safety-by-design but no formal governance documentation.
2. **0/26 clinician-validated eval labels.** All ground truth is dev-labeled. The clinician outreach pipeline exists (`outreachSchema.ts`) and an email is drafted (`s18-clinician-engagement.md`) but 0 invitations have been sent. This caps P2 and P6 at 4.
3. **Parity measured, not mitigated.** Demographic parity is computed from real FHIR demographics but no action is taken on observed disparities — measurement without mitigation.
4. **Sensitivity regression from clamp.** The post-v3 eval shows Risk sensitivity dropped from 100% to 66.7% — pop-0007 (riskScore 92, 3-condition comorbidity + recent 60h discharge) was under-called as "moderate" by the deterministic clamp. A safety net that suppresses genuine high-risk findings is itself a safety concern. This is a new finding not present in previous evaluations.

Secondary risk: **P6 eval data thinness** — Care Gap specificity rests on 1 negative example (and is 0%), SDOH has only 3 positive examples, held-out risk sensitivity is structurally undefined (0 positive labels). The harness is well-designed; the data doesn't yet support its claims.

---

## F. Open Questions for the Team

1. **P4/P6:** The post-v3 eval shows Risk sensitivity dropped from 100% to 66.7% — pop-0007 (riskScore 92, 3-condition comorbidity + recent 60h discharge) was under-called as "moderate." Has the `clampRiskLevel` safety net been tested against true-positive 'high' cases to confirm it doesn't suppress genuine high-risk findings? What is the plan to address this regression?
2. **P4/P6:** Has the clinician outreach email in `s18-clinician-engagement.md` been sent to any clinician? The `clinician-outreach.json` schema exists with 0 invitations — what would it take to get even 1 clinician to review 5 labels?
3. **P4:** Is there a plan for a model card or NIST AI RMF alignment? The `confidenceScorer.ts` heuristic is deterministic and auditable — is this the basis for a model card, or will one be authored separately?
4. **P6:** The held-out set (pop-0011..pop-0020) has 0 patients with `riskScoreFor() ≥ 75`, making held-out sensitivity structurally undefined. Will the threshold be lowered or the generator extended to include more 3-condition patients in the held-out range?
5. **P6:** Care Gap specificity is 0% (1 FP on maria-chen). Are there plans to seed more patients with matching Observations to create additional true-negative cases?
6. **P4:** Demographic parity is computed and displayed on the Governance page — is there a defined mitigation action when a disparity is observed, or is parity measurement the end state?
7. **P1:** The SMART token is minted, exchanged, cached, and attached to every HAPI call, but HAPI itself doesn't validate it (stock Docker image limitation). Is there a plan to deploy a custom HAPI build with a bearer-token interceptor, or is the app-tier enforcement (`smartAuth.ts`) considered sufficient for the POC?
8. **P9:** Is multilingual support planned for the SDOH screening or the coordinator UI? The AHC-HRSN screening is English-only in the seed data.

---

## G. One-Line Verdict

**Finalist** (78.8 weighted × 1.15 multiplier = 90.6/100) — a genuinely inventive multi-agent FHIR architecture with real citation enforcement, seven load-bearing HL7 standards, honest eval harness with real cost capture, and transparent POC-scoped staging, held back from the top of the band by absent clinician validation (0/26), no model card, thin eval data, and a new sensitivity regression (66.7%, pop-0007 FN) that suggests the deterministic clamp may be over-correcting.

---

## Anti-Gaming Watch-List Assessment

| Flag | Status | Evidence |
|------|--------|----------|
| GenAI-washing | **CLEAR** | Four real LLM agents on gpt-5.5 via Responses API with structured output. Mock fallback is explicitly labeled `[demo fallback — OPENAI_API_KEY is unset]`. No scripted AI. |
| FHIR-shaped-not-FHIR-native | **CLEAR** | Real HAPI FHIR R4 in Docker. Real reads/writes (`fhir/client.ts` 52KB). Real Subscription rest-hook with `payload: 'application/fhir+json'`. Real SMART token exchange (RS256 JWT, RFC 7523). |
| Vaporware | **CLEAR** | Full-stack monorepo with working code, 20+ test files, 14 E2E specs, eval harness with real metrics. No unbacked architecture surfaces. |
| Benchmark cherry-picking | **WATCH** | Held-out set has 0 positive risk labels (sensitivity N/A). Care Gap specificity rests on 1 negative example (and is 0%). SDOH has only 3 positive examples. The eval data structurally favors specificity metrics. The sensitivity regression (66.7%) is honestly reported but not yet addressed. |
| Hallucination hand-waving | **CLEAR** | Citation validator (`citationValidator.ts`) is real, tested code. `validateCitations` checks against `validIds` Set. `redactUnvalidatedCitations` + `NarrationBuffer` with 96-char lookahead redacts free-text mentions. Hallucinated citations are dropped before reaching client or HAPI. |

---

## Evidence Index (all claims grounded in source)

- **FHIR R4:** `apps/api/src/fhir/client.ts` — `FhirReadService` class, `getPatientBundle` ($everything), `getConditions`, `getTasks`, `replacePatientTasks`, `getPatientDemographics` (US Core race/ethnicity extensions)
- **SMART Backend Services:** `apps/api/src/smart/assertion.ts` (RS256 JWT assertion), `smart/tokenServer.ts` (RFC 7523 token exchange, multi-client scope validation), `smart/tokenClient.ts` (cached Bearer), `middleware/smartAuth.ts` (per-route scope enforcement, RS256 JWKS + HS256 dual mode)
- **CDS Hooks:** `apps/api/src/routes/cdsHooks.ts` — discovery endpoint, patient-view service, `cdsCardMapping.ts`
- **FHIR Subscription:** `apps/api/src/fhir/subscription.ts` — `ensureTaskSubscription` (rest-hook, `payload: 'application/fhir+json'`), `routes/events.ts` — `createSubscriptionWebhookRouter` (webhook → SSE relay)
- **Multi-agent orchestration:** `apps/api/src/agents/orchestrator.ts` — race-based merge of 3 concurrent async iterators, then ActionPlanner
- **Citation enforcement (GD11):** `apps/api/src/agents/citationValidator.ts` — `validateCitations`, `validateCitationList`, `redactUnvalidatedCitations`, `createNarrationBuffer` (96-char lookahead)
- **Confidence scoring:** `apps/api/src/agents/confidenceScorer.ts` — `scoreRiskFlag`, `scoreCareGap`, `scoreSdohBarrier`, `deriveActionPlannerTaskConfidence`, `clampRiskLevel` (deterministic post-hoc risk-level clamp)
- **Risk agent v3 rubric:** `apps/api/src/agents/riskAgent.ts:97-201` — 3 calibration anchors, 2 hard rules, 5 worked examples with seed-text patient IDs
- **Cost capture:** `apps/api/src/agents/pricing.ts` (per-token rate table), `apps/api/src/agents/usage.ts` (token usage extraction)
- **Eval harness:** `apps/api/src/eval/computeMetrics.ts` (sensitivity/specificity/PPV with null-on-zero-denominator), `eval/errorAnalysis.ts` (per-patient FP/FN extraction), `eval/varianceProbe.ts` (LLM output stability), `eval/outreachSchema.ts` (clinician outreach schema), `data/eval/labels.json` (26 patients, 16 dev-labeled + 10 held-out)
- **Governance:** `apps/api/src/governance/service.ts` — `getAuditTrail`, `getModelPerformance` (confidence distribution), `getParityMetrics` (demographic parity from real FHIR US Core extensions), `getEvalSummary`
- **Role-based access:** `apps/api/src/auth/scopes.ts` — `hasScope(role, domain)`, `apps/api/src/fhir/client.ts:guard()` — denial audit logging
- **Honest staging:** `plan.md` §3 Standards conformance matrix, `routes/events.ts` (webhook not auth'd), `labels.json._meta` (procedural patients substitute for real Synthea)
- **E2E tests:** `apps/web/e2e/` — 14 Playwright specs
- **Frontend pages:** `apps/web/src/pages/` — 40 files including Population, PatientDetail (62KB, canvas agent graph + SSE), Governance, TaskManagement, TaskQueue, TaskDetail, Sdoh, Quality, CostROI, Login
- **Eval report:** `docs/eval-report.md` — post-v3 results with cost capture, generated 2026-07-10T06:11:24Z
- **Submission document:** `docs/SUBMISSION.md` — 240 lines, honest POC framing
