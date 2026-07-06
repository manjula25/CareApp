# Code Review — CareSync AI, S7 (Role-filtered task queue + task actions)

> **PLAN_ID:** `caresync-ai` · **Slice:** S7 · **Date:** 2026-07-06
> **Diff:** `main` (`a1f1dc1`) `...HEAD` (`25fc32d`), 9 commits.
> **Spec sources:** `docs/plans/caresync-ai/issues.md` S7, `implementation-plan.md` Iteration 7,
> `verification-s7.md`. Prior review preserved at `review.md` (S1–S6 cumulative).

## Standards

No hard CLAUDE.md violations found. Mockup fidelity deviations (M02's chrome scope) and the
no-mockup screens (M03, W13) are documented in-code and cross-referenced in `verification-s7.md`,
satisfying the repo's deviation-recording rule. E2E coverage exists for all three new/changed
screens.

**Baseline smell found and fixed during this review:** `FhirReadService.listTasks` and
`getTaskDetail` (`apps/api/src/fhir/client.ts`) each inlined an identical 8-line block pulling
`patientName`/`conditionTag`/`patientPhone` out of a patient's `$everything` bundle — genuine new
duplication (not the pre-existing `getTasks`-style inline-mapping convention this file already
carries, which was considered and correctly not flagged). Extracted into a private
`patientContextFromBundle` helper; both call sites now share it. Re-verified: `tsc --noEmit` clean,
147/147 API tests still pass.

Not flagged, considered and dismissed: `TaskListEntry`/`TaskDetail` type duplication across the
API/web boundary (matches this repo's existing `TaskSummary` cross-boundary pattern, no shared-types
package exists); `EventHub.publishAll` and the `completeTask`→`transitionTask` wrapper (both have
real call sites, not speculative); `guardTaskDomain`/`resolveCitationDisplay` extractions (these
*reduce* duplication, not introduce it).

## Spec

No missing/partial requirements, no scope creep. All 6 `issues.md` S7 acceptance bullets and every
Phase A/B/C sub-bullet in `implementation-plan.md` Iteration 7 are implemented and test-covered,
independently confirmed against the code (not just the plan doc's own claim):

- Fail-open domain rule verified end-to-end in code and tests — no case where it fails closed.
- Escalate's `Task.status` staying unchanged (no native FHIR value for "escalated") is the
  documented, reasoned R4-constraint workaround, not a silent gap — `businessStatus` carries the
  distinction and the acceptance criterion's "reflect back in the UI" is satisfied through it.
- `Task.input` citation persistence and the W13/GD9 scope correction both match what
  `verification-s7.md` claims was done, confirmed against the actual diff and tests, not just
  re-asserted.

**One stale doc comment found and fixed during this review:** `apps/api/src/agents/agent.ts`'s
`ActionPlannerOutput.domain` comment said "consumed downstream to write Task.category (S7 A0)" —
stale, since A0's own doc explains `Task.category` doesn't exist in FHIR R4 and the field is
actually written as a `meta.tag` coding. Corrected to match.

## Summary

**Standards:** 1 finding (duplicated code), fixed. **Spec:** 1 finding (stale comment), fixed. No
open findings on either axis. Worst issue per axis was the fix itself — nothing more severe surfaced
on either side.

## Next step

`finishing-a-development-branch`.
