# Verification — CareSync AI, S3 (Four-agent orchestration + FHIR Task creation)

> **PLAN_ID:** `caresync-ai` · **Slice:** S3 · **Date:** 2026-07-05
> **Stage:** Phase 5 (`verification-before-completion`), run on `feature/caresync-s3-four-agent-orchestration`
> (HEAD `a7bc0e3`, plus this session's D2/D3 closeout). Read `docs/plans/caresync-ai/implementation-plan.md`
> Iteration 3 and `docs/plans/caresync-ai/issues.md` S3 for the plan this verifies against — not re-derived here.
> Prior slice's verification preserved at `verification-s2.md`.

## 1. Fresh command evidence (this session, 2026-07-05)

All commands re-run fresh in this session against the live local stack (Docker HAPI FHIR healthy, DB migrated/seeded, 35 FHIR resources imported).

| Command | Result |
|---|---|
| `npm run test:api` (1st run) | **2 suites / 3 tests failed** — see below |
| `npm run test:api` (2nd run, immediately after) | **19 suites / 80 tests passed** |
| `npm run test:web` | **5 files / 24 tests passed** |
| `npm run test:e2e` (Playwright) | **4/4 passed**, incl. the new S3 four-feed/Task-card spec |
| `npm run lint --workspace apps/api` | 0 errors, 13 pre-existing warnings (unused `_event`/output-type imports) |
| `npm run lint --workspace apps/web` | 0 errors, 2 pre-existing warnings (`useAuth.tsx` fast-refresh) |
| `npm run build --workspace apps/api` (`tsc`) | exit 0 |
| `npm run build --workspace apps/web` (`tsc -b && vite build`) | exit 0 |

**On the first `test:api` failure — a real test-isolation finding, not a product bug.** Earlier in this session, D3's live-call evidence gathering ran a real orchestrated analysis against Maria Chen on the shared local HAPI container, which created 10 real CareSync-authored Tasks. `fhir/client.test.ts:63` asserts an exact `taskCount: 2` for Maria from a live HAPI read — it failed because the container had 12 Task resources at that point, not 2. Immediately re-running the full suite passed clean (19/19): `analysis.test.ts`'s own B3 integration test invokes `replacePatientTasks` with its own stub output, which (correctly, per B2's replace guarantee) deleted the 10 CareSync-tagged Tasks my live run had created and left only the 2 seed Tasks untouched — confirmed directly against HAPI (`GET /Task?patient=maria-chen` → `total: 2`, the two seed tasks only). This is a genuine environmental coupling worth recording: **the API integration suite is not isolated from manually-triggered live runs against the same dev HAPI container** — a live D3-style run and the test suite share mutable state. It didn't require a code fix (the replace-on-rerun behavior is exactly what's specified and it visibly self-healed), but it means running a live analysis and then immediately running the test suite once can show a stale failure that clears on a second run. Recorded here rather than silently re-run-until-green.

## 2. Definition-of-done check (S3 acceptance, `issues.md`)

All 6 acceptance bullets confirmed against the actual code and this session's live evidence (not just the plan doc's claim) — checkboxes in `issues.md` were stale (`[ ]`) despite being fully implemented; corrected to `[x]` as part of this pass:

1. **All four agents run in parallel, each streams to its own feed** — `orchestrator.ts`'s `orchestrate()` (B1, unit-tested with 4 stub agents); confirmed live in D3 (209 streamed tokens across `risk`/`careGap`/`sdoh`/`actionPlanner`); confirmed in the browser via the new D2 Playwright spec (all four `FeedBox`es leave the idle placeholder).
2. **Action Planner output becomes FHIR Tasks persisted in HAPI** — `replacePatientTasks` (B2, Supertest vs test HAPI); confirmed live in D3 (`GET /Task?patient=maria-chen` returned Tasks `36`–`45` with real HAPI-assigned ids, in addition to the 2 seed Tasks).
3. **Each Task cites validated (non-fabricated) resources** — `validateCitationList` gate in `routes/analysis.ts` (B3); confirmed live in D3 both structurally (all 10 live-created Tasks' `fhirResources` resolved against a fresh `$everything` fetch) and via the fabrication-drop proof (9 real + 1 synthetic fabricated id → 9 valid / 1 dropped, run against the actual `validateCitations` function).
4. **SDOH reads the AHC-HRSN Observation; Care Gap reads Condition/Encounter/Observation** — `sdohAgent.ts`/`careGapAgent.ts` (A2/A3) read these resource types from the bundle and the live D3 findings cite exactly them (e.g. `sdoh → Observation/maria-chen-sdoh`, `careGap → Condition/maria-chen-diabetes`). **Correction (2026-07-05, post-`code-review`):** this bullet originally claimed the agent *prompts* had already been revised to match AC #4's corrected wording — false. The prompts still said "QuestionnaireResponse"/"CarePlan" until `code-review` caught the drift; see `review.md` "Post-review fix" for the actual prompt fix and its re-verification (0 dropped citations, SDOH correctly citing the real `Observation`, both before and after the fix).
5. **Re-running replaces prior findings/Tasks cleanly** — `replacePatientTasks`'s tag-scoped delete-then-create (B2); independently re-confirmed by this session's own test-isolation incident above (the Jest suite's own re-run replaced the 10 live D3 Tasks and left the 2 seed Tasks untouched — a second, incidental live proof of the same guarantee).
6. **API-boundary tests: all four agents' findings + created Tasks with resolvable citations** — `analysis.test.ts` (D1, part of the 19/80 green suite in §1).

No drift between what's claimed done and what the code does.

## 3. Spec-drift check (issues.md / prd.md / plan.md vs. implementation-plan.md vs. code)

- **`issues.md` S3 acceptance checkboxes were stale** (`[ ]` despite full implementation) — fixed to `[x]` in this pass (see §2). The AC #4 wording itself was already corrected in a prior commit (`a7bc0e3`, "correct AC #4 to match real seed data") — verified that wording matches the real seeded resource types, no further drift there.
- **`implementation-plan.md` D2/D3 for S3 were unchecked** (`- [ ] D2...`, `- [ ] D3...`) reflecting genuinely-outstanding work at the start of this session — both are now done and documented with dated evidence (this session, 2026-07-05) in Iteration 3.
- **`tasks/todo.md` has no S3 section** — it stops at the S2 checklist. This is a pre-existing gap (S3's code landed via direct commits without a todo.md entry, unlike S1/S2) — not introduced by this session, and `implementation-plan.md` Iteration 3 is the authoritative, up-to-date record for S3, so this doesn't block the gate. Flagged for the user's awareness; not fixed here since it's out of this verification's scope (backfilling a checklist for already-shipped work is bookkeeping, not verification).
- **Iteration 4+ (S4–S9) content already drafted in `implementation-plan.md`**: present, per the S2 verification's carried-forward flag. Not touched by this pass — still out of scope for S3.

## 4. Backend review pass (ahead of the formal `code-review` skill)

Reviewed the S3-specific diff added in this session (`patient-analysis.spec.ts` extension, `PatientDetail.tsx`'s `data-testid` addition) against existing repo conventions — both are additive, low-risk, and consistent with the existing `SUMMARY_TESTID` test-id pattern already in the same file. No new findings in this session's own changes.

The substantive S3 backend/frontend diff (agents, orchestrator, Task write, SSE routing, four-feed UI) was already reviewed in the prior "Post-review fixes" pass (E1/E2, `implementation-plan.md` Iteration 3) before this session started — not re-litigated here. This pass's job was closing the two outstanding verification gaps (D2/D3), which it did; the formal `code-review` skill (Standards + Spec axes) is the next gate and covers the full branch diff since `main`.

## 5. Domain-term documentation check

No new domain terms were introduced in this session's D2/D3 closeout (test/testid additions only). S3's domain terms (`Agent<TOutput>`/`AgentEvent`, `orchestrate`, `replacePatientTasks`, per-agent `agentId` SSE tagging) are already documented inline via "Domain rule:"/"ponytail:" annotations in `implementation-plan.md` Iteration 3, consistent with the S2 precedent. `docs/agents/domain.md` still doesn't exist — same pre-existing, deferred gap noted in the S2 verification, unchanged by S3.

## 6. Gate outcome

**PASS.** All fresh command evidence is green (§1); the one first-run test failure was diagnosed to a real, non-blocking test-isolation quirk (shared live HAPI state between manual live runs and the Jest suite) that self-resolved and is documented rather than hidden. Definition-of-done (§2) and spec-drift (§3) checks found only stale-checkbox bookkeeping, now fixed. No code defects found in this pass.

## Next step

`code-review`, covering the full branch diff since `main` along the Standards and Spec axes.
