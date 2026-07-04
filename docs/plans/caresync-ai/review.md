# Code Review — CareSync AI, S3 (Four-agent orchestration + FHIR Task creation)

> **PLAN_ID:** `caresync-ai` · **Slice:** S3 · **Date:** 2026-07-05
> **Fixed point:** `feature/caresync-s2-single-agent-analysis` (merge-base `344157a`) → `HEAD` (`a7bc0e3`),
> plus the uncommitted working-tree changes on top (`git diff` — the D2 E2E-test extension in
> `apps/web/e2e/patient-analysis.spec.ts` and a `data-testid` addition in `apps/web/src/pages/PatientDetail.tsx`).
> `git diff feature/caresync-s2-single-agent-analysis...HEAD` + `git status`/`git diff` for the working tree.
> Commits reviewed: `be3510c..a7bc0e3` (13 commits). Prior S2 review preserved at `review-s2.md`.

Two axes reviewed in parallel, independently, per the repo's `code-review` skill. Not merged or reranked —
see that skill's "why two axes" note. Extra scrutiny was directed at the code that landed **after** the
documented E1/E2 post-review fixes (B1 orchestrator, B2 Task write/replace, B3 route wiring, C1/C2 four-feed
frontend) and at this session's own not-yet-reviewed D2 additions. The two already-fixed issues (streamed
narration misattribution; three-of-four-feeds-never-visibly-streamed) were confirmed genuinely fixed and are
not re-litigated.

## Standards

**No HARD violations of documented standards found.** CLAUDE.md's Code-style section is unfilled placeholders,
so the standards in force are its UI-fidelity/verification/evidence rules plus the conventions established in
S1/S2 code. Against those:

**Conventions correctly followed (not findings).** The two S2 hard duplications stayed fixed — `PatientBundle`
is now imported once from `fhir/client.ts` by every agent and the route; `AgentFlag` lives once in
`citationValidator.ts` and is re-used via `agent.ts`. New FHIR-client additions (`ActionPlannerTaskInput`,
`CreatedTask`, `PanelEntry`) are exported named interfaces — matches the file's convention. Default-param DI is
applied consistently (`orchestrate(bundle, agents = DEFAULT_AGENTS)`, `runAnalysis = orchestrate`,
`client = getOpenAiClient()`). The shared discriminated `AgentEvent` union in `agent.ts` is clean. The
agent-graph-canvas UI-fidelity deviation is explicitly recorded at `PatientDetail.tsx:267-270`, satisfying
CLAUDE.md's "record intentional deviations" rule.

Everything below is a JUDGEMENT CALL (baseline smell). A documented repo standard would override any of these;
none does.

1. **Duplicated Code / Shotgun Surgery (largest).** The lazy-client block
   (`let cachedClient…; function getOpenAiClient() { if (!cachedClient) cachedClient = new OpenAI(); … }`) is
   copy-pasted verbatim across all four agents, as is the stream-drain loop
   (`for await (const event of stream as any) { … output_text.delta / response.completed … }` → `if (!toolCall) throw`
   → `JSON.parse(toolCall.arguments)`), differing only in `agentId`/tool name, and `buildPrompt`'s `resourceLines`
   line (3×). Since `agent.ts` was created as the shared-contract home, a `runToolAgent(client, input, tool, agentId)`
   helper belongs there. Today a change to OpenAI event handling is a 4-file edit.

2. **Speculative Generality / dead export + re-declared types.** `agent.ts:64` exports
   `export type Agent = (bundle: PatientBundle) => AsyncIterable<AgentEvent>` — never imported anywhere.
   `orchestrator.ts:8` re-declares the same shape as `BundleAgent`; `analysis.ts:8` re-declares it as `RunAnalysis`.
   Delete `Agent` or use it in both places.

3. **Primitive Obsession (propagated from S2, now 3 more sites).** `resources: any[]`, `stream as any`, `(item: any)`
   now appear in careGap/sdoh/actionPlanner too — the same judgement call the S2 review accepted, just wider.

4. **Primitive Obsession — frontend finding type.** `AnalysisFinding` (`client.ts:65-76`) is a bag of 8 optionals
   plus `[key: string]: unknown`, discarding the backend's clean discriminated union. A per-`agentId` union would
   restore the type-narrowing that `AgentEvent` already models server-side.

5. **Repeated Switches (mild, inherent).** The `agentId` set is switched on in the orchestrator (78-80), the analysis
   route (82-116), and PatientDetail (`FEED_DEFS`/`SUMMARY_TESTID`). Design-inherent; noted for awareness, not action.

**D2 working-tree changes** are test-only plus one `data-testid={task.key}` addition — clean, and the new
per-summary testids resolve the S2 "lone testid" inconsistency note.

## Spec

Reviewed against `issues.md` S3 (6 ACs), `implementation-plan.md` Iteration 3, GD11 (citation enforcement), and
the seed data. **Overall the six ACs are substantively met:** the orchestrator truly interleaves
risk/careGap/sdoh (`orchestrate`, race-merged `.next()` promises) then runs Action Planner over their collected
outputs; Tasks persist via `replacePatientTasks`; GD11 holds on all four agents' structured citations **and**
narration (per-`agentId` `NarrationBuffer` flushed on each `result`, including `actionPlanner`); the replace is
correctly scoped to `CARESYNC_TASK_TAG` so seed/Synthea Tasks are never deleted; and a Task whose citations all
drop is excluded from `valid` and never reaches HAPI. E1/E2 are genuinely fixed. No scope creep found.

### (c) Implemented but WRONG — agent prompts contradict corrected AC #4  *[CONFIRMED, verified against source]*
AC #4 (revised in `a7bc0e3`): *"SDOH agent reads the AHC-HRSN screening (seeded as an `Observation`, not a
`QuestionnaireResponse`); Care Gap reads Condition/Encounter/Observation (no `CarePlan` resource is seeded)."*
Seed data confirms this: `import-fhir.ts` emits the AHC-HRSN as a LOINC-coded (`71802-3`) `Observation`; no
`QuestionnaireResponse` and no `CarePlan` is seeded anywhere.

But the **agent prompts still use the old resource model**:
- `sdohAgent.ts:79` — "Focus on the AHC-HRSN **QuestionnaireResponse**…" and `:84` — "Barriers drawn from the
  AHC-HRSN screening **must cite that QuestionnaireResponse id**." Since no QuestionnaireResponse exists in the
  bundle, this instruction steers the model toward a citation the GD11 validator will drop — risking loss of the
  housing/food SDOH barrier, which is the SDOH agent's entire purpose. It only survived the D3 live run because
  the model overrode its own instructions.
- `careGapAgent.ts:73` — "Focus on **CarePlan**, Condition, Encounter, and Observation…" names a resource type
  that isn't seeded (lower impact; the other three exist).

This is also a **documentation-vs-code drift**: `verification.md` §2 #4 claims `sdohAgent.ts`/`careGapAgent.ts`
were "revised 2026-07-05 … not the original `QuestionnaireResponse`/`CarePlan` wording." The code was **not**
revised — the prompts still say exactly that. Recommend correcting both prompts to the seeded Observation model
and correcting the verification.md claim.

### (a) PARTIAL — Task citations not durable across reload
AC #3: *"Each Task card cites the FHIR resource(s) behind it."* Citations ride only the SSE `task` payload;
`createTask` deliberately does not persist `fhirResources` onto the FHIR Task (documented at `client.ts:220-234`).
On page reload, `getTasks` returns cards **without** citation chips. Acceptable-for-POC and documented, but the AC
is met only at creation time, not on reload.

### Minor
AC #1 says "all four agents run in parallel." Action Planner is necessarily downstream (it synthesizes the other
three) — consistent with the PRD contract; only the three bundle agents are truly concurrent. Wording, not a defect.

### (b) Scope creep
None — the diff stays within S3.

## Summary / outcome

- **Standards:** 0 hard violations, 5 judgement calls. Worst: the 4×-duplicated OpenAI client/stream-drain block
  (Duplicated Code / Shotgun Surgery) — a `runToolAgent` helper in `agent.ts` would collapse it.
- **Spec:** 3 findings (1 wrong, 1 partial, 1 wording). Worst: the SDOH/Care Gap prompts still cite
  `QuestionnaireResponse`/`CarePlan` — resource types that don't exist in the seed — directly contradicting the
  corrected AC #4 and the verification.md claim that the prompts were revised.

**Fix before this branch ships:**
- **Spec (c) — SDOH/Care Gap prompt drift.** Change `sdohAgent.ts:79,84` from "QuestionnaireResponse" to the
  AHC-HRSN `Observation`, and drop "CarePlan" from `careGapAgent.ts:73`. Low-effort, and it removes a live risk of
  the SDOH barrier's citation being validator-dropped. Also correct the false "revised 2026-07-05" claim in
  `verification.md` §2 #4 (a small doc edit) so the verification record matches the code.

**Minor / deferrable (follow-up, not ship-blocking):**
- Standards #1 (4× OpenAI-client/stream-drain duplication) — worth a `runToolAgent` refactor before S4/S5 add more
  agents, but the code is correct as-is.
- Standards #2 (dead `Agent` export + `BundleAgent`/`RunAnalysis` re-declares) — trivial cleanup.
- Standards #3/#4 (`any` typing; loose frontend `AnalysisFinding`) — tighten once the OpenAI SDK's stream unions
  are confirmed usable; carried over from S2.
- Spec (a) (Task citations not durable on reload) — already documented as an accepted POC limitation; revisit if a
  persisted-citation requirement appears (candidate for the S4 analysis-cache work, which stores Task payloads).
- Spec "minor" AC #1 wording — no code change; note in issues.md if desired.

No defect blocks the four-agent orchestration, Task write/replace, or GD11 enforcement paths — those are sound.
The single recommended pre-ship fix is the prompt/verification drift, which is cheap and reduces a real
citation-drop risk.

## Post-review fix — done 2026-07-05

**Spec (c) fixed.** `sdohAgent.ts:79,84` now says "the AHC-HRSN screening … seeded as an Observation" /
"must cite that Observation id" (was "QuestionnaireResponse"); `careGapAgent.ts:73` now lists only
"Condition, Encounter, and Observation" (dropped "CarePlan"). Both prompts now match the AC #4-corrected
data model, closing the citation-drop risk the review flagged.

Verified, not just edited: `npx jest sdohAgent careGapAgent` — 2 suites / 6 tests still passing (mocked-client
tests were unaffected, as expected — they exercise parse/validation logic, not prompt text). Then re-ran a full
live orchestrated call against Maria Chen (same method as D3) to confirm the corrected prompt still produces
good output: all four agents completed with **0 dropped citations** (risk 9, careGap 9, sdoh 2, actionPlanner
10 findings), and the SDOH agent correctly cited `Observation/maria-chen-sdoh` twice — the real seeded resource,
not the fabricated `QuestionnaireResponse` type the old prompt asked for.

The `verification.md` §2 #4 false "revised 2026-07-05" claim (this review's other finding under Spec (c)) is
also corrected — see that file.

**Remaining minor/deferrable items are unchanged and not addressed in this pass** — user can decide priority/timing.
