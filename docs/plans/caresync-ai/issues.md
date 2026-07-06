# Issues — CareSync AI

> **PLAN_ID:** `caresync-ai`
> **Source:** `docs/plans/caresync-ai/prd.md` · `plan.md` (GD1–GD13)
> **Tracker note:** Jira-free, file-backed POC (per `CLAUDE.md`). These are vertical-slice tracer bullets, in dependency order. No tracker publish, no triage labels applied.
> **Critical path to a defensible submission:** S1 → S2 → S3 → S6/S8/S9.
> S5–S10 largely parallelize across developers once S3 lands. S12 hardens the demo last.

---

## S1 — Walking skeleton: log in, My Patient Panel, read a patient live from HAPI

### What to build
The thinnest end-to-end path that proves every layer connects. A Care Coordinator
logs in with a seed account (email/password → app JWT carrying role) and lands on
their **My Patient Panel** (W12) — their assigned patients with risk scores and task
counts — then opens the hero patient (Maria Chen) and sees her name and active
conditions, read live from HAPI FHIR via the API's SMART on FHIR Backend Services
client. This slice carries the enabling foundation for everything downstream:
monorepo scaffold, Docker HAPI, Synthea import (~500 patients), the hand-authored
Maria Chen bundle, JWT auth + role middleware, the SMART Backend Services client,
the audit-log spine that later slices write to, and the **frontend foundation**
(design tokens/system, app shell, React Router with role guards, Zustand store,
TanStack Query API client, canvas utility lib) that all UI slices build on. Role
determines both the landing screen and which FHIR scopes the API issues.

### Acceptance criteria
- [ ] `docker compose up` brings up HAPI FHIR R4; import loads ~500 Synthea patients + the curated Maria Chen bundle with exact labs/conditions/SDOH.
- [ ] Seed accounts exist for all three roles; login returns a JWT encoding the role.
- [ ] Role-based routing lands each role on its home screen (Coordinator → W12 My Patient Panel).
- [ ] W12 lists the Coordinator's assigned patients with risk scores and task counts, from `/patients/assigned`; clicking a patient drills into their detail view.
- [ ] The frontend foundation is in place: design tokens applied, app shell + routed views, role guards, shared store + API client.
- [ ] The API reads FHIR from HAPI via SMART Backend Services (client-credentials, signed JWT assertion) — not an open unauthenticated call.
- [ ] A Coordinator can open Maria and see her name + conditions sourced from a real HAPI read (visible in the network tab).
- [ ] A Social Worker token is scoped down and cannot read non-SDOH-domain resources it shouldn't.
- [ ] Every FHIR read/write is written to the audit log.
- [ ] API-boundary tests (Supertest against a test HAPI + seeded data) cover login, role scoping, the assigned-panel query, and the patient read.

### Blocked by
- None — can start immediately.

---

## S2 — Single-agent analysis with citation enforcement

### What to build
The core innovation, kept thin to one agent. On Maria's detail view, "Run Analysis"
starts an analysis that dispatches the **Risk agent** (live model call,
structured output — **OpenAI `gpt-5.5`**, revised 2026-07-04 from the original
Claude Sonnet 5 plan; see `plan.md` GD13) over her FHIR bundle. Its findings stream
to a single feed box over SSE, word-by-word. Every `fhirResourceId` the agent emits
is validated against the resource IDs actually present in the retrieved bundle; any
citation not in the bundle is dropped/flagged before it reaches the UI. This
establishes the SSE stream, the citation validator as an isolated pure module, and
the reusable agent-service pattern.

### Acceptance criteria
- [ ] "Run Analysis" triggers a live model call producing structured Risk output (riskScore, riskLevel, flags with fhirResourceId, readmissionProbability).
- [ ] Findings stream to the client over SSE and render incrementally in one feed box.
- [ ] The citation validator, given an agent output with one in-bundle citation and one fabricated ID, passes the valid one and drops/flags the fabricated one.
- [ ] No finding reaches the UI citing a resource ID absent from the retrieved bundle.
- [ ] Citation-validator unit tests (Seam 2) and an API-boundary test asserting all returned citations resolve in the bundle.

### Blocked by
- S1

---

## S3 — Four-agent orchestration + FHIR Task creation

### What to build
Extend the single-agent path to the full care team. The Orchestrator dispatches
**Risk, Care Gap, SDOH, and Action Planner** agents in parallel over Maria's bundle,
each streaming findings to its own feed box with per-agent color identity. The
Action Planner synthesizes the other three outputs into prioritized **FHIR Task**
resources written to HAPI, each citing the exact FHIR resources that generated it.
Task cards render in the queue with their citations. Citation enforcement applies to
all four agents.

### Acceptance criteria
- [x] All four agents run in parallel from the Orchestrator; each streams to its own feed.
- [x] Action Planner output becomes FHIR Task resources persisted in HAPI.
- [x] Each Task card cites the FHIR resource(s) behind it; citations are validated (none fabricated).
- [x] SDOH agent reads the AHC-HRSN screening (seeded as an `Observation`, per S1's data model — not a `QuestionnaireResponse`); Care Gap reads Condition/Encounter/Observation (no `CarePlan` resource is seeded).
- [x] Re-running an analysis replaces prior findings and Tasks cleanly.
- [x] API-boundary tests: analysis run yields findings from all four agents and creates the expected Tasks with resolvable citations.

### Blocked by
- S2

---

## S4 — Agent-graph canvas + analysis cache/replay

### What to build
The signature W03 visual and the demo-reliability mechanism (GD2). A native Canvas
agent graph (`requestAnimationFrame`, 5-node radial layout, bezier edges, particle
flow, per-agent color, state machine IDLE→INIT→DISPATCH→ANALYZING→SYNTHESIZING→COMPLETE)
visualizes the orchestration from S3. The last successful analysis per patient is
cached; demo mode replays it instantly and deterministically, while an explicit
"live" trigger forces a fresh model run (OpenAI `gpt-5.5` per GD13, revised
2026-07-04) and re-caches.

### Acceptance criteria
- [x] Canvas graph animates through the state machine in sync with the streaming analysis; no chart library used.
- [x] Per-agent color identity is consistent from graph node → feed box → task card citation.
- [x] A cached analysis replays deterministically without a live model call; the explicit live trigger forces a fresh run and updates the cache.
- [x] Cached and live runs produce the same UI treatment (cache is real prior output, not a script).

### Blocked by
- S3

---

## S5 — Population Dashboard + drill-in (Director)

### What to build
The Director's entry narrative (W02). On login, a Director lands on a Population
Dashboard showing ~500 patients as a risk scatter (risk score × urgency), a critical-
zone count, a projected cost-avoidance figure, and team KPIs — all from a population
aggregate API over HAPI. Clicking a cluster drills to a filtered patient list and
then into a patient detail view.

### Acceptance criteria
- [x] Director login routes to W02 (not the Coordinator panel).
- [x] Scatter renders ~500 patients from real HAPI-derived aggregates (native Canvas, no chart library).
- [x] Critical-zone count and cost-avoidance figure are computed from patient data, not hardcoded.
- [x] Drill-down: cluster → filtered list → patient detail navigation works.
- [x] API-boundary tests for the population aggregate endpoints over seeded data.

### Blocked by
- S1

---

## S6 — Task assignment + real-time FHIR Subscription

### What to build
The real-time loop (GD7). A Director assigns Maria's tasks to a specific Care
Coordinator; the Task is updated in HAPI. A real FHIR **Subscription** (HAPI rest-hook
on Task create/update) calls an API webhook, which relays the change to connected
clients over SSE/websocket, so the Coordinator's view updates live and shows an
assignment notification — without a manual refresh.

### Acceptance criteria
- [x] A FHIR Subscription resource exists on HAPI with a rest-hook on Task changes.
- [x] Assigning a task updates the FHIR Task and fires the Subscription to the API webhook (visible in logs/network).
- [x] The webhook relays to the client over SSE/websocket; the Coordinator's queue updates live and shows a notification. *(No `M02` task queue exists yet — S7's job. The live-updating surface today is `PatientPanel`/"My Patients" (W12); the notification is a toast.)*
- [x] API-boundary test for assignment; an integration test asserting the webhook→relay path delivers the update.

### Blocked by
- S3

---

## S7 — Role-filtered task queue + task actions

### What to build
The queue and its actions (M02 / M03, and the W13 Task Management Center on web),
built responsive per the GD4 mobile recommendation. The queue filters by role — a
Social Worker sees only SDOH-domain
tasks, a Coordinator sees all. Opening a task shows the patient context that justifies
it; the user can Complete / Defer / Escalate (and Call), which PATCHes the FHIR Task
status in HAPI and syncs back. **This slice triggers the GD4 mobile-stack decision
(PWA/responsive web vs. React Native) — resolve it before starting.**

### Acceptance criteria
- [x] GD4 mobile-stack decision recorded before implementation begins. (2026-07-05: PWA/responsive web, see `plan.md` §1 GD4)
- [x] Social Worker queue shows only SDOH-domain tasks; Coordinator sees all task types. (A1 + B1, `implementation-plan.md` Iteration 7)
- [x] Task detail shows the justifying patient context and citations. (B2)
- [x] Complete/Defer/Escalate transitions PATCH the FHIR Task status in HAPI and reflect back in the UI. (A2 + B2)
- [x] Completing a task on the mobile-shaped view syncs to the web view (via S6 relay). (B3 — via `PatientDetail.tsx`, not W13 itself; see `implementation-plan.md` B3's GD9 scope note)
- [x] API-boundary tests for role-filtered listing and each status transition. (A1/A2 Jest suites, 147/147)

### Blocked by
- S3
- GD4 mobile-stack decision (see `plan.md` §8)

---

## S8 — AI Governance & audit dashboard (W06)

### What to build
The trust story (W06). A governance view showing: the audit trail of every FHIR
read/write (from the S1 audit spine) with timestamp and user; model version +
timestamp per analysis; confidence distribution across the analyzed cohort; and
**demographic parity metrics computed from real Synthea demographics** (risk scores
broken down by age/sex/race/ethnicity). Includes a placeholder tile for the S9 eval
headline that renders gracefully before S9 lands.

### Acceptance criteria
- [ ] Audit trail lists real logged FHIR reads/writes with timestamp + user.
- [ ] Each analysis shows its model version and timestamp.
- [ ] Confidence distribution is derived from actual agent outputs.
- [ ] Parity metrics are computed from Synthea demographics, not static numbers.
- [ ] Eval tile renders a graceful empty/loading state until S9 provides data.
- [ ] API-boundary tests for the audit/parity endpoints.

### Blocked by
- S3

---

## S9 — Evaluation harness + report

### What to build
The P6 lever (GD8). A runnable `npm run eval` loads the labeled patients (~5 curated
hero + ~10 Synthea, dev-labeled with a clinician-overridable structure), runs the four
agents over each, and computes sensitivity / specificity / PPV for Care Gap + Risk, an
agreement rate for SDOH, and qualitative notes for Action Planner. It emits a
methodology report **including an error analysis** (misses + false positives) and a
JSON summary that feeds the S8 governance tile. Ships as an honest dev-labeled baseline
(~P6 4) with the slot to upgrade to clinician-validated (P6 5).

### Acceptance criteria
- [ ] A committed label file holds ground truth with rows structured for later clinician override.
- [ ] `npm run eval` runs agents over all labeled patients and computes the metrics per agent.
- [ ] The report includes an explicit error-analysis section.
- [ ] A JSON summary is produced and consumed by the S8 governance tile.
- [ ] Harness metric computation is tested against a fixed label fixture with known expected output (Seam 4).

### Blocked by
- S3

---

## S10 — CDS Hooks patient-view service

### What to build
The fifth load-bearing standard (GD6). A real patient-view **CDS Hooks** service that,
given a patient context, reads the HAPI bundle, runs (or reuses cached) agent findings,
and returns them as CDS cards. Demoable by pointing the public CDS Hooks sandbox at the
service + HAPI.

### Acceptance criteria
- [x] The service exposes a CDS Hooks discovery endpoint and a patient-view service endpoint.
- [x] Given a patient-view hook, it returns well-formed CDS cards carrying agent findings and their FHIR citations.
- [x] A card fires in the public CDS Hooks sandbox against the running service. — verified live
  2026-07-07 against `sandbox.cds-hooks.org` via an `ngrok` tunnel to a real local instance (see
  `verification-s10.md` §1 for the full request/response evidence). The sandbox's own patient-context
  picker only offers patients from its configured reference FHIR server
  (`launch.smarthealthit.org`), none of which exist in our `analysis_cache` — so the real, honest
  response for that session was `{"cards":[]}`, not a populated card. The full pipeline (public
  internet → tunnel → real Express route → real cache lookup → real card-mapping function → real
  JSON rendered in the sandbox's own UI) is proven end-to-end; a populated card was already proven
  separately via a local curl hit against the real dev DB's cached Maria Chen analysis
  (`verification-s10.md` §1).
- [x] Tests for the discovery response and card generation for the hero patient.

### Blocked by
- S3

---

## S11 — Demo-supporting + shell screens

### What to build
Breadth once the design system is established. Build the demo-supporting tier to a
designed/partial depth — SDOH resource directory + referral (M05), Quality/HEDIS view
(W05/W07), Team performance (W04), Patient quick profile (M04), Today/Schedule (M08),
Care Plan builder (W14) — and navigation-only shells for the remaining screens (W08,
W09, W10, W11, W13, W15, W16, M06, M07, M09, M10) with placeholder content. Scope flexes
to remaining capacity; the six demo-critical screens (S1–S8) take priority.

### Acceptance criteria
- [ ] SDOH resource directory lists community resources by category; a referral creates a FHIR ServiceRequest.
- [ ] Quality/HEDIS view shows measure progress and incentive dollars at stake, derived from FHIR data.
- [ ] Team performance view shows coordinator workload and completion rates.
- [ ] Shell screens exist in navigation with consistent design-system styling and placeholder content.
- [ ] No shell screen presents placeholder data as if it were real/functional (honest staging).

### Blocked by
- S5
- S7

---

## S12 — Demo hardening: end-to-end flow tests, fallback video, judge deck

### What to build
The final safety net for the live demo. Automated **Playwright E2E tests for the
three demo flows** (Seam 3) exercise the full stack end-to-end: Director (login →
population → drill into Maria → assign), Coordinator (open patient → run analysis →
findings stream → Tasks appear), and Social Worker (mobile queue → open task → mark
done → syncs back). A **pre-recorded 90-second demo video** is captured as the
out-of-band fallback (GD2), and the **judge slide deck** is assembled (reuse
`reference-materials/caresync-pitch-deck.html`, updated to reflect what actually
shipped and the honest-staging matrix).

### Acceptance criteria
- [ ] Playwright E2E suite covers all three demo flows end-to-end against the running stack and passes green.
- [ ] The three flows are demoable both live (fresh model run) and via cached replay (GD2).
- [ ] A pre-recorded 90-second demo video exists as the fallback and matches the live flow.
- [ ] The judge deck reflects shipped functionality and the built/prototyped/envisioned staging (gate G4), not the original pitch claims.
- [ ] The submission bundles the eval report (from S9) and the standards-conformance matrix.

### Blocked by
- S4
- S5
- S6
- S7
- S8
- S9
