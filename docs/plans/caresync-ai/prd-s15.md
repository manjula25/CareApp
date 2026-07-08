# PRD — S15: Held-Out Evaluation Set + Clinician Outreach Log

> **PLAN_ID:** `caresync-ai` · **Slice:** S15 · **Status:** Ready for `writing-plans` (ADLC: specify → plan)
> **Author:** Manjula / Bitcot · 2026-07-08
> **Upstream artifacts:** `docs/plans/caresync-ai/grill-evaluation-gaps.md` (6-question grill, S15/S16 split), `reports/HL7-Challenge-Evaluation.2026-07-08.md` §E (biggest risk/gap decomposition), `docs/eval-report.md` (the eval surface), `data/eval/labels.json:_meta.labelingRules` (the labeling function to factor), `apps/api/src/scripts/render-clinician-review.ts` + `apply-clinician-review.ts` (the existing engagement round-trip S15 builds on).
> **Tracker note:** This POC is Jira-free and file-backed (per `CLAUDE.md`). No issue-tracker publish and no triage labels applied — this file is the artifact. The slice name `S15` continues the existing `S#` convention used by S1–S14.

---

## Problem Statement

The HL7 AI Challenge evaluation report (`reports/HL7-Challenge-Evaluation.2026-07-08.md` §E) identified P2, P4, and P6 as the pillars bounded by three shared sub-gaps:

1. **No held-out eval set.** The 16 dev-labeled rows are the ground truth the eval is computed against — they are not a held-out set. The brief's P6 calibration is *"would score 5 with a held-out eval set showing sensitivity/specificity."* Without one, P6 caps at 4.
2. **0/16 clinician-validated labels.** The `review:render` + `review:apply` round-trip is built and tested (S14 commits `ab3baf4` + `b3f8167`). No clinician has used it. The eval-report's Status line reads *"0 of 16 clinician-validated (0.0%), 16 of 16 dev-labeled (100.0%)"* and the GD8 caveat renders.
3. **Risk agent over-calls risk (9 FPs, specificity 30.8%, PPV 25%).** This is an LLM-side investigation — out of scope for this slice; tracked for S16.

S14 closed four other gaps (SDOH rebalance, review:apply round-trip, per-finding confidence, SMART A+B enforcement). S15 closes sub-gaps 1 and 2 above; sub-gap 3 stays reserved for S16 with its own `design-risk-calibration-v2.md`.

From a **clinical evaluator's** perspective, the absence of a held-out set means every sensitivity/specificity number in `docs/eval-report.md` is computed against labels the eval-design team had visibility into when tuning the agent. That is the single weakest link in the eval methodology — even with the SDOH rebalance, the Care Gap specificity rests on a single negative example (`maria-chen`), and the agent's 9-FP rate on Risk cannot be diagnosed without an independent sample.

From a **submission-reviewer / judge** perspective, sub-gap 2 (no clinician engagement) is the question the HL7 rubric's Open Questions list names directly: *"Has the HTML form been sent to any clinician for review? If not, what is the timeline?"* The current answer is "no." S15 ships the path + the tracking so the answer becomes visible and the engagement becomes auditable.

---

## Solution

S15 closes sub-gaps 1 + 2 in a single four-commit PR. Each commit is atomic, the PR is reviewable as a unit, and the verification matrix in §5 is the unified acceptance signal: an `npm run eval --no-live` re-run + diff of `docs/eval-report.md` showing the new three-section layout and the Outreach table.

The four commits, in order:

1. **`feat(S15): procedural held-out set (pop-0011..pop-0020) + labels._meta.heldOutRows`**. Extends `apps/api/src/fhir-data/population.ts`'s `generatePopulation()` to produce 10 more deterministic procedural patients with `pop-0011`..`pop-0020` ids. Re-imports FHIR via `npm run import` (idempotent). Adds `_meta.heldOutRows: [...]` to `data/eval/labels.json`. Adds a `careGap` / `risk` / `sdoh` label row for each held-out patient using the existing `_meta.labelingRules` (mechanical derivation). Source stays `"dev"`.
2. **`feat(S15): eval/labelFromBundle.ts — factored labeling function`**. New `apps/api/src/eval/labelFromBundle.ts` exporting `labelFromBundle(bundle, dim): boolean | null` where `dim ∈ {"careGap", "risk", "sdoh"}`. Pure function — no I/O, no LLM. `scripts/eval.ts` calls it for both dev-labeled and held-out rows. Unit tests pin determinism (same input → same output) and per-dimension logic.
3. **`feat(S15): eval-report three-section layout + Held-out evaluation section`**. `scripts/eval.ts`'s `renderMarkdown` + `buildJsonSummary` produce three sections in order: Status (now three-count line), Dev-labeled baseline (existing), Held-out evaluation (new, identical metric shape to dev-labeled). Adds `--dev-only`, `--held-out-only`, `--no-live` CLI flags. Status disclosure now reads *"N clinician-validated / 16 dev-labeled / 10 held-out."* Error analysis splits into two sections (dev-labeled + held-out); data-availability gaps merge into one combined list.
4. **`feat(S15): clinician-outreach.json + Outreach table in eval-report`**. New `data/eval/clinician-outreach.json` (manual edit, missing-file tolerated) with `_meta` + `invitations[]`. New `apps/api/src/eval/outreachSchema.ts` (pure validator, unit-tested). New `apps/api/src/scripts/outreach-validate.ts` (read-only `OK` / errors printer). `scripts/eval.ts`'s `renderMarkdown` renders the Outreach table when the file exists; empty section + "Outreach log not yet started" when it doesn't.

The eval re-run after the four commits produces a `docs/eval-report.md` in which:
- Status line: *"N of 26 clinician-validated (X%), 16 of 26 dev-labeled (Y%), 10 of 26 held-out (Z%)"* (X=0 today, may move on engagement).
- Dev-labeled section: unchanged shape, unchanged numbers (S15 doesn't touch any agent, label function, or seed).
- Held-out section: per-agent metrics on the 10 held-out patients — Care Gap sensitivity/specificity/PPV/matrix, Risk sensitivity/specificity/PPV/matrix, SDOH agreement rate + matrix. All derived from `labelFromBundle()` applied to held-out bundles.
- Outreach section: empty table until invitations are added to `clinician-outreach.json`; renders as a small markdown table once entries exist.
- Methodology: one-sentence addition disclosing the held-out semantics.

The S15 score-card delta on the HL7 rubric: P6 potentially moves from 4 → 5 (held-out section lands, per the brief's calibration). P2 and P4 don't move from S15 alone — they move later when (i) a clinician runs `review:apply` and (ii) S16 ships the Risk rubric v2.

---

## User Stories

### Held-out set

1. As a **clinical evaluator** reading the eval report, I want a "Held-out evaluation" section that reports per-agent sensitivity / specificity / PPV on a sample of bundles the eval-design team had no visibility into, so that I can see whether the agent's accuracy generalizes beyond the dev-labeled set.
2. As a **clinical evaluator**, I want the held-out section to disclose that labels are derived from `_meta.labelingRules` (the same rules used for the dev-labeled set) applied to independently-generated bundles, so that the metric's credibility bound is explicit.
3. As a **clinical evaluator**, I want the held-out and dev-labeled sections to have the same metric shape (Care Gap sensitivity / specificity / PPV / matrix; Risk same; SDOH same), so that I can compare them side-by-side without re-parsing.
4. As a **clinical evaluator**, I want the held-out and dev-labeled numbers to be close (within statistical noise), so that I have evidence the agent generalizes; if they're wildly different, I want the error analysis to surface which patients diverged, so that the failure mode is investigable.
5. As an **eval operator** running `npm run eval`, I want a `--no-live` flag that runs off the existing `analysis_cache` rows, so that the eval-report renders correctly even when OpenAI quota is exhausted and I can iterate on the report shape without burning quota.
6. As an **eval operator**, I want `--dev-only` and `--held-out-only` flags that scope the run to one section, so that I can debug the held-out section without re-running all 16 dev-labeled patients (and vice versa).
7. As a **developer** maintaining the eval harness, I want the held-out patient list to come from `_meta.heldOutRows` in `data/eval/labels.json` (not a hardcoded array in `scripts/eval.ts`), so that the held-out cohort is configurable per-env and the file remains the single source of truth.

### Label-from-bundle factoring

8. As a **developer**, I want `eval/labelFromBundle(bundle, dim)` to be the single function that derives a label from a FHIR bundle, so that the dev-labeled 16 and the held-out 10 are scored against the same logic.
9. As a **developer**, I want the function to be pure (no I/O, no LLM), so that it's unit-testable with deterministic fixtures.
10. As a **test author**, I want a unit test that pins the function's output for one canonical fixture per dimension, so that any future schema change to the bundle or the labeling formula is regression-guarded.

### Outreach log

11. As a **submission reviewer / judge** reading the eval report, I want an "Outreach" section that shows who was invited to review, when, on what channel, and whether they responded, so that I can answer the rubric's Open Question *"Has the HTML form been sent to any clinician for review? If not, what is the timeline?"* from the artifact alone.
12. As a **clinical evaluator**, I want the Outreach section to be empty-but-honest when no invitations have been sent yet, so that the gap is visible but the report doesn't fabricate activity.
13. As a **developer / committer**, I want `data/eval/clinician-outreach.json` to be a simple JSON file I can edit by hand, so that adding an invitation is a `git commit`, not a CLI invocation.
14. As a **developer**, I want `npm run outreach:validate` (or equivalent) to print `OK` or list schema errors, so that I catch typos before the eval re-run.
15. As a **committer**, I want the schema to document the consent boundary explicitly in the file itself, so that adding a reviewer name is an act of affirmed consent.

### Cross-cutting

16. As a **reviewer** of the S15 PR, I want the four commits to be independently reviewable and individually revertable, so that if any one fix turns out to be wrong, it can be reverted without taking down the other three.
17. As a **release engineer**, I want the eval re-run after S15 to produce a `docs/eval-report.md` that is *strictly more informative* than the pre-S15 report (three-section layout, held-out section with real numbers, Outreach section present), so that the S15 PR is provably an improvement, not a side-grade.
18. As a **developer**, I want the `Status` line to read *"N clinician-validated / 16 dev-labeled / 10 held-out"* regardless of which subset ran (dev-only / held-out-only / full), so that the disclosure is always accurate.

---

## Implementation Decisions

### D1. Slice structure
S15 covers sub-gaps 1 (held-out set) + 2 (outreach log) in a single four-commit PR. Sub-gap 3 (Risk agent v2 rubric + LLM-variance investigation) is **out of scope** and gets its own slice (S16) with a fresh `design-risk-calibration-v2.md` and dedicated `verification-s16.md`. Rationale: sub-gap 3 is the only sub-gap whose root cause is LLM-side (model version, system prompt, temperature default) rather than product-side; bundling it with three product-side fixes would re-create the S13 audit-trail problem (one reversion implicates every change in the PR).

### D2. Held-out set: which patients
- 10 new procedural patients: `pop-0011`..`pop-0020`, generated by `apps/api/src/fhir-data/population.ts`'s `generatePopulation()`.
- Distribution targets match the existing 10 procedural patients (`pop-0001`..`pop-0010`): mix of CHF / diabetes / CKD / depression / hip-fx profiles, with the same SDOH positive/negative/absence distribution that S14 introduced (3 positive + 2 explicit-negative + 5 absence-of-screening, scaled proportionally to the held-out cohort).
- `_meta.heldOutRows: ["pop-0011", ..., "pop-0020"]` in `data/eval/labels.json`.
- Each held-out patient gets a label row with `source: "dev"` and a `notes` field explaining the dev interpretation (e.g., *"Generated 2026-07-08 for S15 held-out evaluation; bundle is independently generated, label derived from `_meta.labelingRules`."*).
- FHIR re-import via `npm run import` — idempotent, no manual seed re-write.

### D3. Held-out labeling rules
The held-out labels are derived mechanically from `_meta.labelingRules`:
- **CareGap** — `expectedHasGap = true` iff the bundle has a Condition with a LOINC convention (E11.9 / I50.9 / N18.3) and no matching Observation on file; `false` iff Condition + matching Observation both present; `null` if the patient has no qualifying condition.
- **Risk** — `expectedHighRisk = true` iff `riskScoreFor(bundle) ≥ 75`; `false` otherwise. (Where `riskScoreFor` is the existing deterministic function in `fhir-data/population.ts:127-134`.)
- **SDOH** — `expectedHasBarrier = true` iff bundle contains an AHC-HRSN Observation with a positive screening code; `false` iff contains an explicit-negative screening; `null` if no screening Observation is present.

The same `_meta.labelingRules` text governs the dev-labeled 16 — the dev-interpreted rules are the single function for both. Held-out scoring against the same function is the only apples-to-apples comparison.

### D4. `labelFromBundle.ts` factoring
- New file: `apps/api/src/eval/labelFromBundle.ts`.
- Export: `labelFromBundle(bundle: PatientBundle, dim: "careGap" | "risk" | "sdoh"): boolean | null`.
- Pure function — no I/O, no LLM, no global state. Reads `bundle.resources`, returns the derived label.
- `scripts/eval.ts` calls it inside the per-patient loop, replacing the existing inline label logic (currently reads from `data/eval/labels.json` for dev-labeled patients; for held-out patients, `labels.json:_meta.heldOutRows` is the source of the row index, but the actual label value comes from `labelFromBundle()`).
- Unit tests in `apps/api/src/eval/labelFromBundle.test.ts`:
  - 1 test per dimension (3 total) — fixture bundle, assert exact label.
  - 1 determinism test — same fixture called twice returns same result.
  - 1 null-handling test — bundle with no qualifying resources returns `null` for that dim.

### D5. Eval-report three-section layout
- `scripts/eval.ts` `renderMarkdown` produces a single markdown document with these sections in order:
  1. **Status** (one line) — *"N of 26 clinician-validated (X%), 16 of 26 dev-labeled (Y%), 10 of 26 held-out (Z%)."* Computed from `source` field counts (clinician-validated = rows where `source === "clinician"`; dev-labeled = dev-labeled rows not in `_meta.heldOutRows`; held-out = rows in `_meta.heldOutRows`).
  2. **Methodology** — existing + one new sentence disclosing held-out semantics.
  3. **Per-agent metrics — Dev-labeled baseline (16 patients)** — existing, unchanged shape.
  4. **Per-agent metrics — Held-out evaluation (10 patients)** — new, identical metric shape (sensitivity/specificity/PPV/matrix per agent).
  5. **Outreach** — new, rendered from `data/eval/clinician-outreach.json` (table) or "Outreach log not yet started" (when missing).
  6. **Error analysis — Dev-labeled (16 patients)** — existing, unchanged.
  7. **Error analysis — Held-out (10 patients)** — new, same per-patient shape as dev-labeled.
  8. **Data-availability gaps — combined** — merge the existing per-section gap lists into one combined list.
- `buildJsonSummary` mirrors the markdown shape — three sections in the JSON output.

### D6. CLI flags
- `--dev-only` — skip the held-out patient loop entirely; render only the dev-labeled section. Held-out section in markdown is replaced with "(Held-out evaluation not run — `--dev-only` flag passed.)".
- `--held-out-only` — skip the dev-labeled patient loop entirely; render only the held-out section. Status line still reads *"N clinician-validated / 16 dev-labeled / 10 held-out"* with dev-labeled = 0 (because the run skipped them); held-out = 10.
- `--no-live` — do not invoke the LLM. Read from `analysis_cache` only. Cache misses → "data-availability gap" with reason `no-live-flag`. This is the verification flow.
- All three flags compose: `npm run eval --dev-only --no-live` runs dev-labeled only, off cache. Default = no flags = full live run.

### D7. Outreach log: shape
```json
{
  "_meta": {
    "purpose": "Tracks clinician review invitations — does not gate the eval, surfaces the engagement gap explicitly.",
    "lastUpdated": "2026-XX-XX",
    "consentBoundary": "By adding a `reviewer` entry, the committer affirms the reviewer has consented to their name being recorded in this public eval artifact."
  },
  "invitations": [
    {
      "reviewer": "Dr. M. Smith",
      "sentAt": "2026-XX-XX",
      "channel": "email",
      "status": "sent",
      "labelsAffected": 0
    }
  ]
}
```
- `channel` enum: `email` | `in-person` | `slack` | `phone`.
- `status` enum: `sent` | `returned` | `declined` | `no-response`.
- `labelsAffected` integer ≥ 0 — number of label rows the reviewer has touched in `data/eval/labels.json` (filled in by a committer post-engagement, not auto-computed).
- `_meta.lastUpdated` is the date of the most recent edit; committers update it by hand (no automated setter).

### D8. Outreach log: validation + script
- New file: `apps/api/src/eval/outreachSchema.ts` — exports `validateOutreach(json: unknown): { ok: true } | { ok: false; errors: string[] }`. Pure function.
- New file: `apps/api/src/scripts/outreach-validate.ts` — I/O script, reads `data/eval/clinician-outreach.json`, calls `validateOutreach`, prints `OK` or lists errors. Follows `apply-clinician-review.ts` conventions (path resolved from `__dirname`, `main()` guarded by `require.main === module`).
- New `apps/api/package.json` script: `"outreach:validate": "tsx src/scripts/outreach-validate.ts"`.
- `scripts/eval.ts` calls `validateOutreach` on the parsed JSON; if `ok: false`, renders the error list inline in the Outreach section (so the eval-report surfaces the schema problem rather than crashing).
- Missing file (`fs.existsSync(...) === false`) → `validateOutreach` is not called; render "Outreach log not yet started." in the Outreach section.

### D9. File-level change set
**New files (5):**
- `apps/api/src/eval/labelFromBundle.ts`
- `apps/api/src/eval/labelFromBundle.test.ts`
- `apps/api/src/eval/outreachSchema.ts`
- `apps/api/src/eval/outreachSchema.test.ts`
- `apps/api/src/scripts/outreach-validate.ts`

**New artifacts (2):**
- `data/eval/clinician-outreach.json` (initial empty `invitations: []`, plus `_meta`)
- 10 new entries in `data/eval/labels.json:_meta.heldOutRows` + 10 new label rows for `pop-0011`..`pop-0020`

**Modified files (no seam changes):**
- `apps/api/src/fhir-data/population.ts` — bump the `generatePopulation()` count from 10 to 20 (or expose a `count` parameter) so the held-out 10 are generated.
- `apps/api/src/scripts/eval.ts` — read `_meta.heldOutRows`, split the patient loop, call `labelFromBundle` for held-out patients, render three sections, call `outreachSchema.validateOutreach`, accept three new CLI flags.
- `data/eval/labels.json` — add `_meta.heldOutRows`, add 10 new patient rows.
- `apps/api/package.json` — add `"outreach:validate"` script.

**Not modified (intentionally):**
- `apps/api/src/agents/*.ts` — no agent changes.
- `apps/api/src/scripts/render-clinician-review.ts` + `apply-clinician-review.ts` — no engagement-path changes (already complete from S14).
- `docker-compose.yml`, `apps/api/src/middleware/smartAuth.ts` — no SMART changes.
- `apps/api/src/agents/confidenceScorer.ts` — no confidence changes.

### D10. Eval re-run expectations (S15)
After S15 lands, `npm run eval --no-live` produces:
- Status line: *"0 of 26 clinician-validated (0.0%), 16 of 26 dev-labeled (61.5%), 10 of 26 held-out (38.5%)."* (X stays 0 until engagement.)
- Dev-labeled metrics: unchanged from pre-S15 (same labels, same agent outputs from cache).
- Held-out metrics: per-agent sensitivity/specificity/PPV/matrix on the 10 held-out patients. Numbers depend on what's in `analysis_cache` for `pop-0011`..`pop-0020` — likely all "data-availability: no-live-flag" entries on a `--no-live` run (these patients are new IDs, so cache is cold).
- Outreach section: "Outreach log not yet started." until someone creates `data/eval/clinician-outreach.json`.

When OpenAI quota allows, `npm run eval` (no flags) re-runs all 26 patients live. Live numbers reported in the changelog as bonus signal — not as a pass gate.

### D11. Engagement operationalization
- S15 ships the **path** (`review:render` + `review:apply` already built) and the **tracking** (outreach log). Engagement is **not** a verification gate.
- The S15 PR's `verification-s15.md` documents that engagement happens on its own clock and lists the next action: "Distribute `docs/eval-clinician-review.html` (or the rendered output of `npm run review:render`) to a clinician; record the invitation in `data/eval/clinician-outreach.json`."
- When engagement lands, the next eval re-run automatically picks up the new `source: "clinician"` rows (S14's `c6587f1` made the disclosure data-driven).

---

## Testing Decisions

### T1. What makes a good test for S15
- **External behavior only** — test the *output shape* of `labelFromBundle`, the *file-rendering* result of `scripts/eval.ts` (`--no-live` mode), the *JSON validation* result of `validateOutreach`, and the *eval-report* content after re-run.
- **No live LLM calls in any S15 test.** `labelFromBundle` is pure; `eval.ts --no-live` is cache-only; `outreach-validate.ts` is file-only.
- **Real-but-small fixtures.** Held-out patient labels are derived from the same `_meta.labelingRules` as dev-labeled; test fixtures are bundles with known label outcomes.
- **Round-trip test for `eval.ts`** — start with a fixture `labels.json` + fixture cache rows, run `eval --no-live --dev-only`, assert the dev-labeled section renders. Run `eval --no-live --held-out-only`, assert the held-out section renders (with data-availability gaps for cache misses).

### T2. Prior art
- **`scripts/eval.ts` already has the patient loop + per-agent metrics rendering.** S15 doesn't add a new evaluation pass — it splits the existing one. Same shape as `renderMarkdown` and `buildJsonSummary`.
- **`apps/api/src/eval/` is a new directory.** The existing `eval/computeMetrics.ts` + `eval/errorAnalysis.ts` live here; S15 adds `eval/labelFromBundle.ts` + `eval/outreachSchema.ts` to the same directory.
- **`apply-clinician-review.ts` validates-then-mutates pattern.** S15's `outreach-validate.ts` follows the same pattern (validate-only, no mutation).
- **Pure-function unit tests** (`computeMetrics.test.ts`, `errorAnalysis.test.ts`, `confidenceScorer.test.ts`) — S15's `labelFromBundle.test.ts` and `outreachSchema.test.ts` follow the same fixture pattern.

### T3. What gets tested in each new file
- `apps/api/src/eval/labelFromBundle.test.ts`:
  - 1 test per dimension (3 total) — fixture bundle, assert exact label.
  - 1 determinism test — same fixture called twice returns same result.
  - 1 null-handling test — bundle with no qualifying resources returns `null` for that dim.
- `apps/api/src/eval/outreachSchema.test.ts`:
  - 1 valid-JSON test — fixture matches schema, `validateOutreach` returns `{ ok: true }`.
  - 1 missing-field test — `invitations[0]` missing `sentAt`, returns `{ ok: false, errors: [...] }`.
  - 1 wrong-enum test — `channel: "carrier-pigeon"`, returns `{ ok: false, errors: [...] }`.
  - 1 empty-invitations test — `_meta` present, `invitations: []`, returns `{ ok: true }`.
  - 1 missing-_meta test — top-level `_meta` absent, returns `{ ok: false, errors: [...] }`.

### T4. Integration tests in `verification-s15.md`
- 1 `npm run eval --no-live --dev-only` command + diff of `docs/eval-report.md` — must show only the Dev-labeled section, Status line correct (held-out count present).
- 1 `npm run eval --no-live --held-out-only` command + diff — must show only the Held-out section, all 10 patients reported as data-availability gaps.
- 1 `npm run eval --no-live` (no flags) command + diff — must show both sections + Outreach section.
- 1 `npm run outreach:validate` against the initial empty `clinician-outreach.json` — must print `OK`.
- 1 `npm run outreach:validate` against a fixture `clinician-outreach.json` with a typo — must list the schema error.
- 1 `labelFromBundle` determinism re-run with a fixture bundle + dim — must produce the same label across two consecutive calls.

### T5. What does NOT get tested
- The internal `scripts/eval.ts` patient loop iteration order — only the rendered output is tested.
- The new CLI flags' internal branching — only the rendered output is tested (different flags → different output).
- Live LLM behavior (no live LLM call anywhere in S15 tests).
- The existing agent / label / scoring / SMART logic — S15 doesn't touch any of it.
- The `data/eval/labels.json` `_meta.heldOutRows` mutation — that's a file edit, validated by `eval.ts` reading the field at runtime.

---

## Out of Scope

- **Risk agent v2 rubric + LLM-variance investigation — S16.** Deferred. Tracked in `docs/plans/caresync-ai/verification-s13.md §6` as cross-slice debt. S16's design thread is intentionally not started by this PRD.
- **Held-out labels via inter-rater agreement.** Rejected in grill §3. Would require infrastructure (Cohen's kappa, two-dev labeling workflow) that the POC doesn't have and S14 explicitly rejected.
- **Hand-curated held-out labels.** Rejected in grill §3. Breaks apples-to-apples with the dev-labeled set.
- **In-app clinician review queue.** Deferred indefinitely. The `review:render` HTML is sufficient POC UX (same call as S14 grill §7).
- **Two-tier label system** (`labels.clinician.json` "blessed" file as a separate source of truth). Not needed for POC; `data/eval/labels.json` with the `source` field on every row is the single source of truth.
- **Held-out scoring on ActionPlanner.** Qualitative-only, no TP/FP/TN/FN shape for it.
- **Model-version pin for the LLM API.** Cross-cutting, lives in S16 alongside the Risk rubric investigation.
- **Multilingual / low-connectivity support.** Out of scope per HL7 evaluation Open Q #7.
- **Clinician engagement itself.** S15 ships the path + the tracking; engagement happens on its own clock, not gated by the slice.
- **A clinician-engagement SLA or timeline.** The HL7 evaluation's Open Q #2 asks for a timeline; S15 doesn't commit one because the timeline depends on factors outside the codebase (which clinician, when they're available). The outreach log makes the timeline auditable *after* invitations go out; before that, the answer is "no invitations sent yet."

---

## Further Notes

### Sequencing within S15
The four commits land in the order: #1 (held-out set) → #2 (labelFromBundle) → #3 (three-section layout) → #4 (outreach log). Rationale:
- #1 is the largest data change (10 new patients + label rows + `_meta.heldOutRows`); doing it first means the re-import is the first thing the PR does and the data surface is stable before the code surface changes.
- #2 is the smallest code change (one pure function + tests); doing it second establishes the labeling contract before the eval harness starts using it.
- #3 is the eval-harness change (split patient loop, render three sections, accept three flags); doing it third means the eval-report rendering is the last big change and depends on the previous two.
- #4 is the smallest isolated change (one JSON file + one validator + one script); doing it last means the existing eval-report rendering is unchanged until the very end, simplifying any rollback.

This order is the *recommended* merge order; if the user prefers a different order, the verification matrix is the same.

### Upstream dependencies
- `docs/plans/caresync-ai/grill-evaluation-gaps.md` (the shared-understanding artifact this PRD is derived from).
- `reports/HL7-Challenge-Evaluation.2026-07-08.md` §E (the biggest risk/gap decomposition that motivates the slice).
- `docs/eval-report.md` (the current eval report that the S15 re-run must improve into a three-section layout).
- `data/eval/labels.json:_meta.labelingRules` (the labeling function that gets factored into `labelFromBundle.ts`).
- `apps/api/src/fhir-data/population.ts` (the procedural generator that gets the count bumped).
- `apps/api/src/scripts/eval.ts` (the eval harness that gets the three-section layout).
- `apps/api/src/scripts/render-clinician-review.ts` + `apply-clinician-review.ts` (the existing engagement round-trip S15 builds on; S15 doesn't modify either, but the outreach log makes engagement of *that* round-trip auditable).

### Downstream artifacts (S15 commits, in order)
1. `feat(S15): procedural held-out set (pop-0011..pop-0020) + labels._meta.heldOutRows` — population.ts (count bump), labels.json (10 new rows + `_meta.heldOutRows`), no eval-report change yet.
2. `feat(S15): eval/labelFromBundle.ts — factored labeling function` — new `eval/labelFromBundle.ts` + tests, no eval-report change yet.
3. `feat(S15): eval-report three-section layout + Held-out evaluation section` — eval.ts (split patient loop, three-section markdown, three CLI flags), eval-report.md regenerated.
4. `feat(S15): clinician-outreach.json + Outreach table in eval-report` — new `eval/outreachSchema.ts` + `outreach-validate.ts` + tests, new `data/eval/clinician-outreach.json`, eval.ts renders Outreach section.

### Post-merge follow-up (S16)
- Open a new grill for S16 (Risk v2 rubric + LLM-variance root cause) with a fresh `design-risk-calibration-v2.md` + `prd-s16.md` + `verification-s16.md`.
- If the LLM-variance investigation finds a model-version pin, that change lands in S16, not S15.

### Engagement playbook (informational, not a verification gate)
- The outreach log is the operational mechanism: each invitation sent / returned / declined becomes a row in `data/eval/clinician-outreach.json`, committed alongside the eval-report diff.
- The `review:render` HTML form is the artifact: `npm run review:render` produces `docs/eval-clinician-review.html`, which can be sent to a clinician by any channel (`email`, `in-person`, etc.).
- When the clinician returns `labels.clinician-review.json`, `npm run review:apply` writes it back to `labels.json` (S14). The next eval re-run shows the new `source: "clinician"` count.
- This is engagement, not S15 code. S15 makes it auditable; it doesn't drive it.