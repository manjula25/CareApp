# Active slice: S16 — Risk Calibration v2 (Rubric Redesign + LLM-Variance Investigation)

## Approved: no (awaiting user approval)

Source: `implementation-plan-s16.md` · Spec: `prd-s16.md` (D1–D11) · Decisions: `grill-risk-calibration-v2.md` (7-question grill, 2026-07-09) · Design: `design-risk-calibration-v2.md`. Prior slice S15 merged in PR #26 (commit `5f27418` on main); pre-S16 SDOH regex fix already on main at `feca132`.

**Goal:** Close sub-gap 3 of the HL7 evaluation's biggest-risk decomposition — the Risk agent's 9-FP rate (specificity 30.8%, PPV 25%) — in a single 3-commit PR: (1) docs [DONE at 193dcdb], (2) `varianceProbe.ts` (LLM-variance observation tool — the temperature+seed pin was dropped per [`variance-probe.md`](variance-probe.md)'s API constraint finding), (3) risk rubric v2 (few-shot examples + 0-anchors rule). 2x2 acceptance gate (dev-labeled + held-out, specificity + sensitivity) is the merge gate for commit 3.

**Architecture:** 1 new module (`eval/varianceProbe.ts` + its TDD test); 1 new artifact (`design-risk-calibration-v2.md` — already in commit 1); 1 modified `riskAgent.ts` for the commit-3 prompt rewrite; 0 modified `*Agent.ts` files in commit 2 (the temperature + seed pin was dropped per the API constraint finding in `variance-probe.md`). TDD where applicable (commits 2 and 3); data-driven for commit 1.

**Ponytail pass applied:** minimum new seams (1 new module, no flags); `varianceProbe.ts` follows the existing `eval/` pure-function + I/O-script pattern; no `--rubric` flag in `eval.ts` (2x2 baseline is the audit trail, not a runtime comparison); no feature flag in the agents themselves (the 2x2 acceptance gate is the merge gate, per `prd-s16.md D5`); no model-snapshot ID hunt (per grill §4); no cross-agent rubric work (per grill §8); no in-app review queue.

**Branch state (per skill warning):** implementation is on `feature/s16-risk-calibration-v2` (off `main` at `feca132`); commit 1 already pushed at `193dcdb`.

**Live LLM dependency:** commit 2's Phase F (variance probe) and commit 3's Phase D (2x2 acceptance gate) both run the real LLM. Per the S15 handoff, OpenAI quota is currently exhausted — these phases will fail until quota returns. Subagent handoff (Phase G of writing-plans wrapper) should batch both live runs in the same window if quota allows.

---

## Commit 1 — `docs(S16): grill + PRD + design-risk-calibration-v2` ✅ DONE at 193dcdb

- [x] A1. `grill-risk-calibration-v2.md` written (7-question grill).
- [x] A2. `prd-s16.md` written (D1–D11).
- [x] A3. `design-risk-calibration-v2.md` written (mirrors S13's design doc pattern).
- [x] B1. Committed at `193dcdb`, pushed to `origin/feature/s16-risk-calibration-v2`.

---

## Commit 2 — `feat(S16): varianceProbe.ts — LLM-variance observation tool`

> **Scope-reduced** from the original plan. The temperature + seed pin across all 4 agents was dropped per [`variance-probe.md`](variance-probe.md)'s finding that the OpenAI Responses API rejects both `seed` (all models) and `temperature` (reasoning tier). Commit 2 ships the observation tool only; the variance-collapse strategy is deferred to a future slice that picks a different lever.

- [ ] **A1.** Read `eval/labelFromBundle.test.ts` for the existing TDD pattern in `eval/`.
- [ ] **A2.** Create `eval/varianceProbe.test.ts` with 3 tests (agreement math, LLM-required env-gate, real-LLM-not-mock invariant). **RED**: module doesn't exist.
- [ ] **B1.** Create `eval/varianceProbe.ts` with `computeAgreement` (named export) + `main()` (real LLM, aborts on `OPENAI_API_KEY` unset, emits markdown agreement matrix). **GREEN**: A2's tests pass.
- [ ] **C1.** Run probe: `cd apps/api && npx tsx src/eval/varianceProbe.ts`. **Expected:** aborts with documented API rejection (`400 Unknown parameter: 'seed'.`). Save the output to `docs/plans/caresync-ai/variance-probe.md`.
- [ ] **D1.** `npx tsc --noEmit` clean; `npx jest --runInBand` all green.
- [ ] **D2.** Commit: `feat(S16): varianceProbe.ts — LLM-variance observation tool`. Push to origin.

**Verify:** 3 new varianceProbe tests pass; probe.md captures the API rejection; tsc + jest clean.

---

## Commit 3 — `feat(S16): risk rubric v2 — replace buildPrompt with few-shot + 0-anchors rule`

- [ ] **A1.** Locate existing 2 S13 regression-guard tests for `buildPrompt` (citation + bundle embedding). They stay.
- [ ] **A2.** Add 3 TDD tests for v2 structure (3 anchors present, "0 anchors → low" rule present, 3 worked examples with seed-text patient IDs). **RED**: tests fail.
- [ ] **B1.** Read `riskAgent.ts:85-100` (current 1-paragraph `buildPrompt`).
- [ ] **B2.** Replace `buildPrompt` body with v2 structure per `design-risk-calibration-v2.md`. **GREEN**: A2's tests pass.
- [ ] **B3.** Verify `runRiskAgent` is unchanged (only `buildPrompt` body was rewritten).
- [ ] **C1.** Quorum check: OpenAI quota available? If exhausted, document gate as "deferred" in `verification-s16.md`; do NOT commit; branch stays open. (Ponytail: no `--rubric` flag in `eval.ts` — the v2 prompt is the only prompt after commit 3 lands; the 2x2 baseline is `verification-s13.md §4`'s pre-S13 30.8% specificity number, already in the audit trail.)
- [ ] **C2.** Run gate: `cd apps/api && npx tsx src/scripts/eval.ts --risk-only`.
- [ ] **C3.** Extract 4 numbers: dev-labeled specificity (≥30%) + sensitivity (≥67%); held-out specificity (≥30%) + sensitivity (≥50%).
- [ ] **C4.** If all 4 hit thresholds → proceed to D. If any miss → branch stays open; iterate in follow-up commit.
- [ ] **D1.** `npx tsc --noEmit` clean; `npx jest --runInBand` all green.
- [ ] **D2.** Commit: `feat(S16): risk rubric v2 — replace buildPrompt with few-shot + 0-anchors rule`. Push to origin.

**Verify:** 2x2 gate passes; eval-report shows post-rubric dev-labeled + held-out numbers; P2 4→5 in HL7 evaluation.

---

## Phase G — Post-merge verification

- [ ] **G1.** `npm run eval` regenerated report: Risk dev-labeled specificity ≥30% (was 0%), sensitivity ≥67%; held-out specificity ≥30%, sensitivity ≥50%.
- [ ] **G2.** Variance probe re-run (post-merge) shows ≥80% per-patient agreement.
- [ ] **G3.** Write `verification-s16.md` per the 5-row matrix in `prd-s16.md D9` + reversion contingency paragraph per `prd-s16.md D7`.
- [ ] **G4.** Write `review-s16.md` per the S14/S15 two-axis pattern (Standards + Spec).
- [ ] **G5.** Re-run post-S16 HL7 evaluation → `reports/HL7-Challenge-Evaluation.2026-07-09-post-s16.md`. P2 4→5; total 89.2 → ~91.0.

---

## Definition of done

D1–D6 from `implementation-plan-s16.md` §"Definition of done". Headline: PR merged (or branch ready for merge pending user review), all 5 verification matrix signals pass, P2 4→5.

---

## Open follow-ups (deferred — NOT in this slice)

1. **Care Gap FN=10 / SDOH agreement regression** — same temperature+seed pin should help; if it persists, S17 = per-agent rubric investigations for Care Gap + SDOH.
2. **MODEL_CARD.md authoring** — Option B in S15 handoff; defer until S16's v2 rubric + variance pin stabilizes the Risk numbers.
3. **Clinician engagement** — S15's outreach log is the operational mechanism; engagement happens on its own clock, not gated by S16.
4. **In-app review queue** — deferred indefinitely (same call as S14 grill §7).
5. **Model-snapshot ID hunt** — uncertain whether OpenAI exposes one; defer until temperature+seed proves insufficient.
6. **Held-out inter-rater or hand-curated labels** — rejected in S15 grill §3; same call for S16.

---

# Archived slice: S14 — Close 4 Secondary Gaps (merged in PR #24)

## Approved: yes (merged)

Source: `implementation-plan-s14.md` · Spec: `prd-s14.md` (D1–D10) · Decisions: `grill-secondary-gaps.md` (9-question grill, S14/S15 split). Prior slice S11 archived in git history + `verification-s11.md`.

**Goal:** Close 4 of the 5 secondary gaps from the HL7 evaluation in a single PR (4 atomic commits): #2 SDOH imbalance, #3 clinician validation apply half, #4 confidence emission, #5 SMART enforcement. Gap #1 (Risk PPV / LLM variance) is out of scope — see S15.

**Architecture:** 3 new modules (`apply-clinician-review.ts`, `confidenceScorer.ts`, `smartAuth.ts`) + 8 modified files (seed-patients.ts, labels.json, agent.ts schema, citationValidator.ts call site, eval.ts disclosure, docker-compose.yml, server.ts middleware mount, package.json). TDD where applicable (#3, #4, #5); data-driven for #2 (no new logic, just new FHIR Observations).

**Ponytail pass applied:** minimum new seams (3); per-finding schema additions are additive; HAPI config is additive env vars + 1 bind-mount; no speculative work on gap #1; confidence scorer is pure (no I/O); no separate labels.clinician.json (would create two-tier complexity); no in-app clinician review queue.

**Branch state (per skill warning):** implementation must move to a fresh feature branch (e.g. `feature/s14-secondary-gaps`) before any code lands. Do NOT implement from `main`.

---

## Commit 1 — feat(S14): rebalance SDOH labels

- [ ] A1. Extend `SeedPatient` with `sdohNegative?: { id, note }` in `apps/api/src/fhir-data/seed-patients.ts`. `npx tsc --noEmit` clean.
- [ ] A2. Update `import-fhir.ts:189` to push both `sdohPositive` and `sdohNegative` AHC-HRSN Observations (LOINC 71802-3). `npx tsc --noEmit` clean.
- [ ] B1. Add `sdohPositive: { id: 'james-okafor-sdoh', note: 'AHC-HRSN screening positive: transportation barriers, medication-cost barriers' }` to `james-okafor`.
- [ ] B2. Add `sdohPositive: { id: 'angela-diaz-sdoh', note: 'AHC-HRSN screening positive: mental-health-access barriers, social isolation' }` to `angela-diaz`.
- [ ] B3. Add `sdohPositive` to `pop-0010` (index 9) in `population.ts`.
- [ ] B4. Add `sdohNegative: { id: 'robert-kim-sdoh', note: 'AHC-HRSN screening: no social barriers identified' }` to `robert-kim`.
- [ ] B5. Add `sdohNegative` to `pop-0005` (index 4) in `population.ts`.
- [ ] C1. Update `labels.json._meta.labelingRules.sdoh` to reference both `sdohPositive` and `sdohNegative`.
- [ ] C2. Update `james-okafor.sdoh` row: `expectedHasBarrier: true`, `expectedDomains: ['transportation', 'financial']`, rich notes. `source: "dev"` stays.
- [ ] C3. Update `angela-diaz.sdoh` row: `expectedHasBarrier: true`, `expectedDomains: ['mental-health', 'social-isolation']`, rich notes.
- [ ] C4. Update `pop-0010.sdoh` row: `expectedHasBarrier: true`, `expectedDomains: ['social-isolation', 'financial']`, rich notes.
- [ ] C5. Update `robert-kim.sdoh` row: `expectedHasBarrier: false`, rich notes (explicit-negative).
- [ ] C6. Update `pop-0005.sdoh` row: `expectedHasBarrier: false`, rich notes (explicit-negative).
- [ ] D1. `npm run import` (idempotent PUT). Verify HAPI has 5 new Observations.
- [ ] D2. Spot-check via curl: each new Observation returns the expected `valueString`.
- [ ] D3. Commit: `feat(S14): rebalance SDOH labels (3 positive + 2 explicit-negative)`.

**Verify:** `npm run eval` shows SDOH rate off 100%; TP/FP/TN/FN appear for the first time.

---

## Commit 2 — feat(S14): review:apply

- [ ] A1. RED: Create `apply-clinician-review.test.ts` with one round-trip test covering override + endorse + abstain in one fixture. `npx jest` → fails.
- [ ] A2. GREEN: Create `apply-clinician-review.ts` with `applyReview(reviewPath, labelsPath)` (reads, validates, mutates, writes). Round-trip test passes.
- [ ] A3. Add second test: bad patient ID → throws + labels.json untouched. Passes.
- [ ] B1. Add `main()` (cwd review, committed path labels, CHANGELOG summary, `require.main === module` guard) + add `"review:apply": "tsx src/scripts/apply-clinician-review.ts"` to `apps/api/package.json`.
- [ ] B2. Commit: `feat(S14): review:apply (the missing apply half)`.

**Verify:** `npx jest src/scripts/` all green; `npm run review:render` → fill form → download JSON → `npm run review:apply` → labels.json mutated as expected.

---

## Commit 3 — feat(S14): per-finding confidence

- [ ] A1. RED: Create `confidenceScorer.test.ts` with 5 cases (3 scorer functions + Action Planner derivation + 1 more). `npx jest` → fails.
- [ ] A2. GREEN: Create `confidenceScorer.ts` with `scoreRiskFlag`, `scoreCareGap`, `scoreSdohBarrier`, `deriveActionPlannerTaskConfidence`. All 5 tests pass.
- [ ] B1. Update `agent.ts` to add `confidence: number` to each finding shape (RiskOutput.flags, CareGapOutput.gaps, SdohOutput.barriers, ActionPlannerOutput.tasks) + update `mock-outputs.ts` to fill `confidence: 0.5` placeholder. `tsc --noEmit` clean.
- [ ] B2. Wire scorer into `citationValidator.ts`: call scorer after `validateCitations`, write score into the validated finding's `confidence` field.
- [ ] B3. `npx jest src/agents/` all green; no regressions.
- [ ] B4. Commit: `feat(S14): per-finding confidence via bundle-evidence heuristic`.

**Verify:** `npm run eval` shows per-agent confidence-bucketed accuracy sub-tables with non-zero buckets.

---

## Commit 4 — feat(S14): SMART enforcement A+B

- [ ] A1. Extract public key from `apps/api/src/smart/keys.ts` to `apps/api/src/smart/keys/smart-public.pem`. Update `docker-compose.yml` `hapi-fhir`: add `hapi.fhir.security.oauth.enable_jwt_validation: "true"` + `hapi.fhir.security.oauth.public_key_location: file:/keys/smart-public.pem` + bind-mount `./apps/api/src/smart/keys:/keys:ro`. `docker compose config` clean.
- [ ] B1. RED: Create `smartAuth.test.ts` with 5 cases (valid → next; no token → 401; tampered → 401; expired → 401; wrong scope → 403). `npx jest` → fails.
- [ ] B2. GREEN: Create `smartAuth.ts` with `createSmartAuthMiddleware({ publicKey, audience, requiredScopesByMethod })` + `smartAuthErrorHandler`. All 5 tests pass.
- [ ] C1. Mount middleware on HAPI-touching routes in `server.ts` (NOT on `/api/auth/*` or `/api/health`). Existing route tests still pass with valid Bearer tokens in fixtures.
- [ ] D1. `docker compose up -d hapi-fhir`. `curl -i http://localhost:8080/fhir/Patient/maria-chen` → 401 Unauthorized. With valid token: 200 OK with Patient body.
- [ ] D2. Commit: `feat(S14): SMART enforcement A+B (app middleware + HAPI config)`.

**Verify:** 401/200 curl evidence captured in `verification-s14.md`.

---

## Phase E — Post-merge verification

- [ ] E1. `npm run eval` regenerated report shows: SDOH rate off 100% (target 70-90%); SDOH TP/FP/TN/FN visible; per-agent confidence-bucketed tables non-zero; "Status" disclosure reads "X of 16 clinician-validated (Y%), M of 16 dev-labeled (N%)."
- [ ] E2. Write `verification-s14.md` per `verification-s13.md` template (outcome, evidence, TDD, live re-eval, definition-of-done, open follow-ups).
- [ ] E3. Write `review-s14.md` per `review-s13.md` two-axis pattern.

---

## Rollback / safety

| Commit | Revert | Reverts |
|---|---|---|
| 1 (SDOH) | `git revert <sha>` | Drops 5 new AHC-HRSN Observations (re-import); labels.json returns to 1/16-positive. |
| 2 (review:apply) | `git revert <sha>` | Removes script + tests + npm script. `review:render` still works. |
| 3 (confidence) | `git revert <sha>` | Removes scorer + schema + integration. Eval governance buckets return to zero. |
| 4 (SMART A+B) | `git revert <sha>` | Removes middleware + HAPI config. Pre-S14 gap returns. |

**Whole-PR revert:** `git revert <merge-sha>...<tip-sha>` reproduces pre-S14 state.

---

## Definition of done

D1–D9 from `implementation-plan-s14.md` §"Definition of done (S14)". Headline: PR merged, eval report shows the 4 improvements, verification-s14.md + review-s14.md ship.

---

## Open follow-ups (deferred — NOT in this slice)

1. **Risk agent v2 rubric + LLM-variance root cause** — owned by S15. Per `verification-s13.md §6`.
2. **Production SMART handoff** — point HAPI at a real SMART auth server. Noted in `verification-s14.md`.
3. **Model-version pin for the LLM API** — owned by S15 (cross-cutting).
4. **In-app clinician review queue** — deferred indefinitely.