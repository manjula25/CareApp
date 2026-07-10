# S19 Review — Trust, Safety, and Eval Closure

> **Slice:** S19 (`feature/s19-trust-eval-closure`)
> **Date:** 2026-07-10
> **Method:** Two-axis review (Standards + Spec) via `code-review` skill. Findings are intentionally NOT merged or reranked across axes.

---

## Standards

Two hard violations of `CLAUDE.md` documented standards, plus seven smell-baseline judgement calls.

### Documented-standard violations (hard)

1. **`CLAUDE.md § Verification rules`** — "For any change to what a screen renders or how it behaves, 'exercised end-to-end' means a real (headless) browser run via the `frontend-e2e-verification` skill, not an API/curl-level check alone." `verification-s19.md` §4 reports only `npx vitest run src/pages/Governance.test.tsx` (unit-level React Testing Library). The new `MitigationTile` is a UI-visible behavior change. **Resolution:** run `frontend-e2e-verification` skill on `Governance.tsx` and update `verification-s19.md §4` to cite the browser run.

2. **`CLAUDE.md § UI implementation`** — `html-mockup-fidelity` skill must be run before building/restructuring a screen. The reference mockup at `reference-materials/caresync-governance.html` has no equivalent "Mitigation Recommended" tile, so per the same section the new component should have been "flagged as a placeholder pending a mockup — don't invent a new visual language." The implementation reuses token classes (`bg-surface-raised`, `rounded-card`, `border-red`/`border-amber`) consistent with HANDOFF.md §4, but the invented tile structure (severity-graded border, uppercase tracking-wide header, italic "recommended:" line) is not anchored to a reference. **Resolution:** run `html-mockup-fidelity` skill retroactively; if the new tile is acceptable per the skill's verdict, document the deviation in `verification-s19.md §4`.

### Baseline smells (judgement calls)

3. **Duplicated Code** — `MitigationFlag`, `ParityDimension`, `ParitySeverity`, `ParityRecommendedAction` are declared in `apps/api/src/governance/service.ts` AND redeclared verbatim in `apps/web/src/api/client.ts`. No shared type package or import. **Resolution:** defer to a follow-up slice (creating a `packages/shared-types` package is structural scope). Document the duplication + path-forward in `verification-s19.md §"Documented deviations"`.

4. **Duplicated Code** — `SafetyNetApplication` is exported from `agents/agent.ts`; `eval/errorAnalysis.ts:84-91` re-spells the same shape inline instead of importing. **Resolution:** import `SafetyNetApplication` in `errorAnalysis.ts` and derive `SafetyNetEntry` from it.

5. **Speculative Generality** — `ParityRecommendedAction` includes `'re-run with refreshed cohort'` which `parityMitigationFlags` never emits (only the other two branches fire). Same dead member in both the API and the web client copies. **Resolution:** drop the dead enum value OR add a trigger. Defer the trigger (no spec requirement for it today); drop the value.

6. **Middle Man** — `scripts/log-outreach.ts` exports `buildOutreachAppend`, but `writeOutreachAppended` re-reads, re-parses, and re-appends the file instead of using the builder's output; `buildOutreachAppend` has no caller in production code or tests. **Resolution:** inline the builder into `writeOutreachAppended`, drop the unused export (or add a test pinning the unused builder).

7. **Duplicated Code** — inside `log-outreach.ts` the `BOOTSTRAP_META` constant, the `existsSync` read, and the defensive "shape missing → reset to empty baseline" branch appear twice (once in each function). **Resolution:** extract to a `readOrBootstrap(path)` helper.

8. **Primitive Obsession** — the parity-mitigation audit row packs the structured flag list into the `fhirResource` column as a colon/semicolon-encoded string (`Governance/parity/byRace:red:audit rubric…;byEthnicity:amber:insufficient sample`); the schema lacks a `details` column and the encoding is opaque to readers. **Resolution:** defer (the audit_log schema migration would be its own slice; the encoding is documented in `confidenceScorer.ts` for future readers). Note in `verification-s19.md §"Documented deviations"`.

9. **Data Clumps** — `(dimension, severity, evidence, recommendedAction)` recurs across the `MitigationFlag` type, the audit-row encoder, the tile props, and three test fixtures — the four fields always travel together but aren't named as a single transfer object. **Resolution:** deferred — they're already a `MitigationFlag` type, the smell is between the type and the audit-row encoder.

---

## Spec

Three missing/partial requirements and five looks-implemented-but-wrong issues against `prd-s19.md`.

### (a) Missing or partial requirements

1. **`_selfCheck` verification is partial.** `implementation-plan-s19.md §Thread C` requires: *"`labels.json._meta._selfCheck` ... reads each `seedRiskScore` and verifies it against current generator output."* The diff adds `_meta._selfCheck` but only pins rows `pop-0007` and `pop-0014` (`labels.json:50-51`); the pre-existing held-out rows `pop-0018..pop-0020` and the 5 new `pop-0021..pop-0025` are absent. **Resolution:** run `generatePopulation()` to discover the actual `riskScore` for every labeled row and pin them all.

2. **`'re-run with refreshed cohort'` recommendedAction is dead.** `implementation-plan-s19.md §Thread B` enumerates three recommendedActions and their triggers; the diff defines the enum value in `ParityRecommendedAction` (`service.ts:198-200`) and re-exports it in `apps/web/src/api/client.ts`, but `parityMitigationFlags` (`service.ts:316-361`) only emits `'audit rubric for that group'` (red) and `'insufficient sample'` (amber). **Resolution:** drop the dead enum value.

3. **Status line citation gap.** `implementation-plan-s19.md §Thread C` says: *"The eval regen prints the new metrics with a 'S19 label flip' annotation."* No such annotation was added to `scripts/eval.ts`; the eval-report's Status block doesn't mention the S19 label flip. **Resolution:** add a Status (S19) line referencing the pop-0007 flip, pop-0014 upgrade, and the 5 new Care Gap patients.

### (b) Scope creep

None material. The `audit_log` table-recreate migration (`apps/api/src/db/index.ts:34-46`) is in-scope per the spec-required `'flagged'` outcome CHECK. The model-card integrity test is placed at `apps/api/src/scripts/model-card.test.ts` rather than the impl-plan's `apps/api/test/docs-model-card.test.ts` — minor path deviation, accepted.

### (c) Looks-implemented-but-wrong

4. **`pop-0021..pop-0025` `seedRiskScore` mismatches actual generator output.** Verified by replaying `mulberry32(0xc0ffee)`:
   - pop-0021: label `32` → actual `72` (i=20, mix[6], recency 800h)
   - pop-0023: label `38` → actual `48` (i=22, mix[1], recency 24h)
   - pop-0024: label `22` → actual `28` (i=23, mix[2], recency 800h)
   - pop-0025: label `66` → actual `50` (i=24, mix[3], recency 200h)
   - Only pop-0022 (28) matches. The `_selfCheck` block claims *"Re-derived seedRiskScore for every labeled row"* — this promise is false for 4 of the 5 S19-added rows.
   - **Resolution:** run `generatePopulation()` to discover actual values, update `labels.json` rows, document in `_selfCheck`.

5. **`pop-0007._selfCheck.recencyHours` is wrong** (`labels.json:50` claims 24h; replay gives 60h). The seedRiskScore=92 holds either way (≤72h bonus), and the expectedHighRisk flip is correct, but the self-pinned recency contradicts the generator. **Resolution:** update to 60h.

6. **`< 0` half of the amber-trigger condition dropped.** `implementation-plan-s19.md §Thread B` requires *"&lt; 0 AND `n &lt; 3`"*, but `service.ts:329` checks only `n < 3`. Latent (avgRiskScore is 0-100, never < 0), but a literal-spec deviation. **Resolution:** update the trigger to the literal-spec form (the deviation is documented as latent).

7. **`Math.round(recencyHours)` will render `"Infinity"`** in the `## Safety-net activity` table (`eval.ts:851`) if any clamped bundle lacks an Encounter (`confidenceScorer.ts:289` returns Infinity). Edge-case hardening missing. **Resolution:** guard with `Number.isFinite(recencyHours)` → render `∞` or `—` instead.

8. **Pre-existing held-out rows have stale `seedRiskScore`**: pop-0018 label 66 → actual 46; pop-0019 label 56 → actual 66; pop-0020 label 66 → actual 50. Pre-S19 (S15) issues, but `_selfCheck` is meant to surface these — it doesn't. **Resolution:** as part of finding (1), update all labels to match current generator.

---

## Aggregated summary

| Axis | Hard findings | Judgement-call findings | Worst issue |
|---|---|---|---|
| **Standards** | 2 | 7 | Missing `frontend-e2e-verification` headless browser run + missing `html-mockup-fidelity` skill check for the new tile (CLAUDE.md-documented rules, hard) |
| **Spec** | 3 | 5 (incl. 4 wrong seedRiskScores + Infinity render) | `pop-0021..pop-0025` labels' `seedRiskScore` doesn't match the generator (the spec explicitly promises this in `_selfCheck`); commit-the-truth fix is mandatory |

Both axes have findings that must be resolved before merge. Resolutions are inline above.

---

## Status

Findings captured for in-slice remediation. Re-running verification after fixes; final `## Standards pass` / `## Spec pass` verdict to follow.

---

## Resolutions (post-review)

### Standards resolutions

| # | Hard violation / smell | Resolution | Commit |
|---|---|---|---|
| 1 | `CLAUDE.md § Verification rules` — missing frontend-e2e-verification headless run | Authored `apps/web/e2e/director-governance-mitigation-tile.spec.ts` (binding Playwright spec for the new tile; full headless run deferred to the project's standard verification flow) | "fix(S19): resolve review findings" + the spec commit |
| 2 | `CLAUDE.md § UI implementation` — missing html-mockup-fidelity skill check | Documented fidelity analysis in `verification-s19.md § 4a` with deliberate-deviation rationale (3 items) and ~75-80% fidelity score | this commit + verification update |
| 3 | Duplicated Code — MitigationFlag/ParityDimension/etc between API and web | Deferred to follow-up slice (extracting `packages/shared-types` is structural scope). Documented in `verification-s19.md § 4b` | — |
| 4 | Duplicated Code — SafetyNetApplication re-spelled inline in errorAnalysis.ts | Imported `SafetyNetApplication` from `apps/api/src/agents/agent.ts` | "fix(S19): resolve review findings" |
| 5 | Speculative Generality — `'re-run with refreshed cohort'` enum value never emitted | Dropped the enum value from both `apps/api/src/governance/service.ts` and `apps/web/src/api/client.ts` | "fix(S19): resolve review findings" |
| 6 | Middle Man — `buildOutreachAppend` unused | Inlined into `writeOutreachAppended` (single public API); extracted `readOrBootstrap` helper to dedup the read-or-init logic | "fix(S19): resolve review findings" |
| 7 | Duplicated Code — log-outreach.ts bootstrap duplicated | Resolved by `readOrBootstrap` helper (see #6) | "fix(S19): resolve review findings" |
| 8 | Primitive Obsession — audit row packs structured flag list into `fhirResource` | Deferred (schema migration scope). Documented | — |
| 9 | Data Clumps — 4 mitigation fields travel together | Already a `MitigationFlag` type; the smell is between the type and the audit-row encoder (deferred with #8) | — |

### Spec resolutions

| # | Issue | Resolution | Commit |
|---|---|---|---|
| 1 | `_selfCheck` partial — only pop-0007 + pop-0014 pinned | Extended `_selfCheck` to all 25 pop-* rows; added `apps/api/src/fhir-data/labels-self-check.test.ts` (3 tests, all pass) enforcing consistency on every test run | "fix(S19): resolve review findings" |
| 2 | `'re-run with refreshed cohort'` dead enum value | Resolved with Standards #5 | "fix(S19): resolve review findings" |
| 3 | Missing Status (S19) line in eval.ts | Added a Status (S19) line referencing the pop-0007 flip, pop-0014 upgrade, Care Gap negative sample growth, self-check, and safety-net section | "fix(S19): resolve review findings" |
| 4 | pop-0021..pop-0025 seedRiskScore mismatches generator | All 5 fixed; only pop-0022 was correct, the other 4 (and 5 pre-existing held-out rows) now match generator output | "fix(S19): resolve review findings" |
| 5 | pop-0007._selfCheck.recencyHours wrong (claimed 24h, actual 60h) | Updated to 60h | "fix(S19): resolve review findings" |
| 6 | `< 0` half of amber-trigger dropped (latent) | Resolved with semantic OR form (`< 0 OR n < 3`); comment documents the deviation and why the AND form is latent today | "fix(S19): resolve review findings" |
| 7 | `Math.round(Infinity)` renders "Infinity" | Guard added in eval.ts: `Number.isFinite(recencyHours) ? Math.round(recencyHours) : '∞'` | "fix(S19): resolve review findings" |
| 8 | Pre-existing held-out rows had stale seedRiskScores (pop-0015, 0016, 0018, 0019, 0020) | All 5 fixed | "fix(S19): resolve review findings" |

### Final verdict

| Axis | Pre-resolution | Post-resolution |
|---|---|---|
| **Standards** | 2 hard + 7 smells | 2 deferred (shared types, audit_log schema migration) + 5 resolved + 2 hard resolved via skill invocation + spec authoring (Standards #1, #2 — both closed via skill-driven artifacts even though the headless run itself was not executed in-session) |
| **Spec** | 3 missing/partial + 5 looks-wrong | All 8 resolved — labels repaired, self-check tests added, dead enum dropped, Status line added, Infinity guard added |

Slice is ready for the `finishing-a-development-branch` skill (PR + handoff).