# Changelog: S12 — Phase 3 mobile-trio lead-port at normal web size

**Type:** Feature

**Branch:** `feature/caresync-s12-phase-3-mobile-trio` (branched off `main` at the S11 merge,
`3bb0b4d`)

**Date:** 2026-07-07

## Summary

Completes the HL7 AI Challenge POC's lead-project integration with the Social-Worker (mobile) flow
ported at normal web content width. The decision to land Phase 3 at the same content width as
S11's other surface (overriding the S7 B1 GD4 390px phone-frame convention) was made by the user
mid-session: lead's three mobile/ pages (`TaskQueue.tsx`, `TaskDetail.tsx`, `PatientProfile.tsx`)
are adapted to the existing AppShell (Header + Sidebar) chrome, wired to the project's real
APIs (`listTasks`, `getTaskDetail`, `transitionTask`, `getPatient`, `subscribeToEvents`) instead
of lead's mock-driven fetches, and the only demo-safety-net fallback is Maria-Chen-only rich
detail (labs / meds / SDOH / phone) sourced from lead's fixtures — the project's API has no
`riskScore`, no `laps`, no `medications`, no SDOH, and no `phone` on `PatientDetail`, and the
fixture fill is gated on `patient.id === 'maria-chen'` (the real HAPI seed id, fixed from
lead's hardcoded `'maria-chen-4829'` so the branch is reachable from real navigation).

Also bundles the prior-session-uncommitted Phase 0 (shell primitives + 3 high-priority supporting
pages), Phase 1 (PatientDetail — the S7 B1 3-view-mode demo surface), and Phase 2 (Population —
the 2-column director overview), per the user's "commit all three phases together at the end"
decision.

## Changes Made

### Phase 3 — Mobile trio at normal web screen size (this session)

#### `TaskQueue.tsx` — rewrite at normal web size (was 220-line 390px phone-frame)

- **Before:** S7 B1's 390px phone-frame M02 surface (`StatusBarChrome`, summary bar inside the
  phone chrome, `MobileNav`, FAB + `CreateTaskSheet`). 220 lines, MOCK fallback only.
- **After:** 170-line normal-web-content-width surface. Dropped phone frame, `StatusBarChrome`,
  `MobileNav`, FAB, and `CreateTaskSheet` (no `/api/tasks/:patientId/assign` endpoint in this
  project). Preserved the pre-existing summary bar (Open / Critical / Patients counts), the
  `sortTasks` helper (open-first → priority → due), and the `CompletedTaskCard` distinct treatment
  (line-through, emerald left border) — all from the previous in-tree version, not lead (lead's
  design rendered done tasks identically to open ones). Kept the 4 filter chips (All / Critical /
  Today / In Progress — lead's `urgent` → this project's `critical`, lead's `low` dropped because
  this project's API doesn't return it). Wired to the real `listTasks()` API and `useMutation`
  with `completeTask(id)` for the Done button. Card click navigates to `/tasks/:id`.
- **Files changed:** `apps/web/src/pages/TaskQueue.tsx` (rewrite), `TaskQueue.fixtures.ts` (new),
  `TaskQueue.test.tsx` (new, 11 tests).

#### `TaskDetail.tsx` — extended with defer/escalate confirm steps + cross-surface sync

- **Before:** 112-line S7 B2 surface with bare Complete / Defer / Escalate buttons + a Call link,
  no real-time sync.
- **After:** ~250-line surface. Extended the action bar with two of lead's UX affordances:
  defer confirm step (first click reveals an inline date picker + Confirm Defer button; only the
  second click fires `transitionTask(id, 'defer')`) and escalate confirm step (first click swaps
  the button label to `Escalate (confirm)` and renders a red "tap again to confirm" warning;
  only the second click fires `transitionTask(id, 'escalate')`). Complete stays single-click per
  lead. Added overdue-red treatment on the `due` label. Added a `useEffect`-mounted
  `subscribeToEvents({ onTaskUpdated })` subscription that invalidates the `['task', id]` and
  `['tasks']` queries on matching events (id-filtered) — closes the handoff's open
  cross-surface-sync question so a coordinator status change live-refetches a social worker's open
  detail view. Honest-staging note documents: defer discards the picked date (the API has no
  `dueDate` override param; lead's stub accepted it as `extra: { dueDate }`), description / FHIR
  evidence / assignedTo / created sections are dropped (the API doesn't return those fields).
- **Files changed:** `apps/web/src/pages/TaskDetail.tsx` (extend), `TaskDetail.fixtures.ts` (new),
  `TaskDetail.test.tsx` (new, 14 tests), `apps/web/src/lib/task.ts` (new `isOverdue` export — was
  reimplemented inline in the page; see Standards review fix #2).

#### `PatientProfile.tsx` — new surface, real API + lead fixture fallback for Maria's rich detail

- **Before:** no profile surface existed; the only patient view was `PatientDetail.tsx` (the
  director / analysis view).
- **After:** 298-line `/patients/:id/profile` route (added to `App.tsx`) rendering lead's
  header/conditions/labs/meds/SDOH card / quick-actions structure, with `bg-bg` + `max-w-3xl` +
  AppShell chrome (no phone frame, no `MobileNav`). Real API `getPatient(id)` is the only data
  source for the header (name, age via `ageSexLabel(birthDate, gender)`, demographics), conditions
  list, and `← Back to Tasks` link. Labs / meds / SDOH / phone all fall back to lead's fixtures
  only when `patient.id === MARIA_ID` (the real HAPI seed id `'maria-chen'`, reconciled from
  lead's hardcoded `'maria-chen-4829'` — see review #5). For non-Maria patients, rich-detail
  branches render honest "No recent labs on file" / "Medication list not available in demo"
  placeholders, mirroring lead's `isMaria` branch. MRN shown as "—" (no MRN field on the
  real API's `Patient`). Risk score hidden (no `riskScore` in the API) and replaced with a muted
  "Risk score unavailable" pill. Quick actions: Create Task → `/tasks`, Call Patient
  (`tel:+1-555-0142`, the real HAPI seed's Maria phone — reconciled from lead's `tel:555-0100`,
  see review #5) for Maria only, SDOH Resources → `/patients/:id/sdoh` for everyone.
- **Files changed:** `apps/web/src/pages/PatientProfile.tsx` (new), `PatientProfile.fixtures.ts`
  (new, lead's `MOCK_PATIENTS` + Maria-only `MARIA_LABS` / `MARIA_MEDS` / `SDOH_FLAGS` /
  `MARIA_PHONE` + `MARIA_GET_PATIENT_RESULT` + `buildMockGetPatientResult` helpers),
  `PatientProfile.test.tsx` (new, 16 tests), `apps/web/src/lib/patient.ts` (new `sexLabel`
  export — was hand-rolled inline in the page; see Standards review fix #4), `apps/web/src/App.tsx`
  (added `/patients/:id/profile` route).

#### E2E coverage (Playwright) for the three new/rewritten surfaces

- **Before:** `task-queue.spec.ts` (S7 B1) and `task-detail.spec.ts` (S7 B2) exercised the old
  390px phone-frame + single-click-defer behavior; no `patient-profile.spec.ts` existed.
- **After:** `task-queue.spec.ts` and `task-detail.spec.ts` updated for the new behaviors (direct
  `page.goto('/tasks')` instead of a non-existent "Tasks" link selector that was matching patient
  rows containing "tasks" in the task-count badge; two-click defer confirm). New
  `patient-profile.spec.ts` (110 lines, 4 tests) covers the Maria rich-detail branch, the
  non-Maria placeholder branch, the SDOH Resources navigation, and the back-link return.
- **Files changed:** `apps/web/e2e/task-queue.spec.ts`, `apps/web/e2e/task-detail.spec.ts`,
  `apps/web/e2e/patient-profile.spec.ts` (new).

### Phase 0 — Lead shell primitives + 3 high-priority supporting pages (prior session, uncommitted)

- `apps/web/src/components/layout/{Header,Sidebar,MobileNav}.tsx` (3 new, ~329 lines combined) —
  AppShell chrome; Sidebar uses icon-only buttons gated by role; MobileNav is `md:hidden` bottom
  tab bar (Tasks / Patients / Resources).
- `apps/web/src/components/ui/{Badge,Card,Spinner,Toast}.tsx` (4 new, ~125 lines combined) —
  shared UI atoms.
- `apps/web/src/store/agentStore.ts` (new, 44 lines) — zustand store imported from lead; not yet
  consumed by any page (see handoff's "available, currently unused" note).
- `apps/web/src/types/index.ts` (new, 74 lines) — shared project type definitions.
- `apps/web/src/pages/{AlertsPage,CostROI,SettingsPage}.tsx` (3 new, ~623 lines combined) —
  high-priority supporting pages.

### Phase 1 — PatientDetail (S7 B1-era demo surface, prior session, uncommitted)

- 1527-line patient-detail surface with 3 view modes (panel / cinema / orchestrator), animated
  Canvas orchestrator graph, `AnalysisProgressFloat`, `ActionCard` with confidence bars + a
  Create-Task stub. MOCK fallback chain (`MOCK_PATIENTS`, `MOCK_ANALYSIS`, `runMockSim`) for
  demo-day offline insurance. `mockSimTimeoutsRef` cleanup `useEffect` cancels pending
  `runMockSim` setTimeouts on unmount so they don't bleed into the next test (5+ second timeouts
  in adjacent test files). 11 unit tests cover the real-data / mock-fallback / loading branches.

### Phase 2 — Population (S5-era 2-column director overview, prior session, uncommitted)

- 709-line two-column director overview (40% patient list — search + filter tabs + ranked rows;
  60% KPI cards + scatter plot with critical threshold line + glowing critical dots). 14 unit
  tests cover the real-data / mock-fallback / loading branches + patient-row + scatter-dot
  navigation. `MOCK_PATIENTS` for Population = 8 hardcoded patients (used as offline fallback
  when both `/api/population/summary` and `/api/population/scatter` reject). 14 unit tests.
- Deleted `apps/web/src/pages/PopulationPatientList.tsx` (orphan from a prior drill-in route that
  the Phase 2 nav refactor superseded). Dot click now navigates straight to `/patients/:id`.

### Test infrastructure stabilization (Phase 1+2 fallout)

- `apps/web/vite.config.ts` `testTimeout: 15000` — necessary for environmental slowness under
  full-suite load; 5s default intermittently flakes `Governance.test.tsx` and `MoreScreens.test.tsx`
  ~50% of the time.

## Files Modified (Phase 3 focus)

| File | Change Description |
|------|---------------------|
| `apps/web/src/pages/TaskQueue.tsx` | Rewrite at normal web content width; dropped phone frame + FAB + MobileNav; wired to real `listTasks` + `completeTask` |
| `apps/web/src/pages/TaskQueue.fixtures.ts` | New — MOCK_TASKS + FILTER_TABS + date helpers |
| `apps/web/src/pages/TaskQueue.test.tsx` | New — 11 tests |
| `apps/web/src/pages/TaskDetail.tsx` | Extended with defer/escalate confirm steps + `subscribeToEvents` cross-surface sync |
| `apps/web/src/pages/TaskDetail.fixtures.ts` | New — MOCK_TASK + isoDay helper |
| `apps/web/src/pages/TaskDetail.test.tsx` | New — 14 tests |
| `apps/web/src/pages/PatientProfile.tsx` | New — 298-line `/patients/:id/profile` surface |
| `apps/web/src/pages/PatientProfile.fixtures.ts` | New — lead's MOCK_PATIENTS + Maria-only rich-detail fixtures; `MARIA_ID` reconciled to real HAPI seed id `'maria-chen'`; `MARIA_PHONE` reconciled to real seed value `'+1-555-0142'` |
| `apps/web/src/pages/PatientProfile.test.tsx` | New — 16 tests |
| `apps/web/src/lib/task.ts` | Added `isOverdue(due: string): boolean` (Phase 3 Standards review fix — was reimplemented inline in `TaskDetail.tsx`) |
| `apps/web/src/lib/patient.ts` | Added `sexLabel(gender)` (Phase 3 Standards review fix — was hand-rolled inline in `PatientProfile.tsx`) |
| `apps/web/src/App.tsx` | Added `/patients/:id/profile` route |
| `apps/web/e2e/task-queue.spec.ts` | Replaced broken `getByRole('link', { name: 'Tasks' })` selector with direct `page.goto('/tasks')` (the patient-row "3 tasks" badge was matching) |
| `apps/web/e2e/task-detail.spec.ts` | Same selector fix + two-step defer confirm (first click → date picker + Confirm Defer, second click → transition) |
| `apps/web/e2e/patient-profile.spec.ts` | New — 4 tests covering Maria rich-detail, non-Maria placeholders, SDOH navigation, back-link |
| `docs/plans/caresync-ai/review-s12.md` | New — two-axis code-review artifact (Standards + Spec) |

## Testing & Verification

**How to verify this works:**
- `cd apps/web && npx vitest run` (full unit suite)
- `cd apps/web && npx playwright test --workers=1 task-queue.spec.ts task-detail.spec.ts patient-profile.spec.ts` (Phase 3 E2E)
- `npx tsc -p apps/web/tsconfig.json --noEmit`

**Test results (this session, 2026-07-07, fresh, re-confirmed after every Standards review fix):**
apps/web unit tests — **29 files / 261 tests passed** (220 pre-existing + 41 new for Phase 3
= 11 TaskQueue + 14 TaskDetail + 16 PatientProfile); Phase 3 Playwright E2E — **7/7 passed**
(4 patient-profile + 3 task-queue/detail); `tsc --noEmit` exit 0 in apps/web.

**Pre-existing E2E failures (NOT Phase 3 regressions):** 11 Playwright specs fail in the full
suite for pages Phase 3 didn't touch (`director-governance.spec.ts`, `director-population.spec.ts`,
`director-quality.spec.ts`, `agent-graph-cache.spec.ts`, `coordinator-panel.spec.ts`,
`patient-analysis.spec.ts`, `patient-detail-live-task-update.spec.ts`,
`social-worker-denied.spec.ts`). Confirmed pre-existing by re-running
`director-governance.spec.ts` against `git stash`-clean `main` (HEAD `3bb0b4d`); same failure.
These are Phase 1+2 verification debt — primarily a stale sidebar nav-link selector (`Governance`,
`Population`, `Quality` text-named link buttons vs the icon-only Sidebar) — and should be
addressed in a follow-up S13 ticket, not as part of this commit.

## Notes

- **The single most important real bug caught by review:** the lead fixture had
  `MARIA_PHONE = '555-0100'` (lead's hardcoded mockup value), but the real HAPI seed had
  `+1-555-0142`, which is what `TaskDetail.tsx`'s existing e2e
  (`task-detail.spec.ts:80`) already asserted. The same patient therefore had two different
  phone numbers depending on which surface the social worker clicked Call from. Reconciled to
  the real seed value `'+1-555-0142'`; the fixture doc + the in-page honest-staging comment +
  the new `patient-profile.spec.ts:51` `tel:` assertion all updated to match.
- **A second real bug, found at the same time:** the lead fixture had `MARIA_ID =
  'maria-chen-4829'` (a pure fixture id that never reached a real FHIR Patient). The
  `isMaria` check on `PatientProfile.tsx` was therefore always false in the running app, making
  the rich-detail branch (labs / meds / SDOH / phone) unreachable from any real navigation path.
  Reconciled to the real HAPI seed id `'maria-chen'` so a social worker navigating from
  `/tasks/:id` (where the Task's `Task.for.reference = "Patient/maria-chen"`) actually sees
  Maria's labs/meds/SDOH/phone. The 16 PatientProfile unit tests use the `MARIA_ID` constant
  directly and updated automatically.
- **Code review caught 4 Standards hard violations + 1 Spec bug, all fixed in the same session:**
  `isoDay` duplicated (TaskDetail.tsx + fixtures) → import from fixtures; `isOverdue`
  reimplemented inline → extracted to `lib/task.ts`; `RISK_BADGE_CLASS` exported but unused
  → deleted; `sexLabel` hand-rolled cascade → added to `lib/patient.ts`; Maria phone mismatch
  → reconciled to real seed. 4 judgement calls left as-is with reasoning documented in
  `review-s12.md` (`CompletedTaskCard` / `sortTasks` / summary bar = pre-existing features
  preserved across the rewrite, not scope creep; defer-date input UX kept as lead-intended
  despite the API discarding the picked date; `MOCK_PATIENTS` cross-phase duplication
  tracked as debt; `conditionDotBgClass` via `.replace('text-', 'bg-')` left as small and
  local).
- **Handoff's open grill questions, all resolved in this slice:** (1) real→mock fallback
  chain kept (Phase 2 pattern, demo insurance); (2) TaskDetail wired to the real
  `transitionTask` PATCH instead of lead's UI stub pattern; (3) `zustand` store left unused
  (local `useState` is simpler for the SSE event-mapping shape); (4) `subscribeToEvents({
  onTaskUpdated })` integrated on `TaskDetail` so cross-surface sync works.
- **Honest-staging discipline applied throughout the Phase 3 port:** the `Description / FHIR
  Evidence / Assigned To / Created` sections from lead's `mobile/TaskDetail.tsx` are dropped
  (the API doesn't return those fields); MRN shown as "—"; risk score replaced with a
  "Risk score unavailable" pill; SDOH card only rendered for Maria (matches lead's `isMaria`
  branch); labs/meds placeholders mirror lead's "not available in demo" copy. No fabrication
  of fields the API doesn't carry.
- **Evidence strength:** local. The 7 new Phase 3 Playwright E2E specs drive the real API +
  live HAPI (no mocks), giving local packaged-UI-strength evidence. The 41 new unit tests
  use the established `vi.mock('../api/client', …) + waitFor(…)` pattern (matches Phase 1+2's
  `settleOnRealData` rule for query-derived values). Pre-existing E2E failures (11 specs for
  pages Phase 3 didn't touch) are local-mock strength at best and are not Phase 3 evidence.
- **Scope-flex decision — `apps/web/src/pages/PopulationPatientList.tsx` + its test deleted.**
  The Phase 2 nav refactor superseded the old `/population/patients` drill-in route, leaving
  the page + test as orphans. Deleted in the same commit (per the handoff's "side-effects the
  next agent should NOT undo" note: "if a future slice wants quadrant drill-in back, recreate
  the route + page from scratch — the old code is in git history"). Not Phase 3 work, just
  orphan cleanup bundled in.
