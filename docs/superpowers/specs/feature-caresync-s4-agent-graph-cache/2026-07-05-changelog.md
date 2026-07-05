# Changelog: S4 — Agent-graph canvas + analysis cache/replay

**Type:** Feature

**Branch:** `feature/caresync-s4-agent-graph-cache` (branched off `feature/caresync-s3-four-agent-orchestration`)

**Date:** 2026-07-05

## Summary

Adds the signature W03 visual and the demo-reliability mechanism (GD2/GD10): a native Canvas agent graph animates the S3 four-agent orchestration through an `IDLE→INIT→DISPATCH→ANALYZING→SYNTHESIZING→COMPLETE` state machine, and a per-patient analysis cache lets the default "Run Analysis" replay the last successful run deterministically with zero model calls, while an explicit "Run live" trigger forces a fresh orchestrator run and re-caches. Cached and live runs emit byte-identical SSE, so the client has one render path for both.

## Changes Made

### Backend — Analysis cache

- **Before:** Every analysis request ran the full orchestrator live; no persistence existed between requests.
- **After:** A SQLite `analysis_cache` table (`patient_id` PK, `result_json`, `model_version`, `created_ts`) holds the last successful, citation-gate-validated result per patient — including Task **payloads**, not just ids, so replay is self-contained even after S3's replace-on-rerun deletes the original Tasks. `POST /:id/analysis` (no `?live=1`) replays a cache row as the identical `token`/`finding`/`complete`/`task`/`done` SSE sequence in the same phased `agentId` order a live run produces, with zero orchestrator invocations; `?live=1` always runs the orchestrator and overwrites the row; a cold cache (no row) falls through to the same live path. The cache write is best-effort — a persistence failure doesn't sink an otherwise-successful run.
- **Files changed:** `apps/api/src/db/analysisCache.ts` (new), `apps/api/src/routes/analysis.ts`.

### Backend — Security: scope enforcement + audit on the replay path

- **Before:** N/A — no replay path existed.
- **After:** Cache replay enforces the same `'clinical'` FHIR scope as a live read, via `FhirReadService.assertScope` (reusing the existing private `guard()`, not a hand-rolled copy) — a Social Worker is denied on replay exactly as on a live run, and the denial is audited. A successful replay is also now audited as a `read`/`success` row (fixed post-`code-review`; see below) — replay was never meant to be, and is not, an unaudited read.
- **Files changed:** `apps/api/src/fhir/client.ts` (`assertScope`), `apps/api/src/routes/analysis.ts`.

### Frontend — Analysis state machine + AgentGraph canvas

- **Before:** No visual representation of the orchestration; the four feed boxes were the only indication an analysis was running.
- **After:** `analysisGraph.ts` (`analysisGraphReducer`/`useAnalysisGraph`) derives graph + per-node state purely from the existing S3 SSE vocabulary (`finding`/`complete`/`task`/`done`, no new backend events needed) — `INIT→DISPATCH` on stream open, per-node `ANALYZING` on that agent's first tagged event, `SYNTHESIZING` on the first Action Planner event, `COMPLETE` on the terminal `done`. `AgentGraph.tsx` (+ pure-math `agentGraphGeometry.ts`) renders a 5-node radial layout (Orchestrator + 4 agents) with bezier edges and particle flow via raw Canvas 2D/`requestAnimationFrame` — no chart library (GD10) — with per-agent color identity matching the feed boxes' `FEED_ACCENT` exactly, and a static final-state render under `prefers-reduced-motion`.
- **Files changed:** `apps/web/src/lib/analysisGraph.ts` (new), `apps/web/src/lib/agentGraphGeometry.ts` (new), `apps/web/src/components/AgentGraph.tsx` (new), `apps/web/src/pages/PatientDetail.tsx`.

### Frontend — Live vs. cached trigger + UI parity

- **Before:** One "Run Analysis" button, always live.
- **After:** Default "Run Analysis" serves the cache (or falls back to live on a cold cache); a secondary "Run live" button forces `?live=1`. Both drive the identical graph→feeds→tasks render through one shared `handleRunAnalysis(live)` path — no UI fork between cache and live. A mode label states the *requested* intent (`requested: cached` / `requested: live`), not an asserted outcome, since a cold-cache default press is a live run backend-side; `aria-live="polite"` announces it.
- **Files changed:** `apps/web/src/api/client.ts` (`streamAnalysis(..., { live })`), `apps/web/src/pages/PatientDetail.tsx`.

### Whole-slice review fixes (before this session)

A holistic review of the full diff (not caught by any single task's own tests) found and fixed two integration defects:
- **Graph frozen on 2nd run** — the reducer's `start` action only reset from `idle`, so a second run (the "Run Analysis → Run live to compare" flow the UI itself invites) left the canvas frozen on "complete" while the feeds re-animated. Fixed to reset unconditionally on every `start`.
- **Narration parity gap** — live streamed per-agent `token` narration, but `resultJson` never captured it, so cached replay showed blank reasoning prose against live's streamed text. Fixed: the SAFE (GD11-redacted) narration is now stored and replayed as byte-identical `token` events.

### This session's closeout — verification, code-review, and one real fix

- **`verification-before-completion`** — re-ran all evidence fresh (API 90/90 serial, web 69/69, E2E 7/7, both builds/lints clean), mapped every S4 acceptance criterion to its proving artifact with evidence-strength labels, and fixed stale `[ ]` checkboxes in `issues.md`/`implementation-plan.md` that didn't reflect the real (complete) state — the same drift pattern S3's verification had already caught once.
- **`code-review` (Standards + Spec axes)** — Standards axis found only minor, already-mostly-tracked judgement-call smells, no hard violations. Spec axis found one real defect: **successful cache-replay reads were never audited** — `assertScope` only writes an audit row on denial, and unlike every other clinical read in `FhirReadService`, nothing on the replay path wrote a success row. A default "Run Analysis" against a cached patient served full clinical findings with zero `audit_log` trail, breaking S1's audit invariant.
- **Fix (this session)** — added a failing regression assertion first (confirmed red), then added the missing `writeAudit(...)` call on the replay path, mirroring `getPatientBundle`'s existing guard-then-audit pattern exactly. Re-verified: API still 90/90 (assertion now passing), web 69/69, E2E 7/7, no regressions.

## Files Modified

| File | Change Description |
|------|---------------------|
| `apps/api/src/db/analysisCache.ts` | New — cache schema, `readAnalysisCache`/`writeAnalysisCache` |
| `apps/api/src/routes/analysis.ts` | Cache-aware route: replay/live/cold-cache branches, scope + audit enforcement on replay, narration capture |
| `apps/api/src/routes/analysis.test.ts` | New describe block for cache-aware replay/live (tests a–g); regression assertion added for the success-audit fix |
| `apps/api/src/fhir/client.ts` | `assertScope` public alias reusing the existing `guard()` |
| `apps/web/src/lib/analysisGraph.ts` | New — state-machine reducer/hook derived from existing SSE events |
| `apps/web/src/lib/analysisGraph.test.ts` | New — documented event-sequence fixture, per-node transitions, 2nd-run reset regression |
| `apps/web/src/lib/agentGraphGeometry.ts` | New — pure geometry/paint math for the canvas, no library |
| `apps/web/src/components/AgentGraph.tsx` | New — Canvas 2D component, `requestAnimationFrame`, reduced-motion static render |
| `apps/web/src/pages/PatientDetail.tsx` | AgentGraph wired above the feeds grid; "Run live" trigger + shared render path |
| `apps/web/e2e/agent-graph-cache.spec.ts` | New — idle canvas render, cached-request parity, live-request parity |
| `docs/plans/caresync-ai/{implementation-plan,issues,verification,review}.md` | AC/task checkboxes corrected, S4 verification + review gates recorded, post-review audit fix documented |

## Commits

| Commit | Description |
|--------|-------------|
| `2c5a5e2` | feat(S4): add analysis_cache schema + read/write module |
| `c256fe0` | feat(S4): cache-aware analysis route with live/replay modes |
| `2b68194` | fix(S4): enforce clinical scope on cache-replay path |
| `28a6d45` | refactor(S4): reuse FhirReadService scope guard + error-bound replay path |
| `80b2b95` | feat(S4): add analysis state machine reducer/hook |
| `385fe82` | refactor(S4): rename analysisStateMachine to analysisGraph, de-fragilize test indices |
| `4dc092f` | feat(S4): add AgentGraph canvas component, wire into PatientDetail |
| `3af3b56` | fix(S4): repaint AgentGraph's static frame on state change under reduced-motion |
| `398dd8f` | fix(S4): reduced-motion renders settled final frame; make canvas tests exercise real draw path |
| `a3ce3eb` | feat(S4): add Run live trigger + cache/live UI parity |
| `0ba72ce` | refactor(S4): mode label states requested intent, not asserted outcome; add aria-live |
| `c6a270b` | test(S4): E2E for agent-graph canvas + cache/live trigger parity |
| `58c14c4` | docs(S4): track slice progress — all phases A1–C2 complete |
| `d308c87` | fix(S4): reset analysis graph state on every run, not just from idle |
| `cfb79ae` | fix(S4): replay cached narration for full live/cache parity; best-effort cache write |
| `d5e0796` | docs(S4): record whole-slice review fixes (graph reset, narration parity) |
| `70bd18d` | fix(S4): audit successful cache-replay reads, not just denials |
| `d88d726` | docs(S4): verification-before-completion + code-review artifacts |

## Testing & Verification

**How to verify this works:**
- `cd apps/api && npx jest --runInBand` (serial — parallel workers flake on shared-HAPI contention, a pre-existing environment issue, not an S4 regression)
- `cd apps/web && npm test`
- `cd apps/web && npx playwright test` (needs Docker HAPI up + API:4000/Vite:5173 via `playwright.config.ts`)
- `npm run build`/`npm run lint` for both `apps/api` and `apps/web`

**Test results (this session, 2026-07-05, fresh):** API 90/90, web 69/69, E2E 7/7, both builds exit 0, both lints 0 errors (pre-existing/accepted warn-level only). Full detail and evidence-strength labeling in `docs/plans/caresync-ai/verification.md`; Standards/Spec findings and the post-review fix in `docs/plans/caresync-ai/review.md`.

## Notes

- **No `OPENAI_API_KEY` in this environment** — cache-replay is proven live-model-free by construction (stub-orchestrator-not-called assertions at the Supertest layer); the `?live=1` path itself was not exercised against a real OpenAI call in this session (E2E intercepts SSE). This mirrors S2/S3's standing, documented environment limitation.
- **Accepted deviations (not defects):** canvas isn't full-bleed (page layout, not a fixed viewport); the graph's checkmark text drops the Task count (unavailable to the presentational component); `modelVersion` is written to the cache row but not yet read (no cache-invalidation-on-model-change feature exists); careGap/sdoh finding shapes are hand-written in three places (agent output type / `AnalysisResultJson` / frontend `AnalysisFinding`) — a drift seam to watch on the next agent-output change, accepted today.
- **Standards debt, not blocking (carried from `review.md`):** `replayCachedAnalysis`'s per-agent emit triplet is duplicated four times; `AnalysisCacheEntry`/`AnalysisCacheRow` are duplicate interfaces; `assertScope` reads as a thin Middle Man over `guard()`; `createAnalysisRouter`'s required `db` parameter sits after a defaulted one. None block this branch; worth a look before S5+ adds more cache/route surface.
