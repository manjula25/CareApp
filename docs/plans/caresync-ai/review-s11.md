# Code Review — CareSync AI, S11 (Demo-supporting + shell screens)

> **PLAN_ID:** `caresync-ai` · **Slice:** S11 · **Date:** 2026-07-07
> **Diff:** `main` (`f3f4b77`) `...HEAD` (`e6154b7` at review time; `23069ff` after the Standards
> fix below), 9→10 commits.
> **Spec sources:** `docs/plans/caresync-ai/issues.md` S11, `implementation-plan.md` Iteration 11,
> `tasks/todo.md`'s active-slice mirror (records the A4 capacity-flex decision and per-task review
> verdicts), `verification-s11.md`. This repo has no `CODING_STANDARDS.md`/`CONTRIBUTING.md` and
> `CLAUDE.md`'s "Code style" section is an empty placeholder — the Standards axis instead measured
> the diff against the closest established sibling modules (`governance/service.ts`'s
> gate→read→transform + `assertDirector` convention, `fhir/client.ts`'s audited-write convention,
> `Governance.tsx`'s mockup-deviation-doc-comment + Tailwind-only convention,
> `ConfidenceChart.tsx`'s native-Canvas convention) plus the fixed Fowler smell baseline.

## Standards

**Convention match: strong** across the API layer. `assertDirector`-gate → read → transform
(`quality/service.ts`, `team/service.ts`), router-factory-with-injected-deps + try/catch→403
mapping (`routes/quality.ts`, `routes/team.ts`, `routes/sdoh.ts`), and `createServiceRequest`'s
audited-write shape mirror `createTask` exactly (`fhir/client.ts`), with doc-comment density at
every non-obvious decision (`_summary=count` choice, `%7C` encoding workaround). Test conventions
(Supertest+`loginAs`, Vitest+`importActual`) are followed exactly throughout.

**Hard convention violation, found and fixed:** `Team.tsx`'s `StatTile` was a near-verbatim,
undocumented copy of `Governance.tsx`'s `Tile` (identical container/label/value markup, minus the
`note` prop) — unlike every other duplication in this branch, it carried no doc comment
explaining the departure from Governance's own precedent of reusable stat-tile atoms.
**Fixed** (commit `23069ff`): extracted to `apps/web/src/components/StatTile.tsx`, now used by
both `Governance.tsx` and `Team.tsx`. Re-verified: `npx vitest run` → 27/225 still green,
`npx tsc --noEmit` clean in both workspaces.

**Baseline smells, judgement calls, left as-is:**
- **Duplicated Code — `assertDirector` quadruplication.** `governance/service.ts`,
  `quality/service.ts`, and `team/service.ts` each re-implement the identical role-check/audit/
  throw function with the same "deliberate minimal duplicate" doc comment. This is a documented
  repo pattern (governance/service.ts established it against population/service.ts), so not a
  hard violation, but S11 extends a 2-copy precedent to 4 without revisiting whether a shared
  helper (alongside the already-central `DirectorOnlyError`) is now cheaper. Not blocking —
  matches this repo's own established tolerance for this exact shape (see S10's review, which
  found and left a structurally similar duplication).
- **Duplicated Code — `AppShell.tsx`'s five sequential role-gated nav-link blocks.** Same shape
  repeated per link (Tasks/Task Center/Governance/Quality/Team/More). The branch itself
  introduces a data-driven alternative for exactly this kind of repetition elsewhere
  (`shellScreens.ts`'s table-driven shells) but didn't apply it to its own new nav links. Minor,
  not blocking.

No Feature Envy, Primitive Obsession, Message Chains, Mysterious Name, Repeated Switches,
Shotgun Surgery, Divergent Change, Speculative Generality, Middle Man, or Refused Bequest
observed.

## Spec

**Verdict: clean.** No missing/partial requirements against the S11 acceptance criteria, no scope
creep, no wrong-implementation findings survive verification.

- **A1 (SDOH):** `apps/api/src/routes/sdoh.ts` + `fhir/client.ts`'s `createServiceRequest` POST a
  real, audited FHIR `ServiceRequest`. Matches `issues.md`: *"a referral creates a FHIR
  ServiceRequest."*
- **A2 (Quality/HEDIS):** `quality/service.ts` computes real live counts (Condition E11.9 vs.
  Observation LOINC 4548-4); `illustrativeIncentiveDollars` is clearly labeled non-financial in
  both the service doc and the UI. Matches *"shows measure progress and incentive dollars at
  stake, derived from FHIR data."* Director-only gating matches PRD story 9.
- **A3 (Team):** `team/service.ts` reuses the same task-bearing panel `listTasks` (S7 A1) already
  established as this POC's task population — consistent with existing precedent, not a new gap.
  Director-only gating matches PRD story 8.
- **A4 (deferred):** the only unbuilt item from the plan's broader "What to build" list
  (M04/M08/W14) — **a justified deferral, not a spec violation.** `issues.md`'s S11 "Acceptance
  criteria" checklist lists only 5 items (none referencing M04/M08/W14); the plan's own text says
  *"Scope flexes to remaining capacity; the six demo-critical screens... take priority"* and A4's
  own task instruction says *"stop at capacity, record what's partial (honest staging)."*
  `tasks/todo.md` records a specific, checkable rationale (no mockups, direct overlap with
  already-shipped screens, W14 being new backend scope). No acceptance bullet or definition-of-done
  line references these three, so nothing checked off is actually missing.
- **B1 (shells):** all 11 IDs render via one shared, parameterized component driven by a
  route→title table, reachable via a new "More" nav link. Matches *"shell screens exist in
  navigation... consistent... styling and placeholder content"* and the honest-staging bullet.
- **No scope creep:** every diff surface traces to a spec line (SDOH/Quality/Team nav links and
  entry points are direct consequences of A1/A2/A3/B1, not additions beyond them).
- **Tests exist and pass:** 37 API suites / 232 tests, 27 web files / 225 tests, 16/16 Playwright
  E2E specs (serial run) — see `verification-s11.md` §1 for full command evidence, independently
  re-run during this review.

## Summary

**Standards:** 1 hard finding (found and fixed — `StatTile` duplication, commit `23069ff`), 2
baseline smells (judgement calls, left as-is per established repo tolerance). Worst issue: the
`StatTile` duplication — already resolved.
**Spec:** 0 findings against what this diff claims to deliver. All 5 S11 acceptance criteria are
met; the one deferred item (A4) is an explicitly justified, spec-permitted capacity-flex
decision, not a gap.

## Next step

`finishing-a-development-branch` — push, open the PR against `main`, and merge.
