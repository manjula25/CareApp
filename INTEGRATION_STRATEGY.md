# CareSync AI — Integration Strategy for Merged HL7 AI Challenge Submission

> **Date**: July 7, 2026
> **Projects**: Lead Project (`hl7-competition-caresyncai`) + User's Project (`caresync-UI`)
> **Objective**: Merge two HL7 AI challenge submissions into a single competitive project combining robust UI and callback resilience with advanced AI and FHIR/SMART capabilities.

---

## Table of Contents

1. [Strengths, Gaps, and Risk Factors](#1-strengths-gaps-and-risk-factors)
2. [Recommended Base Project](#2-recommended-base-project)
3. [Concrete Merge Plan](#3-concrete-merge-plan)
4. [Risk/Mitigation Checklist + Success Criteria](#4-riskmitigation-checklist--success-criteria)
5. [Feature Comparison: Lead Project vs Your Project](#5-feature-comparison-lead-project-vs-your-project)
6. [Key Takeaways](#6-key-takeaways)

---

## 1. Strengths, Gaps, and Risk Factors

### Project A — Lead Project (`hl7-competition-caresyncai`)

#### Strengths

- **Rich, polished UI**: 1287-line `PatientDetail.tsx` with agent streaming visualization, confidence bars, severity dots, and a full Canvas-based population scatter plot (`PopulationDashboard.tsx` at 603 lines). The UI is the demo showpiece.
- **Complete screen inventory**: 16 web pages + 5 mobile pages covering Director, Coordinator, and Social Worker roles — all 21 PRD screens scaffolded.
- **Professional layout system**: `Sidebar` + `Header` + `MobileNav` + reusable UI primitives (`Badge`, `Card`, `Spinner`, `Toast`).
- **Zustand state management**: `authStore.ts` + `agentStore.ts` for clean client-side state.
- **Anthropic Claude SDK**: All 4 agents (`riskAgent`, `careGapAgent`, `sdohAgent`, `actionPlannerAgent`) are wired with Claude `claude-sonnet-4-6` using structured tool-use output.
- **Mock fallback system**: `mock-outputs.ts` provides deterministic demo data when no API key is present — critical for judge demos.

#### Gaps

- **No SMART on FHIR**: Zero SMART backend services implementation. No JWT assertion, no token server, no asymmetric key signing.
- **No CDS Hooks**: No CDS Services discovery or patient-view hooks.
- **No FHIR Subscriptions**: No webhook/callback mechanism for live Task updates.
- **No citation enforcement**: Agents can hallucinate FHIR resource IDs with no validation gate.
- **No scope-based authorization**: `auth.ts` middleware checks JWT but has no per-domain scope enforcement (clinical/sdoh).
- **FHIR client is a stub**: `services/fhir/client.ts` is 21 lines — `getPatient` returns `{ resourceType: 'Patient', id }`. No real FHIR reads.
- **No tests**: 0 test files across API and web.
- **SSE is polling-based**: `analysis.ts` polls in-memory sessions every 400ms — not true streaming.
- **No analysis caching**: Every analysis run hits the LLM again.
- **No eval harness**: No metrics computation or error analysis.

#### Risk Factors

- UI is demo-ready but backend is largely non-functional against a real FHIR server.
- Mock data is hardcoded in UI components — switching to real API data may break layouts.
- No test safety net means merge conflicts will be hard to detect.

---

### Project B — Your Project (`caresync-UI`)

#### Strengths

- **Production-grade FHIR client**: 1051-line `FhirReadService` with real HAPI FHIR reads, scope-enforced access (`ScopeDeniedError`, `DirectorOnlyError`), Task CRUD, CarePlan reads, SDOH referrals, and condition tag extraction.
- **SMART Backend Services**: Full implementation — `keys.ts` (RSA keypair generation), `tokenServer.ts` (JWT assertion verification + access token issuance), `tokenClient.ts` (assertion signing + token caching), `assertion.ts` (RFC 7523 compliance).
- **CDS Hooks**: `cdsHooks.ts` with discovery endpoint + patient-view service + card mapping.
- **FHIR Subscriptions**: `subscription.ts` with `ensureTaskSubscription` + `eventHub.ts` + `events.ts` relay for live Task assignment callbacks.
- **Citation enforcement**: `citationValidator.ts` — validates every agent flag's `fhirResourceId` against the actual bundle, drops fabricated citations, redacts unvalidated citations in streamed narration with a `NarrationBuffer` for split-token safety.
- **True async streaming**: Orchestrator uses `AsyncIterable` + `Promise.race` for true interleaved streaming, not polling.
- **OpenAI integration**: All 4 agents wired with OpenAI `gpt-5.5` Responses API, structured function tools, and lazy client construction.
- **Analysis caching**: `analysisCache.ts` persists analysis results in SQLite.
- **Eval harness**: `computeMetrics.ts` + `errorAnalysis.ts` for agent quality measurement.
- **Comprehensive test suite**: 39 API test files + 27 web test files (66 total). Nearly 1:1 test-to-source ratio on the API.
- **Scope-based auth**: `scopes.ts` with `ResourceDomain` ('clinical' | 'sdoh') enforcement on every FHIR read.
- **Playwright E2E**: `playwright.config.ts` + e2e test directory.

#### Gaps

- **UI is utilitarian**: `AppShell` is a simple header bar — no sidebar, no mobile nav. Canvas charts exist (`PopulationScatterChart`, `QualityGaugeChart`, `ConfidenceChart`, `ParityRadarChart`) but pages are less visually rich.
- **No Zustand**: Uses React Context (`useAuth.tsx`) + TanStack Query only. No dedicated agent state store.
- **No mock fallback**: If `OPENAI_API_KEY` is missing, agents throw — no graceful demo fallback.
- **Fewer screens built**: 16 page components vs lead's 21, with several as `ComingSoon` placeholders.
- **No mobile decorative shell**: `TaskQueue.tsx` has a phone frame but it's basic compared to lead's mobile pages.

#### Risk Factors

- UI may not impress judges visually compared to the lead's polished mockups.
- No mock fallback means a live demo failure if OpenAI API is unavailable.
- Agent streaming UI is less developed — `AgentGraph.tsx` exists but is simpler than lead's streaming panel.

---

### Codebase Metrics Comparison

| Metric | Lead Project | Your Project |
|---|---|---|
| API test files | 0 | 39 |
| API source files | 25 | 48 |
| Web test files | 0 | 27 |
| Web source files | 32 | 37 |
| API lines (non-test) | 2,337 | 5,679 |
| Web lines (non-test) | 6,037 | 4,870 |
| Total test files | 0 | 66 |

---

## 2. Recommended Base: Your Project (`caresync-UI`)

### Justification

The backend is the foundation that everything else stands on. The lead project's FHIR client is a 21-line stub — it cannot read a single real patient from HAPI. Your project has a 1051-line production FHIR service with SMART, CDS Hooks, Subscriptions, scope enforcement, citation validation, and analysis caching. Rebuilding this infrastructure on top of the lead's UI would take longer than porting the lead's UI components onto your backend.

**Specifically:**

- **SMART on FHIR** is a competition requirement — only your project has it.
- **CDS Hooks** is a differentiator — only your project has it.
- **Citation enforcement** is a safety requirement for AI in healthcare — only your project has it.
- **66 test files** provide a merge safety net that the lead's 0 tests cannot.
- **Real FHIR reads** mean the demo works against a live HAPI server, not just mock data.

The lead's UI is better, but UI is **portable** — React components are self-contained and can be adapted to consume your API's response shapes. Backend infrastructure is **not portable** — it's deeply woven into every route, service, and data model.

---

## 3. Concrete Merge Plan

### 3.1 Architecture

```
Merged Project
├── apps/
│   ├── api/                          ← FROM YOUR PROJECT (base)
│   │   ├── src/
│   │   │   ├── agents/               ← YOUR PROJECT (OpenAI + citation validation)
│   │   │   │   ├── agent.ts           Shared contract (AgentEvent, AgentId, outputs)
│   │   │   │   ├── riskAgent.ts       OpenAI gpt-5.5 + structured tool
│   │   │   │   ├── careGapAgent.ts    OpenAI gpt-5.5 + structured tool
│   │   │   │   ├── sdohAgent.ts       OpenAI gpt-5.5 + structured tool
│   │   │   │   ├── actionPlannerAgent.ts  OpenAI gpt-5.5 + structured tool
│   │   │   │   ├── orchestrator.ts    AsyncIterable race-based merge
│   │   │   │   ├── citationValidator.ts  ← KEY DIFFERENTIATOR
│   │   │   │   └── mock-outputs.ts    ← PORT FROM LEAD (demo fallback)
│   │   │   ├── fhir/                 ← YOUR PROJECT (1051-line FhirReadService)
│   │   │   │   ├── client.ts          Real HAPI reads, scope enforcement, Task CRUD
│   │   │   │   ├── subscription.ts    FHIR Subscription rest-hook
│   │   │   │   └── conditionTags.ts
│   │   │   ├── smart/                ← YOUR PROJECT (SMART Backend Services)
│   │   │   │   ├── keys.ts            RSA keypair generation
│   │   │   │   ├── tokenServer.ts     JWT assertion verification
│   │   │   │   ├── tokenClient.ts     Assertion signing + token caching
│   │   │   │   └── assertion.ts       RFC 7523
│   │   │   ├── routes/               ← YOUR PROJECT + merge
│   │   │   │   ├── analysis.ts        SSE streaming (upgrade to true stream)
│   │   │   │   ├── cdsHooks.ts        CDS Hooks discovery + patient-view
│   │   │   │   ├── events.ts          Client relay + subscription webhook
│   │   │   │   └── ... (auth, patients, tasks, sdoh, etc.)
│   │   │   ├── auth/                 ← YOUR PROJECT
│   │   │   ├── db/                   ← YOUR PROJECT
│   │   │   ├── eval/                 ← YOUR PROJECT
│   │   │   ├── governance/           ← YOUR PROJECT
│   │   │   ├── population/           ← YOUR PROJECT
│   │   │   └── quality/              ← YOUR PROJECT
│   │   └── package.json               ← YOUR PROJECT (openai dep)
│   │
│   └── web/                          ← MERGED (lead UI + your API client)
│       ├── src/
│       │   ├── components/           ← PORT FROM LEAD + KEEP YOURS
│       │   │   ├── layout/            LEAD: AppShell, Header, Sidebar, MobileNav
│       │   │   ├── ui/                LEAD: Badge, Card, Spinner, Toast
│       │   │   ├── AgentGraph.tsx     YOURS: keep for agent visualization
│       │   │   ├── PopulationScatterChart.tsx  YOURS: Canvas chart
│       │   │   ├── ConfidenceChart.tsx         YOURS
│       │   │   ├── QualityGaugeChart.tsx       YOURS
│       │   │   └── ParityRadarChart.tsx        YOURS
│       │   ├── pages/                ← PORT FROM LEAD + ADAPT
│       │   │   ├── director/          LEAD: PopulationDashboard, PatientDetail,
│       │   │   │                      GovernanceAudit, QualityCompliance,
│       │   │   │                      TeamPerformance, CostROI
│       │   │   ├── coordinator/       LEAD: MyPatients, TaskManagement, CarePlanBuilder
│       │   │   ├── mobile/            LEAD: TaskQueue, TaskDetail, PatientProfile, SDOHResources
│       │   │   ├── Login.tsx          YOURS (already works with your auth)
│       │   │   └── ... (keep your working pages as fallback)
│       │   ├── store/                ← PORT FROM LEAD
│       │   │   ├── authStore.ts       Adapt to your JWT token format
│       │   │   └── agentStore.ts      Wire to your SSE analysis endpoint
│       │   ├── api/                  ← YOUR PROJECT (base, extend)
│       │   ├── auth/                 ← YOUR PROJECT
│       │   └── lib/                  ← YOUR PROJECT
│       └── package.json               ← MERGE (add zustand, clsx, date-fns)
│
├── docker-compose.yml                ← YOUR PROJECT (HAPI FHIR config)
├── scripts/                          ← YOUR PROJECT
└── data/seeds/                       ← YOUR PROJECT
```

### 3.2 Data Models (FHIR/SMART on FHIR)

#### FHIR Resources Used (already in your project)

- **Patient** — demographics, telecom (phone for Call action)
- **Condition** — active diagnoses, clinical status filtering
- **Observation** — labs (HbA1c, BNP, creatinine), abnormal flag detection
- **Encounter** — visit history, readmission risk, days-since-contact
- **MedicationRequest** — medication gaps vs guidelines
- **QuestionnaireResponse** — SDOH screening (AHC-HRSN)
- **Task** — AI-generated care tasks with `meta.tag` for domain (clinical/sdoh) + CareSync authorship tag + `input` citations
- **ServiceRequest** — SDOH community referrals with CareSync authorship tag
- **CarePlan** — care gap reference
- **Immunization** — preventive care gaps
- **Subscription** — rest-hook for Task updates (your `subscription.ts`)

#### SMART on FHIR (already in your project)

- Backend Services flow (RFC 7523): client generates RSA keypair → signs JWT assertion → token server verifies → issues access token → token cached and attached to every HAPI call
- Scopes: `system/*.read` (current), extensible to `system/Patient.read`, `system/Task.write` etc.

#### AI Agent Data Models (your project, shared contract)

- `RiskOutput`: `{ riskScore, riskLevel, flags: AgentFlag[], readmissionProbability }`
- `CareGapOutput`: `{ gaps: { gapType, description, urgency, fhirResourceId }[] }`
- `SdohOutput`: `{ barriers: { domain, finding, severity, fhirResourceId }[], referralsNeeded }`
- `ActionPlannerOutput`: `{ tasks: { title, description, priority, domain, assignTo, dueInDays, fhirResources[] }[] }`
- `AgentEvent`: discriminated union — `token` (streaming narration) | `result` (structured output)

**Merge adaptation needed:** The lead project's `AgentFinding` type uses `{ type, finding, fhirResourceId, severity, confidence }`. Your project's `AgentFlag` uses `{ text, fhirResourceId }`. **Resolution:** Create an adapter layer in the API client that maps your richer output shapes to the lead's UI component props. The UI components expect `AgentFinding` — write a `mapAgentOutputToFindings()` function in `api/client.ts`.

### 3.3 AI Integration Points

| Integration Point | Location | Mechanism |
|---|---|---|
| **Agent orchestration** | `POST /api/analysis/:patientId/run` | Your `orchestrate()` → SSE stream |
| **Agent streaming** | `GET /api/analysis/:patientId/stream` | Upgrade from lead's 400ms polling to your `AsyncIterable` pipe |
| **Citation enforcement** | `orchestrator.ts` → `citationValidator.ts` | Validates every `fhirResourceId` against bundle before emitting `result` event |
| **Analysis caching** | `db/analysisCache.ts` | `GET /api/analysis/:patientId/latest` reads from SQLite |
| **CDS Hooks** | `GET /cds-services` + `POST /cds-services/patient-view` | Reads `analysis_cache` for cached recommendations |
| **Task creation** | `orchestrator.ts` → `FhirReadService.createTask()` | Action Planner output → FHIR Task with `meta.tag` domain + citation `input` |
| **Mock fallback** | `agents/mock-outputs.ts` (port from lead) | When `OPENAI_API_KEY` absent, return mock data with `onText` simulation |

#### Fallback Mechanisms

1. **No API key** → mock-outputs.ts returns deterministic demo data (port from lead)
2. **Agent failure** → orchestrator catches per-agent, continues with remaining agents, action planner uses mock for failed upstream
3. **FHIR server down** → `fhirFetch` returns null, UI falls back to mock patient data (lead's pattern)
4. **Citation validation drops all flags** → agent result still emitted with empty flags array + dropped count logged
5. **SMART token expired** → `tokenClient` auto-refreshes via cached assertion

### 3.4 API Boundaries

```
Frontend (React)  ←→  API (Express)
    │                       │
    │  REST (JSON)          │  FHIR R4 (fhir+json)
    │  SSE (text/event-stream)  │  SMART (JWT + OAuth)
    │                       │
    ▼                       ▼
/api/auth/*            HAPI FHIR :8080
/api/patients/*        /smart/token
/api/analysis/*        /cds-services/*
/api/tasks/*
/api/population/*
/api/governance/*
/api/quality/*
/api/team/*
/api/sdoh/*
/api/events/*          ← SSE relay for subscription callbacks
/api/fhir/subscription-hook  ← HAPI webhook target
```

**Key boundary rule:** Frontend never talks to HAPI directly. All FHIR reads go through your `FhirReadService` which enforces scopes, writes audit logs, and applies domain logic (condition tags, risk computation, task domain filtering).

### 3.5 Tech Stack Alignment

| Layer | Lead Project | Your Project | Merged Choice | Rationale |
|---|---|---|---|---|
| **AI SDK** | `@anthropic-ai/sdk` (Claude) | `openai` (GPT-5.5) | **OpenAI** | Your project has working agents + tests + citation validation. Add Claude as alternative via env var. |
| **Express** | v4 | v5 | **Express v5** | Your project already uses it; v5 is newer. |
| **State mgmt** | Zustand | React Context | **Zustand** (port from lead) | Cleaner for agent state; `agentStore.ts` maps perfectly to SSE events. |
| **FHIR client** | `fhirclient` (unused) | native `fetch` | **Native fetch** | Your `FhirReadService` already works; no dependency needed. |
| **Auth** | `bcryptjs` | `bcrypt` | **bcrypt** | Native binding, faster, your tests already pass. |
| **Testing** | none | Jest + Vitest + Playwright | **Keep yours** | 66 test files are the merge safety net. |
| **UI primitives** | `clsx`, `date-fns` | none | **Add clsx + date-fns** | Lead's UI components depend on them. |
| **Linting** | none | ESLint + Oxlint | **Keep yours** | Maintains code quality during merge. |
| **TypeScript** | v5.6 | v6.0 | **v6.0** | Your project's newer; lead's code is compatible. |

#### Interoperability Strategy

1. **API client adapter**: Your `api/client.ts` becomes the single source of truth for all frontend data fetching. Add functions matching each lead page's data needs (e.g. `getPopulationPatients()` returns your `Patient[]` shaped to lead's `Patient` type).
2. **Type bridge**: Create `types/bridge.ts` that maps your API response types to the lead's UI component prop types. This isolates the shape differences.
3. **Auth token compatibility**: Your JWT uses `caresync_token` localStorage key; lead uses `token`. Standardize on yours. Adapt lead's `authStore.ts` to read from your `useAuth.tsx` context instead of Zustand, or port `authStore.ts` and have it call your `login()` API.
4. **SSE consumption**: Lead's `PatientDetail.tsx` already has SSE event handling (`StreamEvent` interface). Wire it to your `/api/analysis/:patientId/stream` endpoint — the event shapes are close. Map your `AgentEvent` (`token`/`result`) to lead's `StreamEvent` (`agent_text`/`agent_complete`).

### 3.6 Feature Phasing

#### Phase 1 — MVP (Days 1-3): AI + Robust UI + Callbacks

**Goal:** Demo the full loop — Director assigns → Coordinator runs AI analysis → Social Worker actions task → Director sees updated dashboard.

| Step | Task | Source | Est. Hours |
|---|---|---|---|
| 1.1 | Port lead's `Sidebar`, `Header`, `MobileNav`, `AppShell` into your web app | Lead | 2h |
| 1.2 | Port lead's `PopulationDashboard` — adapt to consume your `/api/population/scatter` + `/api/population/summary` | Lead → adapt | 4h |
| 1.3 | Port lead's `PatientDetail` — adapt SSE consumption to your `/api/analysis/:patientId/stream`. Map `AgentEvent` → `StreamEvent`. Use your `AgentGraph.tsx` for the visualization. | Lead + Yours | 6h |
| 1.4 | Port lead's `TaskQueue` (mobile) — adapt to your `/api/tasks` response shape | Lead → adapt | 2h |
| 1.5 | Port lead's `TaskDetail` (mobile) — wire Call/Complete/Defer/Escalate to your `/api/tasks/:id/status` | Lead → adapt | 2h |
| 1.6 | Port `mock-outputs.ts` from lead into your `agents/` — add env check fallback | Lead → adapt | 1h |
| 1.7 | Add Zustand `authStore` + `agentStore` — wire to your auth + SSE | Lead → adapt | 2h |
| 1.8 | Verify existing tests pass with new UI components | Yours | 2h |
| 1.9 | Playwright E2E: full demo loop (login → population → patient → analysis → task → complete) | Yours | 3h |

**MVP deliverable:** A single app where a Director sees a polished population dashboard, drills into a patient, runs real AI analysis with streaming narration + citation-validated findings, assigns tasks, and a Social Worker completes them on a mobile-style task queue — with live FHIR Subscription callbacks updating the Coordinator's panel.

#### Phase 2 — Competitive Polish (Days 4-6)

| Step | Task | Source |
|---|---|---|
| 2.1 | Port lead's `GovernanceAudit` page — wire to your `/api/governance/*` | Lead → adapt |
| 2.2 | Port lead's `QualityCompliance` page — wire to your `/api/quality/*` | Lead → adapt |
| 2.3 | Port lead's `TeamPerformance` page — wire to your `/api/team/*` | Lead → adapt |
| 2.4 | Port lead's `CostROI` page — wire to your `/api/quality/*` (ROI data) | Lead → adapt |
| 2.5 | Port lead's `SDOHResources` (mobile) — wire to your `/api/sdoh/*` | Lead → adapt |
| 2.6 | Port lead's `CarePlanBuilder` — wire to your FHIR CarePlan reads | Lead → adapt |
| 2.7 | Add CDS Hooks demo: EHR patient-view triggers recommendation card | Yours |
| 2.8 | Add SMART on FHIR demo: show token exchange in Settings page | Yours |
| 2.9 | Port lead's UI primitives (`Badge`, `Card`, `Spinner`, `Toast`) — replace your inline styles | Lead |

#### Phase 3 — Competition Differentiators (Days 7-9)

| Step | Task | Source |
|---|---|---|
| 3.1 | Eval harness dashboard: show agent accuracy metrics from your `eval/computeMetrics.ts` | Yours |
| 3.2 | Citation enforcement visualization: show "validated" vs "dropped" citations in UI | Yours |
| 3.3 | Agent confidence distribution chart: use your `ConfidenceChart.tsx` | Yours |
| 3.4 | Demographic parity radar: use your `ParityRadarChart.tsx` | Yours |
| 3.5 | Live subscription callback toast: enhance your `AppShell` event subscription | Yours |
| 3.6 | Presentation deck: merge lead's HTML slides with your architecture diagrams | Both |

### 3.7 Collaboration Plan

#### Ownership

| Area | Owner | Reason |
|---|---|---|
| API backend (all routes, services, agents, FHIR, SMART, CDS Hooks) | You | 100% of the production backend is yours |
| UI component porting + adaptation | Lead | They know their components best |
| API client adapter layer (`client.ts` extensions) | You | You know the API response shapes |
| Type bridge (`types/bridge.ts`) | Both | Requires alignment on both sides |
| Test coverage | You | Your test suite is the safety net |
| Demo script + presentation | Both | Lead owns visual narrative, you own technical depth |

#### Milestones

| Milestone | Day | Deliverable | Verification |
|---|---|---|---|
| M1: Merge base | Day 1 | Your backend + lead's AppShell/Login/PopulationDashboard running together | `npm test` passes, `http://localhost:5173` shows population dashboard with real data |
| M2: AI streaming | Day 2 | PatientDetail with live agent streaming + citation validation | Playwright test: run analysis, see streamed tokens + validated findings |
| M3: Full demo loop | Day 3 | Director → Coordinator → Social Worker → back to Director | E2E test passes, mock fallback works without API key |
| M4: All screens | Day 6 | All 21 PRD screens functional with real data | Manual walkthrough + screenshot comparison vs mockups |
| M5: Differentiators | Day 9 | CDS Hooks + SMART + eval + citation visualization | Demo-ready, presentation deck complete |

#### Testing Strategy

- **Unit tests**: Your 66 existing tests must pass after every merge step. Run `npm test` as the gate.
- **Integration tests**: Add tests for the type bridge layer (`bridge.test.ts`).
- **E2E tests**: Playwright suite covering the full demo loop (M3).
- **Visual regression**: Screenshot comparison of lead's mockup pages vs merged pages.
- **Mock fallback test**: Verify the app works end-to-end with no API keys set.

#### Deployment

- **Docker Compose**: Your existing `docker-compose.yml` for HAPI FHIR.
- **Dev server**: `concurrently` running API (`tsx watch`) + web (`vite`).
- **Demo environment**: HAPI FHIR with seeded Synthea data (your `scripts/import-fhir.ts`).
- **Production deploy**: Netlify (web) + Railway/Fly.io (API) + HAPI FHIR Cloud.

---

## 4. Risk/Mitigation Checklist + Success Criteria

### Risk/Mitigation Checklist

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Type shape mismatch** between your API responses and lead's UI component props | High | Type bridge layer (`types/bridge.ts`) with adapter functions. Unit test every mapping. |
| R2 | **SSE event format mismatch** — lead expects `agent_text`/`agent_complete`, you emit `token`/`result` | High | Server-side mapping in `analysis.ts` route: translate `AgentEvent` to lead's `StreamEvent` format before writing to SSE. |
| R3 | **OpenAI API unavailable during demo** | Critical | Port lead's `mock-outputs.ts` as fallback. Env check: `if (!OPENAI_API_KEY) return mockWithSimulatedStream()`. |
| R4 | **HAPI FHIR server not reachable** | High | Lead's mock patient data pattern as UI fallback. Your `fhirFetch` already returns null on failure. |
| R5 | **Merge conflicts in shared files** (package.json, tsconfig, tailwind.config) | Medium | Yours is the base; cherry-pick lead's additions (zustand, clsx, date-fns deps). |
| R6 | **Express v4 vs v5 incompatibility** | Medium | Your project is v5; lead's route files use v4 patterns (`Router` import). Adapt lead's routes to v5 (minimal — mostly `Request`/`Response` type imports). |
| R7 | **Auth token format mismatch** — lead stores `token`, you store `caresync_token` | Low | Standardize on your key. Adapt lead's `authStore.ts` to use `caresync_token`. |
| R8 | **Tailwind config differences** — both use same design tokens but different config structure | Low | Merge into your `tailwind.config.js`. Both use the same color palette (verified — identical token names). |
| R9 | **Agent output schema divergence** — lead's `AgentFinding` has `severity` + `confidence`, your `AgentFlag` doesn't | Medium | Extend `AgentFlag` to include optional `severity` + `confidence` fields. Backward compatible. |
| R10 | **Test breakage from UI changes** | Medium | Your web tests test behavior, not layout. Most should pass. Add new tests for ported components. |
| R11 | **Timeline pressure** — 9 days for full merge | High | Phase 1 MVP is the critical path (3 days). Phases 2-3 are additive. If behind, ship Phase 1 alone — it's already competitive. |
| R12 | **Two team members conflicting on same files** | Medium | Clear ownership boundaries (table above). Git branch per phase, PR review before merge. |

### Success Criteria

| # | Criterion | Measurement | Phase |
|---|---|---|---|
| S1 | **All 66 existing tests pass** after merge | `npm test` exit code 0 | Every phase |
| S2 | **Full demo loop works end-to-end** | Playwright E2E test passes | Phase 1 |
| S3 | **App works without any API keys** | Mock fallback serves all agent outputs | Phase 1 |
| S4 | **Real FHIR data flows through UI** | Population dashboard shows seeded patients from HAPI | Phase 1 |
| S5 | **AI streaming with citation validation** | Agent findings show only validated FHIR resource IDs | Phase 1 |
| S6 | **SMART token exchange visible** | Settings page shows token issuance + FHIR call with bearer token | Phase 2 |
| S7 | **CDS Hooks card appears in patient view** | `POST /cds-services/patient-view` returns cards | Phase 2 |
| S8 | **All 21 PRD screens render with real data** | Manual walkthrough, no `ComingSoon` for demo-critical screens | Phase 2 |
| S9 | **Eval metrics displayed in governance dashboard** | Agent accuracy + error analysis from `eval/computeMetrics.ts` | Phase 3 |
| S10 | **Citation enforcement visualized** | UI shows "validated" vs "dropped" citation count | Phase 3 |
| S11 | **Live FHIR Subscription callback fires toast** | Assign task as Director → Coordinator sees toast in <2s | Phase 1 |
| S12 | **Presentation deck complete** | HTML slides covering architecture, AI, FHIR, SMART, CDS Hooks, demo flow | Phase 3 |

---

## 5. Feature Comparison: Lead Project vs Your Project

### Features in Lead Project NOT Available in Your Project

#### 1. Cost & ROI Dashboard (W07)

- **Lead**: Full `CostROI.tsx` (232 lines) — Canvas-rendered cost trend chart, KPI cards for cost avoidance YTD ($284K), readmissions prevented (34), ED visits avoided (52), readmission rate vs benchmark, monthly trend line chart.
- **API**: `GET /api/quality/roi` returns ROI object with `costAvoidanceYTD`, `readmissionsPrevented`, `edVisitsAvoided`, `readmissionRate`, `readmissionRateBenchmark`, `monthlyTrend`, `monthLabels`.
- **Yours**: No Cost/ROI page. No `/api/quality/roi` endpoint. Your `quality/service.ts` handles HEDIS measures but not ROI/cost avoidance.

#### 2. Clinical Alerts Center (W10)

- **Lead**: Full `AlertsPage.tsx` (260 lines) — Severity-filtered alert feed with category tabs (Clinical, Medication, SDOH, Care Gap), acknowledge/acknowledge-all actions, unacknowledged count badge, critical count, FHIR resource references, patient navigation links, glow effects on severity dots.
- **Yours**: No alerts page. No alerts API endpoint. Your `AppShell.tsx` has toast notifications for task assignments, but no dedicated alert center with filtering/acknowledgment.

#### 3. Settings & System Status Page (W11)

- **Lead**: Full `SettingsPage.tsx` (145 lines) — User profile card with initials avatar, role badge, system status dashboard (FHIR R4 Server, AI Agent Engine, SSE Streaming, Auth Service with latency), about section (version, FHIR standard, competition info), logout confirmation dialog.
- **Yours**: No settings page. No system status display.

#### 4. Care Plan Builder (W14)

- **Lead**: Full `CarePlanBuilder.tsx` (320 lines) — Interactive care plan creation with patient selector, editable goals list (add/remove), interventions with checkboxes and frequency, SDOH barrier tracking with referral status, collapsible sections, toast confirmation on save.
- **Yours**: No care plan builder. Your FHIR client can read CarePlan resources but there's no UI for creating/editing them.

#### 5. Coordinator Task Management Center (W13)

- **Lead**: Full `TaskManagement.tsx` (412 lines) — Full task CRUD with status columns (pending/in_progress/completed), priority badges, overdue detection, create-task form with patient selector, task detail expansion, toast notifications, status transitions.
- **Yours**: `TaskQueue.tsx` (220 lines) is a mobile-style read-only queue with "Done" action only. No create-task form, no status column view, no task editing.

#### 6. Mobile Patient Quick Profile (M04)

- **Lead**: Full `PatientProfile.tsx` (201 lines) — Mobile-optimized patient profile with risk badge, conditions list with color-coded dots, lab results table (HbA1c, NT-proBNP, GFR, K+ with abnormal flags), medication list, care team info, back navigation.
- **Yours**: No mobile patient profile page. `PatientDetail.tsx` is web-only and focused on agent analysis, not quick clinical profile.

#### 7. Mobile SDOH Resource Directory (M05) — UI Layer

- **Lead**: Full `SDOHResources.tsx` (254 lines) — Category-filtered resource browser with custom SVG icons per category (transportation, food, mental health, housing, utilities, care coordination), wait time badges, insurance acceptance indicators, phone/address display, mobile bottom nav.
- **Yours**: `Sdoh.tsx` exists but is web-oriented. No mobile-optimized SDOH resource browser with category icons and wait time badges.

#### 8. Mobile Task Detail with Actions (M03) — UI Layer

- **Lead**: Full `TaskDetail.tsx` (274 lines) — Mobile task detail with priority badge, overdue indicator, patient info card, Call/Complete/Defer/Escalate action buttons, FHIR resource reference display, mobile bottom nav, status transition visual feedback.
- **Yours**: `TaskDetail.tsx` exists but is simpler — it has the call/complete/defer/escalate actions but lacks the mobile-optimized layout, bottom nav, and visual polish.

#### 9. Sidebar Navigation (Layout)

- **Lead**: `Sidebar.tsx` (129 lines) — Icon-only vertical sidebar with 7 nav items (Population, Patients, Quality, Governance, Cost/ROI, Alerts, Settings), role-based filtering, active state highlighting, hover effects, logout button at bottom.
- **Yours**: `AppShell.tsx` uses a simple header bar with text links. No sidebar navigation.

#### 10. Header with User Dropdown (Layout)

- **Lead**: `Header.tsx` (133 lines) — Logo, compliance badges (FHIR R4, SMART on FHIR, CDS Hooks), sync status indicator, notification bell with count badge, user avatar with click-to-open dropdown (name, email, role badge, settings link, logout).
- **Yours**: `AppShell.tsx` header has logo, compliance badges, text nav links, bell icon, avatar initials, and a sign-out button — but no dropdown menu, no sync status, no notification count badge.

#### 11. Mobile Bottom Navigation (Layout)

- **Lead**: `MobileNav.tsx` (63 lines) — Fixed bottom nav with 3 tabs (Tasks, Patients, Resources), SVG icons, active state highlighting, responsive (hidden on md+).
- **Yours**: No mobile bottom navigation component.

#### 12. Reusable UI Primitives

- **Lead**: `Badge.tsx`, `Card.tsx`, `Spinner.tsx`, `Toast.tsx` — shared UI components.
- **Yours**: `StatTile.tsx` is the only shared UI primitive. No Badge, Card, Spinner, or Toast components.

#### 13. Zustand State Management

- **Lead**: `authStore.ts` + `agentStore.ts` — Zustand stores for auth state and agent analysis state (patientId, agents map, isAnalyzing, startAnalysis, updateAgent, resetAnalysis).
- **Yours**: React Context (`useAuth.tsx`) for auth. No dedicated agent state store — agent state is managed inline in page components via TanStack Query.

#### 14. Population Risk Distribution API

- **Lead**: `GET /api/population/risk-distribution` — Returns aggregated risk level distribution (`[{ level: 'critical', count: 12 }, ...]`).
- **Yours**: `GET /api/population/scatter` returns individual patient scatter points. No aggregated risk distribution endpoint.

#### 15. Quality Deadlines API

- **Lead**: `GET /api/quality/deadlines` — Returns upcoming quality deadlines (`[{ measure, dueDate, daysRemaining }]`).
- **Yours**: No quality deadlines endpoint.

#### 16. SDOH Screening Endpoint

- **Lead**: `GET /api/sdoh/screening/:patientId` — Returns patient-specific SDOH flags from screening.
- **Yours**: SDOH data is embedded in the patient bundle and agent output, but there's no dedicated screening endpoint.

#### 17. Audit Trail API with Model Stats + Parity

- **Lead**: Three dedicated audit endpoints:
  - `GET /api/audit/trail` — paginated audit log with patient name, agent ID, recommendation, FHIR resources, confidence, status
  - `GET /api/audit/model-stats` — total recommendations, acceptance rate, avg confidence, per-agent breakdown
  - `GET /api/audit/parity` — demographic parity scores by group
- **Yours**: `governance/service.ts` provides governance data, and `db/audit.ts` writes audit entries, but the API surface is different — `GET /api/governance/*` rather than the lead's `/api/audit/*` structure with model-stats and parity as separate endpoints.

#### 18. Global Error Handler Middleware

- **Lead**: Express global error handler in `index.ts` — `app.use((err, _req, res, _next) => res.status(500).json({ message: 'Internal server error' }))`.
- **Yours**: No global error handler middleware — errors are caught per-route.

#### 19. `GET /api/auth/me` Endpoint

- **Lead**: Returns full user profile (id, name, email, role, initials) from DB.
- **Yours**: No `/api/auth/me` endpoint. User info is decoded from JWT payload client-side.

#### 20. Demo Fallback Data Throughout UI

- **Lead**: Every page has hardcoded mock data (MOCK_PATIENTS, MOCK_TASKS, MOCK_ALERTS, etc.) that renders immediately if the API call fails — the UI always shows something.
- **Yours**: Pages rely on API responses. If the API is down, pages show loading/error states, not demo data.

### Feature Comparison Summary Table

| # | Feature | Lead Has | You Have | Impact |
|---|---|---|---|---|
| 1 | Cost & ROI Dashboard | ✅ Full | ❌ | **High** — PRD W07, judge-facing |
| 2 | Clinical Alerts Center | ✅ Full | ❌ | **High** — PRD W10, demo-critical |
| 3 | Settings & System Status | ✅ Full | ❌ | Medium — PRD W11 |
| 4 | Care Plan Builder | ✅ Full | ❌ | **High** — PRD W14, interactive |
| 5 | Task Management Center (web) | ✅ Full | ❌ | **High** — PRD W13 |
| 6 | Mobile Patient Profile | ✅ Full | ❌ | Medium — PRD M04 |
| 7 | Mobile SDOH Directory (UI) | ✅ Full | Partial | Medium — PRD M05 |
| 8 | Mobile Task Detail (UI) | ✅ Full | Partial | Medium — PRD M03 |
| 9 | Sidebar Navigation | ✅ Full | ❌ | **High** — layout system |
| 10 | Header with Dropdown | ✅ Full | Partial | Medium — UX polish |
| 11 | Mobile Bottom Nav | ✅ Full | ❌ | Medium — mobile UX |
| 12 | UI Primitives (Badge/Card/Spinner/Toast) | ✅ Full | ❌ | Medium — code reuse |
| 13 | Zustand State Stores | ✅ Full | ❌ | Low — architectural preference |
| 14 | Population Risk Distribution API | ✅ | ❌ | Low — derivable from scatter |
| 15 | Quality Deadlines API | ✅ | ❌ | Low — PRD W05 |
| 16 | SDOH Screening Endpoint | ✅ | ❌ | Low — data available via bundle |
| 17 | Audit Model Stats + Parity APIs | ✅ | Partial | Medium — governance depth |
| 18 | Global Error Handler | ✅ | ❌ | Low — robustness |
| 19 | `GET /api/auth/me` | ✅ | ❌ | Low — convenience |
| 20 | Demo Fallback Data in UI | ✅ Full | ❌ | **Critical** — demo safety |

---

## 6. Key Takeaways

The lead project's unique features fall into three buckets:

1. **Missing UI pages** (items 1-8): These are complete, polished React components that can be ported directly. They need API client adaptation but the visual work is done.

2. **Layout/UX system** (items 9-12): The sidebar + header dropdown + mobile nav + UI primitives form a professional shell that your simpler `AppShell` lacks. These are structural and affect every page.

3. **Demo resilience** (item 20): The lead's pattern of embedding mock data in every page as an immediate fallback is a **critical demo safety net** that your project lacks. This is the single most important non-AI feature to port — it ensures the demo always shows something even if HAPI or OpenAI is down.

4. **Minor API gaps** (items 14-19): Small endpoints that are easy to add. Your backend already has the underlying data (governance, audit, quality) — these are just different API surface shapes.

**Bottom line:** The lead has ~8 UI pages and a layout system you don't have. You have ~15 backend services they don't have. The merge plan from Section 3 already accounts for porting all of these — phases 1-2 cover items 1-12, and item 20 (mock fallback) is addressed in phase 1 step 1.6.
