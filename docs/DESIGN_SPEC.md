# CareSync AI — Design Specification

> A HL7-standards-based, agentic care-coordination platform. AI agents read a patient's real FHIR R4 record, produce risk/care-gap/SDOH findings with citations back to the source resources, and turn them into actionable FHIR `Task` work items for care teams — with a governance/audit layer over every read and write.

---

## 1. Overview

### 1.1 Purpose
CareSync AI closes the gap between population risk models and front-line action. It:
- Reads a patient's complete FHIR bundle (`$everything`).
- Runs four cooperating AI agents to identify **risk flags**, **care gaps**, **SDOH barriers**, and a synthesized **action plan**.
- Enforces that every AI finding cites a real FHIR resource in the retrieved bundle (hallucination surface removed).
- Streams reasoning + findings live to the UI over Server-Sent Events (SSE).
- Persists structured work as FHIR `Task` resources and surfaces them to coordinators.
- Logs every FHIR read/write to an audit trail for governance review.

### 1.2 Standards used (load-bearing)
| Standard | Role |
|---|---|
| **FHIR R4** | Patient-data backbone — every recommendation traces to a resource |
| **SMART on FHIR** | OAuth 2.0 scoped access to patient data (token minted, exchanged, cached, attached to HAPI calls) |
| **CDS Hooks** | Delivery of AI recommendations into EHR workflow (`patient-view`) |
| **FHIR Task** | Structured work items for care coordinators |
| **FHIR Subscription** | Real-time push (rest-hook) from server to app |
| **FHIR SDC** | AHC-HRSN SDOH questionnaire administration |
| **LOINC / SNOMED CT / RxNorm** | Terminology bindings on resources |

---

## 2. Architecture

### 2.1 High-level

```
┌──────────────┐        SSE / REST         ┌────────────────┐      FHIR R4       ┌───────────────┐
│  Web (React) │ ───────────────────────►  │  API (Express) │ ─────────────────► │  HAPI FHIR    │
│  Vite + TS   │ ◄─── events / JSON ─────── │  TypeScript    │ ◄── rest-hook ──── │  (Docker)     │
└──────────────┘                           └───────┬────────┘   Subscription     └───────────────┘
                                                   │
                                          ┌────────┴────────┐
                                          │  SQLite         │  users · audit_log · analysis_cache
                                          └─────────────────┘
```

- **Monorepo:** npm workspaces — `apps/api` (backend) and `apps/web` (frontend).
- **Data plane:** HAPI FHIR R4 is the system of record for clinical data + Tasks. SQLite holds only app-side state (auth, audit log, analysis cache).
- **Transport:** REST for CRUD; SSE for live agent streaming and cross-surface event relay.

### 2.2 Backend (`apps/api`)
- **Runtime:** Node.js + Express (TypeScript).
- **Entry:** `src/index.ts` — wires routers, SMART auth middleware, event hub, and boot-time FHIR Task Subscription registration.
- **Modules:**
  - `agents/` — the four agents + orchestrator + citation validator + confidence scorer.
  - `fhir/` — `FhirReadService` (scoped reads, `$everything` bundle, Task read/replace), subscription setup.
  - `smart/` — key-pair generation, token server, token client (SMART Backend Services).
  - `middleware/` — `requireAuth` (session), `smartAuth` (scope enforcement per HTTP method).
  - `db/` — migration, seed, audit, analysis cache.
  - `routes/` — one router per surface (patients, analysis, population, governance, quality, team, tasks, sdoh, carePlans, alerts, events, cdsHooks).

### 2.3 Frontend (`apps/web`)
- **Stack:** React 18 + TypeScript, Vite, React Router v6, TanStack Query, TailwindCSS.
- **Auth:** JWT stored in `localStorage`; `apiFetch` attaches `Bearer` token, emits a global logout event on `401`.
- **Structure:** `pages/` (route screens), `components/` (`AppShell`, guards), `auth/` (context, `RoleGuard`), `api/client.ts` (typed REST + SSE helpers), `lib/` (view helpers, analysis graph).

---

## 3. Agent System

### 3.1 Contract
Defined in `agents/agent.ts`. Each agent is an async generator emitting a discriminated `AgentEvent` union:
- `{ type: 'token', agentId, text }` — streamed reasoning narration.
- `{ type: 'result', agentId, output }` — terminal structured output (narrowed per `agentId`).

`AgentId = 'risk' | 'careGap' | 'sdoh' | 'actionPlanner'`.

### 3.2 The four agents
```
CareSync Orchestrator
├── Risk Agent      → Observation, Condition, MedicationRequest → risk score + level + flags + readmission probability
├── Care Gap Agent  → CarePlan, Condition, Encounter           → gap list (type, urgency, due date)
├── SDOH Agent      → QuestionnaireResponse (AHC-HRSN), Observation → SDOH barriers + referrals needed
└── Action Planner  → all three agents' outputs                → FHIR Task resources
```

Each agent:
- Receives a structured FHIR context (not free text).
- Returns structured JSON with findings + FHIR resource citations.
- Cannot reference data absent from the retrieved bundle.

### 3.3 Orchestration (`agents/orchestrator.ts`)
- Runs Risk / Care Gap / SDOH **concurrently** via a race-based merge (one in-flight `.next()` per iterator), forwarding every event as it settles (true interleaving).
- Collects each agent's terminal `output`.
- Once all three are exhausted, runs the Action Planner on their combined outputs.
- Agents are injectable (default = the real four) so tests can stub timing without hitting the LLM.

### 3.4 Trust guarantees
- **Citation validation (GD11):** `citationValidator.ts` validates every `fhirResourceId` (and a Task's `fhirResources` list) against the bundle's `validIds` **before** it is emitted or persisted. Dropped citations never reach the client or HAPI. Narration is gated by a per-agent `NarrationBuffer` so an unvalidated citation can't leak mid-stream.
- **Confidence scoring (`confidenceScorer.ts`):** each surviving finding's `confidence` (0–1) is a heuristic function of bundle evidence (citation count, abnormal labs, recent encounters, Condition→LOINC mapping, positive AHC-HRSN screening) — **not** model self-report. Action Planner task confidence is derived (min of contributing findings, floored at 0.2).

---

## 4. Data Model

### 4.1 SQLite (app state only)
```sql
users(id, email UNIQUE, password_hash, name, role CHECK IN ('director','coordinator','social_worker'))
audit_log(id, ts, actor, action, fhir_resource, outcome CHECK IN ('success','denied','error'))
analysis_cache(patient_id PK, result_json, model_version, created_ts)
```

### 4.2 FHIR (clinical system of record — HAPI)
`Patient`, `Condition`, `Observation`, `MedicationRequest`, `CarePlan`, `Encounter`, `QuestionnaireResponse` (AHC-HRSN), and `Task` (CareSync-created work items, tagged via `Task.meta.tag` for `clinical` vs `sdoh` domain).

### 4.3 Analysis cache & replay
`AnalysisResultJson` captures exactly what streamed (safe narration + surviving findings + created Task payloads + `complete` payloads per agent). Modes on `POST /api/patients/:id/analysis`:
- `?live=1` → always run orchestrator, stream live, persist to cache.
- no flag, cache hit → **replay** the cached row as the identical SSE sequence (no HAPI/LLM call).
- no flag, cold cache → run live, then cache (first view is always live).

---

## 5. API Surface (selected)

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/auth/login` | Session token | public |
| GET | `/api/patients/assigned` | Coordinator's panel | session + SMART |
| GET | `/api/patients/:id` | Patient detail (patient/conditions/tasks) | session + SMART |
| POST | `/api/patients/:id/analysis` | SSE agent stream (live/replay/mock) | session + SMART |
| GET | `/api/population/scatter`, `/summary` | Director population view | director + SMART |
| GET | `/api/governance/audit`, `/model`, parity | Audit + model performance | director + SMART |
| GET | `/api/quality`, `/api/team` | HEDIS + team performance | director + SMART |
| GET/PATCH | `/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/status` | Task queue + transitions | session + SMART |
| GET/POST | `/api/sdoh` | SDOH directory + audited referral | session + SMART |
| POST | `/api/care-plans/:patientId` | Care Plan Builder | coordinator + SMART |
| GET | `/api/events` | Client SSE relay (cross-surface sync) | session |
| POST | `/api/fhir/subscription-hook` | HAPI rest-hook callback | server-to-server |
| GET/POST | `/cds-services` | CDS Hooks discovery + `patient-view` | auth-less (per spec) |

**SSE event vocabulary:** `token`, `finding`, `task`, `complete`, `done`, `error`.

---

## 6. Security & Access Control

- **Two-tier auth on every HAPI-touching route:** `requireAuth` (CareSync session/JWT) **and** `smartAuth` (SMART access-token scope check per HTTP method — `*.read` for GET, `*.write` for mutations). Either failing → 401/403.
- **Role-based routing:** `RoleGuard` (web) + scope assertions (API). Roles: `director`, `coordinator`, `social_worker`. Directors get population/governance/quality/team; coordinators get panel/tasks/care-plans.
- **Scope enforcement even on replay:** `assertScope` runs on the cache-replay path (no HAPI round-trip) so the role→scope invariant can't drift between live and replay.
- **Audit:** every FHIR read/write writes an `audit_log` row (`actor`, `action`, `fhir_resource`, `outcome`); denials audited by the scope guard, successes by the route.

---

## 7. Frontend Screens

| Screen | Route | Role | Notes |
|---|---|---|---|
| Login | `/login` | all | JWT issue |
| My Patients | `/coordinator` | coordinator | assigned panel |
| Patient Panel | `/panel` | director | grid of patients |
| **Patient Detail** | `/patients/:id` | all | 3 view modes: Panel, Cinema, Orchestrator — live SSE agent feeds, findings, action-plan cards |
| Patient Profile | `/patients/:id/profile` | all | demographics + conditions |
| SDOH | `/patients/:id/sdoh`, `/sdoh` | all | AHC-HRSN, referrals |
| Task Queue / Detail / Center | `/tasks`, `/tasks/:id`, `/task-center` | coordinator | complete/defer/escalate transitions |
| Care Plan Builder | `/care-plans/:patientId` | coordinator | POST care plan |
| Population | `/population` | director | risk×urgency scatter, critical-zone KPIs |
| Governance | `/governance` | director | audit trail, model performance, demographic parity |
| Quality | `/quality` | director | HEDIS measure completion |
| Team | `/team` | director | team performance |
| Cost / ROI | `/cost-roi` | director | projected cost avoidance |
| Alerts / Settings | `/alerts`, `/settings` | all | clinical alerts, prefs |

### 7.1 Patient Detail (flagship)
- **Panel view:** 3-column layout with per-agent cards (status pill + streamed reasoning + findings with severity dot, FHIR citation, confidence).
- **Cinema view:** left-rail patient card + 4 agent panels + action-plan grid.
- **Orchestrator view:** animated agent graph canvas + per-agent finding streams.
- **Real-data layer:** `useQuery(['patient', id])` + per-`AgentId` feed state updated by each SSE event (no cross-agent bleed); the live stream is the single source of truth (mock only as safety net for known fixture patients).
- Task-status changes for the current patient invalidate the query so a coordinator's change live-refreshes other views (cross-surface sync via `/api/events`).

---

## 8. Real-Time Sync
- HAPI rest-hook `Subscription` (registered idempotently at boot, non-fatal on failure) POSTs Task changes to `/api/fhir/subscription-hook`.
- A shared in-process **event hub** fans those into the client SSE relay at `/api/events`.
- The web client subscribes and invalidates affected TanStack Query keys → live cross-surface updates without polling.

---

## 9. Evaluation Harness
- Synthea-generated complex patients (diabetes + CHF + depression comorbidities).
- Ground-truth care-gap labels in `data/eval/labels.json`.
- `npm run eval` scores agent output vs. labels (sensitivity/specificity); `npm run review:render` renders a clinician review (`docs/eval-clinician-review.html`, `docs/eval-report.md`).

---

## 10. Tech Stack Summary

| Layer | Choice |
|---|---|
| Backend | Node.js + Express (TypeScript) |
| DB | SQLite (`better-sqlite3`) — app state only |
| FHIR server | HAPI FHIR R4 (Docker) |
| LLM | OpenAI (structured output; citation-enforced) |
| Frontend | React 18 + Vite + TypeScript |
| Routing / data | React Router v6, TanStack Query |
| Styling | TailwindCSS |
| Realtime | SSE + FHIR Subscriptions (rest-hook) |
| Testing | Vitest / Jest (unit), Playwright (E2E), `oxlint` |

---

## 11. Local Development

```bash
npm install
npm run fhir:up        # HAPI FHIR in Docker
npm run migrate        # SQLite schema
npm run seed           # demo users (director/coordinator/social worker)
npm run fhir:import    # demo FHIR data (~500-patient cohort)
npm run dev            # web :5173 · api :4000 · HAPI :8080
```

| Service | URL |
|---|---|
| Frontend | `http://localhost:5173` |
| Backend | `http://localhost:4000` |
| HAPI FHIR | `http://localhost:8080/fhir` |

---

## 12. Design Principles
- **Every AI claim is traceable** to a FHIR resource; unverifiable claims are dropped, not shown.
- **Confidence is evidence-derived,** never model-asserted.
- **Standards over glue** — FHIR/SMART/CDS Hooks/Subscription do the interoperability work.
- **Live-vs-replay parity** — cached replays are byte-for-byte indistinguishable from live runs on the wire.
- **Defense in depth** — session auth + SMART scopes + role guards + audit on every data touch.
- **Honest staging** — demo/mock fallbacks are explicitly scoped and never fabricate identifiers.
