# Verification — CareSync AI, S13 (Risk agent calibration)

> **PLAN_ID:** `caresync-ai` · **Slice:** S13 · **Date:** 2026-07-08
> **Spec sources:** `docs/plans/caresync-ai/design-risk-calibration.md` (D1–D7), `docs/plans/caresync-ai/implementation-plan-risk-calibration.md` (Phases A–E).
> **Branch:** `feature/risk-agent-calibration-s13` (rebased onto `origin/main` at `05c9d85`, post PR #16 merge). 4 commits (one per phase A/B/C/D or one squash — see commit log).
> **Stage:** Phase 5 (`verification-before-completion`).

---

## 1. Fresh command evidence (this session, 2026-07-08)

| Command | Result |
|---|---|
| `cd apps/api && npx jest src/agents/riskAgent.test.ts` | **9/9 tests passed** (4 new S13 A2.x tests + 5 pre-existing) |
| `cd apps/api && npx jest src/eval/ src/agents/` | **45/45 tests passed, 8/8 suites** (no regressions in `computeMetrics`, `errorAnalysis`, all 4 agent modules) |
| `cd apps/api && npx tsc --noEmit` | exit 0 (clean) |
| `npm run eval` (live re-run on `feature/risk-agent-calibration-s13`, with both `OPENAI_API_KEY` exported and HAPI reachable) | **STATUS: pending — see §3** |

---

## 2. TDD evidence (the calibration surface is pinned)

The S13 calibration is a prompt-only change (`apps/api/src/agents/riskAgent.ts`'s `buildPrompt`). The agent's classification comes from the LLM (non-deterministic), so TDD can't pin "patient X gets `riskLevel=high`." What TDD CAN pin is the **prompt's structural properties** — the load-bearing rubric anchors, the citation requirement (GD11 regression guard), and the bundle grounding (regression guard). These are what the 4 new tests in `riskAgent.test.ts` A2.x assert against.

```
PASS  src/agents/riskAgent.test.ts
  OpenAI client construction is lazy (boot-time safety)
    ✓ importing the module does not throw when OPENAI_API_KEY is unset
    ✓ falls back to MOCK_RISK_OUTPUT when OPENAI_API_KEY is unset (no client injected)
  runRiskAgent (B1 revised — mocked OpenAI client, no live call)
    ✓ yields token events (self-tagged agentId:risk) for streamed text, then a final result event with the parsed RiskOutput
    ✓ calls the client with gpt-5.5, streaming, and a report_risk tool
    ✓ throws if the model never calls report_risk
  buildPrompt (S13 — Risk rubric calibration)                                         <-- NEW
    ✓ buildPrompt includes the rubric anchors (multi-condition comorbidity, recent inpatient discharge, abnormal labs)
    ✓ buildPrompt includes the threshold text and all four risk-level tiers
    ✓ buildPrompt preserves the citation requirement (GD11 regression guard)
    ✓ buildPrompt embeds the bundle resources (grounding regression guard)

Tests: 9 passed, 9 total
```

**Red-then-green trace:** the 4 new tests were authored in Phase A as failing tests. Initial run: `Tests: 2 failed, 7 passed, 9 total` (A2.1 rubric-anchors and A2.2 threshold-tiers failed; A2.3 citation guard and A2.4 bundle grounding passed because the rubric-prompt change hadn't displaced the existing text). After the Phase B rubric insertion: `Tests: 9 passed, 9 total`. No regressions.

---

## 3. Live re-eval status (pending infra)

**Plan §Phase D2** called for `npm run eval` end-to-end against HAPI + OpenAI, with maria-chen's `analysis_cache` row invalidated. **Status as of this write:** the eval has **not yet been re-run end-to-end** for S13.

**Why:** the in-session shell did not have `OPENAI_API_KEY` exported during the TDD/Phase B/Phase C window. Running `npm run eval` in this state would either (a) hit the S12 B.1 demo-fallback path (`MOCK_RISK_OUTPUT`, `riskLevel: 'critical'` for every patient) — yielding specificity 0%, PPV ~19% (3 TP / 16), which is **worse than the original 30.8% and actively misleading** — or (b) fail outright on the OpenAI call. Either way, regenerating `docs/eval-report.{md,json}` under those conditions would be GD8/G4 dishonest staging.

**Action:** the user has exported `OPENAI_API_KEY` mid-session and confirmed HAPI is reachable. The pending action is to re-run `npm run eval` from the worktree (NOT the main repo) and either (i) commit the regenerated `docs/eval-report.{md,json}` to this branch with a follow-up commit, or (ii) merge this branch and re-run on `main` afterwards.

**If the post-calibration numbers do NOT improve** (i.e. specificity stays at 30.8% or worse, or sensitivity drops), the rubric ships as a documented attempt with no improvement claim — and the design doc's D3 path (prompt rubric mirroring the seed heuristic) is reconciled honestly. The committed `docs/eval-report.{md,json}` are **NOT regenerated** until the live re-run succeeds. They continue to document the pre-S13 problem state — readers will see the 2026-07-07 timestamps and the S13 phase metadata in the disclosure, so the date gap + the rubric-mirrors-seed disclosure make the intent explicit.

---

## 4. Disclosure placement (D7 verifiable in the report)

Even before the live re-run, the S13 disclosure is **live in the eval-report rendering pipeline** at two locations:

1. **Methodology banner — `renderMarkdown()` in `apps/api/src/scripts/eval.ts:198-205`:** new "Status (S13)" paragraph below the existing "DEV-LABELED BASELINE" banner. The next `npm run eval` run will emit this paragraph in the regenerated report.

2. **Per-section note above the Risk false-positives list:** "**Note (S13):** The Risk agent's prompt rubric was authored to mirror the synthetic seed heuristic. The specificity number above reflects that alignment — see `docs/plans/caresync-ai/design-risk-calibration.md` for the calibration rationale." Inserted at `scripts/eval.ts:312-316`, just before the per-patient FP enumeration. Every regenerated report will carry this note immediately above its biggest credibility risk.

**Verification:** `grep -n "S13\|rubric-mirrors-seed\|riskScoreFor" apps/api/src/scripts/eval.ts` returns the new strings in two locations (lines 199 and 313).

---

## 5. Definition-of-done check (S13 acceptance)

- [x] **A1 — `buildPrompt` exported.** Confirmed: import in `riskAgent.test.ts:1` resolves; pre-existing tests still pass; `tsc --noEmit` clean.
- [x] **A2 — 4 TDD unit tests, all green.** Confirmed: §2 trace above.
- [x] **B1 — explicit rubric in `buildPrompt`.** Confirmed: prompt now reads `## Risk rubric (S13 calibration)` + 3 anchors (Anchor A/B/C) + count threshold ("at least 2 of the 3") + a "do not over-call" / "do not under-call" directional prompt. See `apps/api/src/agents/riskAgent.ts:90-100`.
- [x] **B2 — pre-existing tests still pass.** Confirmed: `riskAgent.test.ts` is 9/9, of which 5 are pre-existing (lazy-client boot safety, mock fallback, streamed-token + result-event, model+tool wiring, "throws if no tool").
- [x] **C1 — disclosure in renderMarkdown Methodology.** Confirmed: `apps/api/src/scripts/eval.ts:198-205` carries the new "Status (S13)" paragraph.
- [x] **C2 — disclosure header above Risk false positives.** Confirmed: `apps/api/src/scripts/eval.ts:312-316`.
- [ ] **D1 — maria-chen cache invalidated.** **STATUS: no-op** — the `analysis_cache` table is empty in this fresh worktree (`data/caresync.sqlite` does not exist; `getDb()` will create the schema on first call but no rows are present). The invalidation step is moot until a cache row exists.
- [ ] **D2 — `npm run eval` live re-run.** **STATUS: pending — see §3.** The run blocks on shell `OPENAI_API_KEY` propagation. Action: run from the worktree after §3 is unblocked.
- [ ] **D3 — regenerate `docs/eval-report.{md,json}`** and verify the S13 disclosures are present in the committed file.
- [ ] **D4 — commit.** Blocked on D3.
- [x] **E1 — this document.** Written.
- [x] **E2 — `review-s13.md`.** Written.

---

## 6. Open follow-up

After this branch merges, the live re-eval (§3) is the single most valuable next action. Two paths:

1. **Same worktree, before merge.** Run `npm run eval` from this worktree, paste the new `docs/eval-report.json` headline numbers back, and they get committed as a follow-up S13 commit (or amended into the slice).
2. **On `main` after merge.** Run from a clean checkout of `main`, regenerate, commit, push. This is the cleaner long-term option (the eval report's `generatedAt` timestamp will reflect the S13 state on `main`, not on a feature branch).

Either path must:
- Confirm `Risk specificity ≥ 60%` and `Risk PPV ≥ 40%` (the D6 verification thresholds from the implementation plan).
- If specificity does NOT improve, revert the rubric change (`git revert` or `git checkout HEAD~1 -- apps/api/src/agents/riskAgent.ts`) and update this doc with the negative result. The TDD tests still ship — they're a load-bearing safety net regardless.
- Confirm the S13 disclosures appear in the regenerated `docs/eval-report.md` (Methodology banner + Risk FPs section header).

---

## Next step (ADLC)

`code-review` (`docs/plans/caresync-ai/review-s13.md`) → `finishing-a-development-branch` (PR) → follow-up eval (§6).