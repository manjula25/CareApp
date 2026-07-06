# Verification — CareSync AI, S10 (CDS Hooks patient-view service)

> **PLAN_ID:** `caresync-ai` · **Slice:** S10 · **Date:** 2026-07-06
> **Stage:** Phase 5 (`verification-before-completion`), run on `feature/caresync-s10-cds-hooks`
> (base `d219b9c` = `main`, tip `89a0fab`, 6 commits: `94a7af4` pre-implementation plan review,
> `824013d`/`b14c59d` Phase A A1 discovery + review follow-up, `bb4214c`/`17511c8` Phase A A2
> patient-view service + review follow-up, `89a0fab` Phase B B1 sandbox docs + checkbox closeout).
> Read `docs/plans/caresync-ai/implementation-plan.md` Iteration 10 (including its
> "Pre-implementation plan review" note) and `docs/plans/caresync-ai/issues.md` S10 for the plan this
> verifies against — not re-derived here. Built via `subagent-driven-development`: one implementer
> subagent per task (A1, A2), one independent spec-compliance reviewer + one independent code-quality
> reviewer per task, plus a whole-slice integration reviewer across the full diff — all re-verified
> again in this consolidated pass, not trusted from any subagent's self-report.

## 1. Fresh command evidence (this session, 2026-07-06)

Every command below was re-run fresh in this final pass, on top of each task's own independent
reviewer runs (§4).

| Command | Result |
|---|---|
| `cd apps/api && npx jest cdsHooks.test.ts cdsCardMapping.test.ts --runInBand` | **2 suites / 14 tests passed** |
| `cd apps/api && npx tsc --noEmit` | exit 0 |
| `docker ps` | **empty — HAPI FHIR container is down** in this environment |
| `npm run test:api` (full workspace suite) | **24 suites / 140 tests passed, 7 suites / 50 tests failed** — all 7 failing suites (`fhir/client.test.ts`, `fhir/subscription.test.ts`, `routes/{patients,population,governance,tasks,analysis}.test.ts`) fail with `TypeError: fetch failed` inside `FhirReadService`, consistent with the HAPI container being down, not with anything in this diff. **Neither `cdsHooks.test.ts` nor `cdsCardMapping.test.ts` is among the failures.** |
| Local live smoke test: `PORT=4177 npx tsx src/index.ts` (real server, no mocks), then `curl` | `GET /cds-services` → well-formed discovery descriptor; `POST /cds-services/caresync-patient-view` with an uncached patient → `{"cards":[]}`; `POST /cds-services/not-a-real-service` → `404`; `POST /cds-services/caresync-patient-view` with `context: {}` → `400 {"error":"context.patientId is required"}`. Server stopped cleanly after. |

The full-suite failure count and HAPI-down state were independently re-checked in this pass (not
assumed carried-over from earlier in the session) — identical result both times.

## 2. Definition-of-done check (S10 acceptance, `issues.md`)

All 4 acceptance bullets confirmed against the actual code and this session's evidence:

1. **"The service exposes a CDS Hooks discovery endpoint and a patient-view service endpoint."** —
   `GET /cds-services` (`apps/api/src/routes/cdsHooks.ts:23`) and `POST /cds-services/:id` matching
   `CDS_PATIENT_VIEW_SERVICE_ID` (`cdsHooks.ts:58`). Both confirmed live in §1's curl smoke test, not
   just in tests.
2. **"Given a patient-view hook, it returns well-formed CDS cards carrying agent findings and their
   FHIR citations."** — `mapAnalysisResultToCards` (`apps/api/src/routes/cdsCardMapping.ts:45`) maps
   every risk/careGap/sdoh finding from the S4 cache to a card with `summary`/`indicator`/`detail`/
   `source`, each `detail` carrying `(FHIR: ResourceType/id)`. `indicator` is spec-legal
   (`'info'|'warning'|'critical'`) in every branch. Confirmed by the 14 passing tests plus the whole-
   slice reviewer's independent re-run.
3. **"A card fires in the public CDS Hooks sandbox against the running service."** — **NOT DONE.**
   This requires exposing the local dev server to the internet via a tunnel (e.g. `ngrok`), which was
   deliberately not done without the user's explicit sign-off (see `cds-hooks-sandbox.md` for the
   documented steps to do it). Substituted with the local live-server curl smoke test in §1, which
   proves the same request/response contract the sandbox would exercise, minus the actual public
   network hop.
4. **"Tests for the discovery response and card generation for the hero patient."** — `cdsHooks.test.ts`
   covers discovery + patient-view routing (cache-hit/miss/404/400/no-auth); `cdsCardMapping.test.ts`
   unit-tests the pure mapping against a canned `AnalysisResultJson` (every indicator tier, truncation
   boundary, actionPlanner exclusion, empty-findings case). "Hero patient" specifically: the tests use
   a synthetic patient id rather than the literal Maria Chen hero-patient id — reasonable for a pure
   route/mapping test (the mapping has no patient-identity-specific logic), but flagged here rather
   than silently assumed equivalent.

**3 of 4 acceptance bullets fully met; bullet 3 (public sandbox fire) is open pending the user's
decision on exposing the server, tracked as `implementation-plan.md`'s unchecked C2.**

## 3. Spec-drift check (issues.md / implementation-plan.md vs. code)

Two real plan-vs-reality mismatches, both caught and resolved **before** implementation started (this
session's pre-implementation plan review, `94a7af4`), not silent deviations discovered after the fact:

- **The plan's A2 said "reuse cached (or run) analysis."** There is no reusable, non-streaming
  "run the orchestrator and return a validated result" function — that sequence lives inline inside
  `analysis.ts`'s SSE handler. CDS Hooks services must also answer synchronously and fast, which a
  4-agent LLM run can't do inline. **Resolution:** A2 was scoped to cache-only; a cache miss returns
  `cards: []` rather than triggering a live run. This is a deliberate scope reduction, documented in
  the plan itself before any code was written, not a shortcut discovered after the fact.
- **The plan's B1 said "CORS/config so the public CDS Hooks sandbox can hit the running service."**
  `apps/api/src/index.ts` already calls `app.use(cors())` with no options — already fully open, no
  code change needed. B1 reduced to confirming this + writing the sandbox-pointing doc.

No scope creep: `git diff d219b9c..HEAD --stat` shows only new files under `apps/api/src/routes/`
(`cdsHooks.ts`/`.test.ts`, `cdsCardMapping.ts`/`.test.ts`), a 3-line additive change to
`apps/api/src/index.ts` (import + comment + one mount line, later a 2-line comment-accuracy fix), and
docs (`implementation-plan.md`, new `cds-hooks-sandbox.md`, new `verification-s10.md`). No existing
route, middleware, or auth behavior was touched — confirmed by the whole-slice reviewer reading the
full `index.ts` diff, not just the added lines.

Other checks:
- **`implementation-plan.md` Iteration 10's checkboxes** — A1, A2, B1, C1 are `[x]`; C2 is
  deliberately left `[ ]` with an explanation, matching the actual state (verified by reading the file
  directly).
- **No new persisted state** — `apps/api/src/db/index.ts`'s `migrate()` is unchanged; S10 only reads
  the existing `analysis_cache` table (S4), never writes to it.
- **No auth added/removed elsewhere** — `requireAuth` usage in every other router
  (`analysis.ts`, `patients.ts`, `population.ts`, `governance.ts`, `tasks.ts`) is untouched; the new
  router deliberately has none, consistent with the CDS Hooks public-sandbox contract.

## 4. Review notes

Both A1 and A2 were built by an implementer subagent under an explicit TDD requirement (failing test
first, confirmed red for the right reason, then green), and **each task's implementer report was
independently re-verified by a separate spec-compliance reviewer subagent, then a separate
code-quality reviewer subagent** — neither the implementer nor either reviewer graded its own work.
Both reviewer stages re-read the diffs and re-ran the tests themselves rather than trusting the prior
stage's claim.

Two review-driven fixes were applied and re-verified, each as its own commit:
- A1's code-quality review flagged the `'caresync-patient-view'` id string as a magic-string
  duplication risk (A2 would need the exact same value) — fixed by exporting
  `CDS_PATIENT_VIEW_SERVICE_ID` from `cdsHooks.ts` (commit `b14c59d`), mirroring this repo's own S9
  review precedent (exporting `HIGH_RISK_LEVELS` instead of duplicating it).
- A2's code-quality review flagged a garbled comment in `index.ts` ("A2 reads the same table A2
  writes") — fixed to correctly attribute the write to S4's `analysis.ts` (commit `17511c8`).

One code-quality finding was reviewed and deliberately left as a documented judgement call, not
fixed: `cdsCardMapping.ts`'s three near-identical indicator-mapping functions and `.map()` blocks
(different field names/tier boundaries per section) were flagged as a moderate Duplicated-Code smell
with direct repo precedent for generalizing it (`citationValidator.ts`'s `validateCitationList`), but
assessed non-blocking — same tolerance this repo's S4/S9 reviews already applied to structurally
similar shapes.

A separate whole-slice integration reviewer then read the entire `main..HEAD` diff as one PR (not
per-commit) specifically to catch cross-commit issues per-task review can't — confirmed the A1↔A2 id
wiring is genuinely shared (not two independently-typed literals), confirmed the single `db`-param
mount site, confirmed zero changes to any other router/auth/CORS path, confirmed the sandbox doc
matches the real code, and found no leftover TODOs or half-finished code. No new findings surfaced at
the whole-slice level.

No `BLOCKED`/`NEEDS_CONTEXT` escalations were needed for either task — both implementers proceeded
directly from the fully pre-specified card-mapping rules given in their task briefs (the mapping rules
were pinned down by the controller before dispatch specifically to remove design-judgment ambiguity
from the implementer's plate).

## 5. Domain-term documentation check

New domain concepts introduced by S10 — the CDS Hooks `discovery`/`patient-view service` vocabulary,
the `CdsCard` shape (`summary`/`indicator`/`detail`/`source`), and the three indicator-tier mappings
(risk `riskLevel`, care-gap `urgency`, SDOH `severity` → CDS Hooks' 3-value `indicator` enum) — are all
documented inline via doc comments at their introduction point (`cdsHooks.ts`, `cdsCardMapping.ts`),
consistent with the "Domain rule:"/deviation-note convention established since S2. The cache-only
scoping decision and its rationale (CDS Hooks' synchronous-response constraint) is recorded in
`implementation-plan.md`'s plan-review note, not only in code comments — future readers of the plan
see the "why" without having to find the code first. `docs/agents/domain.md` and
`docs/agents/issue-tracker.md` still don't exist — the same pre-existing, deferred gap noted in every
prior slice's verification since S5, unchanged by S10.

## 6. Evidence-boundary labeling (CLAUDE.md)

Per CLAUDE.md's evidence-boundaries rule:
- §1's Jest/tsc results and the whole-slice reviewer's independent re-run are **local mock** strength
  (in-memory SQLite, no live HAPI, no live LLM — none of S10's code touches either).
- §1's curl smoke test against a real, non-mocked running API instance is stronger than a unit test
  but still **local** — it proves the real Express app + real SQLite file wiring works, not a
  target-environment or client-accepted round trip.
- The one piece of evidence this slice's own acceptance criteria calls for at **target-environment**
  strength — a card actually firing in the public `sandbox.cds-hooks.org` client against a
  tunnel-exposed instance of this service — was **not gathered**, and is not claimed here. This is an
  honest, recorded gap (§2 bullet 3, §7), not a substitution dressed up as equivalent.

## 7. Gate outcome

**CONDITIONAL PASS.** All command evidence in this environment is green for what S10's code actually
does (§1), no spec drift survives unresolved (§3), and both review stages plus a whole-slice
integration pass found no unfixed defects (§4). The one open item is acceptance bullet 3 — the actual
public-sandbox fire — which cannot be completed without the user choosing to expose the local server
via a tunnel. Recorded as a known, explicit gap rather than papered over; `implementation-plan.md`'s
C2 checkbox is left unchecked for exactly this reason. Proceeding to `code-review` for the Standards +
Spec axes on the code that does exist; C2 remains open for the user to complete (or explicitly accept
as out of scope for this branch) before `finishing-a-development-branch`.

## Next step

`code-review`, covering the full branch diff since `main` along the Standards and Spec axes.
