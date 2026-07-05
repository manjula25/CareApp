# Code Review — CareSync AI, S4 (Agent-graph canvas + analysis cache/replay)

> **PLAN_ID:** `caresync-ai` · **Slice:** S4 · **Date:** 2026-07-05
> **Fixed point:** `e8a9309` (last S3 commit) → `HEAD` (`d5e0796`), fully committed — no uncommitted
> working-tree changes on this branch besides the `verification-before-completion` doc updates from
> this session. `git diff e8a9309...HEAD` — 16 commits (`git log e8a9309..HEAD --oneline`), 19 files
> changed, 2337 insertions / 64 deletions. Two independent sub-agents reviewed the diff in parallel,
> one per axis, each blind to the other's findings.
>
> Read `docs/plans/caresync-ai/verification.md` first — this review runs on top of a PASS verification
> gate; that doc has the fresh test-evidence tables this review doesn't repeat.

## Standards

Documented-standard checks: CLAUDE.md's "UI implementation" ≥80% fidelity rule is satisfied (`tasks/todo.md` records an explicit ≥85% self-check plus the intentional deviations). The local convention of routers taking `db` via dependency injection (`createAuthRouter(db)`) is followed by the new `createAnalysisRouter(...)`. No documented-standard (hard) violations found. `CLAUDE.md`'s own "Code style" section is an empty placeholder, so the smell baseline is the only other lens applied.

Baseline smells (all judgement calls, none blocking):

- **Duplicated Code** — `analysis.ts`'s `replayCachedAnalysis` repeats the same `token`→`finding`*→`complete` emit triplet four times (once per agent), differing only in field names/`agentId`; could be a per-agent loop or table-driven emit.
- **Duplicated Code (already tracked)** — `AnalysisCacheEntry`/`AnalysisCacheRow` in `analysisCache.ts` are byte-identical interfaces; `PatientDetail.tsx`'s "Run live"/"Run Analysis" buttons duplicate a long `className` string at both call sites. Both already logged as accepted nits in `tasks/todo.md` (A1, B3) — not new findings.
- **Middle Man** — `FhirReadService.assertScope()` (`client.ts`) is a one-line pass-through to the existing private `guard()`, added solely so the cache-replay path can call it; reads more naturally as just making `guard` itself public.
- **Awkward parameter list / mild Data Clump** — `createAnalysisRouter(fhirService, runAnalysis, db, readCache, writeCache)` puts the required `db` after the defaulted `runAnalysis`, forcing every real call site to pass `orchestrate` explicitly just to reach `db`. A `{ runAnalysis, db, readCache, writeCache }` deps object would avoid the ordering trap.
- **Stale comment (minor)** — `analysisGraph.ts`'s `useAnalysisGraph` doc says "Not wired up yet; … that's B2/B3," but this same diff (`4dc092f`) wires it into `PatientDetail.tsx`.

**Worst issue on this axis:** the Middle Man / parameter-ordering items are the closest to substantive, and both are minor, non-blocking judgement calls — no hard violations.

## Spec

Overall: strong compliance. All four S4 acceptance criteria (canvas state-machine sync, per-agent color consistency graph→feed→citation, deterministic cache replay with explicit live override, cache/live UI parity) are implemented and covered by tests matching the documented "Event→state contract" fixture in `implementation-plan.md`/`tasks/todo.md`. Task-citation-chip coloring being neutral gray rather than per-agent-colored is **not** a violation — the mockup (`reference-materials/caresync-ai.html`) itself renders citation ids in flat `text-dim` gray; the AC's "color consistent graph→feed→task" is about traceable attribution, which holds.

**One confirmed defect (category c — looks implemented but is wrong), independently re-verified by the parent review before being reported here:**

**Successful cache-replay reads are never audited — only denials are.** `analysis.ts`'s no-`live=1` branch calls `fhirService.assertScope(...)` (added `2b68194`, refactored to reuse `guard()` in `28a6d45`) before replaying. `assertScope` → `guard()` (`client.ts:126-131`) only calls `writeAudit` on the **denial** branch; a successful scope check does nothing, and — unlike every other read method in `client.ts` (e.g. `getPatientBundle`, which calls `guard()` then its own `writeAudit({outcome: 'success'})`) — no code on the replay path writes a success-audit row. Every default "Run Analysis" that successfully replays a patient's full clinical findings (risk/careGap/sdoh findings + Task citations) leaves **zero** `audit_log` rows for that read, breaking S1's "every FHIR read is audited" invariant (which S8's governance/audit dashboard depends on).

Confirmed directly against the code (not just the sub-agent's claim): `analysis.ts:176`'s comment explicitly says "a local role comparison (+ a denial audit write)" — the comment itself only claims the denial write, none for success. `analysis.test.ts` test (a) (successful replay) asserts on SSE event shape and cache-row immutability but never asserts an `audit_log` row exists; test (d) (denied replay) explicitly queries `audit_log` and asserts one denial row. This gap was never closed: commit `2b68194`'s own message names the exact risk ("could read another user's cached clinical analysis with no audit trail") but its fix, and the later `28a6d45` refactor, only closed the denial half. Not on `tasks/todo.md`'s accepted-deviations list — this is new, not previously reviewed.

## Summary

- **Standards:** 5 findings, all baseline-smell judgement calls, no hard violations. Worst: Middle Man (`assertScope` pass-through) / parameter-ordering data clump on `createAnalysisRouter` — both minor.
- **Spec:** 1 finding. Worst (and only): the cache-replay success-audit gap — a real correctness/compliance defect, confirmed, not a false positive.

## Recommendation

The audit gap should be fixed before shipping, consistent with this repo's S2 precedent (`review-s2.md` / `verification-s2.md` §7 — all `code-review`-confirmed defects were fixed test-first before the branch was finished). It's a small, contained fix: add a success `writeAudit` call on the replay path (mirroring `getPatientBundle`'s pattern) and a Supertest assertion in test (a) that a success audit row now exists, the same shape as test (d)'s existing denial-row assertion.

## Post-review fix — 2026-07-05

**User decision: fix before commit** (same precedent as S2's `code-review`-confirmed defects). Fixed test-first:

1. Added a failing assertion to test (a) in `apps/api/src/routes/analysis.test.ts` — queries `audit_log` for a `read`/`success` row on `Patient/${PATIENT_ID}/$everything`, mirroring test (d)'s existing denial-row assertion. Confirmed red (`Expected length: 1, Received length: 0`) before the fix.
2. `apps/api/src/routes/analysis.ts`: imported `writeAudit` from `../db/audit` and added a `writeAudit(db, { actor, action: 'read', fhirResource: 'Patient/:id/$everything', outcome: 'success' })` call immediately after `assertScope` succeeds on the replay path — mirrors `FhirReadService.getPatientBundle`'s existing guard-then-audit pattern exactly (same actor/action/resource/outcome shape). Updated the surrounding comment to reflect that the route, not `assertScope`, now owns the success-audit write.
3. Re-verified fresh: API **90/90** (`--runInBand`), web **69/69**, E2E **7/7**, `tsc`/lint clean for both apps (13 pre-existing api warnings, 3 pre-existing/accepted web warnings — unchanged from pre-fix counts). No regressions.

**Gate outcome: PASS.** Standards axis: 0 hard violations (unchanged). Spec axis: the one confirmed defect is now fixed and covered by a regression test.

## Next step

`finishing-a-development-branch`.
