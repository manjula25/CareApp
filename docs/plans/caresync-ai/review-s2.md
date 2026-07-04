# Code Review — CareSync AI, S2 (Single-agent analysis with citation enforcement)

> **PLAN_ID:** `caresync-ai` · **Slice:** S2 · **Date:** 2026-07-04
> **Fixed point:** `main` (merge-base `30d7c0e`). Only one commit exists on this branch ahead of
> `main` (`f6e7198`, docs-only); everything else reviewed here is uncommitted working-tree state
> (tracked modifications + untracked new files per `git status`) — nothing below has landed yet.

Two axes reviewed in parallel, independently, per the repo's `code-review` skill. Not merged or reranked — see that skill's "why two axes" note.

## Standards

**Hard violation — Duplicated Code / Data Clump: `PatientBundle` shape defined 3x independently.**
`apps/api/src/fhir/client.ts:141-144` returns an inline anonymous type instead of an exported interface, unlike every other method in that file (`getPatient`/`getConditions`/`getTasks`/`getAssignedPanel`, which all return exported named interfaces reused by callers). `riskAgent.ts:24` and `analysis.ts:7` each hand-redeclare the identical shape. A future bundle-shape change means editing three files (Shotgun Surgery risk).

**Hard violation — Duplicated Code: `AgentFlag` defined twice**, identically, in `riskAgent.ts:10-13` and `citationValidator.ts:1-4`, with no import between them — breaks the file's own single-source-of-truth pattern for domain types.

**Judgement call — Primitive Obsession / loosened typing.** `resources: any[]` (`client.ts:144`, `riskAgent.ts:25`, `analysis.ts:7`) and an `as any` stream cast (`riskAgent.ts:104`) widen typing beyond the surrounding file's style. Reasonable given the OpenAI Responses API's untyped event stream; worth a follow-up type once the SDK's discriminated unions are confirmed usable.

**Correctly matches existing convention (not a finding):** `analysis.ts`'s scope-guard try/catch mirrors `patients.ts` exactly; default-param DI (`runAgent`, `client`) matches `FhirReadService`'s constructor-injection style; web-side type exports follow the established pattern.

**Minor:** `data-testid="risk-summary"` (`PatientDetail.tsx:161`) is the only `data-testid` in the web app (other tests query by role/text) — inconsistency, not a hard violation.

## Spec

**(a) Missing/partial:** All five `issues.md` S2 acceptance criteria are implemented and tested. One partial: GD13 (`plan.md`) calls for "structured outputs via `text.format`/tool calling," but `riskAgent.ts:39` sets `strict: false` on the `report_risk` tool — OpenAI won't schema-enforce the call, so a malformed `RiskOutput` could reach the unguarded `JSON.parse` (`riskAgent.ts:116`) with no fallback.

**(b) Scope creep:** None significant. The `dotenv` → native `process.loadEnvFile` swap is necessary supporting infra for A1, not overreach.

**(c) Implemented but wrong — two findings:**

1. **Citation enforcement doesn't cover the narrated token stream.** GD11 (`plan.md`): "the backend validates every citation against the bundle and drops/flags any hallucinated ID before it reaches the UI" — described in the plan as the slice's non-negotiable core guarantee. `analysis.ts:47-49` streams `token` events (the model's free-text narration) straight to the client with **zero validation** — only the structured `flags` array passes through `validateCitations`. The prompt (`riskAgent.ts` `buildPrompt`) never constrains the model from mentioning a `ResourceType/id` in its prose narration. A hallucinated ID spoken in the narration reaches the UI untouched. The literal `issues.md` acceptance criteria ("no *finding* reaches the UI citing an absent ID") are satisfied — this gap is in the broader GD11 guarantee the plan documents, not the narrower literal wording.

2. **The documented "unset key → graceful per-request error" claim is false.** `implementation-plan.md` Iteration 2 Rollback note: "Unset `OPENAI_API_KEY` to disable live analysis; the route degrades to an explicit error, not a fake result." In practice `export const openai = new OpenAI()` (`riskAgent.ts:5`) runs at **module import time** and throws synchronously with no key present. Since `index.ts` imports `createAnalysisRouter` (→ `riskAgent.ts`) unconditionally at startup, an unset key crashes the **whole API process at boot**, not just the analysis route per-request. `jest.setup.ts`'s placeholder-key workaround shows the authors were aware of the throw but didn't reconcile it with the rollback story.

## Summary

- **Standards:** 2 hard findings (duplicated `PatientBundle`/`AgentFlag` types), 1 judgement call (loosened typing), 1 minor (test-id inconsistency). Worst: the 3-way `PatientBundle` duplication — genuine Shotgun Surgery risk on the next bundle-shape change.
- **Spec:** 2 "implemented but wrong" findings, 1 partial (unenforced schema strictness). Worst: **narrated-text citations bypass GD11's validation gate entirely** — this is the closest thing to a defect in the feature's actual safety guarantee, not just its literal test coverage.

## Cross-reference with `verification.md`

`verification.md` (written earlier this pass) independently found a third real gap not duplicated here: `analysis.ts`'s SSE streaming loop has no error handling around `runAgent`'s `for await` — an agent failure mid-stream hangs the client and, absent any process-level unhandled-rejection handler, can crash the API process. Combined with this review's finding (2) above (import-time crash on a missing key), `analysis.ts`/`riskAgent.ts` have two distinct process-crash risk vectors, both unexercised by current tests.

## Post-review update — 2026-07-04

**User decision: fix all three defects plus both Standards duplications before commit.** All fixed, test-first — see `implementation-plan.md` Iteration 2, "Post-review fixes" (E1–E4) for the detail per finding:

- Standards duplication #1 (`PatientBundle` 3x) → fixed (E4): now exported once from `fhir/client.ts`.
- Standards duplication #2 (`AgentFlag` 2x) → fixed (E4): now exported once from `citationValidator.ts`.
- Spec finding "implemented but wrong" #1 (narration citations unvalidated) → fixed (E2): `redactUnvalidatedCitations` + `createNarrationBuffer`.
- Spec finding "implemented but wrong" #2 (boot-time crash on missing key) → fixed (E3): lazy client construction.
- Cross-referenced verification.md gap (SSE loop has no error handling) → fixed (E1): try/catch + `error` SSE event.
- Not addressed (out of scope, low severity, no action needed): the `strict: false` tool-schema partial finding (Spec §a) and the loosened-typing/`data-testid` judgement calls (Standards) — left as-is, no functional risk.

Re-verified: `npm run test:api` → 15 suites / 61 tests passing (12 new, covering all four fixes); build + lint clean.

## Next step

Run `finishing-a-development-branch` — both this review and `verification.md` are now resolved.
