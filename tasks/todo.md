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
- [ ] D1. API-boundary Supertest suite green (Seam 1 reference)
- [ ] D2. End-to-end smoke (docker up → login → panel → Maria → conditions live)

## Verification
- `npm run test:api` green; `npm run build && npm run lint` clean
- All S1 acceptance criteria in `issues.md` checked

## Rollback
- `docker compose down -v` + delete SQLite → full reset. No external systems, no real PHI.
