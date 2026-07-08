# Active Plan — CareSync AI

**Feature:** `caresync-ai` · **Current slice:** S15 — Held-out evaluation set + clinician outreach log
**Full plan:** `docs/plans/caresync-ai/implementation-plan-s15.md`
**Spec:** `docs/plans/caresync-ai/prd-s15.md` · **Grill:** `docs/plans/caresync-ai/grill-evaluation-gaps.md` · **Trigger:** `reports/HL7-Challenge-Evaluation.2026-07-08.md` §E (biggest-risk decomposition)
**S16 (separate slice, out of scope here):** Risk agent v2 rubric + LLM-variance investigation — owns `design-risk-calibration-v2.md`.

---

## S15 — Held-Out Evaluation Set + Clinician Outreach Log

> **Approved:** pending user review (implementation plan + PRD + grill written; awaiting go-ahead). Implementing via `subagent-driven-development` (TDD where applicable) on a fresh `feature/s15-evaluation-gaps` branch.

### Commit 1 — `feat(S15): procedural held-out set (pop-0011..pop-0020) + labels._meta.heldOutRows`
**Acceptance:** 10 new procedural patients generated; `_meta.heldOutRows` populated; 10 label rows added; `npm run import` succeeds; 5-row verification matrix row 1 passes.

- [ ] **A1.** Read `apps/api/src/fhir-data/population.ts`; locate `generatePopulation()` + count literal. Verify: `grep -n "length: 10\|generatePopulation" apps/api/src/fhir-data/population.ts`.
- [ ] **A2.** Bump `generatePopulation()` count from 10 to 20. Verify: `cd apps/api && npx tsc --noEmit` clean.
- [ ] **A3.** Verify SDOH distribution in the new 10 matches the existing 10 (3 positive / 2 explicit-negative / 5 absence). Add explicit SDOH seeding if the generator's distribution is off.
- [ ] **B1.** Add `_meta.heldOutRows: ["pop-0011".."pop-0020"]` to `data/eval/labels.json`. Verify: `jq '._meta.heldOutRows' data/eval/labels.json`.
- [ ] **B2.** Add 10 label rows for `pop-0011`..`pop-0020` (each with `source: "dev"`, `clinicianOverride: null`, labels derived by hand from `_meta.labelingRules` for now — commit 2 factors the function). Verify: `jq '.patients | length' data/eval/labels.json` returns 26.
- [ ] **B3.** Update `_meta.clinicianStatus` per prd-s15.md D6.
- [ ] **C1.** `npm run import` from `apps/api`. Verify: "Import complete" with non-zero count.
- [ ] **C2.** Spot-check via curl: `curl -s http://localhost:8080/fhir/Patient/pop-0011 | jq '.id'` (adjust id scheme if needed).
- [ ] **C3.** Commit message: `feat(S15): procedural held-out set (pop-0011..pop-0020) + labels._meta.heldOutRows` (full message in implementation-plan-s15.md).

### Commit 2 — `feat(S15): eval/labelFromBundle.ts — factored labeling function`
**Acceptance:** pure function module + 5 tests green + LOINC map extracted.

- [ ] **A1.** Create `apps/api/src/eval/labelFromBundle.test.ts` RED — 5 tests (careGap T/F/null, risk T/F via riskScoreFor ≥ 75, sdoh positive/negative/absent, determinism, null-handling). Verify: `cd apps/api && npx jest src/eval/labelFromBundle.test.ts` → all FAIL.
- [ ] **A2.** Create `apps/api/src/eval/labelFromBundle.ts` GREEN — `labelFromBundle(bundle, dim): boolean | null`; pure, no I/O, no LLM; delegates risk to `riskScoreFor()` from `fhir-data/population.ts:127-134`. Verify: tests PASS.
- [ ] **A3.** Extract LOINC-convention map as named constant at top of file (single source of truth, matches `_meta.labelingRules.careGap`).
- [ ] **A4.** Commit message: `feat(S15): eval/labelFromBundle.ts — factored labeling function`.

### Commit 3 — `feat(S15): eval-report three-section layout + Held-out evaluation section`
**Acceptance:** Status line three-count; dev-labeled + held-out + Outreach sections render; 3 CLI flags work; round-trip test green.

- [ ] **A1.** Read `scripts/eval.ts` — locate patient loop, `renderMarkdown`, `buildJsonSummary`.
- [ ] **A2.** Refactor `scripts/eval.ts` to split patient list by `_meta.heldOutRows`. Use `labelFromBundle` for held-out; existing `labels.json` rows for dev-labeled. Ponytail: factor `computePerAgentMetrics(patientRows, labelSource)` helper.
- [ ] **B1.** Modify `renderMarkdown` to produce 9 sections (Status, Methodology +1 sentence, Dev-labeled baseline, Held-out evaluation, Outreach placeholder, Error analysis dev-labeled, Error analysis held-out, Data-availability combined).
- [ ] **B2.** Modify `buildJsonSummary` to mirror 3-section layout (`devLabeled`, `heldOut`, `outreach` keys).
- [ ] **C1.** Add `--dev-only`, `--held-out-only`, `--no-live` CLI flag handlers to `eval.ts:main()`. Extend existing parser if one exists.
- [ ] **C2.** Verify all 3 flag compositions run without crashing.
- [ ] **D1.** Add `scripts/eval.test.ts` round-trip test — 3 tests (dev-only report, held-out-only report, full report). Verify: `cd apps/api && npx jest src/scripts/eval.test.ts` PASSES.
- [ ] **D2.** Commit message: `feat(S15): eval-report three-section layout + Held-out evaluation section`.

### Commit 4 — `feat(S15): clinician-outreach.json + Outreach table in eval-report`
**Acceptance:** schema validator + 5 tests green + `outreach:validate` script + initial JSON file + Outreach table renders.

- [ ] **A1.** Create `apps/api/src/eval/outreachSchema.test.ts` RED — 4 tests (valid, missing-field, wrong-enum, empty-invitations). Verify: `cd apps/api && npx jest src/eval/outreachSchema.test.ts` → all FAIL.
- [ ] **A2.** Create `apps/api/src/eval/outreachSchema.ts` GREEN — `validateOutreach(json): { ok: true } | { ok: false; errors: string[] }`; pure; hand-rolled validation (no schema library); path-qualified errors. Verify: tests PASS.
- [ ] **A3.** Add 5th test for missing `_meta`.
- [ ] **B1.** Create `apps/api/src/scripts/outreach-validate.ts` (mirrors `apply-clinician-review.ts` conventions: `__dirname`-resolved path, `main()` guarded). Prints "OK" + summary on valid; lists errors + exit 1 on invalid; prints "Outreach log not yet started." on missing file (exit 0).
- [ ] **B2.** Add `"outreach:validate": "tsx src/scripts/outreach-validate.ts"` to `apps/api/package.json` scripts.
- [ ] **B3.** Create initial `data/eval/clinician-outreach.json` with `_meta` + `invitations: []`. Verify: `npm run outreach:validate` prints "OK" + "0 invitations."
- [ ] **C1.** Extend `eval.ts:renderMarkdown` Outreach section to read the JSON file + render table (empty table on empty `invitations`; error list inline on malformed JSON).
- [ ] **C2.** Extend `eval.ts:buildJsonSummary` to include `outreach` key.
- [ ] **D1.** Commit message: `feat(S15): clinician-outreach.json + Outreach table in eval-report`.

### Phase E — Verification (post-merge)
**Acceptance:** all 5 verification matrix rows pass; `verification-s15.md` + `review-s15.md` written.

- [ ] **E1.** `npm run eval --no-live` — confirm Status line is three-count; both sections render; Outreach section reflects JSON contents.
- [ ] **E2.** CLI flag tests: `--dev-only`, `--held-out-only`, `--no-live` all work.
- [ ] **E3.** `npm run outreach:validate` → "OK" + "0 invitations" on initial file.
- [ ] **E4.** Live re-run (best-effort, separate from pass condition) when OpenAI quota allows — report live held-out numbers in changelog.
- [ ] **E5.** Write `docs/plans/caresync-ai/verification-s15.md` per `verification-s14.md` template (6 sections: outcome, command evidence, TDD evidence, live re-eval, DoD check, open follow-ups).
- [ ] **E6.** Write `docs/plans/caresync-ai/review-s15.md` per `review-s14.md` two-axis pattern (correctness + design).

### Definition of done (S15)
- [ ] **D1.** `population.ts` returns 20 patients; `_meta.heldOutRows` populated; 10 label rows added.
- [ ] **D2.** `npm run import` succeeds; 10 new bundles in HAPI.
- [ ] **D3.** `labelFromBundle.ts` exists + 5 tests pass.
- [ ] **D4.** `npm run eval --no-live` produces 3-section report with three-count Status line.
- [ ] **D5.** 3 CLI flags work; round-trip test green.
- [ ] **D6.** `outreachSchema.ts` + 5 tests green; `outreach-validate.ts` script; `npm run outreach:validate` works.
- [ ] **D7.** Outreach section in eval-report reflects JSON file (empty table or populated table).
- [ ] **D8.** `verification-s15.md` + `review-s15.md` written; 5 verification matrix rows pass.
- [ ] **D9.** Branch `feature/s15-evaluation-gaps` opens PR against `main`; cites `prd-s15.md` + grill; merge per CLAUDE.md "Repo etiquette".

### Rollback (S15) — see `implementation-plan-s15.md` §Rollback
| Commit | What reverts |
|---|---|
| 1 | Removes 10 label rows + `_meta.heldOutRows`; `generatePopulation()` back to 10. Dev-labeled 16 unchanged. |
| 2 | Removes `labelFromBundle.ts` + tests. **Cleanest: revert 2 + 3 together** (eval.ts still references the function). |
| 3 | Reverts `eval.ts` to pre-S15 single-section shape. `npm run eval --no-live` reproduces pre-S15 report. |
| 4 | Removes outreach JSON + schema + script + npm script. Outreach section reverts to placeholder. |
| Whole PR | Reproduces pre-S15 state on all 4 fronts. |

### Open follow-ups (deferred to S16 or later)
- Risk agent v2 rubric + LLM-variance investigation → **S16** (separate slice).
- Clinician engagement itself → parallel track, not gated by S15.
- Live re-run of all 26 patients → bonus signal when quota allows, not a pass condition.
- In-app clinician review queue → deferred indefinitely.
- Held-out labels via inter-rater / hand-curation → rejected in grill §3.
- Model-version pin for the LLM API → cross-cutting, lives in S16.
- Multilingual / low-connectivity support → out of scope per HL7 evaluation Open Q #7.

---

## S4 — Agent-graph canvas + analysis cache/replay (GD2, GD10)

> **Approved: yes (2026-07-05)** — plan reviewed against S3 code (`analysis.ts`, `orchestrator.ts`, `PatientDetail.tsx`, `client.ts`). Implementing via `subagent-driven-development` (TDD) on `feature/caresync-s4-agent-graph-cache`.

> **B1 clarification (2026-07-05):** the plan text says the state machine's COMPLETE fires on "the final `complete`" — the real S3 SSE vocabulary has **no single unified complete event**: each of the 4 agents emits its own `complete`, and a separate terminal `done` event ends the stream (`client.ts` already handles `done`). Fixture must reflect: `token`* → `finding`* → `complete`(risk) → `complete`(careGap) → `complete`(sdoh) → `finding`*/`token`* (actionPlanner) → `task`* → `complete`(actionPlanner) → `done`. Per-node COMPLETE = that agent's own `complete`; graph-level COMPLETE = `done`.

### Phase A — Analysis cache (backend, test-first)
- [x] A1. `analysis_cache` schema + migrate (patient_id PK, result_json, model_version, created_ts); idempotent migrate at boot; persist post-citation-gate validated result (findings/agent + Task payloads, not ids) — commit `2c5a5e2`. Spec + code-quality review passed (2 minor nits: duplicate `AnalysisCacheEntry`/`AnalysisCacheRow` types, `readAnalysisCache` JSON.parse has no error guard — revisit if A2 surfaces a real need)
- [x] A2. Cache-aware analysis route: default request replays cache as identical SSE shape (zero agent invocations); `?live=1` runs orchestrator + re-caches; cold cache falls back to live + caches — commits `c256fe0`, `2b68194` (spec-review-caught fix: replay bypassed clinical-scope enforcement + audit), `28a6d45` (quality-review follow-up: replay now reuses `FhirReadService.assertScope` instead of a hand-rolled copy, and has an error boundary matching the live path's `error`/no-`done` convention). Full API suite: 88/88.

### Phase B — Agent-graph canvas (frontend)
- [x] B1. Analysis state machine (client): reducer/hook mapping `token`/`finding`/`complete`/`task`/`done` → `IDLE→INIT→DISPATCH→ANALYZING→SYNTHESIZING→COMPLETE` + per-node status, per the B1 clarification above — `apps/web/src/lib/analysisGraph.ts` (`analysisGraphReducer` + `useAnalysisGraph`), commits `80b2b95`, `385fe82` (quality-review follow-up: renamed file/exports to consistent "Graph" vocabulary, de-fragilized label-keyed test snapshots). Not yet wired into `PatientDetail.tsx` — that's B2/B3. Full web suite: 29/29.
- [x] B2. `AgentGraph` Canvas component (W03, `html-mockup-fidelity` vs `reference-materials/caresync-ai.html` `#agentGraph`): 5-node radial layout, bezier edges, particle flow, per-agent color consistent with `FEED_ACCENT`, `requestAnimationFrame`, teardown on unmount, static render on `prefers-reduced-motion` — `apps/web/src/lib/agentGraphGeometry.ts` (pure math + `paintFrame`) + `apps/web/src/components/AgentGraph.tsx` (presentational, takes `AnalysisGraphState` prop), wired into `PatientDetail.tsx` above the feeds grid. Commits `4dc092f`, `3af3b56`, `398dd8f` (quality-review follow-ups: reduced-motion now paints the settled final frame not the elapsed≈0 mid-settle; canvas tests stub `getContext` so they exercise the real `paintFrame`/repaint path — regression tests proven to fail when fixes reverted; resize repaints under reduced-motion). Fidelity self-check ≥85% (exact color/geometry/radii transcription; deviations: canvas not full-bleed — page layout not fixed viewport; checkmark text drops the Task count — unavailable to presentational component). Web suite 61/61, build clean. **Accepted minor:** one new dev-only `react(only-export-components)` fast-refresh lint warning (`AgentGraph.tsx:143`, from `paintFrame`/`FrameTiming` exported beside the component) — same tolerated category as the 2 pre-existing `useAuth.tsx` warnings; not fixed to avoid churn against a cosmetic warning.
- [x] B3. Live vs cached UI parity + trigger ("Run live" → `?live=1`; default Run Analysis serves cache) — `streamAnalysis(id, handlers, { live })` flag in `client.ts` + secondary "Run live" button in `PatientDetail.tsx`; single shared `handleRunAnalysis(live)` / one streaming+render path (no fork → same UI treatment). Commits `a3ce3eb`, `0ba72ce` (review follow-up: mode label states requested intent `requested: cached`/`requested: live` not asserted outcome — honest-staging; `aria-live="polite"`). Both reviews passed (spec ✅, quality ✅ Approved). Web suite 68/68, build clean. **Accepted minor review notes (not fixed):** URL uses `?live=1` string-concat (fine for one param); button classNames duplicated at 2 call sites (no shared Button component in repo); "Run live" has no spinner while running (only primary does); secondary button precedes primary in tab order.

### Phase C — Verification
- [x] C1. API 88/88 + web 68/68 green (full suites run by controller).
- [x] C2. Frontend E2E (`frontend-e2e-verification`): `apps/web/e2e/agent-graph-cache.spec.ts` (3 tests), commit `c6a270b`. Full E2E suite **7/7 green** (3 new + 4 existing, no regressions). Reduced-motion **disabled** via `test.use({ reducedMotion: 'no-preference' })`. Proves: AgentGraph `<canvas>` renders above the feeds grid (idle); default "Run Analysis" issues request WITHOUT `?live=1` (→ "requested: cached"), "Run live" issues WITH `?live=1` (→ "requested: live"); both render identical graph→feeds→tasks (same UI treatment, GD2). Live-URL assertion teeth-verified. **Evidence strength: packaged UI / local-mock** — SSE is intercepted (no `OPENAI_API_KEY` in env), so this proves client trigger-wiring + canvas render + parity, NOT the backend "zero-model-call replay / `?live=1` forces fresh run" guarantees (those are the A2 Supertest layer: stub-orchestrator-not-called on replay, `?live=1` invokes it, cold-cache fallback, scope-denial).

### Final whole-slice review — 2 integration defects found + fixed (2026-07-05)
A holistic review of the full S4 diff (base `e8a9309` → tip) surfaced two integration issues per-task review structurally couldn't catch:
- [x] **Critical — graph frozen on 2nd run.** `analysisGraphReducer`'s `start` only reset from `idle`, so a second run (exactly the "Run Analysis → Run live to compare" flow B3 invites) left the canvas frozen on "complete" while feeds re-animated. Fixed to unconditionally reset every run. Commit `d308c87`. (web 68→69)
- [x] **Important — narration parity gap.** Live streamed per-agent `token` narration but `resultJson` never captured it → cached replay showed blank reasoning prose vs live's streamed narration, breaking C2 "same UI treatment"/GD2 "real prior output". Now stores + replays the SAFE (GD11-redacted) narration as byte-identical token events. Also made the cache write best-effort (a persistence throw no longer sinks an already-successful run into the `error`/no-`done` path). Commit `cfb79ae`. (API 88→90)
- Accepted/noted (no code change): `modelVersion` written but not yet read (no cache-invalidation-on-model-change feature yet); careGap/sdoh finding shapes hand-written in 3 places (agent output / `AnalysisResultJson` / frontend `AnalysisFinding`) — agree today, a drift seam to watch.

### `code-review` fix — 2026-07-05
- [x] **Important — successful cache-replay reads were never audited.** `analysis.ts`'s replay path called `assertScope` (denial-only audit) but no code wrote a success row, unlike every other read method in `client.ts` — every default "Run Analysis" that served cached clinical findings left zero `audit_log` rows, breaking S1's audit invariant. Fixed test-first (failing assertion in test (a), confirmed red, then `writeAudit(...)` added to the replay path mirroring `getPatientBundle`'s guard-then-audit pattern). No commit yet (uncommitted on top of `d5e0796` — see `review.md` "Post-review fix"). API still 90/90 (assertion now passes), web 69/69, E2E 7/7 unchanged.

**S4 status: all phases complete (A1–A2, B1–B3, C1–C2) + whole-slice review fixes + `code-review` audit-gap fix.** Every task passed spec + code-quality review (review-caught fixes folded in: clinical-scope enforcement on cache replay, reduced-motion settled-final-frame + real canvas tests, honest intent-not-outcome mode label, 2nd-run graph reset, live/cache narration parity, best-effort cache write, replay success-audit write). **Final verification: API 90/90 (serial — parallel runs flake on HAPI contention, a pre-existing env issue), web 69/69, E2E 7/7.** `verification-before-completion` and `code-review` both PASS. Ready for `finishing-a-development-branch`.

**Rollback (S4):** cache is one SQLite table, deletable without affecting HAPI; stale/absent cache degrades to a live run, never a fake; canvas is presentational, no data risk.

---

## S2 — Single-agent analysis with citation enforcement (GD11, GD13)

> **Approved: yes (2026-07-04)** — ponytail pass applied. Implementing via `subagent-driven-development` on `feature/caresync-s2-single-agent-analysis`.

> **GD13 revised 2026-07-04:** no Anthropic key available for D3 → agent provider switched to **OpenAI `gpt-5.5`** (Responses API), straight substitution under the same `runRiskAgent`/`AgentEvent` contract. Recorded in `plan.md` GD13 and Iteration 2 of `implementation-plan.md`. User-approved.

### Phase A — Agent foundation & contracts (backend, test-first)
- [x] A1 (revised). Swap `@anthropic-ai/sdk` → `openai`; `OPENAI_API_KEY` (.env.example); `MODEL='gpt-5.5'` (GD13 revised) — no factory module; client built lazily on first use, not at module load (see E3 below)
- [x] A2. Citation validator — **Seam 2**, pure module (TDD): in-bundle citation passes, fabricated dropped/flagged (GD11)
- [x] A3. `FhirReadService.getPatientBundle()` → `{resources, validIds}` via one audited `Patient/$everything`; `validIds` derived from resources (test vs HAPI)

### Phase B — Risk agent service + SSE (backend, test-first)
- [x] B1 (revised). `runRiskAgent(bundle)` (plain fn — no interface until S3): **OpenAI `gpt-5.5`** structured output `{riskScore, riskLevel, flags[{text,fhirResourceId}], readmissionProbability}`; parse tested with a mocked OpenAI client. Same event contract — B2/C1/C2 untouched.
- [x] B2. `POST /api/patients/:id/analysis` SSE route (`runAgent` defaulted param, stubbable): stream findings, **validate every fhirResourceId against the bundle before emit**, audit the read; wired into index.ts
  - *Boundary test (S2 acceptance):* stub agent → 1 in-bundle + 1 fabricated citation → only the valid one returned; all returned citations resolve in the bundle

### Phase C — Frontend: Run Analysis + streaming Risk feed
- [x] C1. `streamAnalysis()` in api/client.ts via `fetch` ReadableStream (auth header), parse SSE events
- [x] C2. PatientDetail: **Run Analysis** button + one Risk feed box (mockup `#runLabel`/`.feed`), streamed text + validated citation chips
  - *Deviations recorded:* other 3 feed boxes idle placeholders (S3); agent-graph canvas omitted (S4)

### Phase D — Verification (Seam 2 + E2E)
- [x] D1. `npm run test:api` (49/49) + `npm run test:web` (14/14) green
- [x] D2. Playwright E2E (`frontend-e2e-verification`): Coordinator → Maria → Run Analysis → feed streams → validated finding + citation renders. `apps/web/e2e/patient-analysis.spec.ts`. Evidence: packaged UI/local-mock for the stream path (route-intercepted), live-local-stack for login/nav.
- [x] D3 (revised). **Live** call vs real OpenAI `gpt-5.5`: real SSE run against Maria — ~70 streamed tokens, 9 findings, all 9 `fhirResourceId`s independently verified against a fresh `$everything` fetch (all valid, `droppedCount:0`); fabrication-drop then proven by running the *real* `validateCitations` against those 9 live flags + 1 synthetic fabricated one → 9 valid / 1 dropped. Full detail in `implementation-plan.md` Iteration 2, D3.

### Post-review fixes (2026-07-04) — `verification-before-completion` + `code-review`
- [x] E1. SSE route had no error handling around the agent loop (client hang + possible process crash on agent failure) — try/catch + `error` SSE event.
- [x] E2. Narration `token` stream bypassed GD11 citation validation — `redactUnvalidatedCitations` + `createNarrationBuffer` (Seam 2, `citationValidator.ts`), wired into `analysis.ts`.
- [x] E3. `new OpenAI()` at module import time crashed the whole API at boot with no key — made lazy; `jest.setup.ts` placeholder-key workaround deleted (no longer needed).
- [x] E4. Duplicated `PatientBundle`/`AgentFlag` types (Standards) — each now exported once and imported, not redeclared.
- Full detail + evidence: `implementation-plan.md` Iteration 2 "Post-review fixes", `docs/plans/caresync-ai/verification.md` §7, `docs/plans/caresync-ai/review.md` "Post-review update". `npm run test:api`: 61/61 (was 49/49).

**S2 status: all phases complete (A–D), post-review fixes E1–E4 complete.** `verification-before-completion` and `code-review` both passed. Ready for `finishing-a-development-branch`.

**Rollback (S2):** additive, no DB migration; unset `OPENAI_API_KEY` disables analysis (explicit error, not a fake result — true as of E3; wasn't before it). Full reset as S1.

---

## Approved: yes (2026-07-04)

## S1 — Walking Skeleton (stories 17, 33, 34, 36) — ✅ complete

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
