# Changelog: S3 — Four-agent orchestration + FHIR Task creation

**Type:** Feature

**Branch:** `feature/caresync-s3-four-agent-orchestration` (branched off `feature/caresync-s2-single-agent-analysis`)

**Date:** 2026-07-05

## Summary

Extended the single Risk agent (S2) to the full four-agent care team. An Orchestrator dispatches Risk, Care Gap, and SDOH agents in parallel over Maria Chen's FHIR bundle, then feeds their structured outputs to an Action Planner that synthesizes prioritized FHIR Task resources — each citing the exact resources behind it, written to HAPI, with all four agents' structured output and narration passing through the same GD11 citation-enforcement gate as S2's Risk agent.

## Changes Made

### Backend — Shared Agent contract + three new agents

- **Before:** Only `runRiskAgent` existed, with no extracted interface (deferred from S2 on purpose until a second real agent existed).
- **After:** `agent.ts` defines the shared `AgentEvent`/`AgentId` contract; `riskAgent.ts` refactored onto it with no behavior change. Three new agents implement it: `careGapAgent.ts` (reads Condition/Encounter/Observation), `sdohAgent.ts` (reads the AHC-HRSN screening `Observation` + demographics), `actionPlannerAgent.ts` (consumes the other three agents' already-parsed structured outputs — no second bundle read).
- **Files changed:** `apps/api/src/agents/agent.ts` (new), `apps/api/src/agents/careGapAgent.ts` (new), `apps/api/src/agents/sdohAgent.ts` (new), `apps/api/src/agents/actionPlannerAgent.ts` (new), `apps/api/src/agents/riskAgent.ts` (refactored onto the shared contract), `apps/api/src/agents/citationValidator.ts` (generalized `validateCitations`/added `validateCitationList` for the Action Planner's multi-resource citations).

### Backend — Orchestrator + FHIR Task write

- **Before:** No orchestration existed; Tasks were never written by an agent.
- **After:** `orchestrate(bundle)` runs Risk/Care Gap/SDOH concurrently (merged async iteration, each event tagged with its `agentId`), collects their structured results, then runs the Action Planner over them. `FhirReadService` gained `createTask`/`replacePatientTasks` — tag-scoped (`CARESYNC_TASK_TAG`) delete-then-create so a re-run cleanly replaces only CareSync-authored Tasks, never seed/Synthea Tasks, with every write audited.
- **Files changed:** `apps/api/src/agents/orchestrator.ts` (new), `apps/api/src/fhir/client.ts` (`createTask`, `replacePatientTasks`).

### Backend — Analysis route wired to full orchestration

- **Before:** The route's `runAnalysis` defaulted to the single `runRiskAgent`.
- **After:** Defaults to `orchestrate`; every agent's citations (structured findings and Task `fhirResources`) pass the GD11 validation gate before emit and before Task creation — a Task whose citations all drop is never persisted. Emits `finding`/`token` events tagged with `agentId`, a per-agent `complete`, `task` events for created Tasks, and a terminal `done`.
- **Files changed:** `apps/api/src/routes/analysis.ts`.

### Frontend — Four live feeds + Task cards

- **Before:** Only the Risk feed box was live; the other three were honest idle placeholders, and no created-Task rendering existed.
- **After:** All four feed boxes (`FeedBox`) stream live narration and findings with their per-agent accent color; created Tasks render as cards with citation chips in the existing Tasks section. `streamAnalysis` extended to route `onToken`/`onFinding`/`onComplete` by `agentId` and added `onTask`.
- **Files changed:** `apps/web/src/api/client.ts`, `apps/web/src/pages/PatientDetail.tsx`.

### Post-review fixes (prior session, before this session started)

Two real defects surfaced only when reviewing the *composed* system (not caught by any single task's own tests):
- **Streamed narration misattributed to the wrong feed** — `token` events' `agentId` was parsed off the wire then discarded; a concurrently-narrating agent's pre-completion tokens could land in the wrong feed box. Fixed: `onToken` now carries `(agentId, text)` end-to-end.
- **Three of four feeds never visibly streamed** — `withText` (unlike `withFinding`/`withSummary`) never flipped a feed's `started` flag, so Care Gap/SDOH/Action Planner stayed on the idle placeholder through their entire narration and only "popped" the full text on completion. Fixed: `withText` now also sets `started: true`.

Also, a spec/data-model mismatch was corrected: `issues.md`/`prd.md` originally said SDOH reads a `QuestionnaireResponse` and Care Gap reads `CarePlan`/`Encounter`, but the seed pipeline never creates either resource type — the AHC-HRSN screening is seeded as an `Observation`. Docs corrected to match the real seeded types (not a functional defect — both agents already cited real, in-bundle resource ids of the types that actually exist).

### This session's closeout — D2/D3 evidence, plus one real post-review fix

S3's own plan had two verification phases still outstanding at the start of this session (D1 unit/API coverage was already done):

- **D2 (Playwright E2E) — done.** Extended `apps/web/e2e/patient-analysis.spec.ts` with a test covering all four feeds streaming (route-intercepted SSE with `agentId`-tagged frames) and a Task card rendering with citation chips. While extending it, found and fixed that the *existing* S2 E2E test's mocked SSE frames predated the `agentId` tagging convention — under S3's `agentId`-keyed feed state, those frames no longer routed to any feed box, so the S2 test itself had silently started failing. Fixed by adding `agentId: 'risk'` to its frames. Also added `data-testid={task.key}` to task cards to disambiguate citation-chip assertions from the same ids appearing in the Active Conditions list and feed finding chips.
- **D3 (live-call evidence) — done.** One live orchestrated run against real OpenAI `gpt-5.5` and the live HAPI container: all four agents produced structured output with 0 dropped citations (risk 9 findings/critical/88, careGap 8, sdoh 2, actionPlanner 10 tasks); confirmed the 10 created Tasks landed in HAPI directly via `GET /Task`; proved the fabrication-drop path against the real `validateCitations` function (9 real live citations + 1 synthetic fabricated id → 9 valid / 1 dropped).
- **Post-review fix — SDOH/Care Gap prompt drift (found by this session's `code-review`).** The agent *prompts* still said "QuestionnaireResponse"/"CarePlan" despite the AC #4 data-model correction above having updated the docs but not the code — a live risk that the SDOH agent's housing/food barrier citation could be validator-dropped if the model followed the (wrong) prompt literally. Fixed: `sdohAgent.ts` now says "Observation"; `careGapAgent.ts` no longer mentions "CarePlan". Re-verified with a fresh live run: still 0 dropped citations, SDOH correctly citing the real `Observation/maria-chen-sdoh`.
- A test-isolation quirk was also identified (not fixed, documented): the API integration test suite shares live HAPI state with manually-triggered live runs — running a live D3-style call and then the Jest suite once can show a stale `taskCount` failure that clears on a second run (the suite's own analysis test replaces the stray Tasks as a side effect). See `verification.md` §1 for detail.

## Files Modified

| File | Change Description |
|------|---------------------|
| `apps/api/src/agents/agent.ts` | New — shared `AgentEvent`/`AgentId` contract |
| `apps/api/src/agents/careGapAgent.ts` | New — Care Gap agent; prompt fixed this session (dropped "CarePlan") |
| `apps/api/src/agents/sdohAgent.ts` | New — SDOH agent; prompt fixed this session ("QuestionnaireResponse" → "Observation") |
| `apps/api/src/agents/actionPlannerAgent.ts` | New — Action Planner agent, synthesizes the other three |
| `apps/api/src/agents/riskAgent.ts` | Refactored onto the shared `Agent` contract, no behavior change |
| `apps/api/src/agents/citationValidator.ts` | Generalized `validateCitations` + new `validateCitationList` |
| `apps/api/src/agents/orchestrator.ts` | New — parallel dispatch + merged event stream |
| `apps/api/src/fhir/client.ts` | New `createTask`/`replacePatientTasks`, tag-scoped replace |
| `apps/api/src/routes/analysis.ts` | Wired to `orchestrate`, per-agent validation gate, `task`/`done` events |
| `apps/web/src/api/client.ts` | `agentId`-routed `onToken`/`onFinding`/`onComplete`, new `onTask` |
| `apps/web/src/pages/PatientDetail.tsx` | All four feeds live; Task cards with citations; `data-testid` added this session |
| `apps/web/e2e/patient-analysis.spec.ts` | New S3 four-feed/Task-card E2E test; S2 test's stale frames fixed (this session) |
| `docs/plans/caresync-ai/{implementation-plan,issues,verification,review}.md` | D2/D3 evidence recorded, AC checkboxes corrected, post-review prompt-fix documented |

## Commits

| Commit | Description |
|--------|-------------|
| `be3510c` | docs(S3/S4): pin S3↔S4 event contract, cache Task payloads, fix provider refs |
| `8c1ea89` | feat(S3-A1): extract shared Agent contract + generalize citation validator for id-lists |
| `157582d` | feat(S3): Care Gap agent (`runCareGapAgent`) with cited output |
| `5002e35` | feat(S3): SDOH agent (`runSdohAgent`) with AHC-HRSN citation enforcement |
| `aa38279` | feat(S3): Action Planner agent (A4) synthesizing risk/care-gap/SDOH findings |
| `55770a8` | feat(S3): four-agent orchestrator with concurrent merge (B1) |
| `c52c9a1` | feat(S3-B2): FHIR Task write + tagged replace on re-run (audited) |
| `513d709` | feat(S3-B3): wire analysis route to full four-agent orchestration |
| `f48ca78` | feat(S3): route SSE finding/complete by agentId, add task/done handlers |
| `9d33abf` | feat(S3): light up Care Gap/SDOH/Action Planner feeds and stream created Tasks |
| `e14796d` | fix(S3): attribute streamed tokens to their real agentId, not a stale ref |
| `a7dc468` | fix(web): flip agent feed to live on first token, not just finding/complete |
| `a7bc0e3` | docs(S3): correct AC #4 to match real seed data, mark S3 plan complete |
| *(this session, uncommitted at changelog time)* | D2 E2E closeout + `data-testid`, D3 live-call evidence docs, SDOH/Care Gap prompt fix, `issues.md`/`verification.md`/`review.md` updates |

## Testing & Verification

**How to verify this works:**
- `npm run test:api` — 19 suites / 80 tests
- `npm run test:web` — 5 files / 24 tests
- `npm run test:e2e` — 4 Playwright specs (login/panel, S2 Risk-feed streaming, S3 four-feed + Task-card streaming, social-worker denial)
- `npm run build` + `npm run lint` for both `apps/api` and `apps/web`

**Test results (this session, 2026-07-05, fresh):** all green — 80/80 API (after one transient test-isolation failure self-healed on re-run, see above), 24/24 web, 4/4 E2E, both builds exit 0, both lints 0 errors (pre-existing warn-level warnings only). Live evidence (D3) and the post-review prompt-fix re-verification both showed 0 dropped citations across all four agents. Full detail in `docs/plans/caresync-ai/implementation-plan.md` Iteration 3 and the gate write-ups in `verification.md`/`review.md`.

## Notes

- **Deferred, not a regression:** Task citations (`fhirResources`) aren't persisted onto the FHIR `Task` resource itself — they ride only the SSE `task` payload at creation time, so a page reload loses the citation chips (the base Task fields — title, priority, status — do reload correctly). Documented as an accepted POC limitation; a natural fit for S4's analysis-cache work, which will store full Task payloads.
- **Standards debt, not blocking:** the lazy-OpenAI-client-construction block and the stream-drain loop are now duplicated across all four agent files (`riskAgent.ts`/`careGapAgent.ts`/`sdohAgent.ts`/`actionPlannerAgent.ts`). `code-review` recommends a `runToolAgent` helper in `agent.ts` before S4/S5 add more agents, but didn't block this branch on it.
- **Test-isolation quirk (see above):** worth a fix (or at least a documented `beforeEach` HAPI-state reset) before this pattern causes confusion in a future session — not addressed this session, flagged for the user.
