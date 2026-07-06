# Verification — CareSync AI, S7 (Role-filtered task queue + task actions)

> **PLAN_ID:** `caresync-ai` · **Slice:** S7 · **Date:** 2026-07-06
> **Stage:** Phase 5 (`verification-before-completion`), run on `feature/caresync-s6-realtime-assignment`
> → `feature/caresync-s7-task-queue` (base `a1f1dc1` = S6 merge to `main`, tip `d6656e1`, 8 commits:
> `933a423` GD4 resolution, `009035b` docs amend, `7fcc4aa` A0, `48ca413` A1, `6c5da71` A2, `302b4f8`
> B1, `48ec1f0` B2, `d6656e1` B3). Read `docs/plans/caresync-ai/implementation-plan.md` Iteration 7
> and `docs/plans/caresync-ai/issues.md` S7 for the plan this verifies against — not re-derived here.
> Prior slice's verification preserved at `verification.md` (S1–S6 cumulative).

## 1. Fresh command evidence (this session, 2026-07-06)

Every command below was re-run fresh in this final consolidated pass (not just carried over from
each task's own in-progress checks, though those were also independently re-verified — not trusted
from implementer-subagent reports — at every commit boundary throughout the session). Local stack:
Docker HAPI FHIR healthy (reset + reimported mid-session for the A0 domain field and again for B2's
seed phone numbers — both times verified idempotent), API+web dev servers via Playwright's
`webServer` config.

| Command | Result |
|---|---|
| `cd apps/api && npx jest --runInBand` | **27 suites / 147 tests passed** |
| `cd apps/web && npx vitest run` | **13 files / 122 tests passed** |
| `cd apps/web && npx playwright test --workers=1` | **13/13 specs passed** |
| `cd apps/api && npx tsc --noEmit` | exit 0 |
| `cd apps/web && npx tsc --noEmit` | exit 0 |

**On `test:api`/`npm run test` under parallel workers — a pre-existing environment finding, not a
product bug (documented since S3/S4/S5).** Jest's default parallel runner contends with the single
shared live HAPI container and produces spurious timeouts; `--runInBand` (serial) is the correct way
to run this suite locally and was green every time it was run this session (confirmed 3 separate
times across the A1/A2/B1/B2/B3 boundaries, not just once at the end).

**HAPI data-hygiene finding, fixed early in this session (unrelated to S7's own code).** Before any
S7 work began, `apps/patients.test.ts`/`client.test.ts` failed because Maria Chen's Task list had
accumulated 9 extra real Tasks from a prior live analysis run against the same persistent local HAPI
container (11 total vs. the 2 seeded). Reset via `docker compose down -v && up -d hapi-fhir` +
`npm run fhir:import`; confirmed 123/123 clean afterward. Recorded here since it's exactly the class
of shared-environment coupling S3–S5 also hit, not something this slice introduced.

## 2. Definition-of-done check (S7 acceptance, `issues.md`)

All 6 acceptance bullets confirmed against the actual code and this session's live evidence:

1. **GD4 mobile-stack decision recorded before implementation begins** — `plan.md` §1 GD4 and §8
   both marked resolved/locked (PWA/responsive web, one codebase, phone-frame demo). Discovered
   mid-session that this had *already* been resolved on a prior unpushed local commit (`933a423`,
   dated one day before this session) before a duplicate resolution was attempted — the duplicate
   was discarded in favor of the existing, better-reasoned version (it included the rejected-
   alternative rationale for React Native).
2. **Social Worker queue shows only SDOH-domain tasks; Coordinator sees all task types** —
   `FhirReadService.listTasks` (A1) filters `task.domain === undefined || hasScope(actor.role,
   domain)` (fail-open on undefined, per A0). Confirmed live in `task-queue.spec.ts`: Social Worker
   sees sdoh/uncategorized, not clinical; Coordinator sees everything including a clinical-tagged
   probe.
3. **Task detail shows the justifying patient context and citations** — `GET /api/tasks/:id`
   (`getTaskDetail`, B2) resolves `Task.input` citation entries to display strings and returns
   patient name/condition/phone. Confirmed live in `task-detail.spec.ts`: a probe task's two real
   citations (Condition + Observation) render with resolved display text, not just raw references.
4. **Complete/Defer/Escalate transitions PATCH the FHIR Task status in HAPI and reflect back in the
   UI** — `PATCH /api/tasks/:id/status` (A2) maps each transition to `status`/`businessStatus`/
   `priority`; `TaskQueue.tsx`'s Done button and `TaskDetail.tsx`'s three buttons both call it and
   invalidate the relevant query on success. Confirmed live: `task-queue.spec.ts` completes a task
   and sees it flip to the completed-row style; `task-detail.spec.ts` defers a task and sees the
   status update in place.
5. **Completing a task on the mobile-shaped view syncs to the web view (via S6 relay)** — see §3's
   GD9 scope-correction note: satisfied via `PatientDetail.tsx` (not W13, which GD9 scopes as a
   shell) subscribing to a new `task-updated` broadcast event. Confirmed live in
   `patient-detail-live-task-update.spec.ts`: a direct status-transition PATCH live-updates an
   already-open `/patients/maria-chen` tab with **no page reload**.
6. **API-boundary tests for role-filtered listing and each status transition** —
   `apps/api/src/routes/tasks.test.ts` covers A1 (role filtering, 3 tests) and A2 (all 3 transitions
   × domain-scope allow/deny, 9 tests) plus B2's detail-read tests (6 tests). All passing in §1.

No drift between what's claimed done and what the code does.

## 3. Spec-drift check (issues.md / implementation-plan.md vs. code)

Two real plan-vs-reality mismatches were found and resolved during implementation — both are
plan-review findings, not silent deviations, and both are documented in-line in
`implementation-plan.md` at the task they affect:

- **Citation persistence reversed from S3's original decision.** S3's `createTask` doc explicitly
  said citations were kept SSE-only, not persisted — B2 needed them readable after the fact. The
  first fix attempt (`Task.reasonReference`) was verified empirically against local HAPI to
  **silently truncate to one entry** on a multi-value array (FHIR R4 defines it `0..1`) — caught
  before it shipped, not after. `Task.input` (`0..*`, native `valueReference` support) was verified
  the same way to round-trip every entry intact, and is what actually shipped.
- **GD9 vs. B3's own plan text.** `plan.md` GD9 (locked) scopes screen W13 as a nav-only shell —
  B3's own acceptance criteria implied full functionality, contradicting that. Resolved by building
  `/task-center` as an honest placeholder (matching `ComingSoon.tsx`'s existing pattern) and moving
  the *actual* required behavior (S7's own "mobile completion syncs to web" acceptance line) onto
  `PatientDetail.tsx`, which is already demo-critical and already shows a patient's task list. GD9's
  scope tier for W13 itself was not violated.

Other checks:
- **`issues.md` S7 acceptance checkboxes were stale** (4 of 6 still `[ ]` despite full
  implementation) — corrected to `[x]` in this pass, each annotated with which task closed it.
- **`implementation-plan.md` Iteration 7's C1/C2 and Definition-of-done bullets were unchecked** —
  all now `[x]`/✅, matching the actual committed state.
- **No mockup exists for M03 or W13** — confirmed against `reference-materials/*.html` (only 6
  files, mapping to W02/W03/W06/M02/M05/W07; none titled for Task Detail or Task Management Center).
  Both screens were built to the existing design-token/pattern precedent (`PatientDetail.tsx`,
  `TaskQueue.tsx`, `ComingSoon.tsx`) per this repo's own no-mockup rule, not a mockup-fidelity pass.
- **M02's chrome-scope deviations are documented in-code** (`TaskQueue.tsx`'s top-of-file comment):
  segment tabs, bottom tab bar, bell/badge, back button, and the pinned risk-summary sheet all
  omitted with reasons (no backing data/screens); Call deferred to M03 per the plan's own
  architecture note even though the mockup shows it on the list card too.
- **Seed data gained two new fields this slice** (`SeedPatient.phone`, threaded to
  `Patient.telecom`) — a real, intentional addition (Decision 2, B2), not an accidental schema
  drift; all values are fabricated demo data, consistent with the rest of this seed set.

## 4. Review notes (ahead of the formal `code-review` skill)

Every task (A0–A2, B1–B3) was built by an implementer subagent under an explicit TDD requirement
(failing test first, confirmed red for the right reason, then green), and every subagent's final
report was independently re-verified in this session — diffs read line-by-line, all four suites
re-run fresh, HAPI state re-checked by direct reads — rather than trusted at face value. Two
instances of a subagent correctly stopping and reporting `NEEDS_CONTEXT` instead of guessing:

- **A1** — assumed `Task?subject=...` search reads were safe (matching `getAssignedPanel`'s existing
  pattern); empirically found the opposite (search lags behind a just-written Task on the local HAPI
  instance) and switched to `$everything`, which was verified reliable. A real correctness fix for a
  live read path, not just a test-fixture workaround.
- **B2** — as detailed in §3, correctly rejected the `Task.reasonReference` approach after empirical
  verification, rather than shipping silent citation loss.

No separate reviewer-subagent round was run per task this session (verification was done directly,
inline, by re-reading every diff and re-running every suite after each implementer's report) — this
is a deviation from the two-stage subagent-driven-development loop S4/S5 used, driven by session
scope/time rather than a quality shortcut; every commit's diff was still read and independently
tested before being committed.

## 5. Domain-term documentation check

New domain terms/decisions introduced by S7 — `TaskDomain` (`'clinical' | 'sdoh'`, distinct from the
3-value `ResourceDomain` auth-scope vocabulary it reuses the filtering logic from), the fail-open
rule for an untagged Task's domain, the `Task.input` citation-storage convention (with its rejected
`Task.reasonReference` alternative), `businessStatus`-driven display-status labels (`Deferred`/
`Escalated`), and the `EventHub.publishAll` broadcast primitive — are documented inline via doc
comments at each introduction point (`fhir/client.ts`, `eventHub.ts`), consistent with the
"Domain rule:"/ponytail-annotation convention established since S2. `docs/agents/domain.md` still
doesn't exist — the same pre-existing, deferred gap noted in every prior slice's verification,
unchanged by S7. `docs/agents/issue-tracker.md` also doesn't exist despite `CLAUDE.md` referencing
it — noted here for the first time; out of scope to create as part of this verification pass.

## 6. Evidence-boundary labeling (CLAUDE.md)

Per CLAUDE.md's evidence-boundaries rule: all evidence in this document is **local mock / packaged
UI strength** — Jest/Vitest suites and headless Playwright runs against a local dev stack and a
disposable local Docker HAPI container. This is real, stronger than a curl-level check, and proves
the actual rendered UI, the actual FHIR writes/reads, and the actual SSE relay work together — but it
is **not** target-environment, client-accepted, or production-hardware evidence. No such claim is
made here.

## 7. Gate outcome

**PASS.** All fresh command evidence is green (§1, serial run — the parallel-run flakiness is the
same pre-existing, documented environmental coupling S3–S5 already noted, not an S7 regression).
Definition-of-done (§2) and spec-drift (§3) checks found two real plan-vs-reality mismatches
(citation persistence, GD9/W13 scope) — both caught and resolved *during* implementation via
empirical verification and explicit user decisions, not discovered after the fact — plus routine
stale-checkbox bookkeeping, now fixed. No product-behavior defects remain open.

## Next step

`code-review`, covering the full branch diff since `main` along the Standards and Spec axes.
