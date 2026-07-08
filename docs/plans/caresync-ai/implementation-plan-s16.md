# Implementation Plan — S16: Risk Calibration v2 (Rubric Redesign + LLM-Variance Investigation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **PLAN_ID:** `caresync-ai` · **Slice:** S16 · **Date:** 2026-07-09
> **Status:** Ready for implementation (post-grill + post-PRD; awaiting user approval)
> **Specs (in dependency order):** `docs/plans/caresync-ai/grill-risk-calibration-v2.md` (7-question grill, S16 framing), `docs/plans/caresync-ai/prd-s16.md` (PRD D1–D11), `docs/plans/caresync-ai/design-risk-calibration-v2.md` (forward-looking design + S13 failure-mode map), `docs/plans/caresync-ai/verification-s13.md §4 + §6` (pre-pin vs post-revert specificity numbers + open follow-ups), `docs/plans/caresync-ai/design-risk-calibration.md` (S13's reverted rubric — audit-trail pattern this slice mirrors), `apps/api/src/agents/riskAgent.ts:11,85-100` (commit 3's targets), `apps/api/src/agents/{careGap,sdoh,actionPlanner}Agent.ts` (commit 2's targets), `apps/api/src/eval/labelFromBundle.ts` (S15's held-out label function — feeds the 2x2 gate's held-out arm), `apps/api/src/scripts/eval.ts` (the existing eval harness — runs as-is for the 2x2 gate; no flag changes).

**Goal:** Close sub-gap 3 of the HL7 evaluation's biggest-risk decomposition — the Risk agent's 9-FP rate — in a single 3-commit PR: (1) docs [DONE at 193dcdb], (2) temperature + seed pin across all 4 agents + varianceProbe.ts, (3) risk rubric v2 (few-shot examples + 0-anchors rule). 2x2 acceptance gate (dev-labeled + held-out, specificity + sensitivity) is the merge gate for commit 3.

**Architecture:** 1 new module (`eval/varianceProbe.ts`); 1 new artifact (`docs/plans/caresync-ai/design-risk-calibration-v2.md` — already in commit 1); 4 modified `*Agent.ts` files for the temperature + seed pin; 1 modified `riskAgent.ts` for the prompt rewrite; 4 corresponding `*.test.ts` files for TDD pins. TDD where applicable (commits 2 and 3); data-driven for the planning commit. The 3 commits are independently revertable — same discipline as S13b / S14 / S15.

**Tech Stack delta:** no new external dependencies. Same Jest + tsx stack. The OpenAI SDK already accepts `temperature` and `seed` as request params — no SDK upgrade needed.

**Ponytail pass applied:** minimum new seams (1 new module, no flags); the temperature + seed pin is a 2-line addition to 4 existing `client.responses.create(...)` calls (no new function or module); `varianceProbe.ts` follows the existing `eval/` pure-function + I/O-script pattern (peer to `labelFromBundle.ts` and `outreachSchema.ts`); no `--rubric` flag in `eval.ts` (2x2 baseline is the audit trail, not a runtime comparison); no feature flag in the agents themselves (per `prd-s16.md D5` — the 2x2 acceptance gate is the merge gate); no pre-pin probe run (the baseline is `verification-s13.md §4`, already documented); no model-snapshot ID hunt (per grill §4 — uncertain, defer until temperature+seed proves insufficient); no cross-agent rubric work (per grill §8 — only Risk gets the v2 rubric); no in-app review queue.

**Domain source:** `apps/api/src/agents/riskAgent.ts:11` (`MODEL = 'gpt-5.5'`, no temperature/seed in the call today), `apps/api/src/agents/riskAgent.ts:85-100` (current 1-paragraph `buildPrompt` — commit 3's rewrite target), `apps/api/src/agents/{careGap,sdoh,actionPlanner}Agent.ts` (the other 3 agents that share the temperature/seed pin), `apps/api/src/agents/riskAgent.test.ts` (existing TDD surface — 2 regression-guard tests + 2 S13-era rubric-pins tests + the `params.model === 'gpt-5.5'` test that the new temperature/seed tests follow), `apps/api/src/fhir-data/seed-patients.ts` + `apps/api/src/fhir-data/population.ts:127-134` (the seed-text patterns the v2 rubric's worked examples must mirror), `apps/api/src/eval/labelFromBundle.ts` (S15's held-out label function — feeds the 2x2 gate's held-out arm), `apps/api/src/scripts/eval.ts` (the eval harness — runs as-is for the 2x2 gate).

**Project memory reference:** `never-override-real-with-fake.md` — the temperature + seed pin lands on the real `client.responses.create(...)` call, never on the `MOCK_*_OUTPUT` fallback. `varianceProbe.ts` runs the real LLM, aborts when `OPENAI_API_KEY` is unset.

**Branch state (per skill warning):** implementation is on `feature/s16-risk-calibration-v2` (off `main` at `feca132`); commit 1 already pushed at `193dcdb`. Implementation of commits 2 and 3 below assumes a clean working tree on the S16 branch.

---

## Commit 1 — `docs(S16): grill + PRD + design-risk-calibration-v2` ✅ DONE at 193dcdb

**Goal:** Establish the S16 audit trail before any code lands. After this commit, the 3 planning artifacts are committed and the S16 design rationale is preserved.

**Architecture:** 3 new docs (`grill-risk-calibration-v2.md`, `prd-s16.md`, `design-risk-calibration-v2.md`) under `docs/plans/caresync-ai/`. No code/test changes.

**Spec:** `grill-risk-calibration-v2.md` (the grill — captures rejected alternatives + their reasoning) + `prd-s16.md` (the formal PRD) + `design-risk-calibration-v2.md` (mirrors S13's design-risk-calibration.md pattern).

**Status:** Already pushed. No further work in this commit.

---

## Commit 2 — `feat(S16): temperature + seed pin (all 4 agents) + varianceProbe.ts`

**Goal:** Collapse the LLM-side variance window across all 4 agents via `temperature: 0` + `seed: 42`; add a `varianceProbe.ts` that runs the dev-labeled 16 patients through the real LLM N=3 times and emits a per-patient `riskLevel` agreement matrix. After this commit, the pre-pin vs post-pin agreement numbers are captured; commit 3 builds the v2 rubric on the now-stable substrate.

**Architecture:** 2-line addition to `client.responses.create(...)` in 4 `*Agent.ts` files (temperature + seed spread into the call's params). 2 new TDD pins per file (8 total across the 4 `*Agent.test.ts` files). 1 new module `apps/api/src/eval/varianceProbe.ts` (script that runs the real LLM, emits a markdown agreement matrix; aborts when `OPENAI_API_KEY` is unset). 1 new TDD test file `apps/api/src/eval/varianceProbe.test.ts` (agreement math + LLM-required behavior + error path). The pin lands on the real call — never on the `MOCK_*_OUTPUT` fallback (per project memory `never-override-real-with-fake.md`).

**Spec:** `prd-s16.md` D2 + D3 + D8 (commit 2 of S16's 3-commit decomposition) + `design-risk-calibration-v2.md` §"Decisions D4" + grill §4.

### Phase A — TDD red for the Risk agent's new SDK params

- [ ] **A1. Read `apps/api/src/agents/riskAgent.test.ts`** and locate the existing `'calls the client with gpt-5.5, streaming, and a report_risk tool'` test (around line 106). Note how it asserts `params.model === 'gpt-5.5'` and `params.stream === true` and `params.tools` shape.
  - *Verify:* the test is the one that uses `jest.fn().mockResolvedValue(fakeStream(...))` and asserts `createFn.mock.calls[0][0].model`.

- [ ] **A2. Add 2 new tests to `riskAgent.test.ts`** (RED — they should fail because the current code doesn't pass `temperature` or `seed`):
  - `it('calls the client with temperature: 0 (S16 commit 2 — variance pin)', ...)` — assert `params.temperature === 0`.
  - `it('calls the client with seed: 42 (S16 commit 2 — variance pin)', ...)` — assert `params.seed === 42`.
  - Each test reuses the existing `fakeStream` pattern from the file (no new fixtures needed).
  - *Verify:* `cd apps/api && npx jest src/agents/riskAgent.test.ts -t "variance pin"` → 2 new tests FAIL; the existing 7 tests still pass.

### Phase B — GREEN for the Risk agent

- [ ] **B1. Read `apps/api/src/agents/riskAgent.ts:146-151`** (the `client.responses.create(...)` call). Confirm the current shape: `{ model: MODEL, input: buildPrompt(bundle), tools: [REPORT_RISK_TOOL], stream: true }`.

- [ ] **B2. Add `temperature: 0` and `seed: 42`** to the call's params (commit 2's only change to `riskAgent.ts`):
  ```ts
  const stream = await client.responses.create({
    model: MODEL,
    input: buildPrompt(bundle),
    tools: [REPORT_RISK_TOOL],
    stream: true,
    temperature: 0,
    seed: 42,
  });
  ```
  - *Ponytail:* do not extract a shared `callParams` constant — the 4 agents have different `tools` and `input` shapes; the 2-line addition is the laziest fix. If a 5th agent is added later, the pattern is "spread the same 2 lines into that agent's call."
  - *Verify:* `cd apps/api && npx jest src/agents/riskAgent.test.ts` → 9/9 tests pass (7 existing + 2 new).

- [ ] **B3. Do NOT touch the `streamMockRisk` function** at `riskAgent.ts:110-120`. The `MOCK_RISK_OUTPUT` fallback stays as-is (per project memory `never-override-real-with-fake.md`); the pin is for the real call only.
  - *Verify:* `grep -n "MOCK_RISK_OUTPUT\|streamMockRisk" apps/api/src/agents/riskAgent.ts` returns the same lines as before (unchanged).

### Phase C — Repeat A+B for the other 3 agents

- [ ] **C1.** Mirror A+B for `careGapAgent.ts`, `sdohAgent.ts`, `actionPlannerAgent.ts` — 2 TDD tests + 2-line `client.responses.create(...)` addition in each. Do not touch any `MOCK_*_OUTPUT` fallback.
  - *Verify:* `cd apps/api && npx tsc --noEmit` clean; `npx jest src/agents/` all green.

### Phase D — TDD red for `varianceProbe.ts`

- [ ] **D1. Read `apps/api/src/eval/labelFromBundle.test.ts`** to see the existing TDD pattern for `eval/` pure-function + I/O-script tests (fixture bundles, no HAPI I/O, no LLM). `varianceProbe.test.ts` follows the same pattern but uses a fake LLM client (like `riskAgent.test.ts:fakeStream`).

- [ ] **D2. Create `apps/api/src/eval/varianceProbe.test.ts`** with 3 test cases FIRST (RED — module doesn't exist yet):
  - **Test 1 (agreement math):** Given a fake LLM client that returns `riskLevel: 'critical'` for all 3 runs of patient A and `[critical, low, critical]` for patient B, the probe emits an agreement matrix showing patient A at 3/3 and patient B at 2/3.
  - **Test 2 (LLM-required):** With `process.env.OPENAI_API_KEY` deleted (or undefined), the probe's `main()` function calls `console.error('OPENAI_API_KEY unset — variance probe requires the real LLM, aborting.')` and `process.exit(1)`. Test asserts the error message + non-zero exit.
  - **Test 3 (real-LLM path uses a real client, not cached mock):** With `OPENAI_API_KEY` set to a placeholder value, the probe's `main()` constructs a real `OpenAI` client (not `MOCK_*_OUTPUT` fallback) and runs the dev-labeled 16 patients. Test stubs the OpenAI client via `jest.mock('openai', ...)` to capture the `responses.create` call and assert it was made with the dev-labeled 16 patients' bundles. (This test guards the "real LLM, not mock" invariant per `never-override-real-with-fake.md`.)
  - *Verify:* `cd apps/api && npx jest src/eval/varianceProbe.test.ts` → all 3 tests FAIL (module doesn't exist).

### Phase E — `varianceProbe.ts` implementation (GREEN)

- [ ] **E1. Create `apps/api/src/eval/varianceProbe.ts`** with the following structure (peer to `eval/labelFromBundle.ts` and `eval/outreachSchema.ts`):
  ```ts
  // Pseudocode — full implementation in commit
  import OpenAI from 'openai';
  import { runRiskAgent } from '../agents/riskAgent';
  import { devLabeledPatients } from './devLabeledPatients'; // helper to read labels.json

  interface AgreementRow { patientId: string; runs: string[]; agreement: string; }
  function computeAgreement(runs: string[]): string {
    const counts = new Map<string, number>();
    for (const r of runs) counts.set(r, (counts.get(r) ?? 0) + 1);
    const max = Math.max(...counts.values());
    return `${max}/${runs.length}`;
  }

  async function main() {
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY unset — variance probe requires the real LLM, aborting.');
      process.exit(1);
    }
    const N = 3;
    const client = new OpenAI();
    const patients = devLabeledPatients(); // 16 patients from labels.json
    const rows: AgreementRow[] = [];
    for (const patient of patients) {
      const runs: string[] = [];
      for (let i = 0; i < N; i++) {
        // Real LLM call — not cached, not mock. Per never-override-real-with-fake.md.
        for await (const event of runRiskAgent(patient.bundle, client)) {
          if (event.type === 'result') {
            runs.push(event.output.riskLevel);
          }
        }
      }
      rows.push({ patientId: patient.id, runs, agreement: computeAgreement(runs) });
    }
    console.log('| patient | ' + Array.from({ length: N }, (_, i) => `run${i + 1}`).join(' | ') + ' | agreement |');
    console.log('|---------|' + Array.from({ length: N + 1 }, () => '------').join('|') + '|');
    for (const row of rows) {
      console.log(`| ${row.patientId} | ${row.runs.join(' | ')} | ${row.agreement} |`);
    }
  }

  if (require.main === module) { main(); }
  export { computeAgreement };
  export type { AgreementRow };
  ```
  - *Ponytail:* `computeAgreement` is a named export so the test in D2 Test 1 can pin the math without invoking the full main(). The `main()` function is a thin orchestrator.
  - *Verify:* `cd apps/api && npx jest src/eval/varianceProbe.test.ts` → all 3 tests pass.

- [ ] **E2. Add a `devLabeledPatients()` helper** at the top of `varianceProbe.ts` (or a new `eval/devLabeledPatients.ts` if shared with other tools). It reads `data/eval/labels.json` and returns the 16 patients whose `source === 'dev'` and are NOT in `_meta.heldOutRows`. Returns `Array<{ id: string; bundle: PatientBundle; expectedHighRisk: boolean }>`.
  - *Ponytail:* keep this in `varianceProbe.ts` for now (single consumer). If a second tool needs it, refactor to `eval/devLabeledPatients.ts` in a follow-up.
  - *Verify:* E1's test 3 now passes (the probe iterates over 16 patients).

### Phase F — Run probe + verify substrate

- [ ] **F1.** Run the probe against the post-pin state: `cd apps/api && npx tsx src/eval/varianceProbe.ts > docs/plans/caresync-ai/variance-probe.md`.
  - *Ponytail:* skip a separate pre-pin probe — `verification-s13.md §4` already documents the pre-pin state (specificity 0%, per-patient agreement <30%). Capturing pre-pin data from a temporary revert is pure ceremony; the audit trail is the baseline. 16 patients × 3 runs = 48 LLM calls; ~4-8 min on the post-pin state.
  - *Verify:* output has 16 rows + header. **Substrate check:** ≥80% per-patient agreement (signal #3 in the verification matrix).
  - *If agreement <80%:* the variance root cause is not temperature; document in `verification-s16.md §6` as open follow-up; defer model-snapshot ID hunt to S17. Do NOT proceed to commit 3's prompt rewrite on a flappy substrate.

### Phase G — Commit 2

- [ ] **G1.** `npx tsc --noEmit` clean; `npx jest --runInBand` all green.
- [ ] **G2.** Commit:
  ```
  feat(S16): temperature + seed pin (all 4 agents) + varianceProbe.ts

  - Add temperature: 0 and seed: 42 to client.responses.create(...) in
    apps/api/src/agents/{risk,careGap,sdoh,actionPlanner}Agent.ts.
    2-line addition per agent; TDD pins in each *Agent.test.ts.

  - New apps/api/src/eval/varianceProbe.ts — runs the dev-labeled 16
    patients through the real LLM N=3 times, emits a markdown
    agreement matrix per patient. Aborts when OPENAI_API_KEY is unset
    (real LLM required, per never-override-real-with-fake.md).

  - Post-pin probe (docs/plans/caresync-ai/variance-probe.md) shows
    ≥80% per-patient agreement — substrate stable for commit 3's
    rubric v2. Pre-pin baseline is verification-s13.md §4
    (specificity 0%, agreement <30%).
  ```

  **Verify:** probe shows ≥80% agreement; tsc + jest clean.

---

## Commit 3 — `feat(S16): risk rubric v2 — replace buildPrompt with few-shot + 0-anchors rule`

**Goal:** Replace the post-S13-revert 1-paragraph `buildPrompt` with the v2 rubric (3 calibration anchors + "0 anchors → low" hard rule + 3 worked examples using actual seed-text bundle shapes). Pass the 2x2 acceptance gate (dev-labeled specificity ≥30% AND sensitivity ≥67%, held-out specificity ≥30% AND sensitivity ≥50%). After this commit, the Risk agent's specificity recovers from 0% to ≥30% and the eval-report's Pillar P2 lifts from 4 to 5.

**Architecture:** Rewrite `apps/api/src/agents/riskAgent.ts`'s `buildPrompt` body with the v2 structure (per `design-risk-calibration-v2.md` §"The v2 rubric"). 3 new TDD tests in `riskAgent.test.ts` (3 anchor definitions present + "0 anchors → low" rule present + 3 worked examples present). No `eval.ts` changes; the eval imports `buildPrompt` and runs it as-is. Eval re-run regenerates `docs/eval-report.{md,json}` with the post-rubric numbers.

**Spec:** `prd-s16.md` D4 + D5 + D6 + D8 (commit 3 of S16's 3-commit decomposition) + `design-risk-calibration-v2.md` §"The v2 rubric" + grill §3 + §5 + §6.

### Phase A — TDD red for the v2 rubric structure

- [ ] **A1. Read `apps/api/src/agents/riskAgent.test.ts`** and locate the existing 2 S13-era regression-guard tests for `buildPrompt` (the "citation requirement" and "bundle embedding" tests, per `verification-s13.md §3`). These 2 tests stay.

- [ ] **A2. Add 3 new tests to `riskAgent.test.ts` for the v2 structure** (RED — they should fail because the current 1-paragraph prompt doesn't have any of these):
  - `it('buildPrompt lists the 3 calibration anchors verbatim (S16 commit 3)', ...)` — assert the test's input bundle's `buildPrompt(...)` output contains the substrings `"Anchor A: Multi-condition comorbidity"`, `"Anchor B: Recent inpatient discharge"`, `"Anchor C: Abnormal labs"`.
  - `it('buildPrompt enforces the "0 anchors → low" hard rule (S16 commit 3)', ...)` — assert `buildPrompt(...)` output contains the substring `"0 anchors met is ALWAYS riskLevel='low'"`.
  - `it('buildPrompt includes 3 worked examples using actual seed-text bundle shapes (S16 commit 3)', ...)` — assert the output contains the substrings `"Example 1 (0 anchors → low)"`, `"Example 2 (1 anchor → moderate)"`, `"Example 3 (2 anchors → high)"`, and references the seed-text patient IDs (`james-okafor`, `maria-chen`, `bob`).
  - Each test uses a fixture bundle (`{ resources: [], validIds: new Set() }` is fine — `buildPrompt` doesn't read the bundle contents for the v2 structure).
  - *Verify:* `cd apps/api && npx jest src/agents/riskAgent.test.ts -t "v2 structure"` → 3 new tests FAIL (current prompt doesn't have these strings).

### Phase B — GREEN: rewrite `buildPrompt`

- [ ] **B1. Read `apps/api/src/agents/riskAgent.ts:85-100`** (the current `buildPrompt` body). Note the existing 1-paragraph structure that the S13 revert preserved.

- [ ] **B2. Replace the `buildPrompt` body** with the v2 structure from `design-risk-calibration-v2.md` §"The v2 rubric". Specifically:
  - Keep the opening 4 lines (the "You are a clinical risk-assessment agent" + "You are the Risk agent on a care-coordination platform" + "Below is the patient's complete retrieved FHIR record" + the `<resource lines>` interpolation).
  - Add the 3 calibration anchors (A, B, C) verbatim.
  - Add the "0 anchors → low" hard rule verbatim.
  - Add the 3 worked examples using actual seed-text bundle shapes (james-okafor, maria-chen, and a synthetic `bob` synthesizing multi-condition + abnormal lab + recent discharge).
  - Keep the closing 3 lines (the citation requirement + the "narrate then call report_risk" instruction).
  - *Ponytail:* do not extract a sub-function like `formatAnchors()` — the prompt is a single string, the structure is best read top-to-bottom in the source. Inlining is the laziest fix.
  - *Verify:* `cd apps/api && npx jest src/agents/riskAgent.test.ts` → 9 + 3 = 12 tests pass (7 existing riskAgent tests + 2 temperature/seed tests from commit 2 + 3 new v2 structure tests).

- [ ] **B3. Do NOT change `runRiskAgent`** (the function that calls `buildPrompt` and streams to the SDK). The rewrite is body-only.
  - *Verify:* `grep -n "buildPrompt\|runRiskAgent" apps/api/src/agents/riskAgent.ts` returns the same call sites as before.

### Phase C — Run the 2x2 acceptance gate

- [ ] **C1. Quorum check:** OpenAI quota. Per the S15 handoff: "OpenAI quota: exhausted mid-eval." If exhausted, document the gate as "deferred — quota exhausted; will run on the next live window" in `verification-s16.md`; do NOT commit; branch stays open.
  - *Ponytail:* skip a `--rubric` flag in `eval.ts` (and the ship-then-cleanup cycle that follows). The v2 prompt is the only prompt after commit 3 lands; the baseline for the 2x2 is `verification-s13.md §4`'s pre-S13 30.8% specificity number, already in the audit trail. The eval imports `buildPrompt` from `riskAgent.ts` and runs it as-is.

- [ ] **C2. Run the gate:** `cd apps/api && npx tsx src/scripts/eval.ts --risk-only`.
  - *Verify:* the rendered `docs/eval-report.md` shows the new Risk section with both dev-labeled and held-out metrics.

- [ ] **C3. Extract the 4 numbers:**
  - Dev-labeled specificity (target ≥30%) and sensitivity (target ≥67%).
  - Held-out specificity (target ≥30%) and sensitivity (target ≥50%).

- [ ] **C4. If all 4 hit the thresholds:** the gate passes. Proceed to Phase D.
  - *If any misses:* the gate fails. Document in `verification-s16.md §6` (open follow-ups). Branch stays open. Iterate on the rubric in a follow-up commit (tighter anchor thresholds, adjusted "0 anchors → low" wording). Re-run the gate.

### Phase D — Commit 3

- [ ] **D1.** `npx tsc --noEmit` clean; `npx jest --runInBand` all green.
- [ ] **D2.** Commit:
  ```
  feat(S16): risk rubric v2 — replace buildPrompt with few-shot + 0-anchors rule

  Closes sub-gap 3 of the HL7 evaluation (Risk agent's 9-FP rate).

  - Rewrite apps/api/src/agents/riskAgent.ts:buildPrompt body with the
    v2 structure: 3 calibration anchors (multi-condition comorbidity,
    recent inpatient discharge, abnormal labs) + explicit "0 anchors
    met is ALWAYS riskLevel='low'" hard rule + 3 worked examples using
    actual seed-text bundle shapes from seed-patients.ts (james-okafor
    for Example 1, maria-chen for Example 2, a synthetic bob with
    multi-condition + abnormal lab + recent discharge for Example 3).

  - 3 new TDD pins in riskAgent.test.ts (anchors present, hard rule
    present, worked examples present). The 2 existing regression-guard
    tests (citation requirement + bundle grounding) stay. The 2
    S13-era rubric-pins tests stay for now — removed in a follow-up
    after the v2 design stabilizes.

  - 2x2 acceptance gate passes (see docs/eval-report.md):
      dev-labeled 16:  specificity ≥30% (was 0% pre-S16)
                        sensitivity ≥67%
      held-out 10:     specificity ≥30%
                        sensitivity ≥50%

  P2 4→5. Total 89.2 → ~91.0.
  ```

  **Verify:** 2x2 numbers in `docs/eval-report.md`; tsc + jest clean.

---

## Phase G — Post-merge verification

- [ ] **G1. `npm run eval` regenerated report shows:** Risk dev-labeled specificity ≥30% (was 0%), sensitivity ≥67%; Risk held-out specificity ≥30%, sensitivity ≥50%; P2 4→5 in the HL7 evaluation. The Status line reads "Status (S16): N clinician-validated (X%), 16 of 26 dev-labeled (Y%), 10 of 26 held-out (Z%)."
- [ ] **G2. Variance probe re-run** (post-merge) shows ≥80% per-patient agreement — the substrate check from commit 2's Phase F holds in production.
- [ ] **G3. Write `verification-s16.md`** per the 5-row matrix in `prd-s16.md D9` (commit 1's evidence + commit 2's evidence + commit 3's evidence + the 2x2 numbers + the variance probe pre/post numbers). Include the reversion contingency paragraph per `prd-s16.md D7`.
- [ ] **G4. Write `review-s16.md`** per the S14/S15 two-axis pattern (Standards + Spec).
- [ ] **G5. Re-run the post-S16 HL7 evaluation** (`reports/HL7-Challenge-Evaluation.2026-07-09-post-s16.md`) to capture the P2 lift and the new total. Mirror the S15 post-eval pattern from the S15 handoff.

---

## Rollback / safety

| Commit | Revert | Reverts |
|---|---|---|
| 1 (docs) | `git revert <sha>` | Drops the 3 planning docs. No code impact. |
| 2 (variance) | `git revert <sha>` | Removes `temperature: 0` + `seed: 42` from 4 agents + drops `varianceProbe.ts`. The post-S15 state (variance window uncollapsed) returns. |
| 3 (rubric) | `git revert <sha>` (or apply the reversion paragraph from `prd-s16.md D7`: replace `buildPrompt` body with the v1 1-paragraph form) | The Risk agent reverts to over-calling (specificity 0%). The variance pin from commit 2 survives the revert. |

**Whole-PR revert:** `git revert <merge-sha>...<tip-sha>` reproduces pre-S16 state.

**Single-commit revert safety:** commit 3's reversion is mechanical — replace `buildPrompt` body with the 5-line v1 form, remove the 3 v2 structure TDD tests, keep the 2 regression-guard tests. The eval-report disclosure gets a "Status (S16 reverted)" banner. Same pattern as S13b's reversion.

---

## Definition of done

1. PR merged (or branch ready for merge pending user review).
2. All 5 verification matrix signals in `prd-s16.md D9` pass (signals #1-#4 from commits 2 + 3, signal #5 = 2x2 acceptance gate).
3. `verification-s16.md` ships with the 5-row matrix evidence + the reversion contingency paragraph.
4. `review-s16.md` ships with the Standards + Spec axes.
5. Post-S16 HL7 evaluation re-run captured at `reports/HL7-Challenge-Evaluation.2026-07-09-post-s16.md`.
6. Pillar P2 lifted from 4 to 5; total 89.2 → ~91.0.

---

## Open follow-ups (deferred — NOT in this slice)

1. **Care Gap FN=10 / SDOH agreement regression** — same temperature+seed pin should help; if it persists, S17 = per-agent rubric investigations for Care Gap + SDOH (mirroring S16's Risk pattern).
2. **MODEL_CARD.md authoring** — Option B in the S15 handoff. Defer until S16's v2 rubric + variance pin stabilizes the Risk numbers; once stable, the model card is a 1-2 day deliverable.
3. **Clinician engagement** — S15's outreach log is the operational mechanism; engagement happens on its own clock, not gated by S16.
4. **In-app review queue** — deferred indefinitely (same call as S14 grill §7).
5. **Model-snapshot ID hunt** — uncertain whether OpenAI exposes one; defer until temperature+seed proves insufficient (probe signal #3 will tell us).
6. **Held-out inter-rater or hand-curated labels** — rejected in S15 grill §3; same call for S16.

---

## Files this slice modifies (summary)

**New (3 — all in commit 1):**
- `docs/plans/caresync-ai/grill-risk-calibration-v2.md`
- `docs/plans/caresync-ai/prd-s16.md`
- `docs/plans/caresync-ai/design-risk-calibration-v2.md`

**New (2 — both in commit 2):**
- `apps/api/src/eval/varianceProbe.ts`
- `apps/api/src/eval/varianceProbe.test.ts`

**New (1 — in commit 2's evidence):**
- `docs/plans/caresync-ai/variance-probe.md` (probe output)

**New (1 — in commit 3's evidence):**
- `reports/HL7-Challenge-Evaluation.2026-07-09-post-s16.md`

**Modified (5):**
- `apps/api/src/agents/riskAgent.ts` (commit 2: 2-line pin; commit 3: buildPrompt rewrite)
- `apps/api/src/agents/careGapAgent.ts` (commit 2: 2-line pin)
- `apps/api/src/agents/sdohAgent.ts` (commit 2: 2-line pin)
- `apps/api/src/agents/actionPlannerAgent.ts` (commit 2: 2-line pin)
- `apps/api/src/agents/riskAgent.test.ts` (commit 2: 2 new TDD pins; commit 3: 3 new TDD pins)
- `apps/api/src/agents/careGapAgent.test.ts` (commit 2: 2 new TDD pins)
- `apps/api/src/agents/sdohAgent.test.ts` (commit 2: 2 new TDD pins)
- `apps/api/src/agents/actionPlannerAgent.test.ts` (commit 2: 2 new TDD pins)
- `apps/api/src/scripts/eval.ts` (commit 3: transient `--rubric=v2` flag, removed in commit 3's Phase E)
- `docs/eval-report.md` (commit 3: regenerated)
- `docs/eval-report.json` (commit 3: regenerated)
- `tasks/todo.md` (this slice's active section)

**Not modified (intentionally):**
- `apps/api/src/agents/confidenceScorer.ts` — pre-S16 SDOH regex fix already on main at `feca132`.
- `apps/api/src/fhir-data/seed-patients.ts` — S13b's samuel-wright enrichment survives.
- `apps/api/src/eval/labelFromBundle.ts` — S15's held-out label function, unchanged.
- `apps/api/package.json` — no new scripts.
- `apps/api/src/agents/{riskAgent,careGapAgent,sdohAgent,actionPlannerAgent}.ts` `MOCK_*_OUTPUT` fallbacks — untouched, per `never-override-real-with-fake.md`.