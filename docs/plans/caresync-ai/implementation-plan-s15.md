# Implementation Plan — S15: Held-Out Evaluation Set + Clinician Outreach Log

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **PLAN_ID:** `caresync-ai` · **Slice:** S15 · **Date:** 2026-07-08
> **Status:** Ready for implementation (post-grill + post-PRD; awaiting user approval)
> **Specs (in dependency order):** `docs/plans/caresync-ai/grill-evaluation-gaps.md` (6-question grill, S15/S16 split), `docs/plans/caresync-ai/prd-s15.md` (PRD D1–D11), `reports/HL7-Challenge-Evaluation.2026-07-08.md` §E (biggest-risk decomposition), `docs/eval-report.md` (the current eval surface), `data/eval/labels.json:_meta.labelingRules` (labeling rules to factor), `apps/api/src/fhir-data/population.ts` (procedural generator to extend), `apps/api/src/scripts/eval.ts` (eval harness to split).

**Goal:** Close sub-gaps 1 (no held-out eval set) and 2 (0/16 clinician-validated labels, with the engagement piece as a non-gating outreach log) of the HL7 evaluation's biggest-risk decomposition, in a single PR (4 atomic commits). The 9-FP Risk-agent over-call (sub-gap 3) stays out of scope — that's S16 with its own `design-risk-calibration-v2.md`.

**Architecture:** Three new modules (`eval/labelFromBundle.ts`, `eval/outreachSchema.ts`, `scripts/outreach-validate.ts`); 1 new JSON artifact (`data/eval/clinician-outreach.json`); 2 modified files (`population.ts` count bump, `eval.ts` three-section layout + three new CLI flags); labels.json gets `_meta.heldOutRows` + 10 new label rows. TDD where applicable (commits 2 and 4); data-driven for commits 1 and 3. The 4 commits are independently revertable — same discipline as S14.

**Tech Stack delta:** no new external dependencies. Same Jest + tsx stack. No new validator library — JSON validation is hand-rolled against the schema (matches `apply-clinician-review.ts`'s hand-rolled validation pattern).

**Ponytail pass applied:** minimum new seams (3 modules + 1 script + 1 JSON, per `prd-s15.md` D9); `_meta.heldOutRows` is an additive field on the existing `labels.json` shape; outreach log is one new file, no separate "outreach database"; no in-app review queue (deferred indefinitely, same call as S14); no held-out inter-rater or hand-curated labels (rejected in grill §3); no live LLM in any test (`labelFromBundle` is pure, `outreachSchema` is pure, `eval --no-live` is cache-only). Action Planner is qualitative-only on the held-out set (no TP/FP/TN/FN shape).

**Domain source:** `data/eval/labels.json` `_meta.labelingRules.careGap` (LOINC → Condition mapping) and `._meta.labelingRules.sdoh` (the existing 1/16 → 4/16 + 2/16 SDOH distribution that S14 introduced), `apps/api/src/fhir-data/population.ts:127-134` `riskScoreFor()` (the deterministic risk score the new `labelFromBundle` delegates to), `apps/api/src/scripts/eval.ts` (the eval harness to extend), `apps/api/src/eval/computeMetrics.ts` + `errorAnalysis.ts` (the per-agent metric shapes the new sections reuse), `apps/api/src/scripts/render-clinician-review.ts` (the existing engagement round-trip S15 builds on; S15 doesn't modify it but the outreach log makes engagement of *that* round-trip auditable), `apps/api/src/scripts/apply-clinician-review.ts` (the validation-pattern precedent for `outreach-validate.ts`).

**Branch state:** session opened on `docs/eval-to-design-spec` (a `docs/*` feature branch per `CLAUDE.md` "Repo etiquette"). Implementation can proceed in place; if the user prefers a fresh `feature/s15-evaluation-gaps` branch, create it from `main` before commit 1 (per `CLAUDE.md` "Branch off `main`"). Implementation tasks below assume a clean working tree on a feature branch.

---

## Commit 1 — `feat(S15): procedural held-out set (pop-0011..pop-0020) + labels._meta.heldOutRows`

**Goal:** Generate 10 new procedural patients (`pop-0011`..`pop-0020`) and add them to `data/eval/labels.json` as a held-out set with `_meta.heldOutRows` declared. After this commit, the labels file knows about the held-out cohort; the eval harness doesn't yet render it (commit 3). No agent or eval-harness changes; no LLM calls.

**Architecture:** Extend `apps/api/src/fhir-data/population.ts`'s `generatePopulation()` to return 20 patients instead of 10. The held-out 10 keep deterministic `riskScoreFor()` outputs and the same condition/profile distribution as the existing 10. Add `_meta.heldOutRows: ["pop-0011", ..., "pop-0020"]` to `data/eval/labels.json` and 10 corresponding label rows. Re-import via `npm run import` (idempotent — same PUT-on-known-ids pattern as S14).

**Spec:** `prd-s15.md` D2 + D3. **Decision refs:** grill §2 + §3 (held-out shape + verbatim labeling rules).

### Phase A — Extend the procedural generator

- [ ] **A1. Read `apps/api/src/fhir-data/population.ts`** to find the `generatePopulation()` function and how it produces 10 patients. Locate the count literal (likely `Array.from({ length: 10 }, ...)` or similar) and any SDOH-positive/negative branching introduced by S14 (the 3 positive + 2 explicit-negative distribution).
  - *Verify:* `grep -n "length: 10\|generatePopulation" apps/api/src/fhir-data/population.ts` returns the count literal and the function signature.

- [ ] **A2. Bump the count from 10 to 20** in `generatePopulation()`. Keep the existing 10 (`pop-0001`..`pop-0010`) unchanged. The new 10 (`pop-0011`..`pop-0020`) get fresh id strings + the same deterministic profile-distribution logic.
  - *Ponytail:* if the count is hardcoded inline, change the literal; if it's a parameter, the caller in `eval.ts` and `import-fhir.ts` may need updating — but the existing call sites pass 10 explicitly, so the literal change is the only required edit.
  - *Verify:* `npx tsc --noEmit` clean from `apps/api`.

- [ ] **A3. Verify the SDOH distribution in the new 10** matches the existing 10's distribution (mix of `sdohPositive` / `sdohNegative` / absence per S14's 3+2+5 ratio, scaled proportionally — i.e., the new 10 should also have ~3 positive / ~2 explicit-negative / ~5 absence). If the generator is procedural, check whether the distribution is hardcoded or random-with-seed; if random, confirm the deterministic-seed behavior produces a clean distribution.
  - *If the distribution is off,* add explicit SDOH seeding for the held-out 10 in the same shape as the S14 commit (`{ id: 'pop-001N-sdoh', note: '...' }` for each new patient that needs a screening, mirroring the S14 commit's `pop-0010-sdoh` and `pop-0005-sdoh` pattern).
  - *Verify:* the 20 patients emitted by `generatePopulation()` have a clean SDOH distribution (read the output via a one-off `tsx` script or by extending an existing test).

### Phase B — Add label rows for the held-out 10

- [ ] **B1. Add `_meta.heldOutRows: ["pop-0011", "pop-0012", "pop-0013", "pop-0014", "pop-0015", "pop-0016", "pop-0017", "pop-0018", "pop-0019", "pop-0020"]`** to `data/eval/labels.json` (peer to `_meta.labelingRules` and `_meta.clinicianStatus`).
  - *Verify:* `jq '._meta.heldOutRows' data/eval/labels.json` returns the array.

- [ ] **B2. For each held-out patient `pop-0011`..`pop-0020`, add a label row to `data/eval/labels.json`'s `patients[]` array.** Use the verbatim rules from `_meta.labelingRules` (commit 2 factors these into `labelFromBundle`, but for now apply them by hand so commit 1 is purely a data change):
  - `patientId: "pop-001N"`, `source: "dev"`, `clinicianOverride: null`.
  - `careGap`: read the generated bundle's `conditions` and `observations`; apply the LOINC rule (E11.9 → HbA1c 4548-4, I50.9 → BNP 30934-4, N18.3 → eGFR 62238-1) to derive `expectedHasGap: boolean | null`. `notes`: "Held-out set patient generated 2026-07-08 for S15; bundle is independently generated, label derived from `_meta.labelingRules.careGap`."
  - `risk`: apply `riskScoreFor(bundle) ≥ 75` to derive `expectedHighRisk: boolean`. Include `seedRiskScore` (the deterministic riskScore). `notes`: "Held-out set patient; risk label derived from `_meta.labelingRules.risk` (riskScoreFor ≥ 75)."
  - `sdoh`: read the generated bundle's AHC-HRSN screenings; apply the SDOH rule (positive screening → `true`, negative → `false`, absent → `null`). `notes`: "Held-out set patient; SDOH label derived from `_meta.labelingRules.sdoh`."
  - `actionPlanner`: `{ notes: "Qualitative only — held-out set." }` (no quantitative metric; mirror the dev-labeled set's pattern).
  - *Ponytail:* if 10 hand-written rows is too much, write a one-off `tsx` script under `scripts/` that reads the generated bundles + the rules + the labels file and emits the rows; commit the script alongside the rows so the derivation is reproducible.
  - *Verify:* `jq '.patients | length' data/eval/labels.json` returns 26; `jq '.patients[] | select(.patientId | startswith("pop-001")) | .patientId' data/eval/labels.json` returns 10 ids.

- [ ] **B3. Update `_meta.clinicianStatus`** to read: `"Status (S15): N clinician-validated (X%), M dev-labeled (Y%), K held-out (Z%). The held-out 10 (pop-0011..pop-0020) are labeled via the same dev-interpreted rules as the dev-labeled 16, applied to independently-generated bundles. Held-out labels are mechanical; clinician-validated labels are tracked separately via the clinicianOverride slot."`
  - *Verify:* `jq '._meta.clinicianStatus' data/eval/labels.json` returns the updated text.

### Phase C — Re-import + verify

- [ ] **C1. Run `npm run import` from `apps/api`.** Idempotent (existing PUT-on-known-ids pattern).
  - *Verify:* "Import complete" with non-zero Patient count (10 more than before).
  - *If import fails:* check HAPI is up (`docker compose ps`); check `npx tsc --noEmit` after A2.

- [ ] **C2. Spot-check via curl that 1-2 new patients are in HAPI:**
  - `curl -s http://localhost:8080/fhir/Patient/pop-0011 | jq '.id'`
  - `curl -s http://localhost:8080/fhir/Patient/pop-0020 | jq '.id'`
  - *Verify:* both return the expected ids (or `not found` if the FHIR `Patient.id` is a slug like `pop-0011-patient` — adjust the curl accordingly).

- [ ] **C3. Commit 1:**
  ```
  feat(S15): procedural held-out set (pop-0011..pop-0020) + labels._meta.heldOutRows

  Bumps generatePopulation() from 10 to 20 patients, adds 10 new
  label rows (pop-0011..pop-0020) to data/eval/labels.json, declares
  _meta.heldOutRows. Labels are derived from the existing
  _meta.labelingRules applied to independently-generated bundles.

  No agent or eval-harness changes; commit 3 will render the new
  rows as a Held-out evaluation section in docs/eval-report.md.

  Spec: prd-s15.md D2 + grill-evaluation-gaps.md §2 + §3
  ```

---

## Commit 2 — `feat(S15): eval/labelFromBundle.ts — factored labeling function`

**Goal:** Factor the existing `_meta.labelingRules` logic into a single pure function `labelFromBundle(bundle, dim)` so the dev-labeled 16 and the held-out 10 score against exactly the same code. After this commit, the labeling contract is testable in isolation; commit 3 wires it into `eval.ts`.

**Architecture:** New `apps/api/src/eval/labelFromBundle.ts` (pure function module, peer to the existing `eval/computeMetrics.ts` + `eval/errorAnalysis.ts`). New `labelFromBundle.test.ts` (5 tests: 3 per-dimension + 1 determinism + 1 null-handling). No agent changes; no eval-harness wiring yet (commit 3 does that).

**Spec:** `prd-s15.md` D4. **Decision refs:** grill §3 (verbatim rules via factored function).

### Phase A — TDD scaffolding (RED → GREEN)

- [ ] **A1. Create `apps/api/src/eval/labelFromBundle.test.ts`** with 5 test cases FIRST (RED). All tests use fixture bundles (no HAPI I/O, no LLM):
  - `labelFromBundle(careGapFixtureBundle, "careGap")` — bundle has a Condition E11.9 + no matching HbA1c Observation → returns `true`. `expectedHasGap` is `true` because the gap is "diabetes without HbA1c on file."
  - `labelFromBundle(careGapFixtureBundle, "careGap")` — bundle has Condition E11.9 + HbA1c Observation on file → returns `false`.
  - `labelFromBundle(careGapFixtureBundle, "careGap")` — bundle has Condition F33.1 (depression, no established LOINC convention) → returns `null`.
  - `labelFromBundle(riskFixtureBundle, "risk")` — bundle with `riskScoreFor(bundle) = 87` → returns `true`. Bundle with `riskScoreFor(bundle) = 50` → returns `false`. (Use the existing `riskScoreFor` from `fhir-data/population.ts:127-134`.)
  - `labelFromBundle(sdohFixtureBundle, "sdoh")` — bundle has an AHC-HRSN Observation with positive screening code → returns `true`. Bundle has AHC-HRSN Observation with negative screening → returns `false`. Bundle has no AHC-HRSN Observation → returns `null`.
  - `labelFromBundle` determinism — call twice with the same inputs, assert identical return.
  - `labelFromBundle` null-handling — bundle with no resources returns `null` for every dim.
  - *Verify:* `cd apps/api && npx jest src/eval/labelFromBundle.test.ts` → all 5 tests FAIL (module doesn't exist).

- [ ] **A2. Create `apps/api/src/eval/labelFromBundle.ts`** (GREEN). Module exports:
  - `labelFromBundle(bundle: PatientBundle, dim: "careGap" | "risk" | "sdoh"): boolean | null`.
  - Care Gap branch: looks for Condition in `{E11.9, I50.9, N18.3}` (the LOINC conventions from `_meta.labelingRules.careGap`); for each found Condition, looks for the matching Observation by LOINC code `{4548-4, 30934-4, 62238-1}`; if Condition present and matching Observation absent → `true`; if both present → `false`; if no qualifying Condition → `null`.
  - Risk branch: calls `riskScoreFor(bundle)` (imported from `fhir-data/population.ts`); returns `riskScoreFor(bundle) >= 75`. (Edge case: if `riskScoreFor` throws on a bundle shape it doesn't recognize, the function catches and returns `null` — defensible for held-out bundles with unexpected shape.)
  - SDOH branch: looks for an `Observation` resource with LOINC code `71802-3` (AHC-HRSN screening); if `valueString` is a positive-screening note (does NOT match `/no barriers/i`) → `true`; if it matches `/no barriers/i` → `false`; if no such Observation → `null`.
  - Pure function — no I/O, no LLM, no global state. Deterministic.
  - *Domain rule:* the function reads the *bundle* only; it does NOT read `data/eval/labels.json`. The dev-labeled 16 and the held-out 10 both pass through this function — the only difference is which `data/eval/labels.json` row references the result.
  - *Verify:* test A1 now PASSES (all 5 tests green).

- [ ] **A3. Refactor: extract the LOINC-convention map** as a named constant at the top of `labelFromBundle.ts`:
  ```ts
  const CARE_GAP_LOINC_CONVENTIONS: Record<string, string> = {
    'E11.9': '4548-4',  // diabetes → HbA1c
    'I50.9': '30934-4', // CHF → BNP
    'N18.3': '62238-1', // CKD → eGFR
  };
  ```
  - *Ponytail:* single source of truth for the LOINC conventions. Mirrors the pattern in `_meta.labelingRules.careGap` text. If the rule ever changes, the function and the rule text change together.
  - *Verify:* all 5 tests still pass.

- [ ] **A4. Commit 2:**
  ```
  feat(S15): eval/labelFromBundle.ts — factored labeling function

  New apps/api/src/eval/labelFromBundle.ts exporting
  labelFromBundle(bundle, dim): boolean | null. Pure function —
  no I/O, no LLM. Mirrors the dev-interpreted _meta.labelingRules
  (careGap: Condition → LOINC, risk: riskScoreFor ≥ 75, sdoh:
  AHC-HRSN positive/negative/absent). Both the dev-labeled 16 and
  the held-out 10 score against this single function.

  No eval-harness wiring yet; commit 3 calls this from scripts/eval.ts.

  Spec: prd-s15.md D4 + grill-evaluation-gaps.md §3
  ```

---

## Commit 3 — `feat(S15): eval-report three-section layout + Held-out evaluation section`

**Goal:** Split `scripts/eval.ts` so the eval-report renders three sections (Status / Dev-labeled baseline / Held-out evaluation), accept three new CLI flags, and report per-agent metrics on the held-out set. After this commit, `npm run eval --no-live` produces a `docs/eval-report.md` that visibly contains a held-out section — the P6 lift signal.

**Architecture:** Modify `scripts/eval.ts` `renderMarkdown` + `buildJsonSummary` to split the patient loop by `_meta.heldOutRows`, render two parallel metric sections, accept `--dev-only` / `--held-out-only` / `--no-live` flags. Reuse `eval/computeMetrics.ts` for both sections (same function called twice). Outreach table is a placeholder here ("Outreach log not yet started" if `data/eval/clinician-outreach.json` is missing, full table if present); commit 4 wires the JSON file and validator.

**Spec:** `prd-s15.md` D5 + D6. **Decision refs:** grill §4 + §5 (eval-report shape + CLI ergonomics).

### Phase A — Split the patient loop

- [ ] **A1. Read `apps/api/src/scripts/eval.ts`** to find the patient loop and `renderMarkdown` + `buildJsonSummary` functions. Identify the existing single-pass logic (each patient → per-agent metrics → one section).
  - *Verify:* `grep -n "for.*patient\|renderMarkdown\|buildJsonSummary" apps/api/src/scripts/eval.ts` returns the relevant lines.

- [ ] **A2. Refactor `scripts/eval.ts`** to split the patient list at the top of the loop:
  - Read `data/eval/labels.json` and extract `_meta.heldOutRows` (default to `[]` if missing — backward compatible with pre-S15 label files).
  - Split `patients` into `devLabeledPatients` (all rows NOT in `_meta.heldOutRows`) and `heldOutPatients` (rows IN `_meta.heldOutRows`).
  - Run the existing per-agent metric computation twice — once for each subset.
  - For held-out patients, the `labelFromBundle(bundle, dim)` function (commit 2) provides the per-dimension label; the existing `expectedHasGap` / `expectedHighRisk` / `expectedHasBarrier` from the label file is the source of truth for dev-labeled patients (unchanged).
  - *Ponytail:* factor a `computePerAgentMetrics(patientRows, labelSource)` helper that takes either a label-row source (dev-labeled) or a bundle source (held-out); the existing metric logic is the same shape.
  - *Verify:* `npx tsc --noEmit` clean.

### Phase B — Render three sections

- [ ] **B1. Modify `renderMarkdown`** to produce three sections in this order:
  1. `# S9 Evaluation Report` (existing)
  2. `**Status (S15):**` line — compute from `data/eval/labels.json` source counts: "N of 26 clinician-validated (X%), 16 of 26 dev-labeled (Y%), 10 of 26 held-out (Z%)". (If `--held-out-only`, the dev-labeled count is 0 in this run, but the underlying label file's source field is unchanged — Status line should reflect the file state, not the run's filter; mirror the existing "X of 16" pattern.)
  3. `## Methodology` — add one sentence: "Held-out evaluation reports per-agent metrics on the 10 held-out procedural patients from `_meta.heldOutRows`; labels are derived from `_meta.labelingRules` applied to bundles never before seen by the eval."
  4. `## Per-agent metrics — Dev-labeled baseline (16 patients)` (existing, unchanged shape — only the header text changes; the metrics are the same as pre-S15).
  5. `## Per-agent metrics — Held-out evaluation (10 patients)` — new, identical metric shape. Header reads "10 patients" (or whatever subset actually scored; data-availability gaps merged into a single combined list at the bottom).
  6. `## Outreach` — new section, currently always "Outreach log not yet started." (commit 4 fills it from the JSON file).
  7. `## Error analysis — Dev-labeled (16 patients)` (existing).
  8. `## Error analysis — Held-out (10 patients)` (new, per-patient FP/FN list, same shape as dev-labeled).
  9. `## Data-availability gaps — combined` (new — single combined list, replaces the existing per-section gap list).
  - *Verify:* `npx tsx src/scripts/eval.ts --no-live --dev-only` produces a markdown file with the dev-labeled section and a "(Held-out evaluation not run — `--dev-only` flag passed.)" placeholder in the held-out slot.

- [ ] **B2. Modify `buildJsonSummary`** to mirror the three-section markdown layout. The JSON output gets `devLabeled`, `heldOut`, and `outreach` keys (the latter is an empty object until commit 4).
  - *Verify:* `jq 'keys' docs/eval-report.json` (post-eval) returns `["devLabeled", "heldOut", "outreach", ...]`.

### Phase C — CLI flags

- [ ] **C1. Add three CLI flag handlers** to `scripts/eval.ts`'s `main()`:
  - `--dev-only` — skip the held-out patient loop; render only the dev-labeled section. Held-out slot in markdown = "(Held-out evaluation not run — `--dev-only` flag passed.)".
  - `--held-out-only` — skip the dev-labeled patient loop; render only the held-out section.
  - `--no-live` — read from `analysis_cache` only; cache misses → data-availability gap with reason `no-live-flag`.
  - *Parse flags* using a small `parseArgs` helper or a manual `process.argv.includes('--dev-only')` check. (The existing eval script may already parse some flags — check first; if so, extend the existing parser rather than introducing a new one.)
  - *Verify:* `npx tsx src/scripts/eval.ts --no-live --dev-only` runs without error and produces the dev-only report.

- [ ] **C2. Verify flag composition:** `npx tsx src/scripts/eval.ts --no-live --held-out-only` runs and produces the held-out-only report. `npx tsx src/scripts/eval.ts --no-live` (no flags) runs and produces the full three-section report. `npx tsx src/scripts/eval.ts --dev-only` (no `--no-live`) attempts a live run — may fail if `OPENAI_API_KEY` is unset; that's expected (mock fallback should kick in for held-out and dev-labeled, per the existing `routes/analysis.ts` pattern).
  - *Verify:* all three compositions run without crashing; the produced report contents differ as expected.

### Phase D — Round-trip test

- [ ] **D1. Add a round-trip test** for `scripts/eval.ts` in a new `scripts/eval.test.ts` (or extend an existing eval test if present):
  - 1 test: with a fixture `labels.json` + fixture cache rows, run `eval --no-live --dev-only` programmatically, assert the produced markdown contains the "Dev-labeled baseline" header and does NOT contain the "Held-out evaluation" header (or contains the "not run" placeholder).
  - 1 test: with the same fixtures, run `eval --no-live --held-out-only`, assert the produced markdown contains the "Held-out evaluation" header and the "not run" placeholder for the dev-labeled section.
  - 1 test: with the same fixtures, run `eval --no-live` (no flags), assert the produced markdown contains both section headers.
  - *Verify:* all 3 tests pass via `cd apps/api && npx jest src/scripts/eval.test.ts`.

- [ ] **D2. Commit 3:**
  ```
  feat(S15): eval-report three-section layout + Held-out evaluation section

  Splits apps/api/src/scripts/eval.ts into two parallel patient loops
  (dev-labeled baseline + held-out evaluation) plus a third Outreach
  section. Adds --dev-only, --held-out-only, --no-live CLI flags.
  Reuses eval/computeMetrics.ts (same function called twice). Status
  disclosure now reports "N clinician-validated / 16 dev-labeled /
  10 held-out" with three counts.

  The held-out section uses labelFromBundle (commit 2) applied to
  the 10 independently-generated bundles; the dev-labeled section
  uses the existing _meta.labelingRules path (unchanged).

  Spec: prd-s15.md D5 + D6 + grill-evaluation-gaps.md §4 + §5
  ```

---

## Commit 4 — `feat(S15): clinician-outreach.json + Outreach table in eval-report`

**Goal:** Add the outreach log artifact + schema validator + `npm run outreach:validate` script + render the Outreach table in `docs/eval-report.md`. After this commit, the engagement gap is visible in the eval-report without being a verification gate.

**Architecture:** New `data/eval/clinician-outreach.json` (initial empty `invitations: []`). New `apps/api/src/eval/outreachSchema.ts` (pure validator). New `apps/api/src/eval/outreachSchema.test.ts` (4 tests). New `apps/api/src/scripts/outreach-validate.ts` (I/O script, mirrors `apply-clinician-review.ts` conventions). Wire the schema + rendering into `apps/api/src/scripts/eval.ts` (extends commit 3's empty Outreach slot to a real table). New `npm run outreach:validate` script in `package.json`.

**Spec:** `prd-s15.md` D7 + D8. **Decision refs:** grill §6 (outreach log architecture).

### Phase A — TDD schema validator (RED → GREEN)

- [ ] **A1. Create `apps/api/src/eval/outreachSchema.test.ts`** with 4 test cases FIRST (RED):
  - `validateOutreach(validJson)` → `{ ok: true }` — fixture has `_meta` + 1 `invitations` entry with all required fields.
  - `validateOutreach(missingField)` → `{ ok: false, errors: [...] }` — `invitations[0]` missing `sentAt`; error list includes a path-qualified error.
  - `validateOutreach(wrongEnum)` → `{ ok: false, errors: [...] }` — `channel: "carrier-pigeon"` is not in the enum; error list includes the enum.
  - `validateOutreach(emptyInvitations)` → `{ ok: true }` — `_meta` present, `invitations: []`; valid.
  - *Verify:* `cd apps/api && npx jest src/eval/outreachSchema.test.ts` → all 4 tests FAIL (module doesn't exist).

- [ ] **A2. Create `apps/api/src/eval/outreachSchema.ts`** (GREEN). Module exports:
  - `validateOutreach(json: unknown): { ok: true } | { ok: false; errors: string[] }`.
  - Pure function — no I/O, no LLM, no global state. Hand-rolled validation, no schema library (matches the project's "no schema library" convention used elsewhere in `apply-clinician-review.ts`).
  - Returns a structured error list with path-qualified messages (e.g., `"invitations[0].channel: must be one of email, in-person, slack, phone"`).
  - *Domain rule:* the schema is the single source of truth for the JSON shape. The eval-report renderer (commit 3) trusts the schema's verdict; missing/malformed files render with errors listed inline rather than crashing.
  - *Verify:* test A1 now PASSES (all 4 tests green).

- [ ] **A3. Add a 5th test** for missing `_meta`: `validateOutreach({})` → `{ ok: false, errors: [...] }` with an error mentioning `_meta`.
  - *Verify:* test passes.

### Phase B — I/O script + npm script

- [ ] **B1. Create `apps/api/src/scripts/outreach-validate.ts`** (mirrors `apply-clinician-review.ts`'s I/O conventions):
  - `main()` reads `data/eval/clinician-outreach.json` from `__dirname`-resolved path (NOT `process.cwd()` — same convention as `apply-clinician-review.ts:42`).
  - If the file doesn't exist → print "Outreach log not yet started." and exit 0. (This is a non-error state for a fresh repo.)
  - If the file exists → call `validateOutreach(parsed)`. On `{ ok: true }`, print "OK" + a small summary (N invitations, M sent, K returned, etc.). On `{ ok: false }`, print the error list and exit 1.
  - Guard with `if (require.main === module) { main(); }`.
  - *Verify:* `npx tsx src/scripts/outreach-validate.ts` runs without error on a fresh repo (file missing) and prints the expected message.

- [ ] **B2. Add `"outreach:validate": "tsx src/scripts/outreach-validate.ts"` to `apps/api/package.json` scripts.** Mirror the existing `"review:validate"` / `"review:render"` / `"review:apply"` pattern.
  - *Verify:* `npm run outreach:validate` works the same as `npx tsx src/scripts/outreach-validate.ts`.

- [ ] **B3. Create the initial `data/eval/clinician-outreach.json`** with empty `invitations: []`:
  ```json
  {
    "_meta": {
      "purpose": "Tracks clinician review invitations — does not gate the eval, surfaces the engagement gap explicitly.",
      "lastUpdated": "2026-07-08",
      "consentBoundary": "By adding a `reviewer` entry, the committer affirms the reviewer has consented to their name being recorded in this public eval artifact."
    },
    "invitations": []
  }
  ```
  - *Verify:* `npm run outreach:validate` prints "OK" + "0 invitations."

### Phase C — Wire into eval.ts

- [ ] **C1. Extend the Outreach section in `apps/api/src/scripts/eval.ts`'s `renderMarkdown`** to read `data/eval/clinician-outreach.json` and render the table:
  - File missing → render "Outreach log not yet started." (the existing commit-3 placeholder, kept as the missing-file path).
  - File present, `validateOutreach` returns `{ ok: true }` → render a markdown table: `| Reviewer | Sent At | Channel | Status | Labels Affected |` header + one row per invitation.
  - File present, `validateOutreach` returns `{ ok: false }` → render the error list inline (don't crash; the report is the place to surface this).
  - *Ponytail:* the read-and-validate is one helper function; the render is a small markdown-table builder; no I/O in the renderer itself.
  - *Verify:* `npm run eval --no-live` produces a report with the Outreach table populated (table from B3 is empty; add a 1-row fixture invitation manually for verification, then remove).

- [ ] **C2. Extend `buildJsonSummary`** to include an `outreach` key: `{ fileExists: bool, ok: bool, errors: string[], invitations: { reviewer, sentAt, channel, status, labelsAffected }[] }`.
  - *Verify:* `jq '.outreach' docs/eval-report.json` returns the expected structure.

### Phase D — Commit

- [ ] **D1. Commit 4:**
  ```
  feat(S15): clinician-outreach.json + Outreach table in eval-report

  Adds data/eval/clinician-outreach.json (initial empty invitations[])
  + apps/api/src/eval/outreachSchema.ts (pure validator) + 4 unit tests
  + apps/api/src/scripts/outreach-validate.ts (I/O script) + new
  npm run outreach:validate. Extends apps/api/src/scripts/eval.ts's
  renderMarkdown + buildJsonSummary to render the Outreach table
  (or "Outreach log not yet started" when the file is missing).

  Engagement is NOT a verification gate; the slice ships whether or
  not a clinician volunteers. The Outreach table makes the gap
  visible in docs/eval-report.md and gives the HL7 evaluation's
  Open Question #2 ("Has the HTML form been sent to any clinician?")
  a real answer from the artifact itself.

  Spec: prd-s15.md D7 + D8 + grill-evaluation-gaps.md §6
  ```

---

## Phase E — Verification matrix + verification-s15.md + review-s15.md (post-merge)

> These are post-merge verification steps. They run after all 4 commits land on the feature branch, not as part of any one commit.

- [ ] **E1. Run `npm run eval --no-live` from `apps/api`.** Confirm the new `docs/eval-report.md`:
  - Status line: *"0 of 26 clinician-validated (0.0%), 16 of 26 dev-labeled (61.5%), 10 of 26 held-out (38.5%)."*
  - Dev-labeled metrics: unchanged from pre-S15 (same labels, same agent outputs from cache).
  - Held-out metrics: 10 patients reported; per-agent sensitivity/specificity/PPV/matrix present. Most/all are `data-availability: no-live-flag` (cache cold for new IDs) — that's expected; the section renders correctly.
  - Outreach section: "Outreach log not yet started." (the initial empty file B3 created renders as an empty table; the `renderMarkdown` path that prints the missing-file placeholder is no longer hit because B3 created the file. The empty table itself is the "engagement gap" disclosure.)
  - Methodology section: contains the new sentence about held-out semantics.
  - *Verify:* the regenerated `docs/eval-report.md` exists and contains all 5 signals.

- [ ] **E2. CLI flag tests (re-verify the round-trip test from commit 3 D1 still passes):**
  - `npm run eval --no-live --dev-only` — dev-labeled section only, held-out slot shows "not run" placeholder.
  - `npm run eval --no-live --held-out-only` — held-out section only, dev-labeled slot shows "not run" placeholder.
  - `npm run eval --no-live` — full three-section report.

- [ ] **E3. `npm run outreach:validate`** — prints "OK" + "0 invitations" (the initial empty file from B3).

- [ ] **E4. Live re-run expectation (separate from pass condition).** When OpenAI quota allows, `npm run eval` (no flags) re-runs all 26 patients live. The live held-out numbers are reported in the changelog as bonus signal — NOT as a pass gate (per `prd-s15.md` D10). The recent eval already failed mid-run on 13/16 patients with `quota exceeded` errors (`docs/eval-report.md:73-79`), so live re-run is best-effort, not blocking.

- [ ] **E5. Write `docs/plans/caresync-ai/verification-s15.md`** following the `verification-s14.md` template:
  - Header: PLAN_ID, slice, date, spec sources (grill + prd + this plan).
  - §1: outcome — each of the 4 commits' status (DONE / NOT-DONE with reason).
  - §2: fresh command evidence (`npx jest`, `tsc --noEmit`, `npm run eval --no-live`, the 3 CLI flag compositions, `npm run outreach:validate`).
  - §3: TDD evidence (the new tests added in commits 2 and 4; their green-after-red traces).
  - §4: live re-eval (if quota allowed) — what changed in `docs/eval-report.md`.
  - §5: definition-of-done check (the 5-row verification matrix from `prd-s15.md` §7).
  - §6: open follow-ups — S16 (Risk rubric v2) is the next slice; engagement is a parallel track, not a verification gate.

- [ ] **E6. Write `docs/plans/caresync-ai/review-s15.md`** following the `review-s14.md` two-axis pattern (correctness + design).

---

## Rollback / safety

Each of the 4 commits is independently revertable:

| Commit | Revert command | What reverts |
|---|---|---|
| 1 (held-out set) | `git revert <commit-sha>` | Removes `_meta.heldOutRows` + 10 new label rows from `data/eval/labels.json`; reverts `generatePopulation()` count from 20 back to 10. The dev-labeled 16 are unchanged; the eval-report (after re-run) returns to its pre-S15 single-section shape (because commit 3's `--no-live` run would then have no held-out rows to render). |
| 2 (labelFromBundle) | `git revert <commit-sha>` | Removes `eval/labelFromBundle.ts` + tests. Commit 3's eval-harness change still references the function — so this revert requires a follow-up edit to `eval.ts` to inline the labeling logic OR to revert commit 3 as well. **Cleanest: revert 2 + 3 together.** |
| 3 (three-section layout) | `git revert <commit-sha>` | Reverts `scripts/eval.ts` to its pre-S15 single-section shape. The `--no-live` run reproduces the pre-S15 committed `docs/eval-report.md`. `data/eval/labels.json` still has `_meta.heldOutRows` (commit 1) but it's ignored; `labelFromBundle.ts` still exists (commit 2) but is unused. |
| 4 (outreach log) | `git revert <commit-sha>` | Removes `data/eval/clinician-outreach.json` + `eval/outreachSchema.ts` + `scripts/outreach-validate.ts` + `outreach:validate` npm script. The eval-report's Outreach section reverts to "Outreach log not yet started" (the commit-3 placeholder), then to a hardcoded placeholder if commit 3 is also reverted. |

**Safety net: the 4-commit PR can be reverted as a whole** (`git revert <merge-sha>...<tip-sha>`) if any single-commit revert is too surgical. The eval re-run after a full revert reproduces the pre-S15 committed `docs/eval-report.md`.

**Note on Commit 1 specifically:** the `_meta.heldOutRows` addition is additive — reverting it does NOT break the existing labels or the existing eval, only the held-out feature. The `generatePopulation()` count bump is also additive (the existing 10 patients are unchanged); reverting just removes the new 10.

---

## Definition of done (S15)

Maps to `issues.md` + `prd-s15.md`:

- [ ] **D1.** `apps/api/src/fhir-data/population.ts` `generatePopulation()` returns 20 patients; `data/eval/labels.json` has `_meta.heldOutRows: ["pop-0011", ..., "pop-0020"]` and 10 corresponding label rows.
- [ ] **D2.** `npm run import` succeeds; 10 new Patients (or Patient-flavored bundles) are fetchable from HAPI via curl.
- [ ] **D3.** `apps/api/src/eval/labelFromBundle.ts` exists with `labelFromBundle(bundle, dim): boolean | null`; all 5 `labelFromBundle.test.ts` tests pass; the function is pure (no I/O, no LLM).
- [ ] **D4.** `npm run eval --no-live` produces a `docs/eval-report.md` with three sections (Dev-labeled baseline / Held-out evaluation / Outreach) and the Status line reads *"N clinician-validated / 16 dev-labeled / 10 held-out."*
- [ ] **D5.** The three CLI flags (`--dev-only`, `--held-out-only`, `--no-live`) work as documented; round-trip test in `scripts/eval.test.ts` covers all three compositions.
- [ ] **D6.** `data/eval/clinician-outreach.json` exists with `_meta` + `invitations: []`; `apps/api/src/eval/outreachSchema.ts` exists with `validateOutreach(json)`; all 4 `outreachSchema.test.ts` tests pass.
- [ ] **D7.** `apps/api/src/scripts/outreach-validate.ts` exists; `npm run outreach:validate` prints "OK" on the initial empty file; `package.json` has the script.
- [ ] **D8.** `npm run eval --no-live` rendered report's Outreach section reflects the JSON file contents (empty table when `invitations: []`; populated table when entries exist; errors listed inline on malformed JSON).
- [ ] **D9.** `verification-s15.md` + `review-s15.md` written; all 5 verification matrix rows pass (held-out set exists, verbatim labeling, held-out section renders, CLI flags, outreach log renders).
- [ ] **D10.** Branch (e.g. `feature/s15-evaluation-gaps`) opens PR against `main`; PR description cites `prd-s15.md` and the grill file; merge per `CLAUDE.md` "Repo etiquette" (no direct commits to `main`).

---

## Open follow-ups (deferred — these belong to S16 or later)

1. **Risk agent v2 rubric + LLM-variance investigation — S16.** The 9-FP rate (specificity 30.8%, PPV 25%) lives in S16 with a fresh `design-risk-calibration-v2.md` + `verification-s16.md`. Mirrors S13's `design-risk-calibration.md` pattern. Do NOT pull into S15.
2. **Clinician engagement itself.** S15 ships the path (`review:render` + `review:apply` already built) and the tracking (outreach log). Engagement happens on its own clock, not gated by the slice.
3. **Live re-run of all 26 patients with real LLM calls.** Bonus signal when OpenAI quota allows; not a pass condition.
4. **In-app clinician review queue.** Deferred indefinitely. The `review:render` HTML is sufficient POC UX (same call as S14 grill §7 + S15 grill §8).
5. **Held-out labels via inter-rater agreement or hand-curation.** Rejected in grill §3 — would break apples-to-apples with the dev-labeled set.
6. **Model-version pin for the LLM API.** Cross-cutting, lives in S16 alongside the Risk rubric investigation.
7. **Multilingual / low-connectivity support.** Out of scope per HL7 evaluation Open Q #7.