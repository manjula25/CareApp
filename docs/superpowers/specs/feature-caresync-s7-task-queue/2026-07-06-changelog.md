# Changelog: S7 — Role-filtered task queue + task actions

**Type:** Feature

**Branch:** `feature/caresync-s7-task-queue` (branched off `main` at the S6 merge, `a1f1dc1`)

**Date:** 2026-07-06

## Summary

Delivers the role-filtered task queue and its actions (M02/M03 + a W13 shell). A Social Worker's
queue shows only SDOH-domain tasks; a Coordinator's shows everything. Opening a task shows the
justifying patient context and citations, and the user can Complete/Defer/Escalate (each an audited
FHIR Task write) or Call the patient. Completing a task on the mobile-shaped queue syncs live to an
already-open web view via the existing S6 relay.

## Changes Made

### Backend — Task domain field (A0, plan-review finding)

- **Before:** `Task` carried no field distinguishing SDOH from clinical work; the Action Planner's
  per-task citations were explicitly dropped before the HAPI write.
- **After:** Action Planner self-reports `domain: 'clinical' | 'sdoh'` per task (reusing the existing
  `ResourceDomain` vocabulary). Storage-mechanism correction from the original plan: FHIR R4 `Task`
  has no `category` element (HAPI 7.2.0 silently drops it), so domain is stored as a second
  `meta.tag` coding, mirroring the existing `CARESYNC_TASK_TAG` pattern. Fail-open on read: a Task
  created before this field existed maps to `domain: undefined`, visible to every role, never a
  fabricated default.
- **Files changed:** `apps/api/src/agents/actionPlannerAgent.ts`, `apps/api/src/agents/agent.ts`,
  `apps/api/src/fhir/client.ts`, `apps/api/src/routes/analysis.ts`.

### Backend — Role-filtered listing + status transitions (A1, A2)

- **Before:** No way to list Tasks across the panel or transition a Task's status other than via
  `assign`.
- **After:** `GET /api/tasks` (`listTasks`) reads every panel member's Tasks via
  `Patient/{id}/$everything` — not `Task?subject=...` search, verified against the real local HAPI
  to lag behind a just-written Task — then filters per-task by domain scope (fail-open). `PATCH
  /api/tasks/:id/status` (`transitionTask`) maps `complete`→`status: 'completed'`,
  `defer`→`status: 'on-hold'` + `businessStatus: 'Deferred'`, `escalate`→`businessStatus:
  'Escalated'` + `priority: 'urgent'` (FHIR R4 `Task.status` has no native deferred/escalated
  value). Authorization generalizes A1's read filter to a write: denies only if the Task's own
  domain is defined and the actor's role lacks scope for it — not a blanket `guard('clinical')`,
  which would incorrectly block a Social Worker from their own sdoh tasks.
- **Files changed:** `apps/api/src/fhir/client.ts` (`listTasks`, `transitionTask`,
  `guardTaskDomain`, `displayStatus`), `apps/api/src/routes/tasks.ts`.

### Backend — Task detail + citation persistence (B2, plan-review finding)

- **Before:** S3's `createTask` deliberately did not persist the Action Planner's citations onto the
  FHIR Task (SSE-only) — fine until a task needed to show its justification after the fact.
- **After:** `createTask` writes citations as `Task.input` entries (`{type:{text:'citation'},
  valueReference:{reference}}`), one per citation. `Task.reasonReference` was tried first (seemed
  like the obvious native field) and rejected: FHIR R4 defines it `0..1`, and HAPI silently keeps
  only the first entry of a multi-value array — verified by direct probe before it shipped.
  `Task.input` (`0..*`) was verified the same way to round-trip every entry intact. New `GET
  /api/tasks/:id` (`getTaskDetail`) resolves each citation to a display string and returns the
  patient's phone (new `Patient.telecom` seed data — fabricated demo numbers) for the Call link.
- **Files changed:** `apps/api/src/fhir/client.ts` (`createTask`, `getTaskDetail`,
  `resolveCitationDisplay`, `patientContextFromBundle`, `FhirNotFoundError`),
  `apps/api/src/fhir-data/seed-patients.ts`, `apps/api/src/scripts/import-fhir.ts`.

### Backend — Cross-surface sync (B3, scope correction)

- **Before:** `EventHub.publish` only reached one specific user's connections (S6's owner-scoped
  `assignment` event); a plain status transition with no reassignment notified no one.
- **After:** `EventHub.publishAll` broadcasts to every open connection. The Subscription webhook now
  fires `task-updated` on every Task change (assigned or not), alongside the unchanged
  `assignment` event.
- **Files changed:** `apps/api/src/routes/eventHub.ts`, `apps/api/src/routes/events.ts`.

### Frontend — M02 Task Queue, M03 Task Detail, W13 shell

- **Before:** No task queue or task-detail screen existed; Social Worker's role home was a
  `/coming-soon` placeholder.
- **After:** `/tasks` (`TaskQueue.tsx`) — phone-frame queue built against
  `reference-materials/caresync-mobile.html`, role-filtered, priority-sorted, with a working "Done"
  action. `/tasks/:id` (`TaskDetail.tsx`) — justifying context, resolved citations,
  Complete/Defer/Escalate, `tel:` Call link (no mockup exists for this screen; built to the
  established design tokens/patterns). `/task-center` (`TaskCenter.tsx`) — an honest nav-only
  placeholder, since `plan.md` GD9 (locked) scopes W13 as a shell, not a fully-functional screen
  (this contradicted the S7 plan text's own wording for B3 — resolved in favor of GD9).
  Social Worker's `roleHome` now points to `/tasks`. `PatientDetail.tsx` subscribes to the new
  `task-updated` broadcast and live-updates when a task for that patient changes elsewhere — this is
  where "completing on mobile syncs to web" is actually satisfied, since W13 itself is a shell.
- **Files changed:** `apps/web/src/pages/{TaskQueue,TaskDetail,TaskCenter,PatientDetail}.tsx`,
  `apps/web/src/{App,api/client}.tsx`, `apps/web/src/auth/useAuth.tsx`,
  `apps/web/src/components/AppShell.tsx`, `apps/web/src/lib/task.ts`.

### E2E — Real role filtering, real transitions, real live sync

- **After:** `apps/web/e2e/task-queue.spec.ts` (Social Worker sees sdoh/uncategorized only,
  completes one; Coordinator sees everything), `task-detail.spec.ts` (citations resolve and render,
  defer works, Call link is correct), `patient-detail-live-task-update.spec.ts` (a direct
  status-transition PATCH live-updates an already-open patient tab, no reload). All mutate
  live seed/probe data and restore it, verified via direct HAPI reads in `afterAll`.

## Files Modified

| File | Change Description |
|------|---------------------|
| `apps/api/src/fhir/client.ts` | `TaskDomain`, `extractTaskDomain`, `listTasks`, `transitionTask`, `getTaskDetail`, `guardTaskDomain`, `patientContextFromBundle`, `resolveCitationDisplay`, `displayStatus`, `FhirNotFoundError`; `createTask` gains domain tag + `Task.input` citations |
| `apps/api/src/agents/{actionPlannerAgent,agent}.ts` | Action Planner schema gains `domain` |
| `apps/api/src/routes/tasks.ts` | `GET /`, `GET /:id`, `PATCH /:id/status` |
| `apps/api/src/routes/tasks.test.ts` | New — role-filtered listing, each transition × domain-scope allow/deny, detail read, 404 |
| `apps/api/src/routes/eventHub.ts` | `publishAll` (broadcast) |
| `apps/api/src/routes/events.ts` | Webhook fires `task-updated` on every Task change |
| `apps/api/src/fhir-data/seed-patients.ts` | `phone` field on all 6 named patients |
| `apps/api/src/scripts/import-fhir.ts` | `Patient.telecom` from seed phone |
| `apps/web/src/pages/TaskQueue.tsx` | New — M02 |
| `apps/web/src/pages/TaskDetail.tsx` | New — M03 |
| `apps/web/src/pages/TaskCenter.tsx` | New — W13 shell |
| `apps/web/src/pages/PatientDetail.tsx` | Subscribes to `task-updated`, live-invalidates its query |
| `apps/web/src/auth/useAuth.tsx` | `roleHome('social_worker')` → `/tasks` |
| `apps/web/src/components/AppShell.tsx` | "Tasks" + "Task Center" nav links |
| `apps/web/src/api/client.ts` | `listTasks`, `getTaskDetail`, `transitionTask`, `completeTask`, `onTaskUpdated` |
| `apps/web/e2e/{task-queue,task-detail,patient-detail-live-task-update}.spec.ts` | New |
| `docs/plans/caresync-ai/{implementation-plan,issues}.md` | S7 task/AC checkboxes corrected to done |
| `docs/plans/caresync-ai/{verification-s7,review-s7}.md` | S7 verification + code-review gates recorded |
| `plan.md`, `docs/plans/caresync-ai/prd.md` | GD4 mobile-stack decision recorded as locked |

## Commits

| Commit | Description |
|--------|-------------|
| `933a423` | docs(S7): resolve GD4 mobile-stack decision (pre-work gate) |
| `009035b` | docs(S7): amend Iteration 7 with A0 — Task domain field |
| `7fcc4aa` | feat(S7): A0 — Task care-domain field (Action Planner self-report) |
| `48ca413` | feat(S7): A1 — role-filtered task listing |
| `6c5da71` | feat(S7): A2 — status-transition endpoints |
| `302b4f8` | feat(S7): B1 — M02 Task Queue |
| `48ec1f0` | feat(S7): B2 — M03 Task Detail + actions |
| `d6656e1` | feat(S7): B3 — W13 shell + cross-surface sync |
| `25fc32d` | docs(S7): verification-before-completion pass (Phase C) |
| `332ce37` | docs(S7): two-axis code-review artifact (Standards + Spec) |

## Testing & Verification

**How to verify this works:**
- `docker compose up -d hapi-fhir && npm run fhir:import` (fresh seed, including new patient phones)
- `cd apps/api && npx jest --runInBand`
- `cd apps/web && npx vitest run`
- `cd apps/web && npx playwright test --workers=1`
- `npx tsc --noEmit` in both `apps/api` and `apps/web`

**Test results (this session, 2026-07-06, fresh, re-confirmed before finishing):** API **27 suites /
147 tests passed**, web unit **13 files / 122 tests passed**, Playwright **13/13 passed** (serial —
this repo's HAPI-backed suites are documented-flaky under parallel workers, a pre-existing
environmental coupling, not an S7 regression), both `tsc --noEmit` exit 0, both `lint` clean (0
errors; 13 pre-existing api warnings + 4 pre-existing web warnings, none in S7 files, matching prior
slices' baselines).

## Notes

- **Two plan-review findings, both caught and resolved during implementation (not after):**
  citation persistence (`Task.reasonReference`'s silent truncation, caught by empirical HAPI
  verification before it shipped) and the GD9/W13 scope conflict (this branch's own B3 plan text
  implied full functionality for a screen `plan.md` locks as a nav-only shell). Both documented in
  `implementation-plan.md` Iteration 7 and `verification-s7.md` §3.
- **A pre-existing unpushed local branch was discovered and reconciled at session start**: GD4's
  resolution and A0 had already been implemented on this branch in a prior session before this one
  began. The duplicate GD4 write-up drafted at the start of this session was discarded in favor of
  the existing, better-reasoned version.
- **Non-blocking follow-up (from `review-s7.md`, already addressed):** a duplicated patient-context
  lookup between `listTasks`/`getTaskDetail` and a stale doc comment referencing `Task.category`
  were both found and fixed within this same session, before this changelog was written — not
  carried forward as open debt.
- **`getAssignedPanel`'s `taskCount`** still reads via `Task?subject=...` search and has the same
  latent HAPI lag risk `listTasks` worked around — out of scope for S7, flagged for a future slice.
- **Evidence strength:** local mock / packaged UI — headless Playwright + Jest/Vitest against a
  local dev stack and a disposable Docker HAPI container. Not target-environment or client-accepted.
- **Branch is local-only, never pushed** — no PR opened yet as of this changelog.
