# Verification — CareSync AI, S2 (Single-agent analysis with citation enforcement)

> **PLAN_ID:** `caresync-ai` · **Slice:** S2 · **Date:** 2026-07-04
> **Stage:** Phase 5 (`verification-before-completion`), run against the uncommitted S2 diff on
> `feature/caresync-s2-single-agent-analysis`. Read `docs/plans/caresync-ai/implementation-plan.md`
> Iteration 2 and `tasks/todo.md` for the plan this verifies against — not re-derived here.

## 1. Fresh command evidence (this session, 2026-07-04)

All commands re-run fresh in this session, not carried over from the prior session's notes.

| Command | Result |
|---|---|
| `FHIR_BASE_URL=http://localhost:8080/fhir npm run test:api` | **15 suites / 49 tests passed** |
| `npm run test:web` | **5 files / 14 tests passed** |
| `npm run lint --workspace apps/api` | 0 errors, 2 pre-existing warnings (`riskAgent.test.ts` unused `_event`) |
| `npm run lint --workspace apps/web` | 0 errors, 2 pre-existing warnings (`useAuth.tsx` fast-refresh) |
| `npm run build --workspace apps/api` (`tsc`) | exit 0 |
| `npm run build --workspace apps/web` (`tsc -b && vite build`) | exit 0 |

Matches the prior session's D1 evidence exactly (49/49, 14/14) — no regression since the handoff was written. Docker `caresync-ui-hapi-fhir-1` was confirmed running before the API suite ran.

Not re-run (per the handoff, doesn't need repeating since agent code hasn't changed): the live D3 OpenAI call and the Playwright E2E suite (`patient-analysis.spec.ts`). Both are already documented with dated evidence in `implementation-plan.md` Iteration 2, D2/D3.

## 2. Definition-of-done check (S2 acceptance, `issues.md`)

All 5 acceptance bullets confirmed against the actual code (not just the plan doc's claim):

1. **Live call → structured Risk output** — `apps/api/src/agents/riskAgent.ts` `runRiskAgent`, `report_risk` tool schema requires `riskScore`/`riskLevel`/`flags`/`readmissionProbability`. Confirmed via D3 live evidence + `riskAgent.test.ts`.
2. **SSE streaming, incremental render** — `routes/analysis.ts` streams `token` events then `finding`/`complete`; `apps/web/src/api/client.ts` `streamAnalysis` + `PatientDetail.tsx` render incrementally. Confirmed via `analysis.test.ts` and Playwright D2.
3. **Citation validator passes valid, drops fabricated** — `citationValidator.ts` `validateCitations`, unit-tested with exactly this in/out-of-bundle pair (`citationValidator.test.ts`).
4. **No out-of-bundle citation reaches the UI** — enforced in `routes/analysis.ts` (`validateCitations` gates every flag before `writeSseEvent(res, 'finding', ...)`); `analysis.test.ts` asserts the fabricated id never appears in `res.text`.
5. **Unit + API-boundary test coverage** — present and green (see §1).

No drift between what's claimed done and what the code does.

## 3. Spec-drift check (issues.md / prd.md / plan.md vs. implementation-plan.md vs. code)

- **`prd.md`'s uncommitted 4-line diff** (flagged by the prior handoff as "not reviewed, worth a glance"): reviewed. It's the GD13 provider-revision edit (Claude Sonnet 5 → OpenAI `gpt-5.5`, dated 2026-07-04) applied consistently to the agent-orchestration and caching sections. **Not drift** — it correctly reflects the same decision recorded in `plan.md` GD13 and `implementation-plan.md` Iteration 2.
- **`issues.md` S2 section is stale** — its "What to build" and acceptance criterion #1 still read "live Claude Sonnet 5 call" / "live Claude call," with no note of the GD13 provider revision that `prd.md`, `plan.md`, and `implementation-plan.md` all carry. Functionally harmless (the actual implementation and its own plan/PRD are correct and consistent with each other), but `issues.md` is the acceptance-criteria source of truth per the ADLC chain and should say what actually shipped. **Recommend a one-line update to `issues.md`** noting the revision, same as the other three docs — low priority, doesn't block this gate.
- **`implementation-plan.md` task A1 checkbox is unchecked** (`- [ ] **A1 (revised).**`) while `tasks/todo.md` shows it checked and the code (`riskAgent.ts` lines 1–8) confirms it's implemented exactly as described. Cosmetic doc inconsistency between the two plan artifacts, not a functional gap.
- **Iteration 3–9 (S3–S9) content already drafted in `implementation-plan.md`**: confirmed present, per the prior handoff's flag. Not touched by this verification pass — out of scope for S2, and per the handoff, not yet an approved planning pass. Flagged again below for the user.

## 4. Backend review pass (ahead of the formal `code-review` skill)

Reviewed the full backend diff (`riskAgent.ts`, `citationValidator.ts`, `routes/analysis.ts`, `fhir/client.ts`'s `getPatientBundle`, `env.ts`) against this repo's existing conventions (`routes/patients.ts`, `fhir/client.ts`'s other methods).

- `getPatientBundle` follows the exact existing audit/guard pattern (guard → fetch → audit-on-success only, consistent with every other method in `fhir/client.ts` — failed HAPI reads aren't audited anywhere in this codebase, not a new gap).
- `citationValidator.ts` is a pure function, no I/O, matches its Seam 2 spec exactly.
- **Finding — no error handling around the SSE streaming loop in `routes/analysis.ts`.** The bundle fetch (`getPatientBundle`) is wrapped in try/catch for `ScopeDeniedError`, but the subsequent `for await (const event of runAgent(bundle))` loop is not. `riskAgent.ts`'s `runRiskAgent` is documented and unit-tested (`riskAgent.test.ts`, "throws if the model never calls report_risk") to throw mid-generator — and any transient OpenAI network/rate-limit failure would throw the same way. Since `res.writeHead(200)` has already run by that point, a thrown error here means:
  - the client's SSE connection hangs indefinitely — no `finding`, `complete`, or error event is ever sent, and the "Run Analysis" UI has no way to know the call failed;
  - the rejected promise from the async Express route handler is unhandled (Express 4 does not catch async-handler rejections, and there's no `process.on('unhandledRejection', ...)` anywhere in `apps/api/src/index.ts`); under Node 22's default `--unhandled-rejections=throw`, this **crashes the whole API process** for every concurrent user, not just the one whose analysis call failed.
  - This is a real gap in the branch's own diff (not inherited from S1's `patients.ts`, which at least try/catches its own FHIR calls, if not the equivalent unhandled-rejection risk on non-`ScopeDeniedError` errors — that part *is* a pre-existing, out-of-scope S1 pattern).
  - **Not exercised by any existing evidence**: D1–D3 and the Playwright E2E all cover the success path only; nothing in `analysis.test.ts` feeds `runAgent` a stub that throws.
  - **Recommendation:** wrap the streaming loop in try/catch, emit an `error` SSE event and call `res.end()` on failure, and add a Supertest case with a throwing stub agent (mirrors the existing `stubAgent` pattern in `analysis.test.ts`). Small, contained, test-first fix consistent with repo conventions — did not implement it in this verification pass so `code-review` and the user can weigh in on priority/timing first.

## 5. Domain-term documentation check

No `docs/agents/domain.md` exists yet — `implementation-plan.md`'s own header (line 13) already notes this and defers it to "before spec-heavy later slices." All S2-introduced domain terms (`AgentEvent`, `RiskOutput`, citation validator / Seam 2, `droppedCount`, `$everything`, `validIds`) are documented inline via "Domain rule:" / "Domain terms:" annotations in `implementation-plan.md` Iteration 2, and the GD13 provider decision is fully recorded in `plan.md`. Sufficient for this POC stage; no action needed.

## 6. Gate outcome

**PASS.** All fresh command evidence is green and matches the plan's claims (§1–2); the two low-priority doc-drift items (§3, `issues.md`'s stale "Claude" wording and the `implementation-plan.md` A1 checkbox) were fixed alongside the code fixes below.

## 7. Post-review update — 2026-07-04

`code-review` (see `review.md`) ran next and, combined with §4's finding here, surfaced three real defects (this SSE gap, plus two the Spec review caught: narration citations bypassing GD11, and a boot-time crash on a missing API key) and two Standards duplications. **User decision: fix all before commit.** All four fixed test-first — see `implementation-plan.md` Iteration 2, "Post-review fixes" (E1–E4) for the detail. Re-verified fresh after: `npm run test:api` → **15 suites / 61 tests passing** (up from 49), `npm run test:web` → 14/14 unchanged, both builds and lints clean. `git status`/diff reviewed — no other files touched beyond the four fix areas plus this doc set.

**Still unresolved, carried forward:** Iteration 3–9 draft content in `implementation-plan.md` needs a decision from the user before anyone treats it as ready to implement — not addressed in this pass, out of scope for S2.

## Next step

`finishing-a-development-branch`, once `code-review`'s findings are also marked resolved in `review.md`.
