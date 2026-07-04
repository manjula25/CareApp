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
- [x] C4. Patient detail minimal (name + conditions from HAPI; tasks panel added in the fidelity audit below)

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
and the center agent-feed panels are S2/S3 functionality (no agent exists
yet) and were intentionally left out rather than shown as inert chrome. The
right-hand Tasks panel was *also* left out at this point, but that framing
turned out to be inaccurate — see the fidelity audit below; it wasn't
actually agent-gated. Backend `getAssignedPanel` now also returns `gender`,
`birthDate`, and `conditionTags` (short ICD-10→tag lookup) to support this —
TDD throughout, `npm run test:api` still green (33/33).

## ADLC skills added (2026-07-04)
Added two repo-local skills and wired them into `CLAUDE.md`'s ADLC table
(Phase 4/5): `html-mockup-fidelity` (screen-vs-mockup fidelity loop, replaces
the prose-only "UI implementation" instructions) and
`frontend-e2e-verification` (Playwright E2E gate). Both are standalone
helpers (no `## Next step`), same pattern as `tdd`. Confirmed Playwright's
bundled Chromium installs and runs headless in this sandbox (tested in an
isolated scratchpad dir, not added to repo deps yet) — the Seam 3 E2E work
in `prd.md` no longer needs to wait for S12 purely on tooling grounds; adding
`@playwright/test` to `apps/web` and the first real spec is still open work.

## html-mockup-fidelity + frontend-e2e-verification audit (2026-07-04)

Ran both new skills against the S1 screens (AppShell header, PatientPanel,
PatientDetail) vs. `reference-materials/caresync-ai.html`.

**Fidelity findings:**
- Header, My Patients list, and pt-bar all score well against the checklist
  (layout regions, component patterns, tokens, spacing all match).
- Real gap found and fixed: the mockup's right-hand Tasks panel (priority
  pill, due date, title, FHIR-id, status) was missing from PatientDetail, and
  the prior note above mischaracterized it as blocked on the S2/S3 agent.
  In fact the backend already fetched the full `Task` bundle per patient and
  discarded everything but a count. Fixed test-first: `FhirReadService`
  gained `getTasks()` (guarded by the same `clinical` scope as conditions);
  seed `Task` resources now carry a real FHIR `priority`
  (stat/urgent/routine) and `restriction.period.end` for due date;
  `GET /api/patients/:id` returns `tasks: TaskSummary[]`; `PatientDetail.tsx`
  renders real task cards. `npm run test:api` green (36/36, +3 for this),
  `npm run build && npm run lint` clean.
- Known, accepted deviation (unchanged from the prior pass): the mockup
  presents patient-list + patient-detail + tasks as three simultaneous panels
  in one screen. The PRD treats these as separate screens (W12 My Patient
  Panel vs. a fuller patient+agent view), so S1 implements them as two routes
  (`/panel`, `/patients/:id`) rather than a persistent 3-column layout. This
  is a PRD/architecture decision, not a fidelity shortcut — left as-is.
- Minor, unfixed: the header's "Last synced Xs ago" text and notification
  bell count aren't wired to real data — reasonable omission (no backing
  data source yet) but wasn't previously called out; noting it here.

**E2E verification:** Added `@playwright/test` to `apps/web` (root-level
install per the skill's lockfile-safety note) with `apps/web/playwright.config.ts`
booting the API + Vite dev server against the already-running HAPI container.
Two specs added under `apps/web/e2e/`, both green headless against the real
stack (`npm run test:e2e`):
- Coordinator login → panel → Maria Chen → conditions + the new real Tasks
  panel (title/priority/due/status), live from HAPI.
- Social Worker login → direct patient-detail nav → sees the 403 error state,
  not clinical data (TanStack Query's default retry means the error state
  takes several seconds to settle — noted in the spec).

Evidence strength (per `CLAUDE.md`'s evidence boundaries): **packaged UI /
local mock** — a real headless Chromium run against the local dev stack, not
target-environment or client-accepted evidence.

## Rollback
- `docker compose down -v` + delete SQLite → full reset. No external systems, no real PHI.
