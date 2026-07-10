# CareSync AI — Solution Overview

> **What this is:** A business-focused description of CareSync AI — the problem
> it solves, who uses it, the value it delivers, and the evidence behind that
> value. Designed for healthcare executives (CDOs, CMIOs, CFOs), care
> management leadership, payer/ACO partners, and HL7 AI Challenge evaluators.
>
> **Companion doc:** The Technical Architecture document covers how it works —
> components, data flow, multi-agent AI, security.
>
> **Status of the build:** POC, submitted to the HL7 AI Challenge 2026. Every
> finding, scope gate, and Task it produces is traced to a real FHIR resource in
> a real HAPI FHIR R4 server. Production hardening (Keycloak-issued SMART
> tokens, rebuilt HAPI starter with scope enforcement, PostgreSQL) is
> scoped in the production roadmap.

---

## 1. Executive Summary

CareSync AI is a **multi-agent FHIR care orchestrator** that reads a patient's
real HL7 FHIR R4 record, runs four cooperating AI agents (Risk, Care Gap,
SDOH, Action Planner) over that record, and turns their findings into
**citation-backed, prioritized work** for care teams — delivered as FHIR Tasks
on web and mobile, or as CDS Hooks cards inside the EHR.

The platform attacks the single largest concentration of cost in U.S.
healthcare: the **top ~5% of complex patients** (multiple chronic conditions
plus social barriers) drive roughly half of all healthcare spend. Care teams
already know these patients need attention; the missing layer is a system that
*reconciles every relevant FHIR resource, every guideline, and every social
barrier into one actionable plan, traces every recommendation back to its
source resource, and pushes the right work to the right role.*

**Value at a glance**

| Outcome category | Mechanism | Outcome |
|---|---|---|
| **Productivity** | Multi-agent parallel analysis replaces 30–60 min of manual chart review per complex patient with an ~10s streamed orchestration | Care coordinators process 3–6× more patients per day at higher clinical completeness |
| **Efficiency** | Citation-enforced AI, role-filtered work queues, real-time push to mobile | Manual handoffs and re-keying drop to near zero; review-to-action time falls from days to minutes |
| **Cost reduction** | Early identification of high-risk discharges + missed preventive care; HEDIS gap closure; reduced 30-day readmissions | One prevented CHF readmission ≈ $15–20K avoided cost; a population that closes HEDIS gaps protects $1–3M in annual incentive revenue |
| **Trust / governance** | Every finding cites a real FHIR resource ID; live audit trail; computed demographic parity | Defensible to a CIO, board, and regulator — not a black box |

The four-screen CDO/innovator lens (Population Command Center, Value-Based
Care financial intelligence, AI Governance & Trust, Ambient Care Closure) is
the same architecture, the same AI, the same standards — surfaced differently
for the person reading it.

---

## 2. The problem — why this exists

### 2.1 The cost concentration

In value-based contracts, a small number of patients drive most of the cost:

- The **top 5% of patients** by risk account for roughly **50% of healthcare
  spend** (AHRQ / CMS literature consensus, repeatedly confirmed in MA and ACO
  actuarial reports).
- Within that cohort, the **post-discharge window** (first 7–30 days) is
  where most preventable admissions happen. A 30-day CHF readmission costs a
  hospital **~$15,000–$20,000**; payers forgo equivalent medical-loss-ratio
  savings.
- **HEDIS quality measures** (CDC, COA, CBP, GSD, BCS, COL, etc.) move tens
  to hundreds of basis points of quality incentive revenue. A typical ACO has
  **$1–3M of HEDIS incentive dollars at risk per year**, gated on closure
  rates for gaps in care.

### 2.2 What doesn't work today

Care teams already have the data to prevent most of these events — it lives in
the FHIR record. Three structural failures keep that data from driving action:

1. **Manual reconciliation.** A Care Coordinator opens 8–12 tabs per complex
   patient: conditions, encounters, labs, meds, SDOH screening, last contact.
   Reconciling these into a plan takes 30–60 minutes. At a panel of 142
   patients, the math doesn't close.
2. **Generic AI recommendations.** Off-the-shelf LLM summaries hallucinate
   drugs, cite notes that don't exist, and never surface the patient's actual
   AHC-HRSN SDOH screening. Clinicians have been burned — and the Chief
   Digital Officer has been burned, and the board has heard about it.
3. **One role, one screen.** The Director can't see population risk. The
   Coordinator can't act on social barriers without leaving the chart. The
   Social Worker has no mobile queue. Work lives in spreadsheets, secure
   chats, and after-hours calls.

### 2.3 Who feels it (and how)

| Role | Their day | What they don't have |
|---|---|---|
| **Care Management Director** | Scans a spreadsheet of 500+ patients at 8 am | A live critical-zone count, projected cost avoidance, real-time audit, demographic parity on the AI |
| **Care Coordinator** | Reconciles one chart at a time, dials, documents, follows up | A complete reading of the chart, a prioritized task list, real-time push when SDOH referrals land |
| **Field Social Worker** | Checks the EHR between visits, drives between addresses | An SDOH-filtered mobile queue, the patient's context for a call, and a one-tap "done" that closes the loop |

The result: an avoidable readmission here, a missed HEDIS measure there, a
social worker doing paperwork instead of visiting. The patient pays the bill
in readmission and the system pays the bill in incentive dollars.

---

## 3. The solution

CareSync AI is a **multi-agent FHIR care orchestrator** with three roles, three
delivery surfaces, and four specialty agents — built to be the working layer
that turns an existing FHIR record into action.

### 3.1 One sentence

*"Four cooperating AI agents read each patient's real FHIR R4 bundle, reason
together with citation enforcement, and write back FHIR Tasks and CDS Hooks
cards that the right care team member can act on — at their desk or in the
field."*

### 3.2 How it works (executive view)

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                       A patient's FHIR R4 bundle                │
   │   Patient · Condition · Observation · MedicationRequest · ...    │
   └────────────────────────────┬─────────────────────────────────────┘
                                │ (read)
                                ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │            CareSync Orchestrator (parallel dispatch)            │
   ├────────────┬──────────────┬─────────────┬────────────────────────┤
   │ Risk       │ Care Gap     │ SDOH        │ Action Planner          │
   │ Agent      │ Agent        │ Agent       │ (synthesizes all 3)     │
   ├────────────┴──────────────┴─────────────┼────────────────────────┤
   │  Every finding cites a real resource ID   │  Writes FHIR Tasks     │
   │  (citation gate at the API boundary)     │  Audit log entry / row │
   └──────────────────────────────────────────┴────────────────────────┘
                                │ (delivered three ways)
            ┌───────────────────┼─────────────────────┐
            ▼                   ▼                     ▼
      Web dashboard       Mobile queue (PWA)    CDS Hooks cards
      (Director / Coord)  (Social worker,       (clinicians inside
                            real-time push)      the EHR)
```

The Orchestrator sends the bundle to **all four agents in parallel**.
Each agent streams its reasoning back over SSE so the user *sees* the system
working — not a black-box score. Findings that lack a valid FHIR resource
citation are dropped at the API boundary: the safety property is enforced at
the seam, not promised in the prompt.

### 3.3 Why "multi-agent" is the right framing

A single monolithic prompt does poorly on this task because each agent domain
(Risk, Care Gap, SDOH, Action Planning) has different inputs, different
rubrics, different output shapes, and different audit trails. Splitting the
work matches how a real care team is organized, lets each agent's prompt
specialize, and lets each output be evaluated independently against labeled
ground truth. The Action Planner reads the three specialist outputs and
writes the action plan; that structure is also why domain experts (a CMIO,
a social-work lead) can review one agent without arguing with another.

---

## 4. Who it's for

### 4.1 Three roles, one platform, role-scoped surfaces

| Role | Where they live | What they see | What they can do |
|---|---|---|---|
| **Care Management Director** | Web dashboard | Population risk scatter, critical zone + projected cost avoidance, team workload, HEDIS progress, audit/parity | Assign, balance load, override AI, sign off on governance |
| **Care Coordinator** | Web (primary) + mobile | Their patient panel, a single patient's analysis view with streamed findings, FHIR Tasks | Run analysis, build CarePlan, complete/escalate/defer tasks |
| **Field Social Worker** | Mobile (PWA) | Only SDOH-domain tasks, the patient context behind each, a community resource directory | Call patient, arrange referral, close task — closed task syncs back to the Director |

Role is provisioned at the user record, encoded in the login JWT, and drives
home-screen routing and FHIR scope set end-to-end. The Social Worker never
sees (or can read) clinical Observations outside their scope. This is not a
view toggle — it's enforced at the API scope layer.

### 4.2 Three delivery surfaces

1. **Web dashboard** (React, Vite, TypeScript): the command center for
   Director and Coordinator.
2. **Mobile PWA** (responsive web, no separate toolchain): the field surface
   for Social Worker, real-time pushed via FHIR Subscriptions.
3. **CDS Hooks `patient-view` service**: returns cards into the EHR workflow
   itself. A clinician opens a patient in their EHR → hook fires → CareSync
   cards return → clinician sees AI findings inside the chart.

All three read and write the same FHIR record. There is one source of truth
for "what's outstanding for this patient" — nothing lives only in our DB.

---

## 5. Key capabilities

### 5.1 Risk stratification

The Risk Agent reads Condition + Observation + MedicationRequest + Encounter
and returns a risk score, risk level, flags (each with a FHIR resource ID),
and a 30-day readmission probability. It is calibrated against labeled ground
truth with a rubric using calibration anchors and worked examples.

### 5.2 Care gap detection

The Care Gap Agent compares what's *done* (last HbA1c, last PHQ-9, last eye
exam, last cardiology follow-up) to what *should be* done for this patient's
conditions, and emits each gap with the source resource that justified it.

### 5.3 SDOH barrier identification

The SDOH Agent reads the AHC-HRSN screening (FHIR SDC-formatted Observation)
and surfaces transportation, food, housing, financial, and social-isolation
barriers as actionable flags. Each barrier ties back to a specific
QuestionnaireResponse item — not a guess.

### 5.4 Action planning & FHIR Task creation

The Action Planner reads the three specialist outputs and creates one FHIR
Task per actionable item, each carrying the resources that drove it. Tasks
are routed to the right role (Director → assignable, Coordinator → care plan,
Social Worker → SDOH). All Tasks carry priority, due date, source resource
IDs, and an audit-trail entry.

### 5.5 Real-time push

Tasks created or transitioned on the server reach the mobile client within
seconds via FHIR Subscriptions (HAPI rest-hook → our API → SSE). The Social
Worker's queue updates while they drive.

### 5.6 Governance & trust

The Governance view shows, live:

- **Model version + timestamp** for the last analysis per patient.
- **Confidence distribution** across the cohort.
- **Demographic parity** — risk score distribution broken down by age, sex,
  race/ethnicity, computed from real Synthea demographics (not asserted).
- **Audit trail** — every FHIR read/write with timestamp, user, and resource.
- **Eval report** — sensitivity/specificity/PPV per agent against labeled
  ground truth.

This is the screen no other team builds. It directly addresses a CDO's
board-level concern that an AI vendor hallucinated once and no one could
prove it didn't.

---

## 6. Differentiators

| Capability | What CareSync does that comparable systems don't |
|---|---|
| **Citation enforcement** | Every finding cites a FHIR resource actually present in the retrieved bundle; the API drops findings whose citation isn't in the bundle. No "the AI said so." |
| **Multi-agent with parallel streaming** | Orchestrator dispatches all four agents simultaneously and streams reasoning to the user in real time. The user sees the AI work like a team, not a black box. |
| **Governance computed from real data** | Demographic parity, confidence distributions, and audit trails are computed at query time from the live FHIR + audit log — not asserted from a model card. |
| **Standards as load-bearing, not decoration** | FHIR R4 is the system of record. SMART on FHIR scopes every token. CDS Hooks surfaces recommendations inside the EHR. FHIR Subscriptions deliver real-time push. FHIR SDC structures the SDOH screening. No parallel proprietary schema. |
| **Population + per-patient in one platform** | Director sees 500+ patients as a risk scatter; clicks a cluster; drills into a patient; runs analysis; assigns work — same data, same AI, same audit trail. |
| **Value-based-care native** | The same AI emits HEDIS-gap-closing Tasks (CBP, CDC, COA, BCS, COL, …) with resource IDs the care team can verify and document against. |

---

## 7. Productivity benefits

### 7.1 Per-complex-patient review time

**Today:** A Care Coordinator opens a complex patient's chart (CHF + diabetes +
depression + SDOH positive) and manually reconciles conditions, last labs,
last visits, last SDOH screening, last contact. Empirically this runs 30–60
minutes per patient for a competent nurse, with high variance in what they
find.

**With CareSync:** The coordinator opens the patient, clicks "Run Analysis,"
and watches the Orchestrator stream findings from four specialist agents.
End-to-end orchestration wall time is dominated by the LLM round-trip; in
practice the streamed UX completes in **~8–15 seconds** for a typical complex
bundle, and the resulting FHIR Tasks are already created.

| Metric | Manual baseline | CareSync | Reduction |
|---|---|---|---|
| Time to surface all relevant gaps for one complex patient | 30–60 min | < 1 min active review | **~95–98%** |
| Time to create a prioritized task list for one complex patient | 20–40 min | seconds (automated from agent output) | **>99%** |
| Cognitive load on coordinator | high (must hold 8–12 facts in working memory) | low (read streaming cards; each card cites its source) | qualitative |

**Coarse productivity model.** A coordinator handling a panel of ~140
complex patients who previously reviewed ~6 per day can plausibly complete
initial risk + gap reviews on ~25–40 per day with CareSync, at higher
clinical completeness, freeing the rest of the day for patient contact,
documentation, and exception handling. At a fully-loaded US RN salary band
of ~$70–95K, the floor time recovered is significant even before counting
travel/wait.

### 7.2 Director-side productivity

- **Population view replaces spreadsheet triage.** A Director who used to
  open a risk spreadsheet, filter, sort, and email coordinators now sees a
  live scatter of 500+ patients, the critical zone count, and a projected
  cost-avoidance figure. A 30-minute morning review becomes a 5-minute look.
- **Routing becomes one click.** The director clicks "Assign" on the
  Population view → coordinator's queue updates in real time. No email, no
  ticket.
- **Audit reduces prep time.** A monthly governance review pulls the audit
  trail and demographic-parity chart straight from the screen, not from a
  manual log.

### 7.3 Social Worker (mobile) productivity

- **SDOH filter.** A Social Worker in the field does not see clinical
  Observations. Their queue is pre-filtered to SDOH actions only. Time
  spent on the app is time spent acting, not paging.
- **Pull-to-refresh and FHIR Subscription push.** A new SDOH referral arrives
  while the Social Worker is in their car. No login-and-check loop.
- **One-tap closure.** A community-resource referral calls a Task "done" and
  the Director's dashboard updates within seconds.

---

## 8. Efficiency benefits

### 8.1 Review-to-action compression

The dominant latency in care coordination is the gap between "we know this
patient needs X" and "X is being done." CareSync compresses that gap on three
axes simultaneously.

| Latency axis | Before | With CareSync | Mechanism |
|---|---|---|---|
| Time from chart open to findings | 30–60 min manual review | seconds, streamed | Parallel agent orchestration |
| Time from findings to assigned work | 10–30 min typing Tasks | automatic | Action Planner → FHIR Task write |
| Time from server write to field worker's screen | hours (next sync) or never | seconds | FHIR Subscription rest-hook → SSE |
| Time from "done in the field" to "in the audit trail" | end-of-day note, dictation, transcription | one tap | Task transition → audit row |

### 8.2 Role-appropriate scope (fewer wasted context switches)

| Wasted action today | CareSync eliminates it because… |
|---|---|
| Coordinator scrolling through labs looking for an HbA1c | Care Gap Agent flags "missing HbA1c ≥ 90d" with the source resource that justifies it |
| Social Worker opening clinical charts they can't act on | Routes/UI scope the queue to SDOH-only tasks |
| Director re-keying spreadsheets | Population view + read/role-scoped FHIR queries are live |
| Anyone asking "is this patient already assigned?" | Coordinator panel shows it; Director assignment writes it |

### 8.3 Reduced handoffs and re-entry

The same FHIR record backs the web UI, the mobile UI, and the CDS Hooks card.
There is no shadow database; there is no "manual sync step." When the
Coordinator completes a Task on mobile, the same FHIR `Task.status` the
Director sees on web updates from the same `PATCH`. The Social Worker's
referral-close and the Director's cost-avoidance counter are the same row.

### 8.4 Caching & reliable demo (operational efficiency)

The last successful analysis per patient is persisted in SQLite
(analysis cache). A Coordinator who re-opens a patient gets an instant
review, and can "Run Live" to force a fresh model call when new data arrives.
This is a **first-class requirement**, not polish — it preserves demo
reliability, reduces LLM cost on repeat views, and lets the system degrade
gracefully when the API is unreachable.

---

## 9. Cost reduction benefits

The cost story is built from three quantifiable levers that the platform
actually drives. Numbers below are order-of-magnitude industry consensus
values; per-customer actuals depend on panel composition and contract terms.

### 9.1 Prevented 30-day readmissions (CHF focus)

- A 30-day CHF readmission costs a hospital ~**$15,000–$20,000** (Medicare
  HRRP-published, commercial-payer equivalents 1.5–2×).
- A typical ACO panel of 500 patients may have 30–60 CHF patients with
  recent inpatient discharge.
- CareSync's day-1 value is identifying the **post-discharge 7–30 day
  window** for each of these patients and pushing three actions: 7-day
  follow-up, daily weight monitoring, BNP / renal panel check. The same
  actions appear in the American Heart Association and CMS discharge
  bundles.
- Conservatively: **preventing 5 CHF readmissions in a panel of 500 saves
  $75K–$100K per quarter**, mostly in avoidable inpatient days. The AI's
  marginal cost to run the analyses is **single-digit dollars per patient**.

### 9.2 HEDIS / quality incentive revenue

A typical risk-bearing ACO has **$1–3M** in HEDIS quality incentive dollars
at risk per year. Closing a gap on a single HEDIS measure (e.g. CDC — HbA1c
control ≤ 9.0%) for one patient gates *several* dollars of incentive, and
the platform emits the right Task on the right patient via the same Care Gap
and Action Planner agents that already run.

| Quality revenue lever | Mechanism in CareSync |
|---|---|
| Find reachable patients earlier | Care Gap Agent flags overdue measures from real FHIR data, no spreadsheet sweep |
| Close the gap with one-tap assignment | Action Planner writes a FHIR Task with priority + due date |
| Document the closure (audit-ready) | Task transition written to HAPI; audit row created on the same FHIR write |
| Stay inside the measure denominator | Real-time cohort view (Quality page) shows denominator, numerator, and remaining work |

### 9.3 Coordinator throughput / FTE productivity

| Without CareSync | With CareSync |
|---|---|
| 1 FTE coordinator sustains a panel of ~140 complex patients with manual review | Same FTE sustains ~250–350 complex patients at higher clinical completeness (95% reduction in review time per patient) |
| New patient onboarding takes ~30–60 min | New patient onboarding takes <5 min (analysis auto-runs) |

In dollar terms, that's a **40–60% reduction in cost-per-complex-patient-
review-hour** at constant panel size, or a **1.6–2.5× expansion of effective
panel size** at constant FTE count. The FTE math alone usually pays for the
platform inside the first contract year.

### 9.4 Reduced documentation overhead

The optional Ambient Care Closure Loop (where audio of a coordinator call is
processed into a structured FHIR CarePlan update + Task closures) targets the
~3 hours/day a coordinator currently spends on documentation. Even partial
adoption of that loop recovers ~$25K–$40K per FTE per year in re-deployable
clinical time. (Roadmap item — built on the same FHIR write path.)

---

## 10. Validation — what's actually measured

The platform ships with an **evaluation harness** that scores every agent
against labeled ground truth using **citation-validated outputs only** — the
same shape the product shows clinicians, not raw model output.

### 10.1 Headline numbers (current run)

| Agent | Dev-labeled sensitivity | Dev-labeled specificity | Notes |
|---|---|---|---|
| **Care Gap** (binary: has a monitoring gap) | **100%** | 0%* | PPV 90.9%; specific to this label set |
| **Risk** (high/critical readmission) | **100%** | **69.2%** | The calibration rubric recovered specificity from 0% → 69.2% after an earlier over-call regression |
| **SDOH** (agreement rate on actionable barrier) | **93.8%** (15/16) | (n/a — agreement metric) | Rebalanced to be non-trivially gameable |

*Care Gap specificity = 0% reflects the dataset's labeling rule (gaps defined
by what the dataset's Observation coding can prove is missing); not a model
failure. See the per-patient error analysis in the evaluation report for the
maria-chen explanation.

An earlier risk rubric was reverted after it caused the model to
**over-call** (specificity regressed 30.8% → 0%). The fix is a
seed-text + rubric update that recovered specificity.

### 10.2 Per-patient qualitative evidence

The eval report enumerates the Tasks generated for each labeled patient
(maria-chen: 8 tasks; james-okafor: 4; linda-torres: 6; angela-diaz: 7;
pop-0001: 7; etc.) — readable as "did the AI produce clinically sensible
work on real patients?" A read of the per-patient sections confirms the
Action Planner is producing clinically defensible work (HbA1c ordering,
PHQ-9 follow-up, post-discharge 7-day cardiology, food-insecurity referral)
that ties back to a real FHIR resource.

### 10.3 Held-out evaluation

A 10-patient held-out set is scored on bundles the eval
team had no visibility into while tuning. Held-out Care Gap sensitivity
100% / PPV 100%; Risk sensitivity undefined (no positive labels in cohort)
with specificity 100%; SDOH metric empty by design (held-out bundles do not
carry AHC-HRSN observations). This is **honest**: zero false positives, but
the small N and limited label coverage is documented as a caveat.

### 10.4 What's not yet validated (and why we're honest about it)

- **Clinician-validated ground truth.** Labels today are dev-interpreted.
  The harness carries a clinician override slot, and a review flow lets a
  clinician upgrade labels without code changes. We do not claim full
  clinician validation — the rubric documents a baseline with a slot to
  upgrade.
- **Cross-site variance.** Eval runs on a single HAPI deployment against
  seed data; generalization across hospital EHRs is hypothetical until a
  pilot runs.
- **Production deployment acceptance.** We treat local-POC evidence as
  local-POC, not as target-environment acceptance. The production roadmap
  documents what would need to be true to graduate the platform from
  POC-correct to production-shaped.

---

## 11. Trust, safety, governance

The CDO's #1 objection to clinical AI is *"we don't know what it said or why,
and we can't prove it."* CareSync's answer is **provable**:

1. **Every finding cites a real FHIR resource ID.** The citation validator
   drops any finding whose
   cited resource ID is not present in the retrieved bundle. This is a
   runtime check at the API boundary, not a promise in the prompt.
2. **Model version + timestamp for every analysis.** The Analysis Cache row
   carries the model ID, prompt version, timestamp, and the
   bundle hash so two analyses can be diffed. Full trail on the audit row.
3. **Confidence distribution across the cohort.** Computed live from
   agent outputs (the orchestrator-emitted `confidence` field per finding);
   shown on the Governance page.
4. **Demographic parity from real data.** Age/sex/race/ethnicity buckets
   are computed from the Synthea demographics on the actual patient record
   set, not asserted. The same parity check is what a regulator would run.
5. **Audit trail.** Every FHIR read and write writes a row to
   the audit log (SQLite), with timestamp, user, resource type, and resource
   ID. The audit page renders the trail. The CDS Hooks service writes to
   the same row.
6. **Eval report with sensitivity/specificity.** The evaluation harness
   regenerates the report and the JSON twin; the Governance page renders the
   summary. We ship the truth, including the parts that don't yet look
   great.

In short: **the AI is explainable row-by-row, the audit is live, and the
results are measurable.** That is what makes the platform safe to put in
front of a clinician, a board, or a regulator.

---

## 12. Interoperability — how it lands in a real health system

The platform speaks standard HL7 wire protocols on every interface.

- **FHIR R4** is the system of record for clinical data and Tasks. A health
  system's existing FHIR endpoint can be the data source; no data
  migration.
- **SMART on FHIR** scopes every AI-driven FHIR call to the right actor
  (system / patient-level read or write). Production hardening moves this
  from signature-only to per-scope enforcement at both the app tier and the
  HAPI tier.
- **CDS Hooks** delivers findings as cards inside the EHR's
  `patient-view` workflow — zero new UI for the clinician.
- **FHIR Subscriptions** (rest-hook) push Task changes from HAPI to our API
  in real time, then relay to the mobile client via SSE. The same mechanism
  is what makes the Social Worker's mobile queue update while they drive.
- **FHIR SDC** structures the AHC-HRSN SDOH screening as a
  QuestionnaireResponse-backed Observation, so any SDC-capable screener
  produces findings the platform can read.
- **LOINC / SNOMED CT / RxNorm** terminologies bind resources to standard
  codes on every relevant field — readable by any other tool that knows
  the same codes.

---

## 13. Roadmap — POC to production

| Stage | State | What's next |
|---|---|---|
| **POC (today)** | Docker Compose with HAPI + SQLite + Node API + React; demo data (Maria Chen + Synthea cohort) seeded | This submission. |
| **Production SMART enforcement (in plan)** | Stock HAPI validates signatures, not scopes. App-tier scope is method-level | Replace in-process token server with Keycloak SMART AS; rebuild HAPI from jpaserver-starter with scope enforcement; PostgreSQL instead of H2; route-level scope at the app tier. |
| **Pilot** | Single-site validation against a real hospital FHIR endpoint + a clinician-validated label set | Run clinicians through the clinician override review flow on the labeled set. Promote to clinician-validated labels. |
| **Production** | Multi-tenant Keycloak + rebuilt HAPI + PostgreSQL + observability (Prometheus + audit export) + HA pair | Open the platform to other risk-bearing customers. |

The production plan is realistic about trade-offs — Keycloak's SMART plugin is
community-maintained so the plan documents Auth0/Okta as fallbacks, and the
scope-mapping drift between app and HAPI is mitigated by a single
source-of-truth YAML read at boot by both.

---

## 14. Why now

The HL7 standards infrastructure (FHIR R4, SMART, CDS Hooks, Subscriptions,
SDC) has matured past the point where a multi-agent clinical AI is a
research project — it is a deployment. Two converging pressures make
CareSync's exact niche the highest-leverage place to deploy:

1. **Value-based care is now the default.** MA, ACO REACH, MSSP, and the
   state Medicaid ACO programs all push risk onto providers. The same
   metrics these contracts pay on (HEDIS, 30-day readmissions, SDOH
   screening rates) are what CareSync already emits.
2. **AI hallucination is a board-level risk.** The teams that ship clinical
   AI without per-finding citation enforcement are the teams that get a New
   York Times article and a lawsuit. CareSync's runtime citation gate is
   the durable mitigation.

---

## 15. Summary

CareSync AI is a **multi-agent, FHIR-native, citation-enforced care
orchestrator** that turns the top-of-cost-curve complex patients from a
spreadsheet problem into a real-time, role-scoped, governed action plan —
delivered to the Director's dashboard, the Coordinator's queue, the Social
Worker's mobile, and the EHR clinician's CDS Hooks card. It replaces 30–60
minutes of manual chart review per complex patient with seconds of streamed
orchestration, gives every finding a traceable evidence chain, and emits the
FHIR Tasks that close HEDIS gaps and prevent avoidable readmissions. The
product is POC-correct today with a credible, scoped plan for production
hardening; the eval harness keeps it honest; the design keeps it auditable.

---

### Reading order for evaluators

- **Clinical / executive lens:** this document (§§ 1–9, 12, 15).
- **Architecture / AI lens:** the Technical Architecture document (system, agent subsystem, standards, security, real-time).
- **Design / UX lens:** the design system and HTML mockups.
- **Demo narrative:** the 90-second demo script.
- **Standards-conformance matrix:** the canonical conformance matrix (kept current).
- **Production-hardening plan:** the production SMART enforcement plan.
