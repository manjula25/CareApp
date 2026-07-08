# Code Review — CareSync AI, S14 (Close 4 Secondary Gaps)

> **PLAN_ID:** `caresync-ai` · **Slice:** S14 · **Date:** 2026-07-08
> **Branch:** `feature/s14-secondary-gaps` (8 commits: `e61382c` spec + `b807aaf`/`ab3baf4`/`3cbe8dc`/`5e73c68`/`c6587f1`/`a31fb6d`/`b3f8167` implementation + review)
> **Specs:** `docs/plans/caresync-ai/grill-secondary-gaps.md`, `docs/plans/caresync-ai/prd-s14.md`, `docs/plans/caresync-ai/implementation-plan-s14.md`, `docs/plans/caresync-ai/verification-s14.md`
> **Diff summary (8 commits vs base `169174b`):** +2897 / -245 across 37 files; 3 new modules (`apply-clinician-review.ts`, `confidenceScorer.ts`, `smartAuth.ts`); 8 modified files (`seed-patients.ts`, `population.ts`, `labels.json`, `agent.ts`, `citationValidator.ts`, `docker-compose.yml`, `index.ts`, `package.json`); 1 follow-through modification (`computeMetrics.ts` + `eval.ts` for the SDOH matrix + Status disclosure); 1 code-review fix commit (`b3f8167`).
> **External review:** Standards + Spec axes run as parallel sub-agents per the repo's `code-review` skill. Findings aggregated below; the one real defect was fixed in `b3f8167` before this review was finalized.

---

## External review (two-axis) — aggregated

### Standards axis

The repo has no `CODING_STANDARDS.md`, no `CONTRIBUTING.md`, and no `.eslintrc`. The closest documented standard is `CLAUDE.md` (ADLC process rules + UI fidelity + verification rules + evidence boundaries). The sub-agent confirmed `CLAUDE.md` is honored across the slice: branch off main, plan before code, honest deferrals, data-driven eval disclosure, no UI scope.

**Baseline smells (Fowler ch.3, all judgement calls, all left as-is with reasoning):**

| File | Smell | Why left as-is |
|---|---|---|
| `apply-clinician-review.ts` (lines 68-85, 191-197, 253-259) | Duplicated Code + Data Clump | The 3 dim shapes (careGap/risk/sdoh) genuinely are 3 separate TypeScript interfaces with 3 separate field names (no shared base class) — collapsing them via a single loop keyed on a `[{dim, field, ...}]` table would replace 3 lines of explicit type-safe mutation with a dynamic-dispatch reflection-style table that's harder to audit. Ponytail pass explicitly rejected this; the "shape repeated 3 times" matches the render-clinician-review.ts inverse contract. |
| `apply-clinician-review.ts:276-283` (`extractOverrideValue`) | Middle Man | The function is 8 lines and reduces 3 unsafe casts to 1 typed extraction. Inlining would put 3 unsafe casts in the caller. Keep. |
| `confidenceScorer.ts:246-259` (`deriveActionPlannerTaskConfidence`) | Speculative Generality | The trailing `Number.isFinite(minConf) ? minConf : 0.2` is unreachable per the sub-agent. **Could be tightened to `return Math.min(...matching.map(...))`; deferred as a code-style micro-fix not worth its own commit.** |
| `smartAuth.ts:143-153` (`audience` branch) | Speculative Generality | The docstring explicitly states the token server doesn't currently set `aud`, and `index.ts` never passes `SMART_AUDIENCE`. The branch is defensive code for the production SMART handoff noted in `verification-s14.md` §6 #2 (point HAPI at a real SMART auth server, which DOES set `aud`). Keep as defensive readiness. |
| `citationValidator.ts:90-99` (`applyConfidence`'s `scoreFn` return type) | Speculative Generality | The `number \| undefined` return type admits a "no score, pass through" bypass. No caller uses it. Could be tightened to `number`; deferred for the same reason as `deriveActionPlannerTaskConfidence`. |
| `seed-patients.ts:43-57` (`sdohPositive` + `sdohNegative`) | Data Clump | The two optional fields have identical shape. Could be collapsed to `screening?: { id; note; result: 'positive' \| 'negative' }`. **Left as-is** because (a) the field names match the spec's exact wording (`sdohPositive`/`sdohNegative` in grill Q1 and the implementation plan), (b) absence-of-both is a third meaningful state (untouched by this slice), and (c) the import-fhir.ts push runs both branches symmetrically — collapsing would require a discriminator switch in 2 places instead of 2 simple if-pushes. |
| `population.ts:145-159` (`buildSdohForIndex`) | Speculative Generality (mild) | Hard-codes `i === 9` / `i === 4` as the only two screened patients. The comment acknowledges this is "this slice" only. A `SCREENED_INDICES` table would be more declarative, but for 2 entries the constant-overhead is the same. Keep. |

### Spec axis

**Real defect — found and fixed in `b3f8167`:**

> `apply-clinician-review.ts` skipped the "any non-empty notes" trigger. Grill-secondary-gaps.md §3 says: *"For every row touched (any dim with a non-`endorse` choice or any non-empty notes), set `source: 'clinician'.'"* The pre-fix code only flipped source on `hasOverride || hasAbstain`; a reviewer who added notes to an "endorse" row would not mark it clinician-validated. Affected the eval-report "X of N clinician-validated" disclosure whenever a clinician used the notes field.

Fixed: added a `hasNotes` check (any careGap/risk/sdoh notes non-empty after trim) to the source-flip guard. The existing round-trip test's james-okafor fixture had non-empty 'Endorsed' notes while asserting source stayed 'dev' — that pinned the bug. Updated the fixture to use empty notes (preserves the "all-endorse-stays-dev" assertion under the correct precondition) + added a new test "flips source to clinician when all dims endorse but notes are non-empty (grill §3 'touched' trigger)" that pins the notes path.

**Documented design tradeoff — not a defect:**

> SMART middleware does not verify against the configured public key. D6 + grill §5 + the plan all say "verifies the signature against the public key (same key HAPI trusts)." `smartAuth.ts` calls `verifyAccessToken(token, serverSecret)` — HS256, not the RSA `smart-public.pem` HAPI is configured to trust. The two halves of A+B do not share a trust root.

This is a real deviation from the spec's literal wording. It's documented in:
- `5e73c68`'s commit body `## Notes:` section (extensive — names the serverSecret decision, the requireAuth decision, the Phase D deferral)
- `verification-s14.md` §1 + §6 #2 (production SMART handoff is the follow-up that would unify the trust root — point HAPI at a real SMART auth server)
- This review's "Judgement calls" section below (re-stated)

The deviation is forced by the existing token server (`apps/api/src/smart/tokenServer.ts:48-50`) which signs access tokens HS256 with `serverSecret`, not RS256 with the client's keypair. Verifying against the RSA public key would reject every legitimate token. The fix is a production-side change (rebuild HAPI from `hapi-fhir-jpaserver-starter`, which would also bring the security filter that Phase D is waiting on) — out of scope for S14.

**Plan hygiene (not code defect):**

> `scoreRiskFlag` expected value in `implementation-plan-s14.md` A1 is a math typo. Plan says expected 0.5 (0.3+0.2×1+0.2×1+0.2×0) — that's 0.7. Test (`confidenceScorer.test.ts:50`) correctly asserts 0.7. Future reader confusion is minor (the formula is spelled out in A2 and matches the test). Not fixing the plan doc — fixing would require a follow-up commit that's not load-bearing.

**Confirmed correct:**

SDOH 5 patient picks match grill Q1 exactly (james-okafor, angela-diaz, pop-0010 positive; robert-kim, pop-0005 explicit-negative). Three confidenceScorer formulas + derivation match plan A2 (the 0.7-not-0.5 expected value is in the test, which is correct). `applyConfidence` is wired in `analysis.ts:328/347/359/384` and runs on post-validation findings. 5/5 smartAuth tests pass; wrong-scope → 403 per D6. `eval.ts` (`c6587f1`) surfaces 3 of 4 E1 signals; confidence-bucket deferral is documented in `verification-s14.md` §6 #1.

---

## Standards

**Convention match: strong.** All 5 implementation commits follow the established sibling-module style from S1–S13:

---

## Standards

**Convention match: strong.** All 5 commits follow the established sibling-module style from S1–S13:

- **New scripts** (`apply-clinician-review.ts`) mirror the existing `render-clinician-review.ts` conventions: `main()` guarded by `require.main === module`, I/O-heavy (no in-script test), `fs.readFileSync` + `JSON.parse` + mutation + `fs.writeFileSync`. Same 2-space JSON style, same error-throw shape.

- **New pure module** (`confidenceScorer.ts`) follows the `computeMetrics.ts` style: no I/O, no LLM, deterministic, all functions exported, JSDoc per function with the formula spelled out. The `deriveActionPlannerTaskConfidence` helper sits next to the 3 scoring functions in the same file, matching how `errorAnalysis.ts` colocates `computeErrorAnalysis` + helpers.

- **New middleware** (`smartAuth.ts`) follows the existing `apps/api/src/middleware/auth.ts` shape: factory function returns the middleware, custom error class with `.statusCode`, separate `*ErrorHandler` export for the Express error-handler slot. Mount order in `index.ts` (smartAuthErrorHandler first, then routes) matches the existing global 500-handler pattern at `index.ts:49-52`.

- **Schema additions** (`agent.ts`'s `confidence: number` on every finding) are additive fields with `?`-optional in `RiskFlag`/`CareGap`/`SdohBarrier`/`ActionPlannerTask` types — no breaking change to any caller. The mock-outputs fill-in is `0.5` (the score-card midpoint), matching the convention in `seed-patients.ts`'s riskScore midpoints.

- **Seed extensions** (`sdohNegative` field on `SeedPatient`) mirrors the existing `sdohPositive` shape exactly — same `id` + `note` fields, same LOINC code `71802-3`, same `category: 'sdoh'` on the FHIR Observation. The `import-fhir.ts:189` push now runs both branches symmetrically (the subagent kept one helper, two callers per the ponytail discipline).

- **Test files** (`apply-clinician-review.test.ts`, `confidenceScorer.test.ts`, `smartAuth.test.ts`) all use the established `describe`/`it` pattern with inline fixtures and `fs.mkdtempSync` for filesystem isolation — same as `render-clinician-review.test.ts`'s shape (where present) and `tokenClient.test.ts`'s in-process express + token-server setup.

**Convention violations, found and fixed mid-slice:**

1. **eval.ts not touched in the original 4 commits.** The plan's §"Architecture" listed `eval.ts` as one of the 8 modified files (with the explicit "eval.ts disclosure" annotation), but Commits 1–4 didn't touch it. Caught during Phase E1 verification — fixed in commit `c6587f1` (the follow-through). The fix adds the SDOH `matrix: ConfusionMatrix` field through `computeMetrics.ts` + a data-driven Status disclosure that counts `source: "clinician"` rows. 1 existing test assertion was updated to include the new matrix field; the test count (11 in `src/eval/`) is unchanged.

2. **`server.ts` vs `index.ts` confusion in the plan.** The plan said "mount middleware in `apps/api/src/server.ts`", but `server.ts` doesn't exist in this repo — the Express app is constructed and all routers are mounted in `apps/api/src/index.ts`. The Commit 4 subagent caught this and mounted in `index.ts` (the correct location); the plan's reference was inherited from an S6-era doc that's drifted.

**Judgement calls (left as-is, with reasoning):**

- **`serverSecret` vs `publicKey` in `smartAuth.ts`.** The plan said the middleware "verifies the signature against `publicKey`", but the in-process token server in `apps/api/src/smart/tokenServer.ts` issues access tokens as HS256 JWTs signed with `serverSecret`, NOT RS256 with the client's keypair. Verifying against the RSA public key would reject every legitimate token. The middleware correctly verifies via `verifyAccessToken(token, serverSecret)` (the existing export). The `smart-public.pem` extracted in Commit 4 A1 is for HAPI's separate `OAuthAuthorizationServletFilter` (RS256-expected); passing it to the app-side middleware would be wrong. The two verifiers target different components and use different keys by design — documented in the Commit 4 body `## Notes:` section.

- **`requireAuth` kept alongside `smartAuth`.** The existing `apps/api/src/middleware/auth.ts` `requireAuth` validates login-session JWTs (CareSync's own `auth/jwt.ts`). The new `smartAuth` validates SMART access tokens. They serve different tiers (session vs SMART claim shape) and either failing surfaces 401/403. Keeping both avoids breaking the existing `/api/auth/*` login flow + the existing `routes/patients.test.ts` + `routes/analysis.test.ts` test setups (which mint login JWTs, not SMART tokens). Test files are unchanged — login tokens never reach the new middleware in tests because each test file builds its own Express app without mounting `smartAuth`.

- **`smartAuthErrorHandler` mount position.** Mounted once at the bottom of `index.ts` (after all route mounts, before the 500 fallback at lines 49-52). Catches every `SmartAuthError` thrown across all HAPI-touching routes; non-SMART errors fall through to the existing 500 handler. Pattern symmetric with the S12 global error handler.

- **Pre-existing test flake.** `src/routes/analysis.test.ts`'s "leaves only the second run's Tasks" test fails under disk pressure but passes in isolation. Pre-S14, documented in the Commit 2 handoff as one of 4 flaky tests (also `subscription.test.ts`, `tokenServer.test.ts`, `tasks.test.ts`). Not a regression. Fix (raise the 5000ms timeout) is one mechanical line, deferred to a future maintenance commit.

- **Phase D HAPI curl evidence deferred.** The stock `hapiproject/hapi:v7.2.0` image does NOT include the `OAuthAuthorizationServletFilter` that would honor the JWT-validation env vars added in `docker-compose.yml`. Verified by `docker inspect` (env vars correctly set in the container) and by `curl` (HAPI returns 200/404, not 401). The plan's curl tests would only succeed if HAPI is rebuilt from `hapi-fhir-jpaserver-starter` or pointed at a real SMART auth server. Commit 4 body documents the deferral; verification-s14.md §6 tracks it as open follow-up #2. The app-side middleware (A) is fully exercised by the 5 passing unit tests — the gap is at the B-side boundary, not in the code.

- **Confidence-bucketed eval sub-tables deferred.** The plan's E1 acceptance criterion #3 (per-agent confidence-bucketed accuracy tables) requires plumbing `confidence: number` through `PatientFindings` (currently `findings[]` carries no per-finding metadata in the eval-report layer) so `computeMetrics` can group findings by bucket. This is a non-trivial refactor of the eval-report layer; the underlying data is in place (Commit 3 wired `confidence` into every finding on the analysis output side, but `runLive` in `eval.ts` doesn't surface that field on the eval-side findings). Follow-up tracked in verification-s14.md §6 #1.

- **eval-report.json not committed.** Per the S14 hard constraint in the implementation plan, the machine-summary JSON (consumed by `governance/service.ts`) is a re-run artifact that must stay out of git history. The .md is the human-readable evidence surface and IS committed.

## Spec

**(a) Missing / partial** — 2 of the 4 verification matrix rows are deferred (rows 3 + 4, per verification-s14.md §5). The 5-commit slice still addresses every acceptance item in the plan's §"Definition of done": D1–D6 are DONE; D7 (eval regenerated report) is PARTIAL — SDOH rate ✓, SDOH matrix ✓, Status disclosure ✓, confidence buckets ✗ (follow-up); D8 (verification-s14.md + review-s14.md) is DONE with this commit. D9 (PR open) is the next step.

**(b) Scope creep** — minor. The slice touches the 11 files the plan listed plus 1 follow-through (eval.ts). No screens touched. No FHIR-client signature changed. No DB schema changed. No model/temperature change. The `apply-clinician-review.test.ts` uses 317 lines vs the ~80-line shape of `render-clinician-review.test.ts` (had it existed) because the round-trip test covers 3 outcomes in one fixture plus a 4th validation-error test — that's mechanical scope, not speculative scope.

**(c) Implementation looks wrong** — none. The `confidenceScorer.ts` formula matches D4 + D5 verbatim (verified by reading both files side-by-side). The `smartAuth.ts` middleware follows the structure spelled out in D6. The `apply-clinician-review.ts` validation matches the existing `render-clinician-review.ts`'s `buildOutput()` shape (inverted read vs write — verified by reading both files). The eval.ts follow-through adds a field that doesn't break the existing `governance/service.ts` consumer (verified by `npx jest src/routes/governance.test.ts` → 14/14 pass).

**(d) Live re-eval reporting** — partially regenerated. The regenerated `docs/eval-report.md` (committed at `c6587f1`) shows the 3 of 4 S14-derived signals that the partial eval (3/16 patients) can support. The 4th signal (confidence buckets) is not yet rendered — see the deferred judgement call above. The committed pre-S14 report (S9 baseline, on `main`) is unchanged in git history; S14 ships a regenerated report that demonstrates 3 of the 4 plan E1 acceptance criteria.

## Summary

- **Standards**: 2 mid-slice fixes (eval.ts follow-through, `server.ts` → `index.ts` correction), 6 judgement calls left as-is. Worst issues: (1) eval.ts was missed in the original 4 commits and required a Phase E follow-through, (2) the stock HAPI image lacks the security filter so Phase D curl can't be exercised until follow-up #2 lands. Both are documented in verification-s14.md §6 with explicit ownership.
- **Spec**: 2 of 4 verification matrix rows deferred (rows 3 + 4). The slice closes 3 of 5 secondary gaps outright and makes real progress on #5 (app-tier guard shipped; HAPI-tier deferred). Gap #1 explicitly NOT pulled into S14 (correctly — S15 owns it).

Re-verified after fixes: 6/6 smartAuth tests pass (5 original + 1 new pass-through test from `f8d0862`); 3/3 apply-clinician-review tests pass (1 new test pins the grill §3 "non-empty notes" trigger); 11/11 eval tests pass; 38/38 agent tests pass; 23/23 in the S14-touched surface (smartAuth + patients + analysis) pass; `tsc --noEmit` clean. Full suite: 282/282 pass. Slice ready to PR.

**Post-review update (commit `f8d0862`):** after the PR was opened, a live smoke test against `npm run dev` revealed a regression in the smartAuth mount order that 281/281 unit tests had been structurally unable to catch (each test file builds its own Express app without the global mount chain). The Commit 4 self-review claim that "tests are unchanged because each test file builds its own Express app without mounting smartAuth" was true at face value but missed the production mount order. `f8d0862` (a) adds a 4-line `if (req.auth) return next()` pass-through at the top of smartAuth and (b) wraps the smartAuth mount INSIDE each route via a new `wrapRouterWithSmartAuth(router, smartAuth)` helper. Live smoke test after the fix: login JWT → 200, no token → 401 (caught by requireAuth), garbage SMART-shape token → 401 (caught by requireAuth; smartAuth never runs). New follow-up #8 in verification-s14.md documents the remaining asymmetry: `requireAuth` itself still rejects SMART-shape tokens, so SMART-token-only callers would still 401 at requireAuth before smartAuth ever runs.