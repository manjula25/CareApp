# Code Review — CareSync AI, S12 (Phase 3 mobile-trio lead-port at normal web size)

> **PLAN_ID:** `caresync-ai` · **Slice:** S12 / Phase 3 · **Date:** 2026-07-07
> **Diff:** `HEAD` (`3bb0b4d`) `...working-tree`, all of Phase 0/1/2/3 uncommitted.
> **Spec sources:** Handoff doc at `/var/folders/p2/9_g0mt3j50zgw44_x202r9xm0000gp/T/caresync-s12-handoff.md` (open grill questions, 5-step ritual pattern), the inline Phase 3 plan I presented to the user (drop 390px phone frame, drop FAB + CreateTaskSheet, route plan, priority mapping, PatientProfile fallback strategy, tests for all 3 pages, TaskDetail subscribes to `subscribeToEvents` for cross-surface sync), and the user's three AskUserQuestion confirmations (mobile trio at normal web size, Phase 1+2 verified, commit all 3 phases together). This repo has no `CODING_STANDARDS.md`/`CONTRIBUTING.md`; Standards measured the diff against the closest established sibling modules (`PatientDetail.tsx`'s data-testid convention, `Population.tsx`'s `settleOnRealData` waitFor pattern, `Sdoh.tsx`'s `<Link>← Back to …</Link>` convention, `lib/task.ts` + `lib/patient.ts` as the home for shared date/demographic helpers) plus the fixed Fowler smell baseline.

## Standards

**Convention match: strong** in the test and e2e layers. Phase 3's `vi.mock('../api/client', …) + useNavigate mock + renderXxx() + settleOnRealData()` pattern mirrors Phase 1/2's `Population.test.tsx`/`PatientDetail.test.tsx` exactly, including the critical `waitFor` rule for query-derived values (avoiding the `findByTestId` first-paint trap the handoff called out). E2E spec style (`page.goto('/login') + Email/Password + Sign in + expect URL + page.goto('/route') + assertions`) matches the S7–S11 specs.

**Hard convention violations, found and fixed:**

1. **Duplicated Code — `isoDay` defined twice** (`TaskDetail.tsx:74-80` and `TaskDetail.fixtures.ts:60-66`, same body, slightly different signature). **Fixed**: removed the local copy in `TaskDetail.tsx`; the page now imports `isoDay` from `./TaskDetail.fixtures` (the fixture's `string | Date` signature is strictly broader, so the page's `Date`-only calls still typecheck).

2. **Duplicated Code — `isOverdue` re-implemented `lib/task.ts`'s `startOfDay` inline** (`TaskDetail.tsx:65-72`). **Fixed**: extracted `isOverdue(due: string): boolean` into `lib/task.ts` (next to `startOfDay` and `dueLabel` — its natural siblings), `TaskDetail.tsx` now imports it.

3. **Speculative Generality — `RISK_BADGE_CLASS` exported but unused**. The fixture's own comment admitted it was "kept in case any future slice wants it." `PatientProfile.tsx` renders a "Risk score unavailable" pill instead (correct choice — the real API has no `riskScore`). **Fixed**: deleted the export from `PatientProfile.fixtures.ts`.

4. **Primitive Obsession / Mysterious Name — `sexLabel` hand-rolled cascade in `PatientProfile.tsx:109-112`**. `lib/patient.ts` already exports `ageSexLabel` next to `riskDotColor` and `RISK_DOT_CLASS`. **Fixed**: added a `sexLabel(gender)` sibling to `lib/patient.ts`; `PatientProfile.tsx` imports it.

5. **Spec bug — Maria's phone disagreed with the real seed**. `PatientProfile.fixtures.ts:90` had `MARIA_PHONE = '555-0100'` (verbatim from lead's mockup). The real HAPI seed (`apps/api/src/fhir-data/seed-patients.ts:55`) carries Maria's phone as `+1-555-0142`, which is what `TaskDetail.tsx`'s e2e (`task-detail.spec.ts:80`) already asserts. Same patient, two different phone numbers depending on which surface the social worker clicks Call from — a real inconsistency. **Fixed**: updated `MARIA_PHONE` to `'+1-555-0142'`, updated the fixture doc + the in-page honest-staging comment + the e2e `tel:` assertion to match. Re-verified: e2e `patient-profile.spec.ts` + `task-detail.spec.ts` + `task-queue.spec.ts` all 7/7 green; unit tests 261/261 green; typecheck clean.

**Spec bug — minor (added test coverage):** `data-testid="patient-profile-condition-{id}-display"` is rendered in `PatientProfile.tsx:161` but the unit test only asserted the row-level testid. **Fixed**: added a one-line `expect(...getByTestId('…-display')).toBeInTheDocument()` inside the existing `MARIA_GET_PATIENT_RESULT.conditions.forEach` loop.

**Judgement calls (left as-is, with reasoning):**

- **`CompletedTaskCard` / `sortTasks` / 3-stat summary bar in `TaskQueue.tsx`.** The Standards axis flagged these as "scope creep" against the lead's design. They're not — they're preserves of features from the pre-Phase-3 in-tree `TaskQueue.tsx` (the 390px phone-frame version). The Phase 3 brief said "port lead's mobile trio at normal web size," which doesn't read as "remove all existing pre-Phase-3 features." The summary bar + sort + completed-card treatment are established UX patterns in this codebase, and the doc comment in `TaskQueue.tsx` already calls out the 390px frame drop + FAB drop + MobileNav drop explicitly. Decision: keep all three.

- **Defer-date input UX that no-ops the picked date.** `TaskDetail.tsx:127-137` (`handleDefer`) renders a working date input, captures the picked date into `deferDate` state, and then calls `transitionTask(id, 'defer')` — the API has no `dueDate` override param, so the date is discarded. Honest-staging note documents this in the file header (lines 39-44). Removing the date input would diverge from lead's design (lead's mobile TaskDetail had the same pattern); widening `transitionTask`'s API is out of scope for a port slice. Decision: keep the input as lead-intended, keep the honest-staging note.

- **`MOCK_PATIENTS` duplication across `PatientProfile.fixtures.ts` and `Population.fixtures.ts`.** Two different `MockPatient` interfaces (4 patients vs 8 patients), overlapping Maria/Roberto/Patricia rows. The Data Clumps smell is real, but consolidating them would require either widening `Population.fixtures.ts`'s `MockPatient` shape to also include `id` strings instead of the `pop-0001` synthetic ids it currently uses, or picking one fixtures file as the source of truth. Both options affect Phase 2's test surface (Population's tests import directly from `MOCK_PATIENTS`). Out of scope for Phase 3 — track as cross-phase debt.

- **`conditionDotBgClass` via `.replace('text-', 'bg-')`.** Hacky but small (3 lines, one place it's used). Not worth a new palette abstraction.

- **`PRIORITY_BORDER_L` in `TaskQueue.tsx` overlapping `lib/task.ts`'s `PRIORITY_CLASS`.** Different concerns (left-border for the card vs text/bg for the priority pill), so they can co-locate without conflict. Acceptable.

## Spec

**(a) Missing / partial** — none material. The lead's `Description / FHIR Evidence / Assigned To / Created` sections are not rendered; the file header documents the drop explicitly (`getTaskDetail` API doesn't return those fields). Adding them as stub sections would fabricate fields, which violates the "honest-staging deviations" rule the handoff and CLAUDE.md both enforce. Decision: leave absent with the honest-staging note in place.

**(b) Scope creep** — none. The `CompletedTaskCard` / `sortTasks` / summary bar additions in `TaskQueue.tsx` are pre-existing features preserved across the rewrite (see Standards judgement calls above), not new scope.

**(c) Implementation looks wrong** — one real bug, fixed:
- Maria's phone: `tel:555-0100` (lead fixture) vs `tel:+1-555-0142` (real HAPI seed). Fixed by updating `MARIA_PHONE` and the `PatientProfile.tsx` honest-staging comment + e2e `tel:` assertion. See Standards finding #5 for the full trace.

## Summary

- **Standards**: 5 hard violations found and fixed (1 spec bug, 4 code smells), 4 judgement calls left as-is with reasoning. Worst issue: Maria phone mismatch (cross-page inconsistency, hidden until a social worker clicked Call from both surfaces).
- **Spec**: 1 implementation bug found and fixed (same Maria phone), 0 missing/partial requirements, 0 scope creep. Worst issue: same as Standards (Maria phone).

Re-verified after fixes: 261/261 unit tests pass, 7/7 Phase 3 e2e tests pass, `npx tsc --noEmit` clean in both workspaces. Phase 3 is ready to commit.
