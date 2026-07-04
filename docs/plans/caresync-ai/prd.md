# PRD — CareSync AI: Multi-Agent FHIR Care Orchestrator

> **PLAN_ID:** `caresync-ai`
> **Status:** Ready for planning (ADLC: specify → plan)
> **Author:** Manjula / Bitcot · 2026-07-04
> **Upstream artifacts:** `plan.md` (grilling decisions GD1–GD13), `HANDOFF.md`, `reference-materials/` (6 HTML mockups + HL7 Challenge Brief)
> **Tracker note:** This POC is Jira-free and file-backed (per `CLAUDE.md`). No issue-tracker publish and no triage labels applied — this file is the artifact.

---

## Problem Statement

Care teams managing high-risk patients are drowning. The top ~5% of complex
patients (diabetes + CHF + depression comorbidities) drive ~50% of healthcare
cost, yet a Care Coordinator sees each as a row in a spreadsheet. A patient like
Maria Chen — 68, diabetic, congestive heart failure, discharged 48 hours ago —
has an overdue cardiology follow-up, an overdue depression screen, a
transportation barrier, and food insecurity, all buried across dozens of FHIR
resources that no human has time to reconcile before she is readmitted.

Three roles feel this differently:
- A **Care Management Director** cannot see, across 500+ patients, who is about
  to enter the critical zone, what it will cost, or whether the team can absorb
  the work.
- A **Care Coordinator** must manually piece together risk, gaps, and social
  barriers for each patient, then create and track the resulting work.
- A **Social Worker** in the field has no prioritized, role-filtered queue of
  the social-determinant interventions that are theirs to action.

Existing AI tools make this worse, not better: clinicians have been burned by
systems that hallucinate, cite nothing, and cannot be audited — so no Chief
Digital Officer will trust an AI recommendation they cannot trace to source data.

## Solution

CareSync AI is a multi-agent system in which four specialist AI agents — **Risk**,
**Care Gap**, **SDOH**, and **Action Planner** — each reason over a patient's full
FHIR R4 bundle and coordinate through an **Orchestrator** to produce a prioritized,
citation-backed action plan. Every finding cites the exact FHIR resource ID that
produced it, and the system rejects any citation not present in the retrieved
bundle — so a recommendation can always be traced to source data and never to a
hallucination.

The output is delivered three ways, each on a real HL7 standard: as **FHIR Tasks**
routed to the care team, as **CDS Hooks** cards for the EHR workflow, and as
real-time **FHIR Subscription** push to a role-filtered mobile queue. The three
roles meet the system where they work:
- The **Director** opens a Population Dashboard showing 500+ patients as a risk
  scatter, the critical zone, team workload, quality/HEDIS incentive dollars at
  stake, and cost avoidance — then assigns work.
- The **Coordinator** drills into a patient, runs the four-agent analysis live,
  watches findings stream in, and sees FHIR Tasks materialize with their evidence.
- The **Social Worker** works an SDOH-filtered mobile queue, actions community
  referrals, and closes tasks that sync back to the Director's dashboard.

An **AI Governance** view makes the system trustworthy by design: model version,
confidence distribution, demographic parity computed from real data, a live audit
trail of every FHIR read/write, and an evaluation report with sensitivity /
specificity against labeled ground truth.

## User Stories

**Care Management Director (web)**
1. As a Director, I want to log in and land on the Population Dashboard, so that I start with population-scale context rather than one patient.
2. As a Director, I want to see all high-risk patients as a risk scatter plot (risk score × urgency), so that I can grasp the whole panel at a glance.
3. As a Director, I want a "critical zone" count with a projected cost-avoidance figure, so that I can quantify the stakes of acting now.
4. As a Director, I want to drill from a cluster into a filtered patient list and then a single patient, so that I can move from population to individual seamlessly.
5. As a Director, I want to review a patient's AI analysis summary, so that I understand why a patient is flagged before I route work.
6. As a Director, I want to assign a patient's tasks to a specific Care Coordinator, so that work is routed to the right owner.
7. As a Director, I want the cost-avoidance number to update when work is assigned and completed, so that I can see the program's financial impact accrue.
8. As a Director, I want a team performance view (coordinator workload, completion rates, panel assignments), so that I can balance load and spot bottlenecks.
9. As a Director, I want a quality/HEDIS view showing measure progress and the incentive dollars at stake by deadline, so that clinical and financial risk are visible together.
10. As a Director, I want a cost & ROI view (readmission reduction, efficiency), so that I can defend the program to the CFO and board.

**AI trust & governance (Director / all)**
11. As a Director, I want every AI recommendation to cite the exact FHIR resource IDs that drove it, so that I can trust and audit it.
12. As a Director, I want to see the model version and timestamp for each analysis, so that I have provenance for governance.
13. As a Director, I want a confidence distribution across the analyzed cohort, so that I understand where the AI is and isn't certain.
14. As a Director, I want demographic parity metrics (risk scores broken down by age/sex/race/ethnicity), so that I can check the stratifier for bias.
15. As a Director, I want a live audit trail of every FHIR read/write with timestamp and user, so that the system is defensibly compliant.
16. As a Director, I want to see an evaluation report (sensitivity/specificity vs. labeled ground truth), so that I have evidence the agents are actually correct.

**Care Coordinator (web + mobile)**
17. As a Coordinator, I want to log in and land on my patient panel, so that I see my assigned patients and daily priorities first.
18. As a Coordinator, I want to be notified when a Director assigns me a patient, so that I know what is newly mine.
19. As a Coordinator, I want to open a patient and run the full four-agent analysis on demand, so that I get a current, comprehensive read.
20. As a Coordinator, I want to watch each agent's findings stream in real time, so that the analysis feels transparent rather than a black box.
21. As a Coordinator, I want the four agents dispatched in parallel from a visible orchestrator, so that I can see the system working like a care team.
22. As a Coordinator, I want FHIR Tasks created automatically from the analysis, each citing its source resource, so that I know what to do and why.
23. As a Coordinator, I want to re-run an analysis, so that I can refresh after new data arrives.
24. As a Coordinator, I want a task management queue with priority sorting and due dates, so that I can work the highest-impact items first.
25. As a Coordinator, I want to complete a task on mobile and have it sync back to web, so that field work updates the record of truth.
26. As a Coordinator, I want to build/update a FHIR CarePlan with goals and interventions, so that the plan reflects the agent findings.

**Social Worker (mobile)**
27. As a Social Worker, I want to log in and see only SDOH-domain tasks, so that my queue is relevant to my role.
28. As a Social Worker, I want to open a task and see the patient context that justifies it, so that I understand the intervention before I act.
29. As a Social Worker, I want to call the patient from the task, so that I can act without leaving the app.
30. As a Social Worker, I want a community resource directory by category (transportation, food, housing, mental health), so that I can match a barrier to a referral.
31. As a Social Worker, I want to mark an intervention done (e.g., transportation arranged), so that the task closes and syncs back to the Director.
32. As a Social Worker, I want new tasks pushed to me in real time, so that urgent social needs reach me immediately.

**Cross-cutting**
33. As any user, I want the system to detect my role from my credentials and route me to the right home screen, so that I never pick a role manually.
34. As any user, I want every API call scoped to my role's FHIR permissions, so that I only see data I am authorized to see.
35. As a clinician using an EHR, I want CareSync findings surfaced as CDS Hooks cards, so that I get recommendations inside my existing workflow.
36. As an operator, I want the agents backed by real FHIR data in a HAPI server, so that the demo reflects a real integration, not a mock.
37. As a demo presenter, I want a cached prior analysis to replay instantly while still being able to trigger a fresh live run, so that the demo is reliable without faking the AI.

## Implementation Decisions

**Topology (GD1).** A monorepo: a React web client (`apps/web`) and an Express/TS
API (`apps/api`), a HAPI FHIR R4 server in Docker as the data backbone, and SQLite
for users/sessions/audit/analysis-cache. Each agent is a self-contained service to
allow later microservice extraction without business-logic changes.

**Roles & routing (GD5).** Three roles (Director, Coordinator, Social Worker),
one web app and one mobile app with role-based filtering. Role is provisioned by
admin, encoded in an app JWT at login, and drives home-screen routing and the FHIR
scope set the API issues. No manual role-selection screen.

**Authentication (GD5).** Users authenticate with email/password → app JWT carrying
role. The API holds a **SMART on FHIR Backend Services** client (client-credentials,
signed JWT assertion) to read/write HAPI with system scopes; the user's role
determines which FHIR queries/scopes the API issues on their behalf. Per-user SMART
EHR/standalone launch is envisioned, not built.

**Agent orchestration (GD2/GD11/GD13).** An Orchestrator dispatches four specialist
agents in parallel over the patient's FHIR bundle, streaming findings to the client
over SSE. Agents run on **OpenAI `gpt-5.5`** (via the `openai` SDK Responses API)
with structured output — provider **revised 2026-07-04** (see `plan.md` GD13;
originally Claude Sonnet 5). The agent I/O contracts:

- Risk: bundle (Condition, Observation, MedicationRequest, Encounter) →
  `{ riskScore, riskLevel, flags: [{type, finding, fhirResourceId, severity}], readmissionProbability }`
- Care Gap: bundle (Condition, Encounter, Observation — no `CarePlan` is seeded, **revised 2026-07-05** per S1's actual data model) →
  `{ gaps: [{gapType, description, lastDone, dueDate, urgency, fhirResourceId}] }`
- SDOH: (AHC-HRSN screening, seeded as an `Observation` rather than a `QuestionnaireResponse` — **revised 2026-07-05**; plus demographics) →
  `{ barriers: [{domain, finding, severity, fhirResourceId}], referralsNeeded: string[] }`
- Action Planner: all three agent outputs →
  `{ tasks: [{title, description, priority, assignTo, dueInDays, fhirResources}] }`

**Citation enforcement (GD11).** Every `fhirResourceId` / `fhirResources` value an
agent emits is validated against the set of resource IDs actually present in the
retrieved bundle. Any citation not in the bundle is dropped/flagged before the
finding reaches the UI or becomes a Task. This is the core safety guarantee.

**Analysis caching (GD2).** The last successful analysis per patient is persisted.
Demo mode replays it deterministically; an explicit "live" trigger forces a fresh
model run and re-caches. A pre-recorded video is the out-of-band fallback.

**FHIR data (GD3).** Maria Chen plus 1–2 backup hero patients are hand-authored as
controlled FHIR R4 bundles (exact labs/conditions/SDOH); ~500 Synthea patients
(diabetes + CHF + depression) supply the population. Both are bulk-imported into the
same HAPI server so all reads are real FHIR.

**Task delivery & real-time (GD6/GD7).** Action Planner output becomes **FHIR Task**
resources with role-filtered queues. A real **FHIR Subscription** (HAPI rest-hook on
Task create/update) calls an API webhook, which relays to clients over SSE/websocket.
A minimal real **CDS Hooks** patient-view service returns findings as cards,
demoable via the public CDS Hooks sandbox.

**Governance & parity (GD12).** Demographic parity metrics are computed from real
Synthea demographics (age/sex/race/ethnicity), not static. The audit service logs
every FHIR read/write and every recommendation with its evidence chain.

**Screen scope (GD9/GD10).** Build to three screen tiers: six demo-critical screens
fully functional (W02 Population, W03 Patient+Agent, W06 Governance, W12 Patient
Panel, M02 Task Queue, M03 Task Detail); seven supporting screens designed/partial;
the rest navigation-only shells. The six existing HTML mockups are ported faithfully
to React, preserving design tokens and the Canvas agent-graph animation; screens
without mockups are built to the same design system.

**Mobile stack (GD4 — OPEN).** Web is built first. The mobile stack (PWA/responsive
web — recommended — vs. React Native) must be decided before the mobile task-queue
work begins, because M02/M03 are demo-critical and Flow 3 is mobile-only.

## Testing Decisions

**What makes a good test here:** assert observable behavior at a seam, never
implementation detail. A test should survive a refactor of the module's internals.
Prefer the fewest, highest seams; every test named below runs against real
dependencies (test HAPI + seeded data) rather than mocks, except where a pure
function makes a mock unnecessary.

**Seam 1 — HTTP API boundary (Jest + Supertest).** The primary seam. Drives real
endpoints against a test HAPI with seeded users and the curated hero bundles. Covers:
- auth + role scoping (a Social Worker token cannot read non-SDOH resources);
- population/quality/audit aggregates return expected shapes over seeded data;
- `POST /analysis/:patientId/run` → orchestration produces findings whose citations
  all resolve in the bundle; Tasks are created and role-filtered;
- Task status transitions (complete/defer/escalate) and Director assignment.

**Seam 2 — Citation validator (pure function, Vitest/Jest).** `(bundle, rawAgentOutput)
→ validatedFindings`. The one internal seam isolated on purpose: given an agent
output containing one in-bundle citation and one fabricated ID, the fabricated one is
dropped/flagged and the valid one passes. This directly tests the core safety claim
(GD11) without a live model call.

**Seam 3 — E2E UI (Playwright).** The three demo flows end-to-end against the running
stack: Director (login → population → drill into Maria → assign) ; Coordinator
(open patient → run analysis → findings stream → Tasks appear) ; Social Worker
(mobile queue → open task → mark done → syncs back). These are the acceptance tests
for the demo narrative.

**Seam 4 — Eval harness (`npm run eval`, asserted on a fixture).** `(labels, findings)
→ metrics`. Given a small labeled fixture, the harness computes sensitivity /
specificity / PPV for Care Gap + Risk and an agreement rate for SDOH, and emits the
report. Tested against a fixed label set with a known expected metric output.

**Prior art:** none in-repo (greenfield). Establish these four seams as the reference
patterns for all subsequent test work.

## Out of Scope

- Per-user SMART on FHIR EHR/standalone launch (OAuth authorization-code per user) —
  documented as envisioned; the API uses Backend Services instead.
- Ambient documentation / audio capture + ASR (HANDOFF Option D).
- Cross-IDN patient handoffs and network-level features.
- Production deployment, real PHI, hospital SSO/SAML (demo uses seed accounts).
- Clinician-validated eval labels — baseline ships dev-labeled (P6 ~4) with a
  structured slot to upgrade to clinician-validated (P6 5) if a clinician is found.
- Full functional depth on demo-supporting and shell-tier screens.
- Native mobile build until the GD4 stack decision is made.

## Further Notes

- **Honest staging (gate G4):** the standards-conformance matrix in `plan.md` §3 is
  the source of truth for built vs. envisioned; keep it current as work lands.
- **Rubric intent:** this build targets P4 → 5 (citation validation + computed parity
  + audit), P6 3 → 4 with a slot to 5 (eval harness + error analysis), and holds P1 at
  5 (five load-bearing standards). See `plan.md` §6.
- **Demo reliability** (GD2) is a first-class requirement, not polish: cache + live
  re-run + recorded fallback.
- **Design language:** clinical mission-control (dark, data-dense, no emoji, mono for
  FHIR IDs, persistent per-agent color identity). See HANDOFF §4.
- **Repo etiquette:** current branch is `feat/caveman-integration` (unrelated). Work
  should branch off `main` per `CLAUDE.md` before implementation begins.
