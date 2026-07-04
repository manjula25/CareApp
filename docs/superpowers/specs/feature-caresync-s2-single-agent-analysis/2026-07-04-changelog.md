# Changelog: S2 — Single-agent analysis with citation enforcement

**Type:** Feature

**Branch:** `feature/caresync-s2-single-agent-analysis`

**Date:** 2026-07-04

## Summary

Added a live "Run Analysis" flow on the patient detail view: a Risk agent (OpenAI `gpt-5.5`) streams clinical reasoning and structured findings over SSE, with every FHIR citation — in both the structured output and the free-text narration — validated against the patient's retrieved bundle before it reaches the UI.

## Changes Made

### Backend — Risk agent + SSE route

- **Before:** No agent capability existed; `PatientDetail` only read static FHIR data (name, conditions, tasks).
- **After:** `POST /api/patients/:id/analysis` streams a live Risk agent run over SSE (`token`, `finding`, `complete`, `error` events), auditing the underlying `$everything` read.
- **Files changed:** `apps/api/src/agents/riskAgent.ts`, `apps/api/src/routes/analysis.ts`, `apps/api/src/fhir/client.ts` (`getPatientBundle`), `apps/api/src/index.ts` (route wiring), `apps/api/src/env.ts` (new — loads `.env` before the agent module constructs its client).
- **Key changes:** `runRiskAgent(bundle)` — an async generator calling the OpenAI Responses API with a `report_risk` function tool; `getPatientBundle` — one audited `Patient/{id}/$everything` read, deriving `validIds` directly from the returned resources so the citation-check set can't drift from the agent's actual input.

### Backend — Citation enforcement (GD11, Seam 2)

- **Before:** No citation-validation mechanism existed.
- **After:** Every `fhirResourceId` the agent produces — whether in a structured `flag` or mentioned in free-text narration — is checked against the bundle; anything not present is dropped (flags) or redacted (narration) before the client ever sees it.
- **Files changed:** `apps/api/src/agents/citationValidator.ts`.
- **Key changes:** `validateCitations(flags, validIds)` partitions structured flags into valid/dropped. `redactUnvalidatedCitations(text, validIds)` and `createNarrationBuffer(validIds, lookahead)` extend the same guarantee to the streamed narration: the buffer holds back a small (96-char) trailing window so a `ResourceType/id` split across two token deltas is still whole before it's checked, trading a small bounded delay in the live-streaming effect for a real enforcement guarantee instead of buffering (and losing the live effect of) the whole narration.

### Frontend — Run Analysis control + streaming feed

- **Before:** `PatientDetail` had no analysis affordance; the other three feed boxes from the mockup didn't exist yet.
- **After:** A "Run Analysis" control triggers the SSE call; narration streams incrementally into one Risk feed box with a blinking cursor, and validated findings render as FHIR citation chips (`Condition/…`, `Observation/…`) alongside the risk summary. The other three feed boxes render as honest idle placeholders (wired in S3).
- **Files changed:** `apps/web/src/api/client.ts` (`streamAnalysis` — `fetch` + `ReadableStream`, parses SSE), `apps/web/src/pages/PatientDetail.tsx`, `apps/web/src/index.css`, `apps/web/vite.config.ts`.

### Post-review fixes (same branch, before merge)

`verification-before-completion` and `code-review` (run this session against the already-implemented S2 diff) found three real defects and two duplicated-type Standards findings, none exercised by the original success-path-only test evidence. All fixed test-first before commit:

- **SSE error handling** — *Before:* an agent failure mid-stream (proven to happen when the model skips the tool call, or on any transient OpenAI failure) hung the client forever with no error event, and the unhandled promise rejection could crash the whole API process (no error handling existed around the streaming loop, and no process-level handler was registered). *After:* the loop is wrapped in try/catch; a failure emits an `error` SSE event and ends the response cleanly.
- **Narration citation enforcement gap** — *Before:* only the structured `flags` array was validated; a hallucinated FHIR id mentioned in the model's free-text narration reached the UI untouched. *After:* `createNarrationBuffer` + `redactUnvalidatedCitations` cover the narration stream too (see above).
- **Boot-time crash on missing API key** — *Before:* `export const openai = new OpenAI()` ran at module import time and threw synchronously with no key; since the route is imported unconditionally at API startup, an unset key crashed the *whole process at boot* — contradicting the documented "unset key degrades to a per-request error" rollback story. *After:* the client is built lazily on first use (`getOpenAiClient()`), so a missing key only fails the one request that needs it. The `jest.setup.ts` placeholder-key workaround for the old eager-throw is no longer needed and was deleted, along with its `jest.config.js` wiring.
- **Duplicated types (Standards)** — *Before:* `PatientBundle` was independently redeclared in `fhir/client.ts`, `riskAgent.ts`, and `analysis.ts`; `AgentFlag` was redeclared in both `riskAgent.ts` and `citationValidator.ts`. *After:* each is exported once (`PatientBundle` from `fhir/client.ts`, `AgentFlag` from `citationValidator.ts`) and imported everywhere else.

## Files Modified

| File | Change Description |
|------|---------------------|
| `apps/api/src/agents/riskAgent.ts` | New — Risk agent (OpenAI `gpt-5.5`, Responses API, structured output), lazy client construction |
| `apps/api/src/agents/citationValidator.ts` | New — Seam 2: `validateCitations`, `redactUnvalidatedCitations`, `createNarrationBuffer` |
| `apps/api/src/routes/analysis.ts` | New — `POST /:id/analysis` SSE route, validation gate, error handling |
| `apps/api/src/fhir/client.ts` | `getPatientBundle` (`$everything` + `validIds`), exports `PatientBundle` |
| `apps/api/src/env.ts` | New — loads `.env` before agent modules construct clients |
| `apps/api/src/index.ts` | Wires `createAnalysisRouter`; imports `./env` first |
| `apps/web/src/api/client.ts` | `streamAnalysis` — SSE client over `fetch`/`ReadableStream` |
| `apps/web/src/pages/PatientDetail.tsx` | Run Analysis control + Risk feed box, idle placeholders for S3 |
| `apps/api/jest.config.js` | Removed the `setupFiles` entry (no longer needed after the lazy-client fix) |
| `apps/api/jest.setup.ts` | Deleted — placeholder-key workaround no longer needed |
| `docs/plans/caresync-ai/{implementation-plan,issues,prd}.md`, `plan.md`, `tasks/todo.md` | Plan/spec docs updated for GD13 (provider revision) and the post-review fixes |

## Commits

| Commit | Description |
|--------|-------------|
| `f6e7198` | docs(S2): add ponytail-simplified implementation plan + active checklist |
| `5a898ba` | feat(S2): single-agent analysis with citation enforcement (implementation + post-review fixes) |

## Testing & Verification

**How to verify this works:**
- `FHIR_BASE_URL=http://localhost:8080/fhir npm run test:api` — 15 suites / 61 tests
- `npm run test:web` — 5 files / 14 tests
- `npm run test:e2e` — 3 Playwright specs (login/panel, analysis streaming, social-worker denial)
- `npm run build` + `npm run lint` for both `apps/api` and `apps/web`

**Test results (this session, 2026-07-04):** all green — 61/61 API, 14/14 web, 3/3 E2E, both builds exit 0, both lints 0 errors (pre-existing warn-level warnings only). Full detail and live-model evidence (D1–D3, E1–E4) in `docs/plans/caresync-ai/implementation-plan.md` Iteration 2, and the gate write-ups in `docs/plans/caresync-ai/verification.md` and `review.md`.

## Notes

- **GD13 revision:** the agent provider was switched from the originally-planned Claude Sonnet 5 to OpenAI `gpt-5.5` because no Anthropic API key was available to prove the live-call verification step. User-approved straight substitution under the same `runRiskAgent`/`AgentEvent` contract — recorded in `plan.md` GD13.
- **Known deferral, not a regression:** citation redaction in narration uses a 96-character lookahead heuristic (regex-based, bounded buffer) rather than buffering the entire response — a citation that happens to split across a boundary wider than 96 characters is a theoretical edge case not fully eliminated. Acceptable for this POC's threat model; documented in `citationValidator.ts`.
- **Out of scope, flagged for the user, not addressed this session:** `implementation-plan.md` already contains drafted Iteration 3–9 (S3–S9) content that wasn't produced by an approved planning pass in either this or the prior session — needs a decision before anyone treats it as ready to implement. A separate, untracked `docs/plans/caresync-ai/review-s1.md` (a retroactive S1 code review, not authored by this session) also appeared mid-branch and was left untouched.
