# Code Review — CareSync AI, S13 (Risk agent calibration)

> **PLAN_ID:** `caresync-ai` · **Slice:** S13 · **Date:** 2026-07-08
> **Diff:** `HEAD` (`origin/main` `05c9d85`) `...working-tree` on `feature/risk-agent-calibration-s13`. Uncommitted: `apps/api/src/agents/riskAgent.ts` (export + rubric), `apps/api/src/agents/riskAgent.test.ts` (+4 TDD tests), `apps/api/src/scripts/eval.ts` (Methodology + per-section disclosure), `docs/plans/caresync-ai/{design,implementation-plan,verification,review}-risk-calibration*.md`.
> **Spec sources:** `docs/plans/caresync-ai/design-risk-calibration.md` (D1–D7), `docs/plans/caresync-ai/implementation-plan-risk-calibration.md` (Phases A–E), the user's two grill confirmations (calibrate Risk agent, S13 lifecycle form with brief design + implementation-plan), and the user's mid-session acknowledgement that the merged S12 work does not touch eval files (clean branch-off confirmed via `git diff HEAD@{1}..origin/main -- 'apps/api/src/agents/riskAgent.ts' 'data/eval/labels.json' 'apps/api/src/scripts/eval.ts' 'apps/api/src/eval/{computeMetrics,errorAnalysis}.ts' 'docs/eval-report.{md,json}'` returning empty).

## Standards

**Convention match: strong** at every level the diff touches.

- **Agent module** — `riskAgent.ts`'s edit preserves the existing module structure (lazy `cachedClient`, `REPORT_RISK_TOOL`, prompt construction, streaming loop). The only structural changes are (a) `function buildPrompt` → `export function buildPrompt` with a JSDoc that matches the existing per-section JSDoc style (`S13 — exported for TDD unit tests…`), (b) the addition of the `## Risk rubric (S13 calibration)` block, and (c) the in-block tier-name casing aligned with the `enum: ['low','moderate','high','critical']` enum (lower-case). The change is additive and orthogonal to S12's demo-fallback path (`streamMockRisk`), which is unchanged.

- **Test module** — `riskAgent.test.ts`'s 4 new tests match the existing style: `describe(...) → it(...)` blocks at the top level, `expect(...).toContain(...)` and `.toMatch(...)` for string assertions, no extra mock infrastructure, no `jest.isolateModulesAsync` (which is reserved for the existing lazy-client / env-var tests). Fixture built inline at the top of the new `describe(...)` — same pattern as the existing `bundle` constant higher up in the file.

- **Eval script** — `eval.ts`'s two string additions (lines 198-205 Methodology banner; lines 312-316 Risk FPs section header) match the existing prose style of the surrounding lines (sentence fragments in `lines.push(...)` calls, no styling changes, no new helper introduced).

- **Convention violations, found and fixed:**

  1. **Casing — `MODERATE` / `HIGH` (all-caps) in rubric vs lowercase enum.** First rubric draft had uppercase tier names; the enum is `['low','moderate','high','critical']` lowercase, and the TDD test asserts lowercase. Fixed: rewrote the rubric's two tier-naming sentences in lowercase to match the enum (the test determinism requirement is the reason). This is the same kind of cross-module alignment the codebase repeatedly enforces (e.g., `riskLevel` casing in `riskScoreFor` / `riskAgent` / `RiskOutput`'s schema).
  2. **JSDoc scope — `buildPrompt`'s export rationale was implicit.** The export is a load-bearing TDD surface. Fixed: added a multi-line JSDoc paragraph above the function that names the calibration rationale, the labels.json source-of-truth, and the long-term clinician-validation path. The JSDoc matches the rich-comment convention this repo applies to other exported helpers (e.g., the `riskScoreFor` block in `fhir-data/population.ts:107-126`).

**Judgement calls (left as-is, with reasoning):**

- **TDD test scope is structural, not classification.** The agent's `riskLevel` comes from the LLM (non-deterministic). The 4 new tests pin the prompt's structural surface — the rubric anchors are in the prompt, the citation requirement is preserved (GD11), the bundle grounding is preserved. These are the load-bearing properties; if any silently regress, the calibration breaks without a test failure. Pinning the LLM's classification would require either (a) a deterministic mock client returning canned outputs (which would only test the agent's wiring, not the calibration's effect) or (b) integration tests that run against the live LLM (expensive, nondeterministic). The structural-pin is the right level for unit tests; the live re-eval in `verification-s13.md` §3 is the integration test.

- **TDD tests do not assert exact prompt sentences.** The four tests assert substrings — anchor names ("multi-condition comorbidity"), lab thresholds ("BNP", "200"), the four tier names, etc. — rather than asserting the full rubric text. This is by design: tightening the rubric to a single canonical wording would block trivial editorial improvements (wording clarification, more precise terminology, e.g., switching "BNP > 200 pg/mL" to "B-type natriuretic peptide >200 pg/mL"). The substring pinning is the load-bearing surface.

- **Disclosures placed at two sites, not one.** `renderMarkdown`'s Methodology banner is the place a careful reader first sees; the per-section note above the Risk FPs is the place a quick-scanning reader sees (the Risk false positives list is the most visible credibility risk). Two-site disclosure is more findable; one-site would force readers to scroll past three sections of metrics to find it.

- **`analysis_cache` invalidation step is a no-op in this worktree.** Phase D1 called for deleting maria-chen's cache row; the worktree has no `data/caresync.sqlite` (DB hasn't been seeded here), so the row doesn't exist. Documented in `verification-s13.md` §5 — the step still ships as a design for the post-merge state when the report gets re-run.

- **Live re-eval pending.** Phase D2-D4 are blocked on `OPENAI_API_KEY` propagation across shell boundaries; documented in `verification-s13.md` §3. The slice commits without the regenerated `docs/eval-report.{md,json}` — those files keep their 2026-07-07 pre-S13 timestamps and metadata, and the S13 disclosures (when next emitted) will make the date gap explicit. This is honest staging (G4) rather than a fabricated regen.

## Spec

**(a) Missing / partial** — none material. All 5 acceptance checkboxes mapped in `verification-s13.md` §5 are addressed (the 4 done ones are done; the 1 partial — the eval re-run — is documented as blocked on env and not silently glossed over).

**(b) Scope creep** — none. The slice touched exactly:
- `apps/api/src/agents/riskAgent.ts` (export + rubric per Phase A1/B1)
- `apps/api/src/agents/riskAgent.test.ts` (4 new tests per Phase A2)
- `apps/api/src/scripts/eval.ts` (2 disclosure inserts per Phase C1/C2)
- 4 plan/verification/review docs (artifacts of the S13 lifecycle form)

No screen touches. No harness code-path change. No FHIR-client change. No database schema change. No model change.

**(c) Implementation looks wrong** — none unfixed. One casing slip in the rubric (uppercase tier names → enum casing mismatch), caught by the failing A2.2 test and fixed by the same change. No safety invariant broken — citation enforcement (GD11) is preserved (test A2.3); rubric insertion does NOT touch the citation-requirement trailing paragraphs.

**(d) Live re-eval reporting accuracy** — noted. The committed `docs/eval-report.{md,json}` are stale relative to the S13 state. Anyone reading this branch's diff will see the rubric change in `riskAgent.ts`, the disclosures in `scripts/eval.ts`'s source code, and the `verification-s13.md` explaining the data split — there is no false claim that the eval was re-run. The next action (post-merge) is to re-run and either commit the regenerated report or revert the rubric if the numbers don't improve. Verification §6 is the operational follow-up plan.

## Summary

- **Standards**: 2 minor slips found and fixed (casing, JSDoc scope), 4 judgement calls left as-is with reasoning. Worst issue: tier-name casing in the rubric (would have caused the public-facing prompt to disagree with the internal enum — caught immediately by the failing TDD test, fixed in the same change).
- **Spec**: 0 missing, 0 scope-creep, 1 stale-data risk (live re-eval pending) — documented honestly in `verification-s13.md` rather than fabricated.

Re-verified after fixes: 9/9 unit tests in `riskAgent.test.ts` pass; 45/45 unit tests across `src/eval/` + `src/agents/` pass; `tsc --noEmit` clean; `tsc --noEmit` clean in both `apps/api` and `apps/web` workspaces. The slice is ready to commit; the live re-eval is the one explicit follow-up (§6) tracked in the verification doc.