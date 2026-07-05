# CareSync AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the thinnest end-to-end path that proves every layer connects — a Care Coordinator logs in, lands on their My Patient Panel, and reads a patient's data live from HAPI FHIR.

**Spec:** `prd.md` (S1 in `issues.md`); decisions in `plan.md` (GD1, GD3, GD5).

**Architecture:** npm-workspaces monorepo — `apps/web` (React + Vite + TS + Tailwind), `apps/api` (Express + TS). HAPI FHIR R4 in Docker is the data backbone; SQLite (better-sqlite3) holds users + audit. The API authenticates users with a role-carrying JWT and reads HAPI, enforcing role→FHIR-scope filtering. Real SMART Backend Services token exchange + HAPI interceptor is the last S1 task, so it hardens a working skeleton rather than blocking it.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind v3, React Router v6, TanStack Query · Node/Express, better-sqlite3, jsonwebtoken, bcrypt · HAPI FHIR R4 (Docker) · Synthea (S5) · Vitest, Jest + Supertest.

**Domain source note:** No `docs/domain/` or ADRs yet; vocabulary/rules from `prd.md`/`plan.md`/`HANDOFF.md`. Generate formal domain docs before spec-heavy later slices.

---

## Iteration 1 — S1 Walking Skeleton — 2026-07-04

**Spec:** `prd.md` · **Slice:** S1 · **User stories:** 17, 33, 34, 36
**Ponytail pass applied:** cut work that only later slices consume; keep the skeleton minimal and truthful.

### Phase A — Scaffold & infrastructure

- [ ] **A1. Monorepo scaffold.** npm workspaces `apps/web` (Vite+React+TS+Tailwind) and `apps/api` (Express+TS). ESLint/Prettier; Vitest (web), Jest+Supertest (api).
  - *skipped:* `packages/types` (inline types per app until something is genuinely shared — ~S2 agent contracts); Playwright config (S12).
  - *Verify:* `npm run build && npm run lint` green.

- [ ] **A2. Docker HAPI FHIR R4.** `docker-compose.yml` with a healthcheck on `/fhir/metadata`. The import script (A3) retries until healthy.
  - *skipped:* standalone wait-for-hapi helper (compose healthcheck + import retry cover it).

- [ ] **A3. Import the hero + panel patients (GD3).** Hand-author the Maria Chen R4 bundle (HbA1c 8.9%, BNP 340, eGFR 52, K+ 3.4; E11.9/I50.9/F33.1; AHC-HRSN positive; 48h post-CHF-discharge; risk 87) plus ~5 patients for the Coordinator's panel. Bulk-import via `POST /$batch`.
  - *skipped:* 500-patient Synthea generation → **S5** (the population dashboard is its only consumer; generating it now is slow and unused).
  - *Verify:* Maria is fetchable by a stable id with her exact Observations.

### Phase B — Backend core (test-first)

- [ ] **B1. SQLite schema.** `users` (id, email, bcrypt hash, name, role) + `audit_log` (id, ts, actor, action, fhir_resource, outcome). Idempotent migrate at boot.
  - *skipped:* `sessions` table — JWT is stateless; add only if token revocation is needed.

- [ ] **B2. Seed demo accounts.** Three roles (`director@`/`coordinator@`/`socialworker@caresync.demo`, `Demo1234!`), bcrypt, role set. Idempotent.
  - *Domain rule:* role provisioned at creation, never user-selectable (GD5 / PRD D4).

- [ ] **B3. Auth + role middleware (TDD).** `POST /api/auth/login` → bcrypt verify → JWT `{id,name,role}`. Middleware rejects missing/invalid tokens, exposes `req.role`.
  - *skipped:* `GET /auth/me` — the client decodes role from the JWT payload; add when server-verified identity is actually needed.
  - *Test (Supertest):* valid login → decodable JWT with role; bad password → 401; protected route without token → 401.

- [ ] **B4. Role→FHIR-scope enforcement (API-side).** Map each role to allowed FHIR resource domains; the read service (B5) denies out-of-scope reads. This is the *real denial behavior* (Social Worker cannot read non-SDOH resources).
  - *Domain rule:* every call scoped to the role's FHIR permissions (GD5).

- [ ] **B5. FHIR read service + routes (audit in one place).** A single HAPI-client wrapper performs every read and writes one `audit_log` row per call — all callers route through it, so audit is never retrofitted. Methods: `getPatient(id)`, `getConditions(id)`, `getAssignedPanel(coordinatorId)`. Routes: `GET /api/patients/:id`, `GET /api/patients/assigned` (role-scoped list with risk score + task count).
  - *Domain terms:* Patient, Condition (FHIR R4); "assigned panel" = Coordinator's patients (story 17).
  - *Test (Supertest vs test HAPI):* Coordinator reads Maria's conditions; Social Worker token denied non-SDOH reads; each read writes an audit row.

- [ ] **B6. SMART Backend Services + HAPI enforcement (GD5 — sequenced last).** Mint a signed JWT client assertion → exchange for an access token (cached to expiry) → `Authorization: Bearer` on all HAPI calls; configure HAPI's authorization interceptor to require + validate the token so the standard is load-bearing (G1).
  - *ponytail:* runs after the skeleton is green so it hardens a working path, not blocks it. **If it slips, record in `plan.md` §3 that SMART is API-side scoping only until this lands — do not claim SMART while HAPI is open.**
  - *Test:* assertion/token unit test; integration test shows a HAPI call carrying a validated Bearer token.

### Phase C — Frontend foundation

- [ ] **C1. Web foundation + design tokens.** Tailwind config with CareSync tokens (HANDOFF §4 — bg/surface/agent colors/text scale, mono for FHIR IDs). App shell: 48px header, dark clinical layout, SVG icons (no emoji).

- [ ] **C2. Routing + auth + API client + login (W01).** React Router v6 role-guarded routes; TanStack Query client injecting the auth header; login screen posting to `/auth/login`; role→home redirect (Coordinator → W12). Token in `localStorage` behind a small `useAuth` hook.
  - *skipped:* Zustand — `localStorage` + `useAuth` covers auth state; add a store when shared client state exceeds auth.
  - *Domain rule:* home screen derived from role, not user-chosen (GD5).
  - *Test (Vitest):* guard redirects unauthenticated users; role→home mapping correct.

- [ ] **C3. W12 My Patient Panel (Coordinator landing).** Fetch `/patients/assigned`; render assigned patients with risk score + task count; click → patient detail. *Story 17.*

- [ ] **C4. Patient detail (minimal).** `GET /api/patients/:id` → name + active conditions. The drill-in target and S2/S3 host screen (W03), minimal here.
  - *Verify:* opening Maria shows her name + conditions from a real HAPI read (Network tab).

### Phase D — Seam verification

- [ ] **D1. API-boundary suite green (Seam 1).** Consolidate B3/B5 tests into the reference Supertest suite vs a disposable test HAPI + seeded data. Template for all later slices.
  - *Verify:* `npm run test:api` green.

- [ ] **D2. End-to-end smoke.** Clean: `docker compose up` → migrate → seed → import → `npm run dev` → log in as Coordinator → My Patient Panel → open Maria → conditions live. Confirm Social Worker scope denial.
  - *Verify:* all S1 acceptance criteria in `issues.md` satisfied.

### Rollback / safety
- All state in the disposable HAPI container + local SQLite. `docker compose down -v` + delete SQLite = full reset. No external systems, no real PHI.

### Definition of done (S1)
A–D green, `npm run test:api` passing, D2 smoke passes end-to-end. If B6 trails, the SMART honest-staging note is recorded in `plan.md` §3.

---

## Iteration 2 — S2 Single-agent analysis with citation enforcement — 2026-07-04

**Spec:** `prd.md` · **Slice:** S2 (`issues.md`) · **Decisions:** `plan.md` GD11 (citation enforcement is real, core P3/P4), GD13 (agent provider **revised 2026-07-04**: OpenAI `gpt-5.5`, not Claude Sonnet 5 — no Anthropic key was available for the D3 live-call verification; user-approved straight substitution under the same `runRiskAgent`/`AgentEvent` contract), GD2 (cache/replay — *deferred to S4*).

**Goal:** On Maria's detail view, "Run Analysis" dispatches one live **Risk agent** (OpenAI `gpt-5.5`, structured output via the Responses API) over her retrieved FHIR bundle; findings stream to a single feed box over SSE, and every `fhirResourceId` the agent emits is validated against the IDs actually present in the bundle — fabricated citations are dropped before they reach the UI.

**Architecture:** New `apps/api/src/agents/` module: a pure **citation validator** (Seam 2), a `getPatientBundle` read on the existing audited `FhirReadService` (backed by HAPI `$everything`), and a single `runRiskAgent` function. A new SSE route streams findings and runs each through the validator before emit. Frontend adds the "Run Analysis" control and one streaming Risk feed box to `PatientDetail` (W03), consuming SSE via `fetch` streaming. **This slice deliberately stays at one agent** — S3 adds the other three + Action Planner Tasks (and extracts the shared agent interface then), S4 adds the agent-graph canvas + cache. No DB schema change (S2 persists nothing beyond the existing audit spine).

**Tech Stack (delta):** `openai` (Node SDK, `gpt-5.5`, Responses API — `client.responses.create({stream:true})`, flat `tools:[{type:'function',...}]`, streamed `response.output_text.delta`/`response.function_call_arguments.*` events) · HAPI `Patient/$everything` · SSE over Express `text/event-stream` · `fetch` ReadableStream on the client.

**Ponytail pass applied:** one agent, as a plain function — no `Agent` interface until S3 has four real agents to generalize from; `$everything` instead of a per-type read fan-out, with `validIds` derived from the returned bundle (single source of truth); no client-factory module (the SDK client is the abstraction); no cache/persistence, no canvas (S4); no shared `packages/types` yet (agent output type lives in `apps/api`, imported by the client until S3 needs sharing); reuse the existing `buildApp`/defaulted-param test pattern, no new harness.

### Phase A — Agent foundation & contracts (backend, test-first)

- [x] **A1 (revised). OpenAI SDK + config.** Add `openai`; `OPENAI_API_KEY` in `apps/api/.env.example`; `MODEL = 'gpt-5.5'` const in `riskAgent.ts`. *(Checkbox corrected 2026-07-04 — this was already implemented and checked in `tasks/todo.md`; the client construction was made lazy in the post-review pass below, not module-level, to fix a boot-time crash.)*
  - *Domain rule:* agent model is OpenAI `gpt-5.5` (GD13, revised 2026-07-04 — see plan.md).
  - *ponytail:* no factory module — the SDK client *is* the abstraction; one `new OpenAI()` covers it.

- [x] **A2. Citation validator — Seam 2 (pure module, TDD).** `src/agents/citationValidator.ts`: `validateCitations(flags, validIds) → { valid, dropped }`, no I/O. Given agent flags each carrying a `fhirResourceId` and the set of valid `ResourceType/id` strings, partition into passed vs dropped/flagged.
  - *Domain rule:* backend validates every citation against the bundle and drops/flags hallucinated IDs (GD11) — the non-negotiable innovation.
  - *Test (Vitest/Jest, first):* one in-bundle citation + one fabricated → valid passed, fabricated dropped; empty flags → empty result; case/whitespace normalization defined by the test.

- [x] **A3. Patient bundle retrieval (extend audited `FhirReadService`).** Add `getPatientBundle(actor, patientId)` → `{ resources, validIds }`, backed by a **single** `GET /Patient/{id}/$everything` (native HAPI operation — returns the whole record in one Bundle) through the existing audited `fhirFetch` + role `guard`. `validIds` is **derived from `resources`** (`new Set(resources.map(r => \`${r.resourceType}/${r.id}\`))`) — never assembled separately, so the agent's input and the citation-check set cannot drift.
  - *Domain terms:* FHIR R4 `$everything`; "bundle" = the retrieved resource set citations are checked against (GD11).
  - *ponytail:* `$everything` replaces a per-type fan-out (getPatient + getConditions + getObservations…) — one call, one audit row, and citation validity = "was in the record we read," which is exactly GD11.
  - *Test (Supertest vs test HAPI):* Maria's bundle contains her known conditions + labs; `validIds` matches the returned resource ids 1:1; a Social-Worker-scoped read still denies (`guard` on `clinical`).

### Phase B — Risk agent service + SSE (backend, test-first)

- [x] **B1 (revised). Risk agent (`runRiskAgent`).** `src/agents/riskAgent.ts`: a plain `runRiskAgent(bundle): AsyncIterable<AgentEvent>` on **OpenAI `gpt-5.5`** (Responses API) with **structured output** (`text.format` json_schema and/or a `report_risk` function tool): `{ riskScore, riskLevel, flags: [{ text, fhirResourceId }], readmissionProbability }`. Same `AgentEvent`/`RiskOutput` contract as the original Anthropic version — B2/C1/C2 need zero changes.
  - *Domain rule:* structured output; every flag cites a FHIR resource ID (GD11).
  - *ponytail:* **no `Agent` interface yet** — one implementation. S3 extracts the shared interface from the four real agents (generalize from variation you can see, not from one guess).
  - *Test:* prompt-build + response-parse against a **mocked OpenAI client** (no live call in CI); the live call is proven in D3, labeled *live* vs the *local-mock* unit evidence.

- [x] **B2. Analysis SSE route + validation gate.** `createAnalysisRouter(fhirService, runAgent = runRiskAgent)` — the agent fn is a defaulted param so tests pass a stub without a live call. `POST /api/patients/:id/analysis` responds `text/event-stream`: streams the agent's findings incrementally (`finding` events for the live feed) then a `complete` event. **Each flag's `fhirResourceId` passes through the A2 validator against the A3 bundle IDs before emit** — dropped citations never reach the client. `requireAuth` applies; wire into `index.ts`.
  - *Domain rule:* no finding reaches the UI citing a resource absent from the retrieved bundle (GD11); the analysis read is audited.
  - *Test (Supertest, boundary — S2 acceptance):* stub agent yields one in-bundle + one fabricated citation → the streamed result contains **only** the valid citation, and *all* returned citations resolve in the bundle; an audit row is written for the analysis read.
  - *Decision (streaming mechanics):* stream the agent's text output token-wise into the feed for the live effect, and emit validated structured flags as discrete `finding` events; exact delta handling is TDD-driven. *skipped:* GET/`EventSource` variant — client uses `fetch` streaming so it can send the `Authorization` header (no token-in-query hack).

### Phase C — Frontend: Run Analysis + streaming Risk feed

- [x] **C1. API client streaming.** `streamAnalysis(patientId, handlers)` in `src/api/client.ts` using `fetch` + `ReadableStream`, attaching the auth header and parsing SSE `finding`/`complete` events.

- [x] **C2. `PatientDetail` "Run Analysis" + Risk feed box (W03, mockup fidelity).** Add the **Run Analysis** control (`#runLabel` in `reference-materials/caresync-ai.html`) and one **Risk Agent feed box** (`.feed` red accent, `.feed-text.streaming` blinking cursor) that renders streamed text incrementally and validated flags as citation chips (`Condition/…`, `Observation/…` in mono, matching the existing `Task/{id}` treatment).
  - *Mockup-fidelity deviations (recorded per CLAUDE.md UI rules):* the other three feed boxes (Care Gap/SDOH/Action Planner) render as honest **idle placeholders** ("Awaiting analysis run…", as in the mockup) — wired in **S3**; the agent-graph canvas is **omitted** — built in **S4**. Structural fidelity for the Risk feed itself targets ≥80%.
  - *Test (Vitest, mocked stream):* text renders incrementally; a validated finding with its FHIR citation chip appears; the idle placeholders stay idle.

### Phase D — Verification (Seam 2 + E2E)

- [x] **D1. Unit + API suites green.** `npm run test:api` (49/49) and `npm run test:web` (14/14) pass.

- [x] **D2. Frontend E2E (`frontend-e2e-verification`).** Playwright: log in as Coordinator → open Maria → **Run Analysis** → feed streams incrementally → a validated finding with its FHIR citation renders. Added `apps/web/e2e/patient-analysis.spec.ts` alongside the S1 specs. **Evidence strength: packaged UI / local-mock** for the streaming/finding path (route-intercepted SSE, real event framing, real citation id) — login/nav/idle-state/button-state assertions run against the real local stack. Does not exercise the server-side citation-drop path (covered by B2's Supertest) or a live model call (that's D3).

- [x] **D3 (revised). Live-call evidence — done 2026-07-04.** One real `POST /api/patients/maria-chen/analysis` call against **OpenAI `gpt-5.5`** (`OPENAI_API_KEY` in root `.env`, loaded via `apps/api/src/env.ts`), API booted standalone (port 4001) against the live HAPI container. **Evidence strength: live.**
  - Streamed ~70 `token` events narrating real clinical reasoning (CHF readmission risk, BNP/HbA1c/eGFR/K+, SDOH, depression, pending med-rec) — genuine token-by-token streaming, not canned text.
  - 9 `finding` events, each independently cross-checked against a fresh `Patient/maria-chen/$everything` fetch: **all 9 `fhirResourceId`s resolve in the real bundle** (`Encounter/maria-chen-chf-admit`, `Condition/maria-chen-chf`, `Observation/maria-chen-{bnp,hba1c,egfr,potassium,sdoh}`, `Condition/maria-chen-depression`, `Task/maria-chen-task-medrec`).
  - `complete` event: `{riskScore:88, riskLevel:"critical", readmissionProbability:0.62, findingCount:9, droppedCount:0}` — the model didn't fabricate anything on this run, so the drop path wasn't exercised live.
  - **Fabrication-drop proof:** ran the *actual production* `validateCitations` (not a reimplementation) against these 9 real live flags plus one synthetic fabricated flag (`Observation/does-not-exist-99999`) → `valid: 9, dropped: 1`, fabricated id confirmed absent from `valid`. Combines real live model output with a deterministic proof of the drop mechanism GD11 requires, since a live model can't be forced to hallucinate on demand.

### Rollback / safety
Additive only — no DB migration (no persistence until S4's cache). Disposable HAPI + local SQLite reset as in S1 (`docker compose down -v`). Unset `OPENAI_API_KEY` to disable live analysis; the route degrades to an explicit error, not a fake result (honest staging) — **true as of the post-review fixes below; it was not true before them (E3).**

### Post-review fixes — done 2026-07-04

`verification-before-completion` and `code-review` (see `verification.md`, `review.md`) found three real defects and two duplicated-type Standards findings, none exercised by the D1–D3 evidence above (which only covers the success path). All fixed, test-first, same pass:

- [x] **E1. SSE error handling.** `routes/analysis.ts`'s `for await` agent-streaming loop had no error handling; an agent failure mid-stream (proven to happen — `riskAgent.test.ts`'s "throws if the model never calls report_risk" case — or any transient OpenAI failure) hung the client forever and, since `res.writeHead(200)` had already run, produced an unhandled promise rejection with no process-level handler — crashing the whole API under Node 22's default `--unhandled-rejections=throw`. Fixed: the loop is wrapped in try/catch; on failure it emits an `error` SSE event and ends the response. *Test:* `analysis.test.ts` — a throwing stub agent yields an `error` event and no `complete` event, response doesn't hang.
- [x] **E2. Narration citations bypassed GD11.** Only the structured `flags` array was validated against the bundle; the agent's free-text narration (streamed as `token` events) could mention a `ResourceType/id` with zero validation. Fixed: `citationValidator.ts` gained `redactUnvalidatedCitations` (pure, regex-based) and `createNarrationBuffer` (holds back a 96-char tail so an id split across two token deltas is still whole when checked, then redacts before releasing — trades a small bounded delay in the streaming effect for a real enforcement guarantee, instead of buffering the whole narration and losing the streaming effect entirely). Wired into `routes/analysis.ts`'s token-emit path. *Tests:* 8 new cases in `citationValidator.test.ts` (redaction, buffering, split-across-deltas) + a route-level case in `analysis.test.ts` proving a fabricated id in narration is redacted end to end while a valid one passes through.
- [x] **E3. Boot-time crash on missing API key.** `riskAgent.ts`'s `export const openai = new OpenAI()` ran at module import time and throws synchronously with no key — since `index.ts` imports the analysis route unconditionally at startup, an unset key crashed the *whole process at boot*, contradicting this section's own rollback claim above. Fixed: the client is now built lazily on first use (`getOpenAiClient()`), so a missing key only fails the one request that needs it. `apps/api/jest.setup.ts` (a placeholder-key workaround for the old eager-throw) is now unnecessary and was deleted, along with its `jest.config.js` wiring. *Tests:* `riskAgent.test.ts` — importing the module without a key doesn't throw; calling the agent without a key throws only then.
- [x] **E4 (Standards). Duplicated `PatientBundle`/`AgentFlag` types.** Both were independently redeclared in 2–3 files instead of imported from one source (Shotgun Surgery risk on the next shape change). Fixed: `PatientBundle` is now exported once from `fhir/client.ts` (where `getPatientBundle` produces it) and imported by `riskAgent.ts`/`routes/analysis.ts`; `AgentFlag` is exported once from `citationValidator.ts` (the Seam 2 module) and imported by `riskAgent.ts`. No behavior change — confirmed by `tsc` build + full suite green after.

Fresh evidence after all four fixes: `npm run test:api` — **15 suites / 61 tests** (up from 49; +12 new tests across the three fix areas), `npm run build`/`lint` clean (apps/api and apps/web unaffected).

### Definition of done (S2) — maps to `issues.md` acceptance
- Run Analysis triggers a live OpenAI call producing structured Risk output (B1, D3).
- Findings stream over SSE and render incrementally in one feed box (B2, C2, D2).
- Citation validator passes an in-bundle citation and drops a fabricated one (A2 Seam 2).
- No finding citing an out-of-bundle ID reaches the UI (B2 gate; D2/D3 end-to-end).
- Citation-validator unit tests + API-boundary test asserting all returned citations resolve in the bundle (A2, B2; `npm run test:api` green).

---

## Iteration 3 — S3 Four-agent orchestration + FHIR Task creation — 2026-07-04

**Spec:** `prd.md` · **Slice:** S3 (`issues.md`) · **Decisions:** `plan.md` GD11 (citations real, all four agents), GD13 (agent provider **revised 2026-07-04**: OpenAI `gpt-5.5` via the `openai` SDK Responses API — not Claude Sonnet 5; the migrated S2 `runRiskAgent` is the reference), and the four agent I/O contracts in `prd.md` §Implementation Decisions.

**Goal:** Extend the single Risk agent to the full care team. An **Orchestrator** dispatches **Risk, Care Gap, SDOH, and Action Planner** in parallel over Maria's `$everything` bundle; each streams to its own per-agent feed box; the Action Planner synthesizes the other three into prioritized **FHIR Task** resources written to HAPI, each citing the exact resources behind it. Citation enforcement (Seam 2) applies to all four.

**Architecture:** This is the slice where the shared **`Agent` interface is extracted from the four real agents** (generalize from visible variation, not from one guess — deferred from S2 on purpose). `src/agents/` grows `careGapAgent.ts`, `sdohAgent.ts`, `actionPlannerAgent.ts`, and an `orchestrator.ts` that runs the first three in parallel, awaits their structured results, then feeds those into the Action Planner. The analysis route (`createAnalysisRouter`) switches from `runAgent = runRiskAgent` to `runAnalysis = orchestrate` (same defaulted-param, stubbable pattern) and tags every SSE event with an `agentId` so the client can route it to the right feed box. Task writes go on the **one existing FHIR client** — add `createTask`/`replacePatientTasks` to the current `FhirReadService` class (they route through the same audited, token-bearing `fetch`), auditing each write. **Do not** spin up a sibling `FhirWriteService`: one write-method group doesn't earn a second class — just extend the client (rename to `FhirService` if the read-only name bothers you; a one-line rename, not a split). Re-running deletes the prior CareSync-authored Tasks + findings before creating new ones (clean replace).

**Tech Stack (delta):** three more `openai` Responses-API function-tool agents (same shape as the migrated `runRiskAgent`, model `gpt-5.5`) · HAPI `POST /Task`, `DELETE`/conditional-delete for re-run replace · SSE events gain `agentId` · no new client transport (reuse `streamAnalysis`).

**Ponytail pass applied:** extract the `Agent` interface **now** (four concrete agents exist — the S2 note said S3 is when to generalize), not a plugin registry; Action Planner consumes the other three agents' **already-parsed structured outputs**, not a re-read of the bundle; re-run replace via a tag/identifier query + delete, not a new "analysis session" table; one orchestrator function returning a merged `AsyncIterable`, no message bus; Tasks written straight to HAPI (the FHIR server *is* the store), no local Task mirror table.

### Phase A — Agent interface + three new agents (backend, test-first)

- [x] **A1. Extract the `Agent` contract.** Define `Agent<TOutput>` (or a discriminated `AgentEvent` per agent) generalizing `runRiskAgent`'s shape: `(bundle) => AsyncIterable<AgentEvent>` where the terminal `result` carries the agent's structured output and each flag/gap/barrier/task carries a `fhirResourceId`/`fhirResources`. Refactor `riskAgent.ts` to implement it — **no behavior change**, existing S2 tests stay green.
  - *ponytail:* interface extracted from four real implementations, not invented; keep it the minimum the orchestrator + validator need.

- [x] **A2. Care Gap agent (`runCareGapAgent`).** Structured output per `prd.md`: `{ gaps: [{gapType, description, lastDone, dueDate, urgency, fhirResourceId}] }`; reads Condition/Encounter/Observation from the bundle (no `CarePlan` is seeded — **revised 2026-07-05**, see prd.md).
  - *Domain rule:* Care Gap reads Condition/Encounter/Observation (S3 acceptance, revised); every gap cites a FHIR resource id (GD11).
  - *Test:* prompt-build + tool-result parse against a **mocked OpenAI client**; live call proven in D3.

- [x] **A3. SDOH agent (`runSdohAgent`).** Structured output `{ barriers: [{domain, finding, severity, fhirResourceId}], referralsNeeded: string[] }`; reads the **AHC-HRSN screening**, seeded as an `Observation` (not a `QuestionnaireResponse` — **revised 2026-07-05**) + demographics from the bundle.
  - *Domain rule:* SDOH agent reads the AHC-HRSN screening Observation (S3 acceptance, revised); barriers cite resource ids (GD11).
  - *Test:* mocked-client parse; asserts a barrier derived from the AHC-HRSN `Observation` cites its id.

- [x] **A4. Action Planner agent (`runActionPlannerAgent`).** Input is the **three prior agents' structured outputs** (not the raw bundle); output `{ tasks: [{title, description, priority, assignTo, dueInDays, fhirResources}] }` where `fhirResources` are the ids that generated the task.
  - *Domain rule:* Action Planner synthesizes the other three (GD/prd contract); each task cites its source resources (GD11).
  - *ponytail:* consumes parsed outputs — no second bundle read, no re-derivation.
  - *Test:* given three canned agent outputs, produces tasks whose `fhirResources` are a subset of the union of cited ids.

### Phase B — Orchestrator + FHIR Task write (backend, test-first)

- [x] **B1. Orchestrator (`orchestrate(bundle)`).** Dispatch Risk + Care Gap + SDOH **in parallel** (`Promise`/merged async iteration), tag every streamed event with its `agentId`, collect the three structured results, then run Action Planner over them and stream its output too. Returns one `AsyncIterable<AgentEvent & {agentId}>`.
  - *ponytail:* one function, merged iterable — no queue/worker infra (GD1 "self-contained service" is satisfied by module boundaries, not processes).
  - *Test:* with four stub agents, all three parallel agents' events appear before the planner's, and the planner receives the three outputs.

- [x] **B2. FHIR Task write + re-run replace (audited).** Add `createTask(actor, task)` and `replacePatientTasks(actor, patientId, tasks)` to the FHIR client, going through the **same audited, token-bearing `fetch`** as reads (one audit row per write). `replace` first removes prior CareSync-authored Tasks for the patient (query by an author/tag identifier, then delete) so re-running is clean.
  - *Domain rule:* Action Planner output becomes FHIR Task resources persisted in HAPI; re-run replaces prior Tasks cleanly (S3 acceptance); every write audited (S1 audit spine).
  - *Test (Supertest vs test HAPI):* planner tasks are POSTed as FHIR Tasks resolvable in HAPI with their citations; a second run leaves exactly the new Task set (no duplicates); each write writes an audit row.

- [x] **B3. Analysis route → orchestration + validation gate for all four.** Swap `createAnalysisRouter`'s defaulted param from `runRiskAgent` to `runAnalysis = orchestrate`. Each agent's citations pass through the A2/S2 `validateCitations` gate against the bundle `validIds` **before emit and before Task creation** — a task whose citations all drop is not created. Emit `finding` events carrying `agentId`; emit a per-agent `complete`; emit `task` events for created Tasks.
  - *Domain rule:* no finding/Task reaches the UI citing an out-of-bundle resource (GD11); the analysis read + Task writes are audited.
  - *Test (Supertest, boundary — S3 acceptance):* one run yields findings from all four agents, creates the expected Tasks, and **every** returned citation (findings + Tasks) resolves in the bundle; a fabricated id injected via a stub is dropped everywhere.

### Phase C — Frontend: four live feeds + Task cards from analysis

- [x] **C1. Client: route SSE by `agentId`.** Extend `streamAnalysis` handlers so `onFinding`/`onToken`/`onComplete` carry `agentId`, and add `onTask`. No new transport.

- [x] **C2. `PatientDetail`: light up all four feeds + render created Tasks (W03, mockup fidelity).** The three S2 idle placeholders (Care Gap violet / SDOH emerald / Action Planner amber) become **live streaming feeds** using the existing `FeedBox` component and per-agent accent already defined; created Tasks render as Task cards with their citation chips in the existing Tasks section.
  - *Mockup-fidelity note (per CLAUDE.md UI rules):* completes the four-feed grid from `reference-materials/caresync-ai.html`; the **agent-graph canvas above the feeds is still omitted — built in S4**. Record this as the one remaining deviation for W03.
  - *Test (Vitest, mocked stream):* a finding on each of the four `agentId`s renders in its own feed with the right accent; a `task` event renders a Task card with its citation chip.

### Phase D — Verification (Seam 1/2 + E2E)

- [x] **D1. Unit + API suites green.** `npm run test:api` — 19 suites / 80 tests. `npm run test:web` — 5 files / 24 tests. Both `npm run build` clean. Real local HAPI confirmed clean of stray `ai-generated-task` Tasks after full runs.
- [x] **D2. Frontend E2E (`frontend-e2e-verification`) — done 2026-07-05.** Extended `apps/web/e2e/patient-analysis.spec.ts` with a second test: Coordinator → Maria → Run Analysis → all four feeds stream (route-intercepted SSE with `agentId`-tagged frames matching the real route's wire format) → a Task card renders with its citation chips. **Evidence strength: packaged UI / local-mock.** While extending, the run surfaced that the *existing* S2 test's mocked frames predated S3's `agentId` tagging (no `agentId` on `token`/`finding`/`complete`) — under the current `withText`/`withFinding` (keyed by `agentId`), those frames no longer route to any feed, so the S2 test itself started failing. Fixed by adding `agentId: 'risk'` to its frames (no product-code change needed there); also added a `data-testid={task.key}` to task cards in `PatientDetail.tsx` to scope the new test's citation assertions (the same `Condition/…`/`Observation/…` ids otherwise also match the Active Conditions list and feed finding chips). `npm run test:e2e`: 4/4 green; `npm run test:web`: 24/24 still green.
- [x] **D3. Live-call evidence — done 2026-07-05.** API booted standalone (`PORT=4001`) against the live HAPI container; one real `POST /api/patients/maria-chen/analysis` call against OpenAI `gpt-5.5` (~27s, 209 streamed tokens). All four agents produced structured output with 0 dropped citations: risk (9 findings, riskScore 88/critical), careGap (8 findings), sdoh (2 findings), actionPlanner (10 tasks). Confirmed live in HAPI: `GET /Task?patient=maria-chen` returns the 10 newly created CareSync Tasks (ids 36–45) alongside the 2 seed Tasks, each with its citations intact. Fabrication-drop path proven against the real `validateCitations` (not a synthetic unit test): took the 9 real citations from this run's risk flags plus 1 deliberately fabricated id, validated against a fresh live `$everything` fetch's `validIds` (20 resources) → 9 valid / 1 dropped. **Evidence strength: live.**

### Post-review fixes — done 2026-07-05
The whole-implementation review pass (after all of Phase A–C individually passed spec + code-quality review) found two real defects, neither exercised by any single task's own review because each surfaced only from viewing the composed system:

- [x] **E1. Streamed narration misattributed to the wrong feed.** `apps/web/src/api/client.ts`'s `dispatch` parsed `payload.agentId` off every `token` SSE frame and then discarded it, forwarding only `text`; `PatientDetail.tsx` covered the gap with an `activeAgentRef` heuristic that only updated on `finding`/`complete` (i.e., at an agent's *completion*, not its narration). Since the Orchestrator genuinely interleaves Risk/Care Gap/SDOH's `token` events (per `orchestrator.test.ts`'s own interleaving proof), a concurrently-narrating agent's pre-completion tokens landed in whichever feed box the ref last pointed at — demo-visible text bleeding between boxes. Fixed: `onToken` now carries `(agentId, text)` end-to-end; `activeAgentRef` deleted. *Test:* a new interleaving regression test in both `client.test.ts` and `PatientDetail.test.tsx` reproduces the exact bug ordering (token before any finding/complete) and asserts correct per-agent attribution.
- [x] **E2. Three of four feeds never visibly streamed.** `AgentFeedContent` rendered the idle placeholder until `feed.started` flipped true, but `withText` (unlike `withFinding`/`withSummary`) never set it — so Care Gap/SDOH/Action Planner stayed on "Awaiting analysis run…" through their entire narration phase and only "popped" the full accumulated text the instant their `result` arrived, defeating the point of streaming for 3 of 4 boxes. Not caught by the existing isolation tests because they fired `onFinding` before `onToken` — an ordering that doesn't match the real backend (narration always precedes an agent's terminal result). Fixed: `withText` now also sets `started: true`. *Test:* a new regression test fires `onToken` alone (no finding/complete yet) and asserts the box shows live text instead of the placeholder.

### Post-review spec correction — done 2026-07-05
- **AC #4 wording did not match the real data model.** `issues.md`/`prd.md` originally required "SDOH reads the AHC-HRSN QuestionnaireResponse; Care Gap reads CarePlan/Encounter," but the S1 seed pipeline (`seed-patients.ts`/`import-fhir.ts`, unchanged by S3) never creates a `QuestionnaireResponse` or `CarePlan` resource — the AHC-HRSN screening is seeded as an `Observation`. Verified live against HAPI: `Patient/maria-chen/$everything` returns only `Patient/Condition/Observation/Encounter/RiskAssessment/Task/Group`. This did not compromise citation safety (both agents cite real, in-bundle resource ids of the types that actually exist) — it was a spec/data-model mismatch, not a functional defect. User-approved fix: reworded `issues.md`/`prd.md`/this plan to match the real seeded types rather than changing the seed data.

### Rollback / safety
Task writes are additive to HAPI and reversible via `docker compose down -v`. Re-run replace only touches CareSync-authored Tasks (tag-scoped delete) — never Synthea/seed Tasks. No DB migration (analysis still persists nothing until S4 cache).

### Definition of done (S3) — maps to `issues.md` acceptance
- Four agents run in parallel from the Orchestrator; each streams to its own feed (B1, C2). ✅ verified, including the post-review streaming fixes.
- Action Planner output becomes FHIR Tasks persisted in HAPI (B2). ✅ verified live against real HAPI.
- Each Task cites validated (non-fabricated) FHIR resources (B3, Seam 2). ✅ verified end-to-end (agent → route gate → HAPI/client).
- SDOH reads the AHC-HRSN screening Observation; Care Gap reads Condition/Encounter/Observation (A2, A3, revised 2026-07-05). ✅ verified against real seed data.
- Re-running replaces prior findings + Tasks cleanly (B2). ✅ verified live, twice, on two different patients (parallel-test-safe).
- API-boundary test: all four agents' findings + created Tasks with resolvable citations (D1) ✅. E2E (D2) ✅ and live-call evidence (D3) ✅ — both done 2026-07-05. Evidence strength to date: **source-level + local mock (D1/D2) + live (D3).**

---

## Iteration 4 — S4 Agent-graph canvas + analysis cache/replay — 2026-07-04

**Spec:** `prd.md` · **Slice:** S4 (`issues.md`) · **Decisions:** `plan.md` GD2 (cache + live re-run + recorded fallback — demo reliability is first-class), GD10 (native Canvas, no chart library).

**Goal:** The signature W03 visual and the demo-reliability mechanism. A native **Canvas agent graph** (`requestAnimationFrame`, 5-node radial layout, bezier edges, particle flow, per-agent color, state machine `IDLE→INIT→DISPATCH→ANALYZING→SYNTHESIZING→COMPLETE`) visualizes the S3 orchestration; the last successful analysis per patient is **cached** and replays instantly/deterministically, while an explicit **live** trigger forces a fresh model run (OpenAI `gpt-5.5`) and re-caches.

**Architecture:** Backend gains a small **analysis cache** — a SQLite `analysis_cache` table keyed by patient id holding the full validated result set (findings per agent + created Task **payloads**, not just ids + summary) as JSON, plus model version + timestamp. Storing Task content, not ids, keeps replay self-contained: S3's re-run deletes+recreates Tasks with fresh ids (B2), so a cache that held only ids could dangle to deleted Tasks. The analysis route reads: default request serves the cached result (replayed through the same SSE shape so the UI treatment is identical); `?live=1` runs the orchestrator, re-caches, and streams live. Frontend adds a `AgentGraph` canvas component driven by the analysis state machine, wired to the same stream events.

**Event→state contract (resolve before B1).** S3's SSE vocabulary (Iteration 3, B3) is `finding`/`complete`/`task`, each tagged with `agentId` — there is **no `dispatch` or `synthesizing` event**. S4 does **not** add backend events; the client derives the state machine from the existing stream: `INIT`→`DISPATCH` on stream open (all four agent nodes pending), `ANALYZING` per node on its first `agentId`-tagged `finding`/`token`, `SYNTHESIZING` on the first event with `agentId: actionPlanner`, `COMPLETE` on the final `complete`. This derivation is the "documented event sequence" B1's test asserts against — write it down as a fixture. (If a demo needs crisper node timing later, adding an explicit `dispatch` event is an S3-orchestrator change, out of S4 scope.) **No chart/animation library** — raw Canvas 2D + `requestAnimationFrame`, cleaned up on unmount.

**Tech Stack (delta):** SQLite `analysis_cache` (better-sqlite3, JSON column) · `?live=1` query flag on the existing route · one Canvas 2D component (`requestAnimationFrame`, bezier, particles) — no dependency.

**Ponytail pass applied:** cache is one table of JSON keyed by patient — not an event-sourced history; replay reuses the **exact SSE event shape** so there's one client code path (cache vs live differ only in a flag + latency); the canvas is one self-contained component reading a state enum, no animation framework, no WebGL; `?live=1` is a query flag, not a second endpoint.

### Phase A — Analysis cache (backend, test-first)

- [x] **A1. `analysis_cache` schema + migrate.** Table `(patient_id PK, result_json, model_version, created_ts)`; idempotent migrate at boot (matches the S1 migrate pattern). Persist the **validated** result (post-citation-gate) so replay can never surface a dropped citation. `result_json` holds the full findings-per-agent set + Task **payloads** (not just ids) + summary, so replay is self-contained and can't reference a deleted Task.
  - *ponytail:* one row per patient (last successful run), overwritten on re-run — no history table (YAGNI until a "compare runs" feature exists).
  - *Test:* write-then-read round-trips the full result (including Task payloads); overwrite replaces.

- [x] **A2. Cache-aware analysis route.** On `POST /:id/analysis`: if `?live=1` → run orchestrator, persist to cache, stream live; else → if a cache row exists, **replay it** as the same `finding`/`task`/`complete` SSE events; if no cache, fall back to a live run + cache. Replay must re-emit in the **same phased order** live produces — three parallel agents' events, then the Action Planner's — tagged with the same `agentId`s, so the canvas animates through the identical state machine (not a single burst). Pacing between events is cosmetic; the ordering is not.
  - *Domain rule:* cached analysis replays deterministically without a live model call; explicit live trigger forces a fresh run and re-caches (S4 acceptance); cache is real prior output, not a script (GD2); cached and live share UI treatment, which requires matching event order (C2).
  - *Test (Supertest):* (a) seed a cache row → default request replays it with **zero** agent invocations (stub agent asserts not-called) and the replayed events carry the same `agentId`s in the same phased order as live; (b) `?live=1` invokes the (stub) orchestrator and updates the row; (c) **cold cache** (no row) → default request runs the (stub) orchestrator exactly once and the row now exists.

### Phase B — Agent-graph canvas (frontend)

- [x] **B1. Analysis state machine (client).** A small reducer/hook mapping stream events → graph state (`IDLE→INIT→DISPATCH→ANALYZING→SYNTHESIZING→COMPLETE`) and per-node status (Orchestrator + 4 agents), per the **Event→state contract** above (derived from `finding`/`complete`/`task` + `agentId` — no `dispatch` event exists). Pure and unit-testable.
  - *Test (Vitest):* the documented event sequence (the fixture from the Event→state contract) drives the states in order; per-agent nodes flip to ANALYZING on their first tagged event and COMPLETE on their `complete`; `SYNTHESIZING` fires on the first `actionPlanner` event.

- [x] **B2. `AgentGraph` Canvas component (W03, mockup fidelity).** Native Canvas: 5-node radial layout (Orchestrator center + 4 agents), bezier edges, particle flow along active edges, per-agent color identity **consistent with the feed boxes and Task citation chips**, animated via `requestAnimationFrame` and torn down on unmount. Placed above the feeds grid per `reference-materials/caresync-ai.html`, closing W03's last deviation.
  - *Domain rule:* no chart library (GD10); per-agent color consistent graph→feed→task (S4 acceptance).
  - *ponytail:* one component, no lib; guard against SSR/`useEffect` leaks; respects `prefers-reduced-motion` by rendering the final state statically.
  - *Verify:* graph animates through the state machine in sync with the streaming analysis (visual, in E2E/manual).

- [x] **B3. Live vs cached UI parity + trigger.** Wire a "Run live" affordance that hits `?live=1`; default Run Analysis serves cache. Both drive the identical graph + feeds treatment.

### Phase C — Verification
- [x] **C1.** `npm run test:api` (cache replay/live) + `npm run test:web` (state machine) green.
- [x] **C2. Frontend E2E (`frontend-e2e-verification`).** Cached replay renders graph→feeds→tasks with no live call; the live trigger forces a fresh run; both produce the same UI treatment (GD2). Run with reduced-motion **disabled** in the browser context (the B2 `prefers-reduced-motion` path renders the final state statically and would not exercise the animation-in-sync assertion).

### Rollback / safety
Cache is a single SQLite table — deletable without affecting HAPI; `docker compose down -v` + delete SQLite resets. A stale/absent cache degrades to a live run, never a fake. Canvas is presentational — no data risk.

### Definition of done (S4) — maps to `issues.md`
- Canvas graph animates through the state machine in sync with streaming; no chart library (B2).
- Per-agent color consistent node→feed→task (B2).
- Cached analysis replays deterministically with no live model call; live trigger forces a fresh run + re-cache (A2, B3).
- Cached and live runs share UI treatment; cache is real prior output (A1/A2, C2).

---

## Iteration 5 — S5 Population Dashboard + drill-in (Director) — 2026-07-04

**Spec:** `prd.md` (stories 1–4) · **Slice:** S5 (`issues.md`) · **Decisions:** GD3 (~500 Synthea now — this slice is its only consumer, deferred from S1), GD10 (native Canvas scatter), GD5 (Director routing/scope). **Blocked by S1 only — parallelizable with S2/S3.**

**Goal:** The Director's entry narrative (W02). On login a Director lands on a Population Dashboard: ~500 patients as a risk scatter (risk × urgency), a critical-zone count, a projected cost-avoidance figure, and team KPIs — all from a **population aggregate API over HAPI**. Clicking a cluster drills to a filtered patient list, then a patient detail view.

**Architecture:** This slice finally runs the **Synthea import deferred from S1** (~500 diabetes/CHF/depression patients, bulk `$batch` into the same HAPI). Backend gains a `population/` aggregate service: `getPopulationScatter()` (risk score + urgency per patient, from RiskAssessment + condition/encounter recency), `getPopulationSummary()` (critical-zone count, computed cost-avoidance, team KPIs) — all through the audited FHIR client. Frontend adds W02 as the **Director home route** (role→home already exists from S1's `RoleGuard`; add the Director branch) with a native Canvas scatter and drill-in navigation to a filtered `PatientPanel`-style list → existing `PatientDetail`.

**Tech Stack (delta):** Synthea generation + `$batch` import script (extends `scripts/import-fhir.ts`) · `population/` aggregate module · one Canvas 2D scatter component (no chart library, GD10) · Director route branch in `App.tsx`/`RoleGuard`.

**Ponytail pass applied:** aggregate over HAPI search/`_count` + a bounded fan-out, not a precomputed analytics store; cost-avoidance is a **documented transparent formula** over real counts (risk-weighted avoided-readmission × unit cost), computed not hardcoded, with the formula recorded — not an ML model; one scatter component reusing the S4 canvas patterns; drill-in reuses the existing panel/detail screens with a filter param, not new screens; Synthea import is a script run, not a pipeline.

### Phase A — Population data + aggregate API (backend, test-first)

- [x] **A1. Synthea import (~500).** Generate the diabetes+CHF+depression cohort and bulk-import via `$batch` into the same HAPI, alongside the curated hero bundles. Extend the existing import script; idempotent/re-runnable.
  - *ponytail:* the population's **only** consumer is this dashboard (why S1 skipped it); generate once, commit the seed or the generation command.
  - *Verify:* HAPI holds ~500 patients with RiskAssessment + demographics; hero patients still resolve.

- [x] **A2. Population aggregate service (audited).** `getPopulationScatter(actor)` → per-patient `{id, riskScore, urgency, x, y}`; `getPopulationSummary(actor)` → `{criticalZoneCount, projectedCostAvoidance, teamKpis}`. Director-scoped (aggregate). Cost-avoidance from a **recorded formula** over real risk counts. Routes `GET /api/population/scatter`, `GET /api/population/summary`.
  - *Domain rule:* critical-zone count + cost-avoidance computed from patient data, not hardcoded (S5 acceptance, GD12 spirit); every read audited.
  - *Test (Supertest vs test HAPI):* scatter returns ~500 points over seeded data; summary counts match the seeded critical cohort; the cost formula is asserted against a fixed small fixture.

### Phase B — Director routing + W02 dashboard (frontend, mockup fidelity)

- [x] **B1. Director home route.** Extend role→home so Director lands on `/population` (not the Coordinator `/panel`); guard it Director-only. *Story 1.*
  - *Domain rule:* home screen derived from role, not user-chosen (GD5).
  - *Test (Vitest):* Director → `/population`; Coordinator still → `/panel`.

- [x] **B2. W02 Population Dashboard (`reference-materials/caresync-population.html`, `#scatter` canvas).** Native Canvas risk scatter (risk × urgency), critical-zone count tile, cost-avoidance tile, team KPI tiles — from A2. Port design tokens/structure per the mockup (`html-mockup-fidelity`, ≥80%).
  - *Domain rule:* native Canvas, no chart library (GD10).
  - *Test (Vitest, mocked API):* renders the summary tiles from data; scatter receives the points.

- [x] **B3. Drill-in.** Click a scatter cluster → filtered patient list → `PatientDetail`. Reuse the existing list/detail screens with a filter param.
  - *Verify:* cluster → filtered list → detail navigation works (S5 acceptance).

### Phase C — Verification
- [x] **C1.** `npm run test:api` (population aggregates) + `npm run test:web` green.
- [x] **C2. Frontend E2E (`frontend-e2e-verification`).** Director login → W02 renders scatter + computed tiles → drill cluster → filtered list → open Maria.

### Rollback / safety
Synthea data lives only in the disposable HAPI (`docker compose down -v` resets). Aggregates are read-only. Cost-avoidance formula is documented in the slice notes so the number is defensible/honest (not a magic figure).

### Definition of done (S5) — maps to `issues.md`
- Director login routes to W02 (B1).
- Scatter renders ~500 patients from real HAPI-derived aggregates, native Canvas (A1, A2, B2).
- Critical-zone count + cost-avoidance computed from data, not hardcoded (A2).
- Drill-down cluster → filtered list → detail works (B3).
- API-boundary tests for the population endpoints over seeded data (A2, C1).

---

## Iteration 6 — S6 Task assignment + real-time FHIR Subscription — 2026-07-04

**Spec:** `prd.md` (stories 6, 18, 32) · **Slice:** S6 (`issues.md`) · **Decisions:** GD7 (a *real* FHIR Subscription rest-hook → backend webhook → client relay — not app-level SSE relabeled). **Blocked by S3.**

**Goal:** The real-time loop. A Director assigns Maria's tasks to a specific Care Coordinator (Task updated in HAPI); a real **FHIR Subscription** (HAPI rest-hook on Task create/update) calls an API webhook, which relays the change to connected clients over SSE/websocket, so the Coordinator's view updates live with an assignment notification — no manual refresh.

**Architecture:** Backend gains: an **assignment endpoint** (`PATCH`/update Task `owner`/`requester` in HAPI via the audited write client from S3), a **Subscription bootstrap** that creates the HAPI `Subscription` resource (rest-hook targeting our webhook) at startup (idempotent), a **webhook receiver** (`POST /api/fhir/subscription-hook`) that HAPI calls on Task changes, and a **client relay** — a `GET /api/events` SSE endpoint holding open connections, keyed by user, that the webhook fans out to. Frontend subscribes to `/api/events` and updates the task queue + shows a notification on relevant changes. The **web client is wired first** (GD7); mobile subscribes once GD4 resolves (S7).

**Tech Stack (delta):** HAPI `Subscription` (rest-hook, `Task?...` criteria) · webhook receiver route · an in-process SSE hub (`Map<userId, res[]>`) for relay · client `EventSource`/`fetch`-stream consumer for `/api/events`.

**Ponytail pass applied:** relay is an **in-process connection map**, not Redis/pub-sub (single API process in this POC); the Subscription is created once at boot (idempotent), not managed via UI; assignment is a Task field update, not a workflow engine; notification is a client-side toast off the relayed event, no notification table; reuse the audited write client from S3 — no new FHIR plumbing.

### Phase A — Assignment + Subscription + relay (backend, test-first)

- [ ] **A1. Task assignment endpoint (audited).** `PATCH /api/tasks/:id/assign { coordinatorId }` → update the FHIR Task `owner` in HAPI via the S3 audited write client. Director-scoped.
  - *Domain rule:* Director assigns a patient's tasks to a Coordinator (story 6); write audited.
  - *Test (Supertest vs test HAPI):* assignment sets Task.owner; reflected on read; audit row written.

- [ ] **A2. FHIR Subscription bootstrap.** At boot, idempotently ensure a HAPI `Subscription` (rest-hook, criteria on Task create/update) pointing at our webhook URL. Record the honest-staging status if HAPI's rest-hook delivery needs config.
  - *Domain rule:* a real FHIR Subscription exists on HAPI with a rest-hook on Task changes (S6 acceptance, GD7).
  - *Test:* the Subscription resource exists in HAPI after boot with the expected criteria + endpoint.

- [ ] **A3. Webhook receiver + relay hub.** `POST /api/fhir/subscription-hook` (HAPI → us) resolves the changed Task and fans it out over an in-process SSE hub to the affected user's `/api/events` connections. `GET /api/events` (auth'd) registers a connection.
  - *ponytail:* in-process `Map<userId, res[]>` hub — no external broker; **reuse the existing `writeSseEvent` helper from `routes/analysis.ts`** for framing, don't re-author SSE plumbing.
  - *Test (integration):* simulate a HAPI hook POST → an event is delivered to a registered `/api/events` connection for the assigned Coordinator (asserts the webhook→relay path).

### Phase B — Live client update (frontend)

- [ ] **B1. Client event subscription + live queue update + notification.** Subscribe to `/api/events`; on a relevant Task change, update the Coordinator's queue in place and show an assignment notification. No manual refresh.
  - *Domain rule:* Coordinator notified when a Director assigns them a patient (story 18); queue updates live (S6 acceptance).
  - *Test (Vitest, mocked stream):* a relayed assignment event updates the queue and shows a notification.

### Phase C — Verification
- [ ] **C1.** `npm run test:api` (assignment + webhook→relay integration) + `npm run test:web`.
- [ ] **C2. Frontend E2E (`frontend-e2e-verification`).** Director assigns Maria's task → the Subscription fires → the Coordinator's view updates live + notification appears (visible without refresh). Confirm the Subscription firing is visible in logs/network.

### Rollback / safety
Subscription + Tasks live in the disposable HAPI. The relay hub is in-memory (drops on restart, reconnect re-establishes). Assignment writes are audited and reversible. If HAPI rest-hook delivery can't be configured in the stock image, record it in `plan.md` §3 honest-staging (same class of note as SMART) — do not claim live Subscription delivery it doesn't do.

### Definition of done (S6) — maps to `issues.md`
- A FHIR Subscription with a Task rest-hook exists on HAPI (A2).
- Assigning a task updates the FHIR Task and fires the Subscription to the webhook (A1, A2, visible in logs).
- The webhook relays to the client; the queue updates live with a notification (A3, B1).
- API-boundary test for assignment + integration test for webhook→relay (C1); E2E (C2).

---

## Iteration 7 — S7 Role-filtered task queue + task actions — 2026-07-04

**Spec:** `prd.md` (stories 24, 25, 27–29, 31) · **Slice:** S7 (M02/M03 + W13) · **Decisions:** GD4 (**mobile-stack decision — resolve before starting**; recommendation on record: PWA/responsive web), GD5 (role filtering). **Blocked by S3 + the GD4 decision.**

**Goal:** The queue and its actions, built responsive per GD4. The queue **filters by role** — a Social Worker sees only SDOH-domain tasks, a Coordinator sees all. Opening a task shows the justifying patient context + citations; the user can **Complete / Defer / Escalate** (and Call), each PATCHing the FHIR Task status in HAPI and syncing back. Completing on the mobile-shaped view syncs to web via the S6 relay.

**Pre-work (gate):** **Record the GD4 mobile-stack decision** (`plan.md` §8 / a short ADR) before implementation — recommendation is PWA/responsive web (one codebase, phone-frame demo). This slice assumes that unless overridden.

**Architecture:** Backend gains a **role-filtered task listing** (`GET /api/tasks?role-scoped` — Social Worker → SDOH-domain Tasks only via the S1 scope map + Task category, Coordinator → all) and **status-transition endpoints** (`PATCH /api/tasks/:id/status` for complete/defer/escalate) on the audited write client. Frontend builds the M02 **task queue** and M03 **task detail** as responsive views (`reference-materials/caresync-mobile.html`), plus the W13 Task Management Center on web; status changes reflect back and, via the S6 relay, cross-surface (mobile→web).

**Tech Stack (delta):** role-filtered Task query (scope map + Task.category) · Task status PATCH endpoints · responsive/PWA views (M02/M03) reusing the design system · reuses the S6 relay for cross-surface sync.

**Ponytail pass applied:** filtering is the S1 role→domain scope map applied to Task.category — not a new permission system; complete/defer/escalate are **Task.status/businessStatus updates**, not a state-machine service; one responsive codebase (PWA) per the GD4 recommendation — no React Native toolchain unless the decision overrides; cross-surface sync **reuses the S6 relay** (no new channel); "Call" is a `tel:` link, not telephony integration.

### Phase A — Role-filtered listing + transitions (backend, test-first)

- [ ] **A1. Role-filtered task listing.** `GET /api/tasks` scoped by role: Social Worker → SDOH-domain Tasks only (scope map + Task.category), Coordinator → all. Audited.
  - *Domain rule:* Social Worker sees only SDOH-domain tasks; Coordinator sees all (S7 acceptance, GD5).
  - *Test (Supertest):* Social Worker listing excludes non-SDOH Tasks; Coordinator sees all types.

- [ ] **A2. Status-transition endpoints (audited).** `PATCH /api/tasks/:id/status` handling complete/defer/escalate → FHIR Task status/businessStatus in HAPI via the S3 write client.
  - *Domain rule:* transitions PATCH the FHIR Task status and reflect back (S7 acceptance); each write audited.
  - *Test (Supertest vs test HAPI):* each transition sets the expected FHIR status; reflected on read; audit row written.

### Phase B — M02 queue + M03 detail + W13 (frontend, mockup fidelity)

- [ ] **B1. M02 Task Queue (responsive, `reference-materials/caresync-mobile.html`).** Role-filtered queue with priority sort + due dates; phone-frame responsive per GD4. *Stories 24, 27.*
- [ ] **B2. M03 Task Detail + actions.** Justifying patient context + citations; Complete/Defer/Escalate wired to A2; Call as `tel:`. *Stories 28, 29, 31.*
  - *Domain rule:* task detail shows justifying context + citations (S7 acceptance).
- [ ] **B3. W13 Task Management Center (web) + cross-surface sync.** Web queue view; completing on the mobile-shaped view syncs to web via the S6 relay.
  - *Test (Vitest):* role-filtered rendering; a status action calls the transition; a relayed change updates the other surface.

### Phase C — Verification
- [ ] **C1.** `npm run test:api` (role listing + transitions) + `npm run test:web`.
- [ ] **C2. Frontend E2E (`frontend-e2e-verification`).** Social Worker mobile queue (SDOH-only) → open task → mark done → syncs to web (via S6). Coordinator sees all types.

### Rollback / safety
Task writes audited + reversible via HAPI reset. The GD4 decision is recorded before code so the stack isn't relitigated mid-slice. Cross-surface sync degrades to manual refresh if the relay is down (honest).

### Definition of done (S7) — maps to `issues.md`
- GD4 mobile-stack decision recorded before implementation (pre-work gate).
- Social Worker queue SDOH-only; Coordinator sees all (A1).
- Task detail shows justifying context + citations (B2).
- Complete/Defer/Escalate PATCH FHIR status and reflect back (A2, B2).
- Mobile completion syncs to web via S6 relay (B3, C2).
- API-boundary tests for listing + each transition (A1, A2).

---

## Iteration 8 — S8 AI Governance & audit dashboard (W06) — 2026-07-04

**Spec:** `prd.md` (stories 11–15) · **Slice:** S8 (W06) · **Decisions:** GD12 (**demographic parity computed from real Synthea demographics**, not static), builds on the S1 audit spine + S4 cached analyses. **Blocked by S3** (needs analyses to govern); parity needs S5's Synthea population.

**Goal:** The trust story (W06). A governance view showing: the audit trail of every FHIR read/write (from the S1 `audit_log`) with timestamp + user; model version + timestamp per analysis; confidence distribution across the analyzed cohort; and **demographic parity metrics computed from real Synthea demographics** (risk by age/sex/race/ethnicity). Includes a **graceful placeholder tile for the S9 eval headline**.

**Architecture:** Backend gains a `governance/` (or `audit/`) aggregate module: `getAuditTrail()` (page the S1 `audit_log`), `getModelPerformance()` (model version/timestamp + confidence distribution derived from S4 cached analyses), `getParityMetrics()` (join cached risk scores to Synthea demographics, stratify — computed, GD12). Routes under `GET /api/governance/*`. Frontend ports W06 (`reference-materials/caresync-governance.html`) with its `#confChart` + `#radarChart` canvases (native, GD10), the audit table, and an **eval tile that renders a graceful empty/loading state** until S9's JSON lands.

**Tech Stack (delta):** `governance/` aggregate over `audit_log` + `analysis_cache` + HAPI demographics · two native Canvas charts (confidence dist + parity radar, GD10) · W06 port.

**Ponytail pass applied:** read straight from the **existing** `audit_log` + `analysis_cache` — no new governance store; parity is a stratified aggregate query, not a fairness ML library; the eval tile reads the S9 JSON summary if present else renders empty — no coupling that blocks S8 on S9; two canvases reuse the GD10 pattern.

### Phase A — Governance aggregates (backend, test-first)

- [ ] **A1. Audit trail endpoint.** `GET /api/governance/audit` paging the S1 `audit_log` (ts, actor, action, resource, outcome).
  - *Domain rule:* live audit trail of every FHIR read/write with timestamp + user (story 15); reuses the S1 spine.
  - *Test (Supertest):* after some reads/writes, the trail lists them with actor + timestamp.

- [ ] **A2. Model performance + confidence distribution.** `GET /api/governance/model` → model version + timestamp per analysis and a confidence distribution derived from S4 cached agent outputs.
  - *Domain rule:* each analysis shows model version + timestamp (story 12); confidence distribution derived from actual outputs (S8 acceptance).
  - *Test:* distribution computed from seeded cache rows matches expected buckets.

- [ ] **A3. Demographic parity (computed — GD12).** `GET /api/governance/parity` → risk scores stratified by age/sex/race/ethnicity, joining cached analyses to real Synthea demographics from HAPI.
  - *Domain rule:* parity computed from real Synthea demographics, not static (GD12, story 14).
  - *Test (Supertest vs test HAPI):* strata reflect the seeded demographics; a known-imbalanced fixture yields the expected disparity direction.

### Phase B — W06 Governance view (frontend, mockup fidelity)

- [ ] **B1. W06 port (`reference-materials/caresync-governance.html`).** Audit trail table, Model Performance (`#confChart`), Demographic Equity Monitor (`#radarChart`) — native Canvas (GD10) — from A1–A3. ≥80% fidelity.
- [ ] **B2. Eval headline tile (graceful placeholder).** Reads the S9 JSON summary if present, else an empty/loading state.
  - *Domain rule:* eval tile renders graceful empty/loading until S9 provides data (S8 acceptance) — honest staging.
  - *Test (Vitest):* renders parity/confidence/audit from data; eval tile shows empty state with no S9 data and the headline once present.

### Phase C — Verification
- [ ] **C1.** `npm run test:api` (audit/model/parity) + `npm run test:web`.
- [ ] **C2. Frontend E2E (`frontend-e2e-verification`).** Director → W06 → audit rows, model version, confidence chart, parity radar all render from real data; eval tile shows its empty state.

### Rollback / safety
All reads over existing SQLite + HAPI — no new writable state. Parity/confidence are computed at request time (no cache to invalidate). The eval tile never fabricates numbers (honest staging).

### Definition of done (S8) — maps to `issues.md`
- Audit trail lists real logged reads/writes with timestamp + user (A1).
- Each analysis shows model version + timestamp (A2).
- Confidence distribution derived from actual agent outputs (A2).
- Parity metrics computed from Synthea demographics, not static (A3).
- Eval tile renders graceful empty/loading until S9 (B2).
- API-boundary tests for audit/parity endpoints (A1, A3).

---

## Iteration 9 — S9 Evaluation harness + report — 2026-07-04

**Spec:** `prd.md` (story 16) · **Slice:** S9 (Seam 4) · **Decisions:** GD8 (harness clinician-agnostic; ships **dev-labeled ~P6 4** with a clinician-override slot to 5; error analysis mandatory). **Blocked by S3.**

**Goal:** The P6 lever. A runnable `npm run eval` loads the labeled patients (~5 curated hero + ~10 Synthea), runs the four agents over each, and computes sensitivity/specificity/PPV for Care Gap + Risk, an agreement rate for SDOH, and qualitative notes for Action Planner. It emits a methodology report **including an error analysis** and a **JSON summary feeding the S8 tile**.

**Architecture:** New `eval/` (or `scripts/eval.ts`) + a committed `data/eval/labels.json` (ground truth, rows structured for later clinician override). The harness: load labeled patients from HAPI → run the four agents (live or cached) → compare findings vs labels → compute per-agent metrics + error analysis → write `docs/eval-report.md` + a JSON summary. The **metric computation is a pure function** isolated as **Seam 4**, tested against a fixed label fixture with known expected output.

**Tech Stack (delta):** `data/eval/labels.json` · `scripts/eval.ts` (`npm run eval`) · a pure `computeMetrics(labels, findings)` module (Seam 4) · reuses the S3 orchestrator (live or S4 cache).

**Ponytail pass applied:** labels are one committed JSON file (clinician-overridable rows), not a labeling app; metrics are one pure function (Seam 4) — the harness is glue around it; reuse the S3 orchestrator + S4 cache (no eval-only agent path); report is a generated Markdown file, not a dashboard; ships honest dev-labeled with the upgrade slot per GD8.

### Phase A — Labels + metric core (test-first)

- [ ] **A1. Committed label file.** `data/eval/labels.json` — ground truth for ~5 hero + ~10 Synthea, rows structured so a clinician can review/override the Synthea rows later (GD8).
  - *Domain rule:* label file holds ground truth with clinician-overridable rows (S9 acceptance).

- [ ] **A2. Metric computation — Seam 4 (pure, TDD).** `computeMetrics(labels, findings)` → sensitivity/specificity/PPV (Care Gap + Risk), agreement (SDOH), qualitative notes (Action Planner).
  - *Domain rule:* per-agent metrics per GD8; Action Planner is qualitative (synthesis, not classification).
  - *Test (Seam 4):* against a fixed label + findings fixture, the metrics match a known expected output exactly.

### Phase B — Harness + report

- [ ] **B1. `npm run eval` harness.** Load labeled patients from HAPI → run the four agents (live or cached) over each → `computeMetrics` → write `docs/eval-report.md` (**with a mandatory error-analysis section**: misses + false positives) + a JSON summary.
  - *Domain rule:* report includes explicit error analysis (S9 acceptance, GD8 — this is the 4→5 lever); JSON summary consumed by the S8 tile.
  - *Verify:* `npm run eval` produces the report + JSON; the S8 eval tile renders the headline from it.

### Phase C — Verification
- [ ] **C1.** Seam 4 unit test green; one full `npm run eval` run committed as evidence (labeled *dev-labeled baseline*).
- [ ] **C2.** The S8 governance eval tile consumes the produced JSON (cross-slice check).

### Rollback / safety
Read-only over HAPI + labels; outputs are generated files (`docs/eval-report.md` + JSON), regenerable. Ships explicitly as a **dev-labeled ~P6 4** baseline; clinician override of the Synthea rows upgrades to 5 with no code change (GD8).

### Definition of done (S9) — maps to `issues.md`
- Committed label file with clinician-overridable rows (A1).
- `npm run eval` runs agents over all labeled patients + computes per-agent metrics (A2, B1).
- Report includes an explicit error-analysis section (B1).
- JSON summary produced + consumed by the S8 tile (B1, C2).
- Metric computation tested against a fixed fixture with known output — Seam 4 (A2).

---

## Iteration 10 — S10 CDS Hooks patient-view service — 2026-07-04

**Spec:** `prd.md` (story 35) · **Slice:** S10 · **Decisions:** GD6 (a *real* patient-view CDS Hooks service, demoable via the public CDS Hooks sandbox — the fifth load-bearing standard). **Blocked by S3.**

**Goal:** A real patient-view **CDS Hooks** service that, given a patient context, reads the HAPI bundle, runs (or reuses cached) agent findings, and returns them as **CDS cards** — demoable by pointing the public CDS Hooks sandbox at the service + HAPI.

**Architecture:** New `cds-hooks/` module exposing the two spec endpoints: `GET /cds-services` (discovery) and `POST /cds-services/caresync-patient-view` (the patient-view service). The service reuses the **S4 cached analysis** (or triggers the S3 orchestrator) for the patient in context and maps validated findings → CDS Hooks `cards` (summary, indicator, detail, source, each carrying its FHIR citation). CORS-open enough for the public sandbox to reach it.

**Tech Stack (delta):** CDS Hooks 1.0/2.0 discovery + patient-view request/response shapes · reuses S3 orchestrator + S4 cache + S2 citation guard · sandbox-reachable CORS.

**Ponytail pass applied:** one discovery + one service endpoint (patient-view only — no order-select/sign), reusing the existing analysis path — no CDS-specific agent logic; cards are a **pure mapping** of already-validated findings; prefer cached analysis for demo determinism (GD2); no auth beyond what the sandbox needs (documented honest-staging).

### Phase A — CDS Hooks service (backend, test-first)

- [ ] **A1. Discovery endpoint.** `GET /cds-services` returning the patient-view service descriptor (id, hook, title, description, prefetch).
  - *Domain rule:* exposes a CDS Hooks discovery endpoint (S10 acceptance, GD6).
  - *Test:* discovery response is well-formed and lists the patient-view service.

- [ ] **A2. Patient-view service + card mapping (pure).** `POST /cds-services/caresync-patient-view` → resolve the patient, reuse cached (or run) analysis, map **validated** findings → CDS cards carrying their FHIR citations. Card mapping is a pure, tested function.
  - *Domain rule:* returns well-formed CDS cards carrying agent findings + FHIR citations (S10 acceptance); citations already validated (GD11).
  - *Test:* for the hero patient, the service returns cards with the expected findings + resolvable citations; card mapping unit-tested against a canned analysis.

### Phase B — Sandbox demo

- [ ] **B1. Public sandbox wiring.** CORS/config so the public CDS Hooks sandbox can hit the running service + HAPI; document the sandbox URL/steps.
  - *Verify:* a card fires in the public CDS Hooks sandbox against the running service (labeled evidence).

### Phase C — Verification
- [ ] **C1.** `npm run test:api` (discovery + card generation) green.
- [ ] **C2.** Sandbox smoke: a card renders in the public sandbox for the hero patient (evidence recorded, labeled *target-environment*).

### Rollback / safety
Read-only/derived — no new writable state. The sandbox is external: record what it exercised vs local. If the public sandbox can't reach a local service in the demo network, record the honest-staging limitation (screenshot/recorded fallback per GD2).

### Definition of done (S10) — maps to `issues.md`
- Discovery endpoint + patient-view service endpoint exist (A1, A2).
- Patient-view hook returns well-formed cards with findings + FHIR citations (A2).
- A card fires in the public sandbox against the running service (B1, C2).
- Tests for discovery + card generation for the hero patient (A1, A2, C1).

---

## Iteration 11 — S11 Demo-supporting + shell screens — 2026-07-04

**Spec:** `prd.md` (stories 8, 9, 26, 30; GD9 tiers) · **Slice:** S11 · **Decisions:** GD9 (three screen tiers), GD10 (design-system fidelity), honest staging (no placeholder-as-real). **Blocked by S5 + S7.**

**Goal:** Breadth once the design system is established. Build the **demo-supporting tier** to designed/partial depth — SDOH resource directory + referral (M05), Quality/HEDIS (W05/W07), Team performance (W04), Patient quick profile (M04), Today/Schedule (M08), Care Plan builder (W14) — and **navigation-only shells** for the remaining screens (W08–W11, W13, W15, W16, M06, M07, M09, M10) with honest placeholder content. Scope flexes to remaining capacity; the six demo-critical screens keep priority.

**Architecture:** Mostly frontend against the established design system + existing aggregate APIs, with two small real backends: **SDOH referral** creates a FHIR `ServiceRequest` (audited write, S3 client); **Quality/HEDIS** derives measure progress + incentive dollars from FHIR data (small `quality/` aggregate). Shells are routed `ComingSoon`-style pages with consistent styling and **explicitly-staged** placeholder content (never presented as functional). Reference mockups: `caresync-sdoh-mobile.html`, `caresync-quality-roi.html` (`#hedisChart`/`#trendChart`/`#donutChart`).

**Tech Stack (delta):** FHIR `ServiceRequest` write (referral) · small `quality/` HEDIS aggregate · native Canvas for quality charts (GD10) · reuse `ComingSoon` shell pattern + design tokens.

**Ponytail pass applied:** demo-supporting screens to **partial** depth only (GD9) — not full features; shells reuse the existing `ComingSoon` component, not bespoke pages; referral is one `ServiceRequest` write reusing the S3 client; HEDIS is a derived aggregate, not a measure engine; **capacity-flexed** — demo-critical screens always win; honest staging enforced (no fake-functional content).

### Phase A — Demo-supporting screens (partial depth)

- [ ] **A1. SDOH resource directory + referral (M05, `caresync-sdoh-mobile.html`).** List community resources by category (transportation/food/housing/mental health); a referral creates a FHIR `ServiceRequest` (audited).
  - *Domain rule:* referral creates a FHIR ServiceRequest (S11 acceptance, story 30); write audited.
  - *Test (Supertest):* referral POSTs a resolvable ServiceRequest; (Vitest) directory renders by category.
- [ ] **A2. Quality/HEDIS view (W05/W07, `caresync-quality-roi.html`).** Measure progress + incentive dollars at stake, derived from FHIR data; native Canvas charts (GD10). *Story 9.*
  - *Test:* aggregate computes measure progress over seeded data; view renders it.
- [ ] **A3. Team performance (W04).** Coordinator workload + completion rates from Task/assignment data. *Story 8.*
- [ ] **A4. Remaining supporting screens as capacity allows.** Patient quick profile (M04), Today/Schedule (M08), Care Plan builder (W14 — FHIR CarePlan, story 26) to partial depth.
  - *ponytail:* build in priority order; stop at capacity, record what's partial (honest staging).

### Phase B — Shell screens

- [ ] **B1. Navigation-only shells.** W08, W09, W10, W11, W13, W15, W16, M06, M07, M09, M10 as styled placeholder pages in navigation.
  - *ponytail:* **one `ComingSoon` component driven by a route→title table** (the S1 `ComingSoon` page already exists) — 11 rows of data, not 11 files.
  - *Domain rule:* no shell presents placeholder data as real/functional (S11 acceptance — honest staging, gate G4).
  - *Test (Vitest):* each shell route renders with consistent styling + an explicit "coming soon / not yet functional" treatment.

### Phase C — Verification
- [ ] **C1.** `npm run test:api` (referral + HEDIS aggregate) + `npm run test:web` (screens/shells).
- [ ] **C2. Frontend E2E (`frontend-e2e-verification`)** for the demo-supporting screens that carry real behavior (SDOH referral, Quality view render). Shells covered by render tests.

### Rollback / safety
ServiceRequest writes audited + HAPI-reversible. Shells are inert. Honest-staging is the safety property here: partial/placeholder content is explicitly labeled so the demo never overclaims (G4).

### Definition of done (S11) — maps to `issues.md`
- SDOH directory lists resources by category; referral creates a ServiceRequest (A1).
- Quality/HEDIS shows measure progress + incentive dollars from FHIR data (A2).
- Team performance shows workload + completion rates (A3).
- Shell screens exist in nav with consistent styling + placeholder content (B1).
- No shell presents placeholder data as real (B1 — honest staging).

---

## Iteration 12 — S12 Demo hardening: E2E flows, fallback video, judge deck — 2026-07-04

**Spec:** `prd.md` (stories 37 + demo narrative) · **Slice:** S12 (Seam 3) · **Decisions:** GD2 (demo reliability: cache + live + recorded fallback is first-class), G4 (honest-staging deck). **Blocked by S4, S5, S6, S7, S8, S9.**

**Goal:** The final safety net. Automated **Playwright E2E tests for the three demo flows** (Seam 3) exercise the full stack; a **pre-recorded 90-second demo video** is the out-of-band fallback (GD2); and the **judge slide deck** is assembled (reuse `reference-materials/caresync-pitch-deck.html`, updated to what actually shipped + the honest-staging matrix).

**Architecture:** Consolidate the per-slice E2E specs into three **full-stack demo-flow suites** (Seam 3) run against the running stack: Director (login → population → drill Maria → assign), Coordinator (open patient → run analysis → findings stream → Tasks appear), Social Worker (mobile queue → open task → mark done → syncs back). Each flow is demoable **both live and via cached replay** (GD2). Capture the 90s video from a passing run; assemble the deck from the pitch mockup, reconciled against `plan.md` §3 standards matrix + the honest built/prototyped/envisioned staging.

**Tech Stack (delta):** Playwright multi-flow E2E against the full stack · screen recording (video) · deck from `caresync-pitch-deck.html`.

**Ponytail pass applied:** three flow suites (not exhaustive coverage) — these *are* the acceptance tests for the demo narrative; reuse the per-slice specs already written under `frontend-e2e-verification`; the deck reuses the existing pitch mockup, updated not rebuilt; video captured from a real passing run (not staged).

### Phase A — E2E demo-flow suites (Seam 3)

- [ ] **A1. Three full-stack flow suites.** Playwright, against the running stack, green:
  - Director: login → population → drill into Maria → assign.
  - Coordinator: open patient → run analysis → findings stream → Tasks appear.
  - Social Worker: mobile queue → open task → mark done → syncs back (via S6).
  - *Domain rule:* these are the demo acceptance tests (Seam 3).
- [ ] **A2. Live + cached parity.** Each flow runs both live (fresh model run) and via cached replay (GD2) with the same UI treatment.
  - *Verify:* both modes pass green.

### Phase B — Fallback video + judge deck

- [ ] **B1. 90-second fallback video.** Capture from a passing run; matches the live flow (GD2 out-of-band fallback).
- [ ] **B2. Judge deck.** Reuse `reference-materials/caresync-pitch-deck.html`; update to reflect **shipped** functionality + the built/prototyped/envisioned staging matrix (gate G4) — not the original pitch claims. Bundle the S9 eval report + the standards-conformance matrix.
  - *Domain rule:* deck reflects shipped reality + honest staging (G4); submission bundles the eval report + standards matrix (S12 acceptance).

### Phase C — Verification
- [ ] **C1.** Playwright E2E suite for all three flows passes green against the running stack (both live + cached).
- [ ] **C2.** Video exists + matches the live flow; deck + eval report + standards matrix assembled for submission.

### Rollback / safety
E2E runs against the disposable stack. The recorded video + cached replay are the belt-and-suspenders for a stage network failure (GD2). The deck is reconciled against `plan.md` §3 so no claim outruns what shipped (G4 honest staging).

### Definition of done (S12) — maps to `issues.md`
- Playwright E2E covers all three demo flows end-to-end and passes green (A1, C1).
- The three flows are demoable both live and via cached replay (A2).
- A 90-second fallback video exists and matches the live flow (B1).
- The judge deck reflects shipped functionality + honest staging, not pitch claims (B2).
- The submission bundles the eval report (S9) + the standards-conformance matrix (B2).

---

## Handoff note (S3–S12 planned 2026-07-04)

Iterations 3–12 above are the **strong, ponytail-annotated plans** for the remaining slices, written straight from `issues.md` (S3–S12) and grounded in the S1/S2 code seams (`FhirReadService`, the defaulted-`runAgent` param on `createAnalysisRouter`, `AgentEvent`/`runRiskAgent`, `validateCitations` Seam 2, the audited `fetch`, `SmartTokenClient`, `streamAnalysis`, the `FeedBox`/`AgentGraph` W03 host, and the six mockups). They are **implementation-ready for any executor** (e.g. Codex/GPT‑5.5): each task carries its acceptance mapping, test seam, domain rule/decision citation, and rollback.

**Per-slice activation:** `tasks/todo.md` holds the *one active slice* (currently S2). When starting a slice, mirror that iteration's checkboxes into `tasks/todo.md` (add `## Approved: yes` only by user approval), implement via `subagent-driven-development`, then `verification-before-completion` → `code-review`.

**Dependency order (from `issues.md`):** S3→S4; S5 parallel off S1; S6/S8/S9/S10 off S3; S7 off S3 + the GD4 decision; S11 off S5+S7; S12 off S4/S5/S6/S7/S8/S9. Critical path: S1→S2→S3→(S6/S8/S9)→…→S12.
