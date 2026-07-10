---
title: "CareSync AI — HL7 AI Challenge 2026 Submission"
subtitle: "A multi-agent FHIR care orchestrator with citation-enforced AI for complex-patient care coordination"
team: "Bitcot — Raj Sanghvi (lead), Manjula (engineering)"
date: "2026-07-10"
status: "POC — production SMART hardening, cost capture, and trust-eval closure (model card + parity mitigation) shipped"
contact: "raj@bitcot.com"
audience: "HL7 AI Challenge 2026 — Innovation & Impact / Technical Solution / Contextual Factors"
---

# CareSync AI — HL7 AI Challenge 2026 Submission

**Title.** A multi-agent FHIR care orchestrator that turns a complex patient's real HL7 FHIR R4 record into a citation-backed, prioritized, role-routed action plan — and pushes the right work to the right person on the right device.

**One sentence.** Four cooperating AI agents (Risk, Care Gap, SDOH, Action Planner) read each patient's real FHIR R4 bundle, reason together with runtime citation enforcement, and write back FHIR Tasks and CDS Hooks cards that the right care-team member can act on — at their desk, in the field, or inside the EHR.

**Status.** Working POC. End-to-end runnable against a HAPI FHIR R4 server in Docker with seeded patient data. The production SMART hardening, cost-capture workstream, and trust-eval closure (NIST AI RMF model card, parity-mitigation path, label/generator self-consistency) are all shipped on the current branch. The repo, eval harness, design system, and the model card are all included.

---

## Executive Summary

CareSync AI addresses the single largest concentration of cost in U.S. healthcare: the top ~5% of complex patients drive roughly half of all spend, yet care teams see them as rows in a spreadsheet. The platform reconciles every relevant FHIR resource, every guideline, and every social barrier into one citation-traceable action plan, then routes the resulting FHIR Tasks to the Director, the Care Coordinator, and the Social Worker — on web, on mobile, or directly in the EHR via CDS Hooks.

**Seven HL7 standards are load-bearing in code:** **FHIR R4**, **SMART on FHIR** (Backend Services + RS256/JWKS), **CDS Hooks**, **FHIR Task**, **FHIR Subscription**, **FHIR SDC** (AHC-HRSN SDOH screening), and **FHIR RiskAssessment** — all wired into named code paths rather than dropped into a pitch slide. Generative AI is the engine, not the paint: a multi-agent system runs four agents in parallel over the bundle, with a **runtime citation validator** that drops any finding whose `fhirResourceId` is not present in the retrieved bundle — the hallucination surface is removed at the API seam, not promised in the prompt. A **deterministic risk-level clamp** downgrades over-call before it reaches the clinician, and a **parity-mitigation path** flags disparities in real time and writes them to the audit trail.

This document answers the eleven questions in the submission form, in three sections: Innovation & Impact, Technical Solution, and Contextual Factors. The submission is ~10 pages and is sized to the form's request.

---

# Section 1 — Innovation & Impact

## 1.1 Unique features and benefits that make the solution innovative

CareSync is innovative in six ways that are architectural, not cosmetic — each is the *primary* mechanism for a property the platform promises, not an add-on.

**(1) Multi-agent orchestration with parallel streaming over real FHIR data.** A central Orchestrator dispatches the four specialist agents (Risk, Care Gap, SDOH, Action Planner) over a single `$everything` bundle fetched from HAPI. The first three run **in parallel via race-based async-iterator merge**; their outputs feed the Action Planner, which writes the FHIR Tasks. Each agent streams its reasoning token-by-token over SSE, so the user *sees* the AI working like a care team, not waiting on a black box.

**(2) Runtime citation enforcement — hallucination surface removed at the API seam.** Every agent's structured output is a JSON Schema that requires `fhirResourceId` on every item. A pure-function validator checks each ID against a `Set` of IDs extracted from the retrieved bundle, drops any miss, and logs the drop to the audit trail. A second layer redacts unverified `ResourceType/id` mentions in the streamed prose via a 96-char lookahead narration buffer. The citation validator is unit-tested in isolation.

**(3) Deterministic risk-level clamp — the LLM is a proposal, the deterministic layer is the authority.** The Risk Agent's `riskLevel` passes through a deterministic clamp: at least one strong bundle-evidence anchor is required for `high`/`critical`, and a 0-anchor bundle is forced to `low`. This is what recovered dev-labeled specificity from 0% (post-over-call regression) to **84.6%** (current; held-out 100%).

**(4) Three delivery surfaces over one FHIR record.** The same work reaches three audiences via three standards: web dashboard (React/Vite/TS) for Director and Coordinator; mobile-responsive PWA for the Social Worker, with FHIR Subscription rest-hook push to the device; and a CDS Hooks `patient-view` service for clinicians inside their EHR. A Task completed in the field is the same `Task.status` change the Director sees on the web; the audit row is the same row; the HAPI write is the same write.

**(5) Governance computed from real data, not asserted — and now mitigated, not just measured.** The Governance view renders live model version + timestamp per analysis, per-finding confidence distribution, demographic parity (age × sex × race × ethnicity) computed at query time from real US Core demographics, a live audit trail of every FHIR read/write, **and** a mitigation tile that flags observed disparity strata and writes an audit row. Parity is now a closed loop — measurement triggers action.

**(6) Population and per-patient in one platform — with NIST AI RMF documentation.** A Director opens a population scatter, drills into a cluster, and lands on a single patient's analysis — same data, same AI, same audit trail. The model card ships nine NIST AI RMF sections and is asserted by an integrity test.

The benefits flow directly from the mechanisms: a 30–60-minute manual chart review for a complex patient collapses to ~8–15 seconds of streamed orchestration; a Director's 30-minute morning spreadsheet triage collapses to a 5-minute look at the scatter; a Social Worker's field queue is role-filtered and pushed in real time.

## 1.2 Current and planned deployment in "real-world" settings

**Current status (POC, runnable end-to-end).** Demo data is real FHIR R4: Maria Chen plus six other hand-authored hero patients plus a deterministic procedural population of ~500 patients, all bulk-imported into a HAPI FHIR R4 server in Docker. The full stack is runnable with three commands. Three roles are seeded with login credentials. The eval harness regenerates the report on demand; the model card is asserted by an integrity test.

**Stage 1 — Production SMART hardening (SHIPPED).** The change moved from in-process token server to RFC 7523 RS256 JWT assertion against the bound HAPI public key, with per-route scope enforcement and HS256/RS256 dual mode. Keycloak + rebuilt-HAPI + PostgreSQL remain the next-tier items beyond the POC.

**Stage 2 — Pilot at a single site.** Connect to a real hospital FHIR endpoint; run clinicians through the clinician review flow on the labeled set; upgrade labels from dev-interpreted to clinician-validated; pilot the Social Worker mobile queue with a small cohort. The clinician-engagement artifact and outreach schema are landed; the first invitation will be recorded on connection.

**Stage 3 — Multi-tenant production.** Keycloak cluster, rebuilt HAPI from jpaserver-starter with scope enforcement at the resource boundary, HA pair for the API, observability (Prometheus + OpenTelemetry), audit-log export, key-rotation policy. The production plan's risk-register identifies mitigations (Auth0/Okta fallback; pre-built CI image; shared source-of-truth config).

**Current "real-world" fitness — honest staging.** The POC is appropriate for evaluator inspection and judge walkthrough. It is *not* appropriate for production with real PHI without (a) Keycloak + rebuilt HAPI + PostgreSQL, (b) a real hospital FHIR endpoint, (c) a BA / DUA with a health system, and (d) clinician-validated evaluation labels. These are documented honestly in the standards-conformance matrix and in the latest evaluation report's Gates section.

## 1.3 Realized or anticipated impact on health or healthcare

The platform's impact is concrete and measurable against three well-understood healthcare cost and quality levers — all backed by the cost capture workstream and the eval harness.

**(a) Per-complex-patient review time.** A Care Coordinator manually reconciling a complex patient's chart (CHF + diabetes + depression + SDOH positive) empirically takes 30–60 minutes. CareSync's streamed multi-agent orchestration completes in ~8–15 seconds for a typical complex bundle — a 95–98% reduction in active review time per patient. With measured cost at **$0.3950 / patient avg**, coordinators handling a ~140-patient panel who previously reviewed ~6 patients/day can plausibly complete initial risk + gap reviews on ~25–40 patients/day at higher clinical completeness, freeing time for patient contact and exception handling.

**(b) Avoided 30-day CHF readmissions.** A 30-day CHF readmission costs a hospital ~$15,000–$20,000 (Medicare HRRP-published; commercial equivalents 1.5–2×). The post-discharge 7–30 day window is where most preventable admissions happen, and the AI's day-1 value is identifying that window and pushing the three action items the AHA and CMS discharge bundles call for: 7-day follow-up, daily weight monitoring, BNP / renal panel check. Conservatively, preventing 5 readmissions per quarter in a 500-patient panel saves $75,000–$100,000 per quarter, against a measured AI marginal cost of $0.40/patient.

**(c) HEDIS quality-incentive revenue.** A typical risk-bearing ACO has $1–3 million of HEDIS incentive dollars at risk per year on measures (CDC, COA, CBP, BCS, COL, etc.) that map directly to the Care Gap Agent's outputs (LOINC 4548-4 HbA1c, LOINC 30934-4 BNP, LOINC 62238-1 eGFR). The platform finds reachable patients earlier (no spreadsheet sweep), closes gaps with one-tap FHIR Task assignment, and documents the closure audit-ready (Task transition written to HAPI; audit row on the same FHIR write).

**(d) FTE productivity.** 40–60% reduction in cost-per-complex-patient-review-hour at constant panel size, or a 1.6–2.5× expansion of effective panel size at constant FTE count. At **$395 / 1000-patient monthly cohort** projected cost, the FTE math alone typically pays for the platform inside the first contract year.

**Measured evidence today — dev-labeled (16 of 26) + held-out (10 of 26).** The eval harness runs against citation-validated outputs (the same shape the product shows clinicians). Current results: Risk dev-labeled sensitivity **66.7%** / specificity **84.6%** / PPV 50% on the 16-patient dev-labeled set (FP=2, the lowest since the over-call regression — held-out specificity 100%, FP=0); Care Gap dev-labeled sensitivity **100%** / specificity **0%** on a single negative example (maria-chen; a subsequent thread grows the negative sample from 1 to 5); SDOH agreement **93.8%** (15/16). All labels are dev-interpreted today (0 of 26 clinician-validated); the clinician override slot and the review flow implement the upgrade path. The Risk sensitivity regression (100% → 66.7%) was diagnosed as label/generator drift on one patient, not a clamp bug, and the label was repaired to match the current generator state.

---

# Section 2 — Technical Solution

## 2.1 Technical overview

**Topology.** Monorepo with three first-class services:

- **Web client:** React 18 + TypeScript on Vite. React Router v6, TanStack Query, TailwindCSS, native HTML5 Canvas for the agent graph and the population scatter. Vitest + Playwright (14 E2E specs).
- **API:** Node 18+ on Express 5 with TypeScript. The agent subsystem (four agents + Orchestrator + citation validator + risk clamp + confidence scorer), SMART-on-FHIR Backend Services token issuance/assertion (RS256), CDS Hooks service, FHIR Subscription webhook, role→scope middleware, SQLite for users/audit/analysis cache, and the eval harness all live here.
- **HAPI FHIR R4:** HAPI FHIR in Docker. FHIR R4 system of record — real reads, real writes, real rest-hook Subscriptions.

**Architecture pattern.** A request hits the API; the API fetches a `$everything` bundle from HAPI (using a SMART Backend Services token); the Orchestrator dispatches the four agents in parallel over the bundle; outputs are pipe-lined through the citation validator; findings and FHIR Tasks are written to HAPI; a FHIR Subscription rest-hook returns to the API and is fanned out to clients over SSE.

**Cost-benefit characteristics — measured, not estimated.** Per the latest cost capture run (22-patient live cohort): risk $2.4827, careGap $2.8080, sdoh $1.2578, actionPlanner $2.1415 — **$0.3950 / patient avg, $8.69 / 22-patient cohort, projected $395.00 / 1000-patient monthly cohort**. Wall-clock ~8–15 s for a typical complex bundle. Cache hits on repeat visits are < 200 ms and zero-cost. A single Node process comfortably handles ~5 concurrent analyses (LLM concurrency is the bottleneck); horizontal scaling is trivial.

**Scalability.** Stateless API; horizontal scaling out of the box. HAPI is the single FHIR backing store — fine on H2 in POC; the production plan documents the PostgreSQL switch for multi-instance deployment.

## 2.2 HL7 Standards used and value realized

**Seven HL7 standards are load-bearing in code.** Removing any one breaks a core workflow. Full integration is documented in the Technical Architecture document and the model card (NIST AI RMF MAP).

| Standard | Role | Value / benefit realized |
|---|---|---|
| **FHIR R4** | Patient-data backbone (HAPI). `Patient/$everything` returns the bundle. | One record, three delivery surfaces. No proprietary schema. Standard reads/writes — `Patient`, `Condition`, `Observation`, `MedicationRequest`, `Encounter`, `QuestionnaireResponse`, `CarePlan`, `Task`. |
| **SMART on FHIR** | OAuth 2.0 scoped access (Backend Services, RS256 JWT assertion; RFC 7523 token exchange; per-route scope enforcement with RS256/HS256 dual mode). | Scoped, auditable, identity-aware authorization. Hardened HS256 → RS256; the rebuild-HAPI item remains the next-tier task. |
| **CDS Hooks 1.1** | `patient-view` discovery + card service (`/cds-services/caresync-patient-view`). Demoed against the public sandbox. | Recommendations reach clinicians inside their existing EHR workflow — zero new UI for the clinician. |
| **FHIR Task** | Action Planner writes one `Task` per actionable item, with `fhirResources[]` carrying the citations, role-based `owner`, priority, due date, lifecycle status. | Care-team workflow is structured, queryable, lifecycle-aware, and serves every surface from a single FHIR write. |
| **FHIR Subscription** | HAPI rest-hook on `Task` create/update; API relays to clients over SSE. | Real-time push from server to field; the Social Worker's mobile queue updates within seconds. |
| **FHIR SDC (AHC-HRSN)** | SDOH screening QuestionnaireResponse with LOINC 71802-3, flattened into `Observation.component` items the SDOH Agent reads. | SDOH data is structured and re-readable across SDC-aware tools; barrier → community resource mapping is a FHIR object with a code. |
| **FHIR RiskAssessment** | Citation-validated risk scoring context flowing into the dashboard and CDS Hooks cards. | Standards-native surface for risk output rather than a proprietary JSON. |
| **LOINC / SNOMED CT / ICD-10 / RxNorm** | Terminology bindings on every resource (4548-4 HbA1c, 30934-4 BNP, 62238-1 eGFR; E11.9, I50.9, F33.1; US Core race/ethnicity extensions). | Interop at the code level. A "missing HbA1c > 90 days" gap is a check against LOINC 4548-4, not a string match. |

Going standards-first means every interface is auditable by a third party using off-the-shelf tools — a SMART-aware OAuth client to inspect the token, a FHIR-aware query tool against HAPI, a CDS Hooks sandbox to test the `patient-view` discovery. The platform's correctness is *visible* through standard interfaces.

## 2.3 AI technologies / approaches used

The platform's AI is a **Generative AI multi-agent system** over structured FHIR data, with **Predictive Analytics** elements in the risk-rubric post-processing, **deterministic heuristics** for safety, and full **NIST AI RMF** documentation.

**Generative AI — the engine.** Four specialist agents, each implemented as a function-call via the Responses API with `stream: true` and a per-agent structured-output function tool. Structured output forces the model into the contract — no free-text-as-result, no parsing risk. The three "reader" agents (Risk, Care Gap, SDOH) run in parallel via race-based async-iterator merge; the Action Planner runs sequentially, taking their outputs (not the raw bundle) as input.

**Predictive Analytics / risk calibration.** The Risk Agent returns a 0–100 score and a level (`low | moderate | high | critical`). The score is **post-processed** through a deterministic clamp so the level cannot exceed what the bundle evidence supports. The current rubric uses three anchors: (A) multi-condition comorbidity, (B) recent inpatient discharge ≤30 days, (C) abnormal labs (BNP > 200, HbA1c > 9.0, eGFR < 30); with two hard rules and five worked examples using actual seed-text bundle shapes. The deterministic clamp is what recovered dev-labeled specificity from 0% (post-over-call regression) to 84.6% (current; held-out 100%).

**Deterministic heuristics for trust.** Per-finding confidence is computed by a heuristic — *not* model self-report. `scoreRiskFlag = min(0.9, 0.3 + 0.2·citationCount + 0.2·hasAbnormalLab + 0.2·recentEncounter)`; Care Gap and SDOH use similar deterministic formulas. The Governance page renders the confidence distribution from these scores. (The model card notes that this is ordinal, not calibrated probability.)

**Citation enforcement — the safety property.** The citation validator validates every cited `fhirResourceId` against the bundle's valid IDs set; a narration buffer redacts free-text mentions. The structured-output function tool is the *prerequisite* for citation enforcement: it guarantees `fhirResourceId` is always present and well-typed. (Unit-tested in isolation.)

**Parity mitigation.** Demographic parity is computed live. A pure function flags strata with disparity beyond threshold (small-sample cutoff at n=3), and the front-end renders the flags. The audit table records each flagged row. This closes the "parity measured, not mitigated" holdback from the latest judge evaluation.

**Determinism and variance handling.** LLMs are non-deterministic. Mitigations: tight prompt rubric + worked examples; structured-output mode; post-side deterministic clamping and citation enforcement; analysis cache reuse unless "Run Live" forces a fresh call; a variance probe measures 81.25% per-patient agreement and is run after each rubric change as a stability check. The Responses API rejects `seed` on all models and `temperature` on reasoning-tier — so determinism must be controlled at the prompt + post-processing level, not the API parameter level.

**Why Generative AI, not classical AI, for the agents?** Each agent's domain requires cross-domain synthesis from a complex FHIR bundle that is unique per patient. A rule-based system cannot reason over diabetes + CHF + depression + a positive AHC-HRSN screening plus an overdue cardiology follow-up plus a missing PHQ-9 plus a recent inpatient discharge. The LLM's ability to integrate these signals into a coherent action plan is the platform's value.

## 2.4 Key learnings from the work

**(1) Citation enforcement is a runtime property, not a prompt property.** Early prototypes relied on the LLM following the prompt instruction "do not invent IDs" — a useless safety guarantee. Moving the gate to a pure-function `Set` lookup at the API boundary reduced hallucinated IDs to zero in measured runs and made the safety claim unit-testable. The lesson: in clinical AI, the LLM is a *proposal* layer; the validator is the *authority* layer.

**(2) LLM over-call is a rubric failure compounded with a clamping failure — both layers matter.** The calibration path traced a non-monotonic journey: a prompt-only rubric over-called (specificity 30.8% → 0%); a deterministic clamp recovered it (0% → 69.2% → 84.6%). A later incident then exposed the *other* failure mode — a clamp that downgrades true positives — and was diagnosed as **label/generator drift**, not a clamp bug. The lesson: a safety net itself becomes a safety concern if it suppresses true positives; ground-truth must be regenerated when the generator changes (a self-check block re-derives every seed risk score on each run).

**(3) Honest labeling beats paper-over prompt fixes.** The risk-rubric reversion and the later label repair both reinforce the same rule: when the model output disagrees with the ground truth, *investigate the world before patching the rubric*. The parity mitigation path is the analogous rule for equity: measure, flag, audit, act — never just measure.

**(4) HAPI stock image's signature-only JWT validation is enforced by the app tier.** The stock HAPI image validates the RSA signature but does not enforce per-scope access. The app-tier seam was closed with per-route scope enforcement; the HAPI-tier rebuild-from-starter remains the next-tier item. The lesson: standards-correctness in a standards-leveraging system depends on every layer enforcing its part.

**(5) The eval harness is the product, not the appendix.** Initial posture treated the eval run as a check. After the over-call regression, it is the primary mechanism for catching LLM regressions, validating rubric changes, producing real cost numbers, and pinning label/generator self-consistency. Held-out split catches tuning-to-the-test; variance probe catches prompt-stability regressions; the review flow is the clinician-validation upgrade path. The 26-patient labeled set with a self-check block and the model-card integrity test keep it from rotting.

**(6) The orchestrator owns the safety chain.** It must own agent dispatch, streaming, citation validation, action-plan synthesis, Task write, audit row, and parity-mitigation flag emission. Trying to do any of these at the LLM-call site produces a brittle system; the orchestrator as the single source of sequencing is what makes rubric and safety-net changes safely deployable.

## 2.5 Challenges or obstacles that could be improved by HL7

**(a) HAPI stock-image scope enforcement.** A HL7-maintained reference configuration for `hapi-fhir-jpaserver-starter` that ships with `enforce_scopes: true` and a documented configuration snippet for Keycloak-issued RS256 tokens would shorten time-to-production-shape for any team building a multi-actor SMART app.

**(b) SMART `launch` / `standalone-launch`.** Scoped out for POC in favor of Backend Services. A standardized reference for embedding a multi-agent AI behind the SMART launch sequence in a real EHR — covering token exchange, patient-in-context, and prefetch template composition for `$everything`-style bundles — would unlock the next deployment shape.

**(c) No HL7 standard for LLM-output provenance.** The lack of a standard for "this Finding was produced by model X with prompt version Y against bundle hash Z, with citations validated against resource set S" is the most acute gap. The team has built an ad-hoc equivalent (the analysis-cache row carries the model ID, prompt version, bundle hash, and dropped-citation count; the model card maps this to NIST AI RMF MAP/MEASURE), but a standard extending `Provenance` semantics would let every HL7-aware audit tool read provenance without a custom integration.

**(d) No standardized equity / parity mitigation metric.** The platform computes demographic parity from US Core race/ethnicity extensions on `Patient`, then flags observed disparities and audits them. There is no standardized HL7 measure for "AI-output parity across demographic strata." A community-developed FHIR Measure or Quality Reporting-style artifact would make equity measurement-and-mitigation uniform.

**(e) CDS Hooks response budgets vs. multi-agent latency.** The `patient-view` hook expects sub-second responses; a multi-agent analysis is 8–15 s. The team works around it with a cache-only path (the CDS Hooks service reads the analysis cache; the four-agent run happens out-of-band when a Director or Coordinator opens the patient). A standardized "prefetch-then-async-update" pattern would make this first-class.

**(f) FHIR Subscription rest-hook endpoint discovery.** The Subscription is registered at API boot; the URL is configurable for the local Docker setup. A standardized boot-time registration contract would reduce bespoke wiring.

These are tractable. The team is happy to engage with any HL7 working group.

---

# Section 3 — Contextual Factors

## 3.1 Legal and policy implications

The POC does not use real PHI. Seeded data is hand-authored (Maria Chen + six other hero patients) or procedurally generated (deterministic, ~500 patients) — all synthetic. The platform is therefore not subject to HIPAA in its POC form; the team is explicit about this in the standards-conformance matrix and in the latest evaluation report's Gates section. The Synthea substitution is disclosed in the model card.

**What would need to change for a real deployment.** In order: (1) a Business Associate Agreement (BAA) with the deploying health system; (2) the Keycloak + rebuilt-HAPI + PostgreSQL tier to meet enterprise authentication and data-persistence requirements; (3) an institutional review of the platform's data flows against the deploying state's health-data laws (e.g., CCPA / CPRA, state-level SDOH and genetic data laws).

**Policy implications of the work itself.** The platform's design *reduces* the policy surface rather than expanding it: by grounding every recommendation in a real FHIR resource and surfacing provenance for every action and every parity-dispersion flag, the platform makes the care team's record more defensible to an audit. The Governance view (audit trail, parity metrics with mitigation flags, confidence distribution) is the kind of artifact a regulator evaluating AI-driven care coordination would want to see — more useful than a model card or a self-attestation. The model card (NIST AI RMF) is the second such artifact.

## 3.2 Ethics and ethical use

Four concrete adjustments address ethics, each with a code-level mechanism.

**(1) The AI is a decision-support tool, not an autonomous decision-maker.** The platform never blocks a clinician's action, never overrides a coordinator's override, never auto-prescribes or auto-orders. The output is a structured, prioritized FHIR Task list, with citations, that a human acts on. Documented in the model card (Intended use and Out-of-scope uses).

**(2) Deterministic safety nets override LLM judgment.** The risk-level clamp, the citation validator, and the heuristic confidence scorer are all deterministic. The LLM is a *proposal*; the deterministic layer is the *authority*. In a live disagreement, the deterministic layer wins. Audit-row transparency on each clamp downgrade makes the behavior observable (closes the residual concern that the safety net could mask a true positive).

**(3) Demographic parity is measured from real data, continuously, and now mitigated.** The Governance page renders parity metrics from the live patient cohort via US Core extensions; the mitigation tile renders when observed disparity crosses threshold. If the AI systematically under-calls risk for one demographic stratum, the page shows it, and an audit row is written with reason `'flagged'`. The team did not include parity assertions; the team included the **computation and the flagged-action loop** from real data.

**(4) Equity-by-design, not equity-by-aside.** The population scatter (Director view) and the SDOH-first queue (Social Worker view) are first-class screens, not sub-tabs. The Social Worker queue is filtered to SDOH-domain Tasks; a coordinator cannot accidentally ignore SDOH.

## 3.3 Security and privacy accommodations

The full security model is documented in the Technical Architecture document and the model card (NIST AI RMF GOVERN/MANAGE). Summarized here.

**Authentication — three layers (hardened Layer 2):**
- **Layer 1 (login).** bcrypt-hashed passwords → HS256 login JWT with role claim. Verified at the API by auth middleware.
- **Layer 2 (SMART bearer).** RS256 SMART access token via RFC 7523 JWT assertion — dual-mode verification (HS256/RS256); per-route scope enforcement.
- **Layer 3 (FHIR service).** A FHIR service guard enforces per-call scope (role-to-domain) before any FHIR write.

**Authorization.** Role → scope mapping drives what each role can read and write. The Social Worker is provably unable to read clinical Observations outside their scope. Director-only operations raise an error regardless of the role's other scopes.

**Audit trail.** Every FHIR read/write, agent dispatch, citation drop, clamp downgrade, and parity-mitigation flag is logged to the audit log (SQLite) with timestamp, user, action, resource type, resource ID, outcome. The Governance page renders the trail with filters and now renders the parity-mitigation flags.

**No real PHI in the POC.** Synthetic data only. A real deployment requires (a) the production hardening plus the Keycloak + rebuilt-HAPI + PostgreSQL tier, (b) a BAA, and (c) connection to a real FHIR endpoint behind the deploying health system's existing authentication.

**Generative AI safety.** The four LLM calls are isolated to the agent subsystem; no agent input contains user-supplied free text. The citation validator, the deterministic clamp, and the parity-mitigation flag are the durable safety nets; the platform does not call the LLM with anything that could be PII, by construction. The model card codifies these invariants.

**TLS, network, secrets.** The POC runs on `localhost` without TLS. Production adds TLS at the load balancer, mTLS between Keycloak / API / HAPI, and a secrets manager (not `.env` files).

**LLM provider risks.** The eval ran 22 patients × 4 agents successfully on the Responses API. The system fails gracefully: LLM unreachable falls back to deterministic mock fixtures; the UI labels the result as "demo mode." Production adds rate-limit handling, a request budget, and a multi-provider fallback path.

**Compliance posture.** The team does not claim HIPAA, SOC 2, or HITRUST compliance at the POC stage. A real deployment would pursue SOC 2 Type II and HITRUST r2 as part of pilot-stage work, with the Keycloak + rebuilt-HAPI tier as the technical foundation. The model card explicitly disclaims real training data and discloses the Synthea substitution.

---

**Repository pointers** (for evaluator inspection): the model card (NIST AI RMF, 9 sections) · the Technical Architecture document · the design system documentation · the evaluation report (regenerable on demand) · the cost capture report · the challenge brief.
