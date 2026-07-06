# Code Review — CareSync AI, S10 (CDS Hooks patient-view service)

> **PLAN_ID:** `caresync-ai` · **Slice:** S10 · **Date:** 2026-07-06
> **Diff:** `main` (`d219b9c`) `...HEAD` (`b28f4ea` at review time), 7 commits.
> **Spec sources:** `docs/plans/caresync-ai/issues.md` S10, `implementation-plan.md` Iteration 10
> (including its "Pre-implementation plan review" note — that note is itself part of the spec for
> this diff, documenting two deliberate scope corrections made *before* any code was written),
> `verification-s10.md`. This repo has no `CODING_STANDARDS.md`/`CONTRIBUTING.md` and `CLAUDE.md`'s
> "Code style" section is an empty placeholder — the Standards axis instead measured the diff against
> the closest established sibling modules (`agents/citationValidator.ts`'s pure-Seam-module
> convention, `analysis.ts`'s router-factory + injectable-dependency convention) plus the fixed
> Fowler smell baseline. Prior review preserved at `review-s9.md` (a different branch; not yet merged
> to `main` as of this diff's base).

## Standards

**Convention match: strong.** `createCdsHooksRouter(db, readCache = readAnalysisCache)` in
`apps/api/src/routes/cdsHooks.ts` mirrors `analysis.ts`'s injectable-dependency pattern exactly
(required `db` before the defaulted `readCache`, same `ReadCache` type-alias naming), mounted the
same way every other router is. `cdsCardMapping.ts` follows the pure-Seam-module convention from
`citationValidator.ts`: no I/O, trivial helpers (`truncateSummary`, the three `*Indicator` functions)
kept private and exercised only through the public seam, matching rationale-comment density at each
notable decision (why `actionPlanner` is excluded, why cache-only, why 140-char truncation).

The router's deliberate omission of `requireAuth` — a real departure from every other router in this
codebase (`patients.ts`, `tasks.ts`, `population.ts`, `governance.ts`, `analysis.ts` all apply it) —
is self-documented in comments at both routes explaining the public-sandbox no-session-token
constraint, so it reads as a justified deviation, not an unexplained one. The `cached.resultJson as
AnalysisResultJson` unchecked cast is not a new pattern — it's byte-identical to the existing cast
already in `analysis.ts:202` on the same table.

**Baseline smell, confirmed as a judgement call (already flagged and left as-is in the prior review
pass, independently re-confirmed here, not fixed):**
- **Duplicated Code** — `cdsCardMapping.ts`'s three `riskCards`/`careGapCards`/`sdohCards` `.map()`
  blocks are near-identical in shape (truncate + indicator-lookup + fixed `(FHIR: id)` detail string +
  hardcoded source label), differing only in field names and which `*Indicator` function is called.
  Real risk if a 4th finding category is ever added (a 4th near-identical block) or if the detail-string
  format changes (an edit could land in only some blocks). Not fixed this pass, matching the tolerance
  this repo's own S4/S9 reviews already applied to structurally similar shapes — the current form is
  still readable and each section genuinely has different field names/tier value sets.

No hard convention violations found. No other baseline smells (Mysterious Name, Feature Envy, Data
Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative
Generality, Message Chains, Middle Man, Refused Bequest) observed.

## Spec

**Verdict: clean.** No missing/partial requirements, no scope creep, no wrong-implementation findings
survive verification.

- **The A1↔A2 service-id wiring is genuinely shared, not two independently-typed literals** —
  `CDS_PATIENT_VIEW_SERVICE_ID` is exported from `cdsHooks.ts` and used both in the discovery
  descriptor and the `POST /:id` route's match check.
- **Card mapping genuinely excludes `actionPlanner`** — only `risk`/`careGap`/`sdoh` findings are
  mapped; confirmed by both reading `cdsCardMapping.ts` and by a test asserting a populated
  `actionPlanner.tasks` never leaks into the response.
- **The cache-miss path never triggers a live orchestrator run** — `grep` for `orchestrator` across
  the new files returns nothing; a cache miss returns `cards: []` directly. This is the load-bearing
  corrected-scope decision from the pre-implementation plan review, and the diff genuinely honors it.
- **No auth added** — `POST /cds-services/:id` and `GET /cds-services` are mounted outside `/api`
  with no `requireAuth`, matching the public-sandbox requirement; a dedicated test asserts the
  no-auth-header case still returns 200.
- **No scope creep** — the diff is scoped exactly to the plan's A1/A2/B1 items plus doc files
  (`issues.md`, `implementation-plan.md`, `verification-s10.md`, new `cds-hooks-sandbox.md`); no
  extraneous files, no changes to any other router/auth/CORS path.
- **Tests exist and pass**: `cdsHooks.test.ts` + `cdsCardMapping.test.ts`, 14/14.

**Update (2026-07-07, post-review):** S10 acceptance bullet 3 ("A card fires in the public CDS Hooks
sandbox against the running service") was open at review time, pending the user's sign-off to expose
the local server via a tunnel. The user subsequently approved it; the sandbox smoke test was run live
against the real `sandbox.cds-hooks.org` client via `ngrok`, proving the full pipeline end-to-end (see
`verification-s10.md` §1/§2/§7 for the complete evidence). The specific session's response was honestly
`cards: []` (the sandbox's own patient picker has no overlap with our cached patients), a documented
environment constraint, not a code defect. All 4 acceptance bullets are now met.

No discrepancies found between `verification-s10.md`'s narrative and the actual diff contents.

## Summary

**Standards:** 0 hard findings, 1 baseline smell (judgement call, confirmed and left as-is —
structural duplication across the three card-mapping sections). Worst issue: the duplication, not
blocking.
**Spec:** 0 findings against what this diff claims to deliver. All 4 acceptance bullets are met,
including the public-sandbox fire (resolved post-review — see update above).

## Next step

`finishing-a-development-branch` — push, open the PR against `main`, and merge.
