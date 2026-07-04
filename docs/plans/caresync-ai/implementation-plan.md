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

**Spec:** `prd.md` · **Slice:** S2 (`issues.md`) · **Decisions:** `plan.md` GD11 (citation enforcement is real, core P3/P4), GD13 (agents on Claude Sonnet 5), GD2 (cache/replay — *deferred to S4*).

**Goal:** On Maria's detail view, "Run Analysis" dispatches one live **Risk agent** (Claude Sonnet 5, structured output) over her retrieved FHIR bundle; findings stream to a single feed box over SSE, and every `fhirResourceId` the agent emits is validated against the IDs actually present in the bundle — fabricated citations are dropped before they reach the UI.

**Architecture:** New `apps/api/src/agents/` module: a pure **citation validator** (Seam 2), a `getPatientBundle` read on the existing audited `FhirReadService` (backed by HAPI `$everything`), and a single `runRiskAgent` function. A new SSE route streams findings and runs each through the validator before emit. Frontend adds the "Run Analysis" control and one streaming Risk feed box to `PatientDetail` (W03), consuming SSE via `fetch` streaming. **This slice deliberately stays at one agent** — S3 adds the other three + Action Planner Tasks (and extracts the shared agent interface then), S4 adds the agent-graph canvas + cache. No DB schema change (S2 persists nothing beyond the existing audit spine).

**Tech Stack (delta):** `@anthropic-ai/sdk` (Claude Sonnet 5, `claude-sonnet-5`, streaming + tool-based structured output) · HAPI `Patient/$everything` · SSE over Express `text/event-stream` · `fetch` ReadableStream on the client.

**Ponytail pass applied:** one agent, as a plain function — no `Agent` interface until S3 has four real agents to generalize from; `$everything` instead of a per-type read fan-out, with `validIds` derived from the returned bundle (single source of truth); no client-factory module (the SDK client is the abstraction); no cache/persistence, no canvas (S4); no shared `packages/types` yet (agent output type lives in `apps/api`, imported by the client until S3 needs sharing); reuse the existing `buildApp`/defaulted-param test pattern, no new harness.

### Phase A — Agent foundation & contracts (backend, test-first)

- [ ] **A1. Anthropic SDK + config.** Add `@anthropic-ai/sdk`; `ANTHROPIC_API_KEY` in `apps/api/.env.example`; a module-level `anthropic = new Anthropic()` (reads the key from env) + `MODEL = 'claude-sonnet-5'` const in `riskAgent.ts`.
  - *Domain rule:* agent model is Claude Sonnet 5 (GD13).
  - *ponytail:* no `anthropic.ts` factory module — the SDK client *is* the abstraction; one `new Anthropic()` covers it. *skipped:* Haiku fallback (GD13 note — only if latency/cost pressure appears).

- [ ] **A2. Citation validator — Seam 2 (pure module, TDD).** `src/agents/citationValidator.ts`: `validateCitations(flags, validIds) → { valid, dropped }`, no I/O. Given agent flags each carrying a `fhirResourceId` and the set of valid `ResourceType/id` strings, partition into passed vs dropped/flagged.
  - *Domain rule:* backend validates every citation against the bundle and drops/flags hallucinated IDs (GD11) — the non-negotiable innovation.
  - *Test (Vitest/Jest, first):* one in-bundle citation + one fabricated → valid passed, fabricated dropped; empty flags → empty result; case/whitespace normalization defined by the test.

- [ ] **A3. Patient bundle retrieval (extend audited `FhirReadService`).** Add `getPatientBundle(actor, patientId)` → `{ resources, validIds }`, backed by a **single** `GET /Patient/{id}/$everything` (native HAPI operation — returns the whole record in one Bundle) through the existing audited `fhirFetch` + role `guard`. `validIds` is **derived from `resources`** (`new Set(resources.map(r => \`${r.resourceType}/${r.id}\`))`) — never assembled separately, so the agent's input and the citation-check set cannot drift.
  - *Domain terms:* FHIR R4 `$everything`; "bundle" = the retrieved resource set citations are checked against (GD11).
  - *ponytail:* `$everything` replaces a per-type fan-out (getPatient + getConditions + getObservations…) — one call, one audit row, and citation validity = "was in the record we read," which is exactly GD11.
  - *Test (Supertest vs test HAPI):* Maria's bundle contains her known conditions + labs; `validIds` matches the returned resource ids 1:1; a Social-Worker-scoped read still denies (`guard` on `clinical`).

### Phase B — Risk agent service + SSE (backend, test-first)

- [ ] **B1. Risk agent (`runRiskAgent`).** `src/agents/riskAgent.ts`: a plain `runRiskAgent(bundle): AsyncIterable<AgentEvent>` on Claude Sonnet 5 with **structured output** (tool schema): `{ riskScore, riskLevel, flags: [{ text, fhirResourceId }], readmissionProbability }`.
  - *Domain rule:* structured output; every flag cites a FHIR resource ID (GD11).
  - *ponytail:* **no `Agent` interface yet** — one implementation. S3 extracts the shared interface from the four real agents (generalize from variation you can see, not from one guess).
  - *Test:* prompt-build + response-parse against a **mocked Anthropic client** (no live call in CI); the live call is proven in D3, labeled *live* vs the *local-mock* unit evidence.

- [ ] **B2. Analysis SSE route + validation gate.** `createAnalysisRouter(fhirService, runAgent = runRiskAgent)` — the agent fn is a defaulted param so tests pass a stub without a live call. `POST /api/patients/:id/analysis` responds `text/event-stream`: streams the agent's findings incrementally (`finding` events for the live feed) then a `complete` event. **Each flag's `fhirResourceId` passes through the A2 validator against the A3 bundle IDs before emit** — dropped citations never reach the client. `requireAuth` applies; wire into `index.ts`.
  - *Domain rule:* no finding reaches the UI citing a resource absent from the retrieved bundle (GD11); the analysis read is audited.
  - *Test (Supertest, boundary — S2 acceptance):* stub agent yields one in-bundle + one fabricated citation → the streamed result contains **only** the valid citation, and *all* returned citations resolve in the bundle; an audit row is written for the analysis read.
  - *Decision (streaming mechanics):* stream the agent's text output token-wise into the feed for the live effect, and emit validated structured flags as discrete `finding` events; exact delta handling is TDD-driven. *skipped:* GET/`EventSource` variant — client uses `fetch` streaming so it can send the `Authorization` header (no token-in-query hack).

### Phase C — Frontend: Run Analysis + streaming Risk feed

- [ ] **C1. API client streaming.** `streamAnalysis(patientId, handlers)` in `src/api/client.ts` using `fetch` + `ReadableStream`, attaching the auth header and parsing SSE `finding`/`complete` events.

- [ ] **C2. `PatientDetail` "Run Analysis" + Risk feed box (W03, mockup fidelity).** Add the **Run Analysis** control (`#runLabel` in `reference-materials/caresync-ai.html`) and one **Risk Agent feed box** (`.feed` red accent, `.feed-text.streaming` blinking cursor) that renders streamed text incrementally and validated flags as citation chips (`Condition/…`, `Observation/…` in mono, matching the existing `Task/{id}` treatment).
  - *Mockup-fidelity deviations (recorded per CLAUDE.md UI rules):* the other three feed boxes (Care Gap/SDOH/Action Planner) render as honest **idle placeholders** ("Awaiting analysis run…", as in the mockup) — wired in **S3**; the agent-graph canvas is **omitted** — built in **S4**. Structural fidelity for the Risk feed itself targets ≥80%.
  - *Test (Vitest, mocked stream):* text renders incrementally; a validated finding with its FHIR citation chip appears; the idle placeholders stay idle.

### Phase D — Verification (Seam 2 + E2E)

- [ ] **D1. Unit + API suites green.** `npm run test:api` (validator Seam 2 + analysis-route boundary + bundle read) and `npm run test:web` pass.

- [ ] **D2. Frontend E2E (`frontend-e2e-verification`).** Playwright: log in as Coordinator → open Maria → **Run Analysis** → feed streams incrementally → a validated finding with its FHIR citation renders. Add alongside the S1 specs in `apps/web/e2e/`.

- [ ] **D3. Live-call evidence.** One live run against real Claude Sonnet 5 confirming structured output + genuine streaming; record it in the slice's verification notes labeled *live* (vs *local-mock* for CI). Confirm a deliberately fabricated citation is dropped end-to-end.

### Rollback / safety
Additive only — no DB migration (no persistence until S4's cache). Disposable HAPI + local SQLite reset as in S1 (`docker compose down -v`). Unset `ANTHROPIC_API_KEY` to disable live analysis; the route degrades to an explicit error, not a fake result (honest staging).

### Definition of done (S2) — maps to `issues.md` acceptance
- Run Analysis triggers a live Claude call producing structured Risk output (B1, D3).
- Findings stream over SSE and render incrementally in one feed box (B2, C2, D2).
- Citation validator passes an in-bundle citation and drops a fabricated one (A2 Seam 2).
- No finding citing an out-of-bundle ID reaches the UI (B2 gate; D2/D3 end-to-end).
- Citation-validator unit tests + API-boundary test asserting all returned citations resolve in the bundle (A2, B2; `npm run test:api` green).
