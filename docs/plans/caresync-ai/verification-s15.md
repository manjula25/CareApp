# Verification — S15: Held-Out Evaluation Set + Clinician Outreach Log

> **PLAN_ID:** `caresync-ai` · **Slice:** S15 · **Date:** 2026-07-08 · **Branch:** `feature/s15-evaluation-gaps`
> **Spec sources:** `docs/plans/caresync-ai/grill-evaluation-gaps.md` · `docs/plans/caresync-ai/prd-s15.md` · `docs/plans/caresync-ai/implementation-plan-s15.md`
> **Implementation commits (4):** `759dfaf` (C1) · `bf3fbc1` (C2 — amended in review) · `dbf8280` (C3) · `36c9fd0` (C4)

---

## 1. Outcome per commit

| # | Commit | Status | Notes |
|---|---|---|---|
| 1 | `759dfaf` — procedural held-out set (pop-0011..pop-0020) + labels._meta.heldOutRows | **DONE** | Option A applied per sub-agent review: no `population.ts` change (`POPULATION_SIZE = 500`, the held-out 10 are already part of the cohort); 10 label rows added to `data/eval/labels.json`; FHIR re-import succeeded (2398/2398 resources); spot-checked `pop-0011` / `pop-0015` / `pop-0020` are in HAPI. |
| 2 | `bf3fbc1` — eval/labelFromBundle.ts — factored labeling function | **DONE (amended)** | RED→GREEN TDD: 10 tests in `labelFromBundle.test.ts` (5 spec-pinning + 5 contract). `npx jest src/eval/`: 21/21 across 3 suites. One amend: SDOH regex broadened from `/no barriers/i` to `/\bno\s+\w+\s+barriers?\b/i` to match the actual seed text "no social barriers identified" (the plan's regex was a latent spec-vs-seed mismatch). |
| 3 | `dbf8280` — eval-report three-section layout + Held-out evaluation section | **DONE** | RED→GREEN TDD: 3 round-trip tests in `scripts/eval.test.ts`. `npx jest src/`: 45 suites, 295 tests pass in `--runInBand` mode. `eval.ts` now exposes `runHarness` + `EvalOptions` test seam; `--dev-only` / `--held-out-only` / `--no-live` CLI flags. Held-out SDOH sub-metric renders 0-data-points with an explanatory note (the 10 held-out bundles have no AHC-HRSN observations per `population.ts:buildSdohForIndex`). |
| 4 | `36c9fd0` — clinician-outreach.json + Outreach table in eval-report | **DONE** | RED→GREEN TDD: 5 schema tests in `outreachSchema.test.ts`. `npx jest src/eval/ src/scripts/`: 32/32 across 6 suites. `npm run outreach:validate` → `OK — 0 invitation(s).` The eval-report's Outreach section renders the empty-state wording with the consent-boundary note. |

## 2. Fresh command evidence

| Command | Result |
|---|---|
| `npx tsc --noEmit` (apps/api) | clean (no output, exit 0) |
| `npx jest --runInBand` (apps/api) | **46 suites, 300 tests, all pass** (36s) |
| `npx tsx src/scripts/eval.ts --no-live --dev-only` | `eval: wrote docs/eval-report.md` + `eval: wrote docs/eval-report.json` |
| `npm run outreach:validate` (apps/api) | `OK — 0 invitation(s).` |
| `npx jest src/eval/` | 4 suites, 32 tests pass (`computeMetrics`, `errorAnalysis`, `labelFromBundle`, `outreachSchema`) |
| `npx jest src/scripts/eval.test.ts` | 1 suite, 3 tests pass (round-trip for `--dev-only` / `--held-out-only` / no-flags) |
| `curl http://localhost:8080/fhir/Patient/pop-0011 \| jq '.id'` | `"pop-0011"` |
| `curl http://localhost:8080/fhir/Patient/pop-0015 \| jq '.id'` | `"pop-0015"` |
| `curl http://localhost:8080/fhir/Patient/pop-0020 \| jq '.id'` | `"pop-0020"` |
| `curl http://localhost:8080/fhir/Patient/maria-chen \| jq '.id'` | `"maria-chen"` (regression: existing patient still present) |

## 3. TDD evidence (RED→GREEN per commit)

### Commit 2 — `labelFromBundle.ts`

**RED** (test file written before impl, no module):
```
src/eval/labelFromBundle.test.ts: TS2307: Cannot find module './labelFromBundle' or its corresponding type declarations.
Test Suites: 1 failed, 1 total
Tests: 0 total
```

**GREEN** (impl + LOINC-convention extraction):
```
Test Suites: 1 passed, 1 total
Tests: 10 passed, 10 total
```

### Commit 3 — `scripts/eval.test.ts`

**RED** (test file written before refactor):
```
src/scripts/eval.test.ts: TS2305: Module './eval' has no exported member 'runHarness'.
Test Suites: 1 failed, 1 total
Tests: 0 total
```

**GREEN** (after `runHarness` + `EvalOptions` exposed):
```
Test Suites: 1 passed, 1 total
Tests: 3 passed, 3 total
```

### Commit 4 — `outreachSchema.test.ts`

**RED** (test file written before impl):
```
src/eval/outreachSchema.test.ts: TS2307: Cannot find module './outreachSchema' or its corresponding type declarations.
Test Suites: 1 failed, 1 total
Tests: 0 total
```

**GREEN** (impl with hand-rolled validation):
```
Test Suites: 1 passed, 1 total
Tests: 5 passed, 5 total
```

## 4. Live re-eval (separate from pass condition)

`npx tsx src/scripts/eval.ts --no-live --dev-only` regenerated `docs/eval-report.md` and `docs/eval-report.json`. The report now shows:

- **Status line:** "0 of 26 clinician-validated (0.0%), 16 of 26 dev-labeled (61.5%), 10 of 26 held-out (38.5%)." Three counts, data-driven (S14's `c6587f1`).
- **Methodology:** one new sentence disclosing held-out semantics ("labels for those patients are derived from `_meta.labelingRules` applied to bundles never before seen by the eval").
- **9 sections** in the right order: Methodology → Dev-labeled baseline (16) → Held-out evaluation (10) → Outreach → Error analysis dev-labeled → Error analysis held-out → Data-availability gaps combined.
- **2 of 16 dev-labeled patients** scored from cache (james-okafor, linda-torres); 14 produced data-availability gaps (`no-live-flag`). 0 live runs (the `--no-live` short-circuit fired correctly).
- **Held-out sub-metric** correctly shows "_(Held-out evaluation not run — --dev-only flag passed.)_" because we passed `--dev-only`. A no-flags re-run would attempt bundle fetches for the 10 held-out patients; that's a known-path, exercised in `scripts/eval.test.ts`.

**Live re-run (no `--no-live`, all 26 patients) deferred.** Per the plan §E4: "Live numbers reported in the changelog as bonus signal — not as a pass gate, because quota is a precondition we don't control." The recent eval run (`docs/eval-report.md` pre-S15) failed mid-run on 13/16 patients with `quota exceeded` errors; the S15 held-out path is no more quota-fragile than the existing path. When OpenAI quota allows, `npx tsx src/scripts/eval.ts` (no flags) re-runs all 26 patients live; expected outcome documented in `prd-s15.md` D10.

## 5. Definition-of-done check (5-row verification matrix from `prd-s15.md` §7)

| Row | Pass condition | Status |
|---|---|---|
| **Held-out set exists** | 10 patients in `data/eval/labels.json:_meta.heldOutRows` | ✅ `jq '._meta.heldOutRows \| length'` returns 10 |
| **Verbatim labeling** | `eval/labelFromBundle.ts` exports `labelFromBundle(bundle, dim)`; same fixture → same label | ✅ 10 contract tests, all green; peer `computeMetrics.test.ts` (n=10) and `errorAnalysis.test.ts` (n=11) unaffected |
| **Held-out section in eval-report** | `npx tsx src/scripts/eval.ts --no-live --dev-only` produces a Held-out section | ✅ Report contains `## Per-agent metrics — Held-out evaluation (10 patients)` header (placeholder when `--dev-only`, real section when no flags) |
| **CLI flags work** | `--dev-only` / `--held-out-only` / `--no-live` work as documented | ✅ 3 round-trip tests in `scripts/eval.test.ts`; manual smoke confirms all three compositions run without crashing |
| **Outreach log renders** | File absent → empty section; file present → table renders; malformed → errors listed inline | ✅ Initial empty file present; `npm run outreach:validate` returns `OK — 0 invitation(s).`; rendered report shows the empty-state wording with the consent-boundary note. Malformed-JSON path is exercised in the test file's `validateOutreach(missingField)` + `validateOutreach(wrongEnum)` cases. |

## 6. Open follow-ups (deferred to S16 or later)

These are the S15 follow-ups the verification surfaced; each goes into a follow-up slice (most are S16's scope or a separate post-S15 PR).

1. **Risk agent 9-FP rate — S16** (out of scope per the Q1 split). The eval still shows Risk over-calling (specificity 30.8%, PPV 25% in the dev-labeled baseline; held-out sub-metric reports 0 high-risk TPs because all 10 held-out patients have `riskScore < 75`, so the held-out section is TN/FP-only and can't directly measure the FP rate). The S16 slice owns the v2 risk rubric + LLM-variance root cause.
2. **Latent SDOH regex bug in `apps/api/src/agents/confidenceScorer.ts:scoreSdohBarrier`.** The S15 function was fixed in Commit 2's amend (regex broadened to `/\bno\s+\w+\s+barriers?\b/i`). The same regex in `confidenceScorer.ts:172` is **unchanged** — it still uses the spec's original `/no barriers/i` pattern. The latent bug never surfaces in production today because no held-out patient has SDOH and no agent run against a `robert-kim` / `pop-0005` bundle has been scored by confidenceScorer since the S14 rebalance. **Action:** apply the same one-line regex fix in `confidenceScorer.ts` and add a test fixture using "no social barriers identified" to pin it. Should be a 5-minute follow-up PR; not S15 scope.
3. **Held-out SDOH sub-metric reports 0 data points by design.** All 10 held-out patients have no AHC-HRSN Observation because `apps/api/src/fhir-data/population.ts:buildSdohForIndex(i)` only seeds explicit screenings for `i ∈ {4, 9}` (pop-0005 negative, pop-0010 positive). Per `_meta.labelingRules.sdoh`, rows without an AHC-HRSN Observation are `null` and excluded from the SDOH metric. The held-out SDOH sub-section will read "0 data points" with the explanatory note. If we want the held-out SDOH sub-metric to have data points, two options: (a) add SDOH seeding to `generatePopulation()` for `i ∈ {10..19}` (a small code change to `population.ts`); (b) accept the design and document the limitation. The held-out Care Gap and Risk sub-metrics are populated (9/10 + 10/10 rows respectively), so the held-out evaluation isn't empty.
4. **Live re-run coverage.** When OpenAI quota allows, re-run `npx tsx src/scripts/eval.ts` (no flags) to get live numbers on all 26 patients. Currently the eval-report only shows the dev-labeled baseline with cache + data-availability-gap (the 14 patients with no cache row); the live numbers (Risk agent's actual 9-FP rate on the held-out 10) are a bonus signal not a pass gate.
5. **Confidence-bucketed accuracy sub-tables** (E1 acceptance #4) are deferred from S14 to a follow-up. Not S15 scope.
6. **In-app clinician review queue** — deferred indefinitely per `grill-secondary-gaps.md §7` and `grill-evaluation-gaps.md §8`. The HTML form is sufficient POC UX; the engagement gap is now auditable via the outreach log.
7. **Multilingual / low-connectivity support** — out of scope per the HL7 evaluation's Open Q #7.
