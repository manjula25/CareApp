# Code Review — CareSync AI, S6 (Task assignment + real-time FHIR Subscription)

> **PLAN_ID:** `caresync-ai` · **Slice:** S6 · **Date:** 2026-07-05
> **Fixed point:** `1c8c612` (last S5 commit, = `feature/caresync-s5-population-dashboard` tip) →
> `HEAD` (`a281628`), fully committed. This branch is cumulative off the previous slice, not off
> `main`. Two-axis review (Standards + Spec) run as parallel sub-agents over
> `git diff feature/caresync-s5-population-dashboard...HEAD` (23 files, +1419/−168).
>
> Spec sources: `implementation-plan.md` Iteration 6 (tasks A1, A2, A3, B1, C1, C2), `issues.md` S6
> acceptance criteria. Standards sources: none documented (no `CODING_STANDARDS.md`/`CONTRIBUTING.md`)
> — the **smell-baseline-only** path applies; every Standards finding is a judgement call.
> Prior slice's review preserved at `review-s5.md`.
>
> Read `docs/plans/caresync-ai/verification.md` first — this review runs on top of a PASS
> verification gate (119 API tests, 116 web tests, 9/9 E2E incl. the live Subscription spec, tsc +
> lint clean); that doc has the test-evidence tables this review doesn't repeat.
>
> Commits reviewed:
> - `d75645e` feat(S6): task assignment + real-time FHIR Subscription relay
> - `a281628` docs(S6): verification-before-completion artifacts + checkbox closeout

## Standards

No documented coding-standards files exist in this repo, so there are **no hard violations**. Every
item below is a judgement call against the Fowler smell baseline. Tooling-enforced concerns
(formatting, `tsc`, lint) are skipped. The diff is unusually well-documented and mostly clean;
findings are minor.

**Duplicated Code (the one worth acting on) — `apps/web/src/api/client.ts`.**
`subscribeToEvents`'s SSE frame parser is a near-verbatim copy of the loop already in `streamAnalysis`
(same file): same `getReader()` / `TextDecoder` / `buffer.indexOf('\n\n')` split and the same
`event: ` / `data: ` prefix parsing. Two copies of an identical SSE-decoding shape. Possible
Duplicated Code → extract a shared `readSseFrames(res, onFrame)` helper both callers use. Most
concrete finding.

**Primitive Obsession / weak typing — `apps/api/src/fhir/client.ts`.** `mapTaskResource(task: any)`
and `assignTask`'s `task.owner = {...}` on an untyped raw resource lean on `any`/untyped access.
Possible Primitive Obsession (a raw FHIR Task deserves a minimal typed shape). Worth a note because
`any` sidesteps `tsc` rather than being caught by it.

**Message Chains (mild) — `mapTaskResource`.** `task.for?.reference?.split('/')[1]` and
`task.owner?.identifier?.value` are short navigation chains into an untyped resource. Borderline;
acceptable given optional-chaining guards. Not worth changing on its own.

**Considered and cleared.**
- `DirectorOnlyError` consolidation (`population/service.ts` → re-export from `fhir/client.ts`) is the
  *opposite* of Shotgun Surgery — it removes a parallel duplicate class into one home. Good move; the
  added `action` constructor param keeps both call sites expressive.
- `routes/tasks.ts` is a thin HTTP shell over `assignTask`, but that matches every other route file's
  parse → service → map-error shape. Consistent, not Middle Man.
- `eventHub.ts` (`Map<userId, Response[]>` register/unregister/publish) is cohesive, single-purpose,
  no Speculative Generality — scope is exactly the POC's need.
- Feature Envy / Data Clumps / Repeated Switches / Refused Bequest — none spotted. Tests mirror
  production shapes; no notable smells beyond the same SSE-parsing idiom.

**Bottom line:** clean diff. One actionable judgement call (shared SSE-frame helper), one minor
typing note (`any` on the raw FHIR Task). Everything else is intentional consolidation or consistent
with existing conventions.

## Spec

All four acceptance criteria and all plan tasks (A1, A2, A3, B1, C1, C2) are implemented, and the
four documented deviations (logical `owner.identifier`, `PUT {endpoint}/Task/{id}` route match,
client-side toast de-dupe, in-process hub) match the code exactly.

**(a) Missing / partial.**
- **"the Coordinator's queue updates live"** (`issues.md` S6). The only live-data mechanism is
  `queryClient.invalidateQueries({ queryKey: ['assigned-panel'] })` (`AppShell.tsx`). But `PanelEntry`
  carries no owner field, and `getAssignedPanel` reads a fixed `Group/coordinator-demo-panel` —
  assigning `Task.owner` changes nothing the panel renders (`taskCount` counts a patient's tasks, not
  the coordinator's owned tasks). So the refetch is visually a no-op; the *only* observable live
  change is the toast. This is consistent with the plan's scope note ("no M02 queue yet… notification
  is a toast"), so it is **PARTIAL-by-design**, not a defect — but note that "queue updates live" is
  satisfied by the toast, not by any queue/panel content change.

**(b) Scope creep.** None. The two out-of-slice edits are justified, documented refactors: exporting
`writeSseEvent` (`analysis.ts`, explicitly for A3 reuse per the plan) and hoisting `DirectorOnlyError`
into `client.ts` with a re-export shim in `population/service.ts` (no behaviour change; A1 reuses it).

**(c) Wrong / logic concerns.** None found. Verified concretely:
- `assignTask` is Director-gated with a denial audit before the read, does read-modify-PUT preserving
  the full resource, and writes a success audit — matches A1's test (owner round-trip + audit row).
- Webhook relay routes to `task.owner.identifier.value` (= the app `users.id`); `AppShell` registers
  the SSE connection under `user.id` and only for the `coordinator` role — the two key spaces are
  consistent (confirmed via the E2E's `decodeUserId`).
- SSE framing matches on both ends (server writes `event: x\ndata: {json}\n\n`; client parses on
  `\n\n` split); non-`assignment` events (`connected`) are ignored.
- Subscription criteria `'Task?'` (bare `Task` is rejected as HAPI-0014) with
  `payload: 'application/fhir+json'`; idempotency dedupes on criteria + endpoint. Sound.
- Tests cover both required cases: API-boundary assignment (real HAPI) and the webhook→relay
  integration path (both PUT-suffix and bare-POST shapes, plus a no-owner no-op).

**Net:** faithful to spec; the one caveat is that "queue updates live" reduces to a toast, as the
plan itself acknowledges.

---

**Summary.** Standards axis: 2 findings, all judgement calls (no documented standards to violate);
worst is the duplicated SSE-frame parser between `subscribeToEvents` and `streamAnalysis` — extract a
shared helper. Spec axis: 1 finding; worst (and only) is that "the Coordinator's queue updates live"
is satisfied by the toast alone — the `assigned-panel` invalidation is a visual no-op given the
current panel shape — which the plan's own scope note already discloses (no defect). No blocking
issues on either axis; the branch is shippable.
