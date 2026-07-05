# Verification — CareSync AI, S4 (Agent-graph canvas + analysis cache/replay)

> **PLAN_ID:** `caresync-ai` · **Slice:** S4 · **Date:** 2026-07-05
> **Stage:** Phase 5 (`verification-before-completion`), run on `feature/caresync-s4-agent-graph-cache`
> (16 commits, base `e8a9309` = last S3 commit, tip `d5e0796`). Read `docs/plans/caresync-ai/implementation-plan.md`
> Iteration 4 and `docs/plans/caresync-ai/issues.md` S4 for the plan this verifies against — not re-derived here.
> Per-task status with commit SHAs and accepted deviations lives in `tasks/todo.md` (S4 section) — not re-derived here.
> Prior slices' verification preserved at `verification-s3.md`, `verification-s2.md`.

## 1. Fresh command evidence (this session, 2026-07-05)

All commands re-run fresh in this session against the live local stack (Docker HAPI FHIR healthy at `localhost:8080`, `caresync-ui-hapi-fhir-1` running, `GET /fhir/metadata` → 200).

| Command | Result |
|---|---|
| `cd apps/api && npx jest --runInBand` | **20 suites / 90 tests passed** |
| `cd apps/web && npm test` (Vitest) | **8 files / 69 tests passed** |
| `npx playwright test` (from `apps/web`) | **7/7 passed** (3 new S4 + 4 existing, no regressions) |
| `npm run build --workspace apps/api` (`tsc`) | exit 0, clean |
| `npm run build --workspace apps/web` (`tsc -b && vite build`) | exit 0, clean |
| `npm run lint --workspace apps/api` | 0 errors, 13 pre-existing warnings (unused `_event`/output-type imports — same set as S3's verification, unchanged) |
| `npm run lint --workspace apps/web` | 0 errors, 3 warnings: 2 pre-existing (`useAuth.tsx:58,64`) + 1 new accepted (`AgentGraph.tsx:143`, `react(only-export-components)` from `paintFrame`/`FrameTiming` exported beside the component — dev-only fast-refresh warning, same tolerated category as the pre-existing two, not fixed to avoid churn) |

**On the API suite and parallelism — do not mistake for a regression.** `npm test` (parallel Jest workers) is flaky on this branch and pre-dates S4: multiple suites hit the live HAPI container at `localhost:8080` concurrently and time out under contention (60–75s suite times on failure vs. ~15s serial), producing 2–9 spurious failures depending on machine load. This was observed at session start on unmodified S3 code, so it is an **environment/test-infrastructure issue, not an S4 defect**. `--runInBand` (serial) is the correct way to run this suite locally and is green every time it's been run this session. Recommend adding a `test:api:serial` script or CI config that runs Jest with `--runInBand` (or `maxWorkers: 1`) against the shared HAPI container — out of scope to fix in this verification pass, flagged for the user.

## 2. Definition-of-done check (S4 acceptance, `issues.md`) + evidence-strength labels

Per `CLAUDE.md` "Evidence boundaries," each criterion below is mapped to its proving artifact with an explicit evidence-strength label. All four acceptance bullets in `issues.md` were **stale (`[ ]`) despite being fully implemented** — same pattern `verification-s3.md` found for S3; corrected to `[x]` in this pass (`implementation-plan.md` Iteration 4's Phase A/B/C checkboxes were stale the same way and are also now `[x]`).

1. **Canvas graph animates through the state machine in sync with the streaming analysis; no chart library used.**
   - `apps/web/src/lib/analysisGraph.ts` (`analysisGraphReducer`/`useAnalysisGraph`) derives `IDLE→INIT→DISPATCH→ANALYZING→SYNTHESIZING→COMPLETE` purely from the existing `finding`/`complete`/`task`/`done` SSE vocabulary (no new backend events) — unit-tested in `analysisGraph.test.ts` against the documented event-sequence fixture, including the regression test for the whole-slice-review fix (`fully resets on start after a completed run, so a second run animates instead of staying frozen`).
   - `apps/web/src/lib/agentGraphGeometry.ts` (pure math + `paintFrame`) + `apps/web/src/components/AgentGraph.tsx` (presentational, `requestAnimationFrame`, teardown on unmount, static render under `prefers-reduced-motion`) — no charting dependency added to `package.json` (grep-verified: no new deps in this diff).
   - **Evidence strength: source-level + local mock (unit).** Visual in-sync animation itself is confirmed at packaged-UI/local-mock strength via E2E (below); the state-machine *logic* driving it is proven at the unit layer.

2. **Per-agent color identity is consistent from graph node → feed box → task card citation.**
   - Directly verified in this pass by grep: `agentGraphGeometry.ts` maps `risk→COL.red`, `careGap→COL.violet`, `sdoh→COL.emerald`, `actionPlanner→COL.amber`; `PatientDetail.tsx`'s `FEED_ACCENT` maps the same four agent ids to the same four accent names (`red`/`violet`/`emerald`/`amber`), and task-card citation chips inherit their feed box's accent (same component, same prop) — one color source per agent, not three independently-chosen palettes.
   - **Evidence strength: source-level.** No dedicated automated assertion cross-checks the three sites' hex values against each other; the invariant holds by construction (single `COL`/`FEED_ACCENT` mapping, not duplicated literals) and was manually confirmed in this pass.

3. **A cached analysis replays deterministically without a live model call; the explicit live trigger forces a fresh run and updates the cache.**
   - Backend guarantee proven at the **API-boundary Supertest layer**, `apps/api/src/routes/analysis.test.ts`, describe block "analysis routes — cache-aware live/replay (S4 A2)":
     - test (a): seeded cache row replays with a stub agent asserted **not called**, same phased `agentId` order as a live run.
     - test (b): `?live=1` **always** invokes the orchestrator and overwrites the existing cache row.
     - test (c): cold cache (no row) falls back to exactly one live run and populates the row.
     - test (g): a cache-write failure doesn't sink an otherwise-successful run — `done` still fires (best-effort write, `cfb79ae`).
   - **Evidence strength: API-boundary Supertest (source-level integration, no live model).** Not proven against a real OpenAI call in this pass — no `OPENAI_API_KEY` in this environment; this was true for S2/S3 too and is a standing, documented environment limitation, not new to S4.

4. **Cached and live runs produce the same UI treatment (cache is real prior output, not a script).**
   - Byte-identical SSE shape (`token`/`finding`/`complete`×4-per-agent/`task`/`done`) is the load-bearing invariant; test (f) in `analysis.test.ts` proves live narration is captured into the cache and replayed as byte-identical `token` events (the whole-slice-review fix, `cfb79ae`, closing the "cached replay shows blank prose" gap).
   - `apps/web/e2e/agent-graph-cache.spec.ts`: "Default 'Run Analysis' requests WITHOUT `?live=1`... (cached)" and "'Run live' requests WITH `?live=1`... (live)" both assert on the captured `route.request().url()` and both render the identical graph→feeds→tasks treatment, differing only in the `analysis-mode` label text (`requested: cached` vs `requested: live`).
   - Security-sensitive corollary independently verified in this pass: the cache-replay path enforces the same `'clinical'` scope guard as the live path (`analysis.ts:176`, `fhirService.assertScope(...)` called directly on replay, not a hand-rolled copy) and audits denials — test (d) confirms a Social Worker is denied on the replay path too. Replay is not an unauthenticated/unscoped read.
   - **Evidence strength: packaged UI / local-mock for the E2E (SSE intercepted, no live model call in this env) + API-boundary Supertest for the backend byte-identity guarantee.** Do not read the E2E pass as proof of live-model acceptance — it isn't, and doesn't claim to be.

No drift found between what `tasks/todo.md` claims done and what the code/tests actually do, beyond the stale checkboxes fixed above.

## 3. Spec-drift check (issues.md / implementation-plan.md / plan.md vs. code)

- **`issues.md` S4 acceptance checkboxes were stale** (`[ ]` despite full implementation) — fixed to `[x]` in this pass (see §2), same pattern as S3's verification found and fixed.
- **`implementation-plan.md` Iteration 4 Phase A/B/C task checkboxes were stale** (`- [ ] **A1...**` through `- [ ] **C2...**`) — all six now `[x]`, matching `tasks/todo.md`'s already-accurate per-task record.
- **SSE vocabulary correction already recorded, verified still accurate:** `implementation-plan.md`'s "Event→state contract" section and `tasks/todo.md`'s B1 clarification both correctly state there is no single unified `complete` — 4 per-agent `complete`s + a separate terminal `done`. Confirmed against the actual fixture in `apps/web/src/lib/analysisGraph.test.ts` and the live route code in `analysis.ts` — no drift.
- **Accepted deviations** (from `tasks/todo.md`, re-confirmed as still accurate, not re-flagged as bugs): canvas not full-bleed (page layout, not a fixed viewport); checkmark text drops the Task count (unavailable to the presentational `AgentGraph` component); mode label states *requested intent* not *asserted outcome* (a cold-cache default press is a live run backend-side — honest-staging, not a bug); `modelVersion` is written to the cache row but not yet read (no cache-invalidation-on-model-change feature exists yet — correctly scoped out of S4); careGap/sdoh finding shapes are hand-written in three places (agent output type / `AnalysisResultJson` / frontend `AnalysisFinding`) — a real drift seam to watch on the next agent-output change, agreed as acceptable today, not S4's to fix.
- **Iteration 5+ (S5–S9) content already drafted in `implementation-plan.md`**: present, per S2's and S3's verification carrying this flag forward. Not touched by this pass — still out of scope for S4.
- **`tasks/todo.md` S4 section is accurate and complete** — unlike S3 (which had no `todo.md` entry at all), S4's checklist matches the code precisely; no fix needed here.

## 4. Backend review pass (ahead of the formal `code-review` skill)

This session re-confirmed, rather than re-discovered, the two defects the whole-slice integration review already found and fixed earlier in this branch's history (commits `d308c87`, `cfb79ae` — see §2 above for the proving tests). No new defects surfaced in this pass's review of the cache route (`analysis.ts`), the cache module (`apps/api/src/db/analysisCache.ts` — read/write, JSON round-trip, idempotent migrate), or the client state machine (`analysisGraph.ts`).

One pre-existing minor nit carried forward from A1's own task review (`tasks/todo.md`): duplicate `AnalysisCacheEntry`/`AnalysisCacheRow` types and no error guard around `readAnalysisCache`'s `JSON.parse`. Neither has caused a real failure (a malformed row is caught by A2's `replayCachedAnalysis` try/catch and surfaces as an `error` SSE event per test (e), not a crash) — left for the formal `code-review` skill to weigh in on Standards-axis priority, consistent with how S2's and S3's verification passes deferred code-quality nits to that stage rather than fixing them here.

The full S4 backend/frontend diff (agents unchanged; cache schema, cache-aware route, state machine, canvas component, live/cache trigger) has already been through per-task spec + code-quality review during implementation (`tasks/todo.md` records every commit's review outcome) — this section's job is confirming that record against fresh evidence, not re-litigating it; the formal `code-review` skill (Standards + Spec axes, full branch diff since `main`) is the next gate.

## 5. Domain-term documentation check

No new domain terms were introduced beyond what `implementation-plan.md` Iteration 4 already documents inline via "Domain rule:"/ponytail annotations: `analysis_cache` (schema, replay semantics), `?live=1` (query-flag convention, not a second endpoint), the state-machine vocabulary (`IDLE→INIT→DISPATCH→ANALYZING→SYNTHESIZING→COMPLETE`), and the corrected SSE event contract (4 per-agent `complete`s + terminal `done`, no unified `complete`). `docs/agents/domain.md` still doesn't exist — same pre-existing, deferred gap S2's and S3's verification both noted and left out of scope; unchanged by S4.

## 6. Gate outcome

**PASS.** All fresh command evidence is green (§1): API 90/90 (serial — see the parallel-flakiness caveat, a pre-existing env issue not an S4 regression), web 69/69, E2E 7/7, both builds clean, lint clean except pre-existing/accepted warnings. Definition-of-done (§2) is fully mapped to proving artifacts with evidence-strength labels; no overclaiming of live-model or target-environment acceptance beyond what the evidence actually supports. Spec-drift (§3) found only stale-checkbox bookkeeping (now fixed) plus previously-accepted, still-valid deviations. Backend review (§4) found no new defects — the two real integration defects this branch produced (graph-freeze-on-2nd-run, narration-parity gap) were already found and fixed earlier in the branch's own history by a whole-slice review, and this pass independently re-confirmed both fixes hold via the tests that prove them.

## 7. Post-review update — 2026-07-05

`code-review` (see `review.md`) ran next and found one real defect this pass's §4 backend review missed: successful cache-replay reads were never audited (only denials were) — `analysis.ts`'s replay path called `assertScope` but no code wrote a success row, unlike every other read method in `client.ts`. **User decision: fix before commit**, same as S2's precedent. Fixed test-first (failing assertion added to test (a), confirmed red, then `writeAudit` added to the replay path mirroring `getPatientBundle`'s pattern) — see `review.md` "Post-review fix" for full detail. Re-verified fresh after: API **90/90** (unchanged count, now with the audit assertion passing), web **69/69** unchanged, E2E **7/7** unchanged, both builds/lints clean with the same pre-existing/accepted warning counts as §1. No other files touched beyond the fix + its test + the two review docs.

**Still accurate:** everything else in §1–§6 above (evidence, DoD mapping, spec-drift, domain-term check) is unaffected by this fix — it's an additive audit-log write on an already-passing path, not a behavior change to any of the four S4 acceptance criteria.

## Next step

`finishing-a-development-branch`, once `code-review`'s findings are also marked resolved in `review.md` (they are).
