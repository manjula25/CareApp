# Active Plan — CareSync AI

**Feature:** `caresync-ai` · **Current slice:** S1 — Walking Skeleton
**Full plan:** `docs/plans/caresync-ai/implementation-plan.md` (Iteration 1, ponytail-simplified)
**Spec:** `docs/plans/caresync-ai/prd.md` · **Slice def:** `docs/plans/caresync-ai/issues.md`

## Approved: yes (2026-07-04)

## S1 — Walking Skeleton (stories 17, 33, 34, 36)

### Phase A — Scaffold & infra
- [x] A1. Monorepo scaffold: apps/web (Vite+React+TS+Tailwind), apps/api (Express+TS); Vitest + Jest/Supertest
- [x] A2. Docker HAPI FHIR R4 + healthcheck (import retries until healthy) — container has no shell for a Docker-native healthcheck; readiness verified by import script's host-side retry loop instead
- [x] A3. Import Maria Chen bundle + ~5 panel patients via $batch (500-Synthea deferred to S5)

### Phase B — Backend core (test-first)
- [x] B1. SQLite: users + audit_log (no sessions table)
- [x] B2. Seed 3 demo accounts (bcrypt)
- [x] B3. Auth login + role middleware (Supertest TDD; no /me)
- [x] B4. Role→FHIR-scope enforcement in API (SW denied non-SDOH — real denial)
- [x] B5. FHIR read service + routes; audit written in the single HAPI wrapper
- [x] B6. SMART Backend Services token flow + HAPI interceptor (sequenced last) — token mint/exchange/cache/attach is real and tested; HAPI-side enforcement not possible on the stock image (no shell to configure an interceptor) — honest-staging note recorded in plan.md §3

### Phase C — Frontend foundation
- [x] C1. Design tokens (HANDOFF §4) + app shell
- [x] C2. Router role guards + TanStack Query client + login (W01); token in localStorage + useAuth (no Zustand yet)
- [x] C3. W12 My Patient Panel (Coordinator landing)
- [x] C4. Patient detail minimal (name + conditions from HAPI)

### Phase D — Seam verification
- [x] D1. API-boundary Supertest suite green (Seam 1 reference) — 31 tests, `npm run test:api` green
- [x] D2. End-to-end smoke (docker up → login → panel → Maria → conditions live) — full clean reset (`docker compose down -v` + delete SQLite) then re-run verified: Coordinator login → panel (6 patients, risk+tasks) → Maria's name+conditions from a live HAPI read → Social Worker denied (403) → every read/denial audited. No browser was available in this environment to visually verify the rendered UI — see final report.

## Verification
- [x] `npm run test:api` green (31/31); `npm run build && npm run lint` clean for both apps
- [x] All S1 acceptance criteria in `issues.md` checked (see verification note on the 500-Synthea/browser-UI exceptions, both pre-approved deviations)

## Reference-fidelity fixup (2026-07-04)
C1-C4 originally used only the HANDOFF.md §4 token summary, not the actual
`reference-materials/caresync-ai.html` markup/CSS — a real gap against the
new `CLAUDE.md` "UI implementation" rule (≥80% fidelity to the matching
reference). Rebuilt against it: header (compliance pills for what's actually
built — FHIR R4, SMART on FHIR; CDS Hooks omitted, it's S10), My Patients
list (severity dot, age/sex, condition tag chips, search, count — backed by
real Condition/RiskAssessment/Task data, not mock), and the patient detail
top bar (name/age-sex/mono resource id). The mockup's "Run Analysis" button
and the center/right agent-feed and task panels are S2/S3 functionality and
were intentionally left out rather than shown as inert chrome. Backend
`getAssignedPanel` now also returns `gender`, `birthDate`, and
`conditionTags` (short ICD-10→tag lookup) to support this — TDD throughout,
`npm run test:api` still green (33/33).

## Rollback
- `docker compose down -v` + delete SQLite → full reset. No external systems, no real PHI.
