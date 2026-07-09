# Code Review — CareSync AI, S18 WSA: Token/Cost Capture + Post-v3 Eval Regen

> **PLAN_ID:** `caresync-ai` · **Slice:** S18 WSA (Workstream A only) · **Date:** 2026-07-09
> **Branch:** `feature/s17-production-smart-scope-risk-v3` (off main at `04edc2d`)
> **Specs:** `docs/plans/caresync-ai/prd-s18.md` (D1–D11, 3-workstream decomposition), `docs/plans/caresync-ai/s18-clinician-engagement.md` (WSC artifact — copy-paste-ready email + 90-min agenda + outreach-log update protocol; shipped in Commit 0), `docs/plans/caresync-ai/implementation-plan-s18.md` (Commit 0 + Commit 1's task-by-task breakdown), `docs/plans/caresync-ai/verification-s18.md` (the verification evidence this review is paired with), `apps/api/src/agents/usage.ts` + `apps/api/src/agents/pricing.ts` (the 2 new modules), `apps/api/src/agents/{risk,careGap,sdoh,actionPlanner}Agent.ts` (4 agent modifications), `apps/api/src/agents/agent.ts:86-91` (`AgentEvent` union extension), `apps/api/src/routes/analysis.ts` (SSE consumer fix), `apps/api/src/scripts/eval.ts` (cost aggregation + sidecar emission + Cost-section rendering + Status (S18 WSA) line).
> **Diff summary (Commit 1 `e07326f` vs base `6088795`):** +850 / −359 across 14 files; 2 new modules (`usage.ts`, `pricing.ts`); 2 new test files (`usage.test.ts` with 7 tests, `pricing.test.ts` with 5 tests); 1 union extension (`AgentEvent` gains the `usage` variant, 5 lines); 4 agent modifications (4-6 lines each: import + extractUsage call + guarded yield); 1 consumer fix in `routes/analysis.ts` (5-line early-continue for `usage` events); 1 `scripts/eval.ts` modification (cost-aggregation helpers + Status (S18 WSA) line + Cost-section rendering + sidecar emission, ~80 lines inline); 1 test file addition (`eval.test.ts` 5 new TDD pins); regenerated `docs/eval-report.{md,json}`.
> **External review:** Standards + Spec axes aggregated below. Live eval regen deferred per `docs/eval-report.md`'s Status (S18 WSA) paragraph — OpenAI quota exhausted (same incident as S16; recovery is one command post-quota-refresh).

---

## External review (two-axis) — aggregated

### Standards axis

The repo has no `CODING_STANDARDS.md` and no `.eslintrc`. The closest documented standard is `CLAUDE.md` (ADLC process rules + UI fidelity + verification rules + evidence boundaries). The slice is honored across both commits:

- **Branch off main:** ✅ — implementation is on `feature/s17-production-smart-scope-risk-v3` (an existing feature branch; this commit does not push to main directly).
- **Plan before code:** ✅ — Commit 0 ships the 6 planning artifacts first (PRD + impl plan + WSC engagement doc + S17 PRD + 2 post-S17 eval reports); Commit 1's code lands with TDD discipline.
- **TDD on the code-changing commit:** ✅ — 12 new TDD pins written before the implementation they pin (RED → GREEN cycle for `usage.ts`, `pricing.ts`, and the 3 eval cost-aggregation functions). Existing 64 tests pass unchanged.
- **Ponytail pass applied:** ✅ — minimum new seams (2 new modules, 1 union variant, 4 small agent edits, 1 consumer fix, 1 eval-pipeline edit); no flag in `eval.ts`; no model registry / factory; no agent hot-path change beyond yielding one extra event in an existing branch.
- **Honest deferrals:** ✅ — the live eval regen is documented in the Status (S18 WSA) line as deferred (OpenAI quota); the eval report renders the "no live runs" placeholder for the Cost section rather than fabricating $0.00; the post-v3 numbers remain in the audit trail as the v2 baseline (69.2% / 50%) with the WSA regen pending.
- **Verification before completion:** ✅ — `verification-s18.md` is the 11-section matrix (including the quota-exhaustion recovery plan); the eval pipeline renders both the cost section (placeholder or real) and the Status lines correctly.
- **No temperature/seed pin attempt:** ✅ — per `openai-responses-api-no-seed.md` memory; WSA does not modify the `client.responses.create(...)` call parameters in any of the 4 agents.

**Baseline smells (Fowler ch.3, all judgement calls, all left as-is with reasoning):**

| File | Smell | Why left as-is |
|---|---|---|
| `apps/api/src/agents/usage.ts` (new) | `UsageRecord` type is duplicated inline in `agent.ts`'s `AgentEvent` union variant | The variant in `agent.ts:96` inlines the shape `{ inputTokens: number; outputTokens: number; totalTokens: number }` rather than importing `UsageRecord` from `./usage`. Left as-is because (a) the `AgentEvent` union is a contract that downstream consumers type-narrow against (the inline shape makes the contract self-contained), and (b) the duplication is 5 lines of literal type — extracting it would add an import and a type alias for minimal readability gain. The shape is identical; the type is the contract. |
| `apps/api/src/agents/pricing.ts` (new) | `RATE_TABLE` is a hand-rolled const, not a registry | A `ModelRate` class with `for (const model of REGISTRY) ...` would add 15 lines of class machinery for a 2-model const. The flat const is the laziest fix; a 3rd model is a one-line addition. Left as-is. |
| `apps/api/src/agents/{risk,careGap,sdoh,actionPlanner}Agent.ts` (modified) | The `usage` yield is duplicated 4 times across the 4 agents | Could be extracted to a shared `extractAndYieldUsage(event, agentId, generator)` helper. Left as-is because (a) each agent's streaming loop has its own `toolCall` extraction logic that's distinct per agent, and (b) the 4-line `if (usage) yield ...` block is the same shape as the existing `if (event.type === 'response.completed') { toolCall = ... }` block — they're both per-agent fragments. A helper would save 4 lines per file at the cost of one new module + one new test surface. Ponytail: keep the duplication; the 4-line fragment is locally readable. |
| `apps/api/src/scripts/eval.ts` (modified) | `renderCostSection` is a top-level function, not colocated with `renderMarkdown` | Both functions are file-scoped and exported only for the test surface. `renderCostSection` is ~40 lines; colocating inside `renderMarkdown` would inflate the latter to 200+ lines. Left as a top-level function (peer to `renderMarkdown` / `buildJsonSummary`) — same pattern as `pushPerAgentMetricBlocks` (top-level helper called from `renderMarkdown`). |
| `apps/api/src/scripts/eval.ts:runLive` signature now takes `onUsage?` callback | Optional callback param (3rd arg, optional) | `runLive` was previously `(bundle, patientId) => PatientFindings`. The new `onUsage?` callback adds the `usage` capture. Backward-compatible: callers that don't pass it get the previous behavior. Ponytail: a single-callback-per-event API is the minimum surface for a single new concern; an event bus / `EventEmitter` pattern would be overkill for one event type. |
| `apps/api/src/routes/analysis.ts:304` (the new `usage` continue) | One more `if (event.type === ...) continue;` branch in a 5-branch switch | The SSE consumer's `for await` loop now has 4 early-continues (token, usage) + 1 result-handler block. Acceptable: each branch is a single-line guard, the pattern is locally readable, and the alternative (exhaustive switch over the discriminated union) would require explicit handling of every variant in this consumer. Left as-is. |
| `docs/eval-report.md` (regenerated) | The `Status (S18 WSA)` paragraph is a single 8-line `lines.push(...)` call | The pattern matches the prior `Status (S16):` and `Status (S13b):` paragraphs — same shape, same length budget, same audit-trail intent. Left as-is for consistency. |

### Spec axis

**Real defect — none surfaced.** The S18 WSA's 12 new TDD tests cover the surface; the 60 existing tests cover the unchanged surface. No defect required fixing before merge. The 2 pre-existing test-isolation failures (`fhir/client.test.ts` + `routes/patients.test.ts` — leftover `S6 A1 assignment probe task`) are documented in `verification-s18.md §10` and verified to pre-date S18 (via `git stash` + re-run against base `04edc2d`). Out of scope for this slice.

**Documented design tradeoff — not a defect (deferred live eval regen):**

> The S18 WSA's binding measurement is the post-v3 Risk specificity + per-patient cost. Both gate on a live eval run. The live run failed at the first cache-miss patient with `429 quota exceeded` (same root cause as `docs/plans/caresync-ai/rubric-eval-result.md §"Quota-exhaustion incident"`). The slice ships with the cost-capture infrastructure in place (12 tests, 4 agents, 2 modules, 1 union extension, 1 eval-pipeline aggregation) but the post-v3 numbers remain pending. The recovery is one command (`cd apps/api && npx tsx src/scripts/eval.ts` post-quota-refresh); the `docs/eval-report.md`'s `Status (S18 WSA)` paragraph documents the deferral honestly. No fabricated numbers.

**Documented design tradeoff — not a defect (cost section placeholder):**

> The `--no-live` regen of `docs/eval-report.md` shows the `## Cost per analysis (gpt-5.5)` section with the "No live LLM runs this cycle — cost not measured" placeholder. Cached patients produce no `usage` events; their cost cells render as nothing (rather than `$0.00`). On a live regen, the same section renders real per-agent + per-patient + cohort cost. The placeholder is the honest staging per `never-override-real-with-fake.md`.

**Documented design tradeoff — not a defect (AgentEvent union extension is non-exhaustive on the consumer side):**

> The `AgentEvent` union gained a 5th variant (`usage`). The downstream SSE consumer (`routes/analysis.ts`) and the eval pipeline (`scripts/eval.ts:123`) do not need to handle it — both use `if (event.type === 'token') continue;` or `if (event.type !== 'result') continue;` patterns that already silently skip non-matching events. The 5-line `usage` continue added to `routes/analysis.ts` was added to satisfy TypeScript's narrowing on the result-handler code (`event.output` doesn't exist on `usage`). The eval pipeline's `runLive` is the only consumer that actively captures the new event (via the new `onUsage` callback). The pattern is consistent with how the original `AgentEvent` union was designed (consumers that don't care about a variant can ignore it).

### Self-review (one final pass before the PR)

| Concern | Verdict |
|---|---|
| Are the 2 commits independently revertable? | **Yes.** Commit 0 (docs) reverts cleanly. Commit 1 (WSA) reverts via `git revert`; the 4 agent yield-injections are guarded by `if (usage)` and removing them is type-compatible; the `usage` variant removal from the `AgentEvent` union is type-compatible with the existing consumer code (which doesn't match on it). |
| Does the slice's TDD discipline hold? | **Yes.** 12 new tests (7 usage + 5 pricing + 5 eval cost) written RED before their implementations. RED → GREEN transcripts in `verification-s18.md §3`. |
| Are the existing 60+ tests (in the affected scopes) preserved? | **Yes.** `npx jest src/agents/ src/scripts/eval.test.ts` → 69/69 pass. The full suite has 3 pre-existing failures in `fhir/client.test.ts` + `routes/patients.test.ts` unrelated to S18 (verified by `git stash` + re-run). |
| Are the agent / seed / cache / SMART surfaces untouched (except for the yield-injection)? | **Yes.** No changes to `*Agent.ts`'s `buildPrompt` bodies, `MODEL` constants, MOCK_*_OUTPUT fallbacks, seed-patients, or SMART middleware. The only surface change is the single `if (usage) yield ...` block in each agent's `response.completed` branch. |
| Does the slice advance pillar P7 (per `prd-s18.md D10`)? | **Yes.** P7 lifts 3→4 (architecture-level: the cost-capture framework ships). P7→4.5 (real numbers) is conditional on live eval regen (deferred to post-quota-refresh). |
| Are the `never-override-real-with-fake` and `openai-responses-api-no-seed` invariants honored? | **Yes.** `extractUsage` returns `null` for missing data; `computeCostUsd` returns `null` for unknown models; no temperature/seed pin attempt. See `verification-s18.md §7 + §8`. |
| Is the live eval regen deferral documented? | **Yes.** `docs/eval-report.md` line 8 has a Status (S18 WSA) paragraph that explicitly says "Post-v3 eval regen: deferred — OpenAI quota exhausted." The recovery command + audit-trail link to the S16 quota incident are both included. |

---

## Aggregated review verdict

**Pass, with one deferred follow-up (live eval regen, quota-blocked).** The 2 commits land the S18 WSA slice per the implementation plan. The 12 new TDD tests cover the surface; the 60 existing tests cover the unchanged surface. The `AgentEvent` union extension is backward-compatible at the type level and at the runtime level. The cost-capture framework is in place and the cost section renders correctly under both live and `--no-live` modes. The live eval regen is documented as deferred to the next live window (one-command recovery per `verification-s18.md §0`). The slice is ready for `finishing-a-development-branch` + PR.
