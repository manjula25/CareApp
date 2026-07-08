# Grill — S15 Evaluation Gaps (held-out set + clinician engagement outreach log)

> **PLAN_ID:** `caresync-ai` · **Date:** 2026-07-08
> **Trigger:** the "Biggest risk/gap" section of `reports/HL7-Challenge-Evaluation.2026-07-08.md` identified P2/P4/P6 as the pillars bounded by three sub-gaps — 0/16 clinician-validated labels, Risk agent's 9-FP rate (specificity 30.8%, PPV 25%), and the absence of a held-out eval set. S14 closed four of the five secondary gaps (`docs/plans/caresync-ai/grill-secondary-gaps.md`) and reserved S15 for the Risk rubric. This grill re-derives S15's scope to absorb the held-out + outreach-log work, splitting the Risk rubric into a separate S16.
> **Status of this doc:** shared-understanding artifact — the next ADLC step is `to-prd`, which reads this file and `reports/HL7-Challenge-Evaluation.2026-07-08.md` to draft `prd-s15.md`.

---

## 0. The biggest-risk decomposition (verbatim from the evaluator)

> **P2 / P4 / P6** — these three pillars share the same constraint: 0/16 clinician-validated labels, the Risk agent's 9-FP rate (specificity 30.8%, PPV 25%), and the absence of a held-out eval set. The infrastructure to close the clinician-validation gap is now **complete** (`review:render` + `review:apply` + unit tests + data-driven disclosure banner), so the remaining work is engagement, not code. Closing any one of the three would lift at least one pillar by 1, and lift the weighted total.

The three sub-gaps:
1. **No held-out eval set.** The 16 dev-labeled rows are the ground truth the eval is computed against — they are not a held-out set.
2. **0/16 clinician-validated labels.** The `review:render` + `review:apply` round-trip is built and tested; no clinician has used it.
3. **Risk agent over-calls risk (9 FPs).** S13's rubric attempt reverted after it made things worse; needs its own isolated investigation.

---

## 1. Slice structure (Q1)

| Slice | Sub-gaps | Posture | Why |
|---|---|---|---|
| **S15** | Sub-gap 1 (held-out set) + outreach-log for sub-gap 2 | "Wire existing things to a real output" — like S14's 4 commits. Held-out flag on `generatePopulation()`, expand labels file with `_meta.heldOutRows`, factor `labelFromBundle()`, split eval-report, render outreach table. Engagement is a parallel track, not a code gate. | Audit-trail-clean: every S15 commit is "wire an existing thing to a real output," same shape as S14. Engagement doesn't carry LLM-variance risk. |
| **S16** | Sub-gap 3 (Risk agent v2 rubric + LLM-variance investigation) | LLM-variance investigation. Owns `design-risk-calibration-v2.md` + `verification-s16.md`. Mirrors S13's `design-risk-calibration.md` pattern. | Risk rubric changes are exactly the kind of work that S13's reversion taught us not to bundle. Its own design doc isolates what was tried and why. |

**Rationale for splitting S15 vs S16.** S14 grill §1 made the same argument for the S14/S15 split, and it landed cleanly: bundling the Risk rubric (LLM-side) with the held-out generator (surgical) would re-create the audit-trail blur S13 left us with. We pay the same separation here, but with the new naming: S15 = held-out + outreach, S16 = Risk rubric.

---

## 2. Sub-gap 1: held-out set shape (Q2)

**Decision: 10 procedural patients (`pop-0011`..`pop-0020`), all 3 dimensions (CareGap/Risk/SDOH), ActionPlanner qualitative-only, ML-standard held-out semantics.**

| Parameter | Decision | Why |
|---|---|---|
| **Source** | Procedural only. No new curated patients. | `apps/api/src/fhir-data/population.ts`'s `generatePopulation()` already produces consistent deterministic profiles. Extending it is one parameter change. Curated additions would require new seed entry + bundle seeding + manual label rationale = more work than value. |
| **Size** | 10 patients. | Pairs with existing 16 (6 hero/panel + 10 procedural) into a 26-total cohort with 10/26 ≈ 38% held out. Statistically meaningful but doesn't double the eval runtime (~6-8 min at the recent 3/16 LLM-call throughput, depending on quota). |
| **Dimensions labeled** | All three: `careGap.expectedHasGap`, `risk.expectedHighRisk`, `sdoh.expectedHasBarrier`. | A held-out set for one dimension only leaves the other two stories un-upgraded. Labeling all three is ~30 lines per patient in `data/eval/labels.json`. |
| **ActionPlanner** | Qualitative-only, NOT held-out scored. | Action Planner is synthesis, not classification — `computeMetrics` doesn't have a TP/FP/TN/FN shape for it. Including it would force inventing a metric. |
| **Held-out semantics** | "Held-out" = labels unseen by **eval scoring**, not unseen by **agent**. Standard ML convention. | The agent WILL analyze these patients via `routes/analysis.ts` if requested; the eval just doesn't see the labels until reporting time. Labels-file concern, not cache or runtime concern. |
| **`_meta` field** | `_meta.heldOutRows: ["pop-0011", ..., "pop-0020"]` in `data/eval/labels.json`. `scripts/eval.ts` filters on this for the held-out section. | One-line addition, no schema change. Matches existing `_meta.limitations` and `_meta.clinicianStatus` pattern. |

---

## 3. Sub-gap 1: labeling rules (Q3)

**Decision: apply `_meta.labelingRules` verbatim. Factor `eval/labelFromBundle.ts` exporting `labelFromBundle(bundle, dim): boolean | null`. `scripts/eval.ts` calls it for both dev-labeled and held-out rows.**

The held-out labels are derived mechanically from the same dev-interpreted labeling rules the dev-labeled set uses:
- **CareGap** — Condition → required LOINC match (E11.9 → HbA1c 4548-4; I50.9 → BNP 30934-4; N18.3 → eGFR 62238-1); conditions without established LOINC convention → `null` (unlabeled, excluded from that dimension's metric).
- **Risk** — `riskScore ≥ 75` (`CRITICAL_RISK_THRESHOLD`).
- **SDOH** — `sdohPositive` / `sdohNegative` seed presence.

This is **credible-enough for a POC** because the bundles are independently generated (different patient profiles from `generatePopulation()`) — the agent has never seen these specific bundles. It's not a clinically-rigorous held-out (that would require independent human labels on independent bundles), and the eval-report's Methodology section will say so explicitly.

| Concern | Decision |
|---|---|
| Same rules as dev set? | Verbatim. Held-out scoring against the same function is the only apples-to-apples comparison. |
| Where does the rule live? | `eval/labelFromBundle.ts`. Pure → unit-testable. |
| `null` for held-out patient on some dimension? | Excluded from that dimension's metric for that patient (same as today). |
| `pop-0020` with seed `riskScore = 50` (below 75)? | Labeled `false`, agent predicts whatever, counted in TN/FP for risk. |
| Does the held-out generator seed SDOH `sdohPositive` / `sdohNegative`? | Same distribution as existing 10 procedural patients (mix of positive/negative/absence per S14's rebalance rules). |

**Rejected alternatives:** (A) two-dev inter-rater on held-out labels — codebase has no inter-rater infra and S14 explicitly rejected adding it; (B) hand-curated labels for the held-out 10 — breaks apples-to-apples; (C) engine + hand-double-check on top-5 — mixes parity sources.

---

## 4. Eval-report shape (Q4)

**Decision: three named sections + Outreach table, in order.**

```
# S9 Evaluation Report

**Status (S15):** N of 26 clinician-validated (X%), 16 of 26 dev-labeled (Y%), 10 of 26 held-out (Z%).

## Methodology
(existing — add one sentence: "Held-out evaluation reports per-agent metrics on the 10 held-out procedural patients from `_meta.heldOutRows`; labels are derived from `_meta.labelingRules` applied to bundles never before seen by the eval.")

## Per-agent metrics — Dev-labeled baseline (16 patients)
(existing — unchanged)

## Per-agent metrics — Held-out evaluation (10 patients)         ← NEW
(Care Gap / Risk / SDOH, each with sensitivity/specificity/PPV + matrix, identical shape to the dev-labeled section)

## Outreach                                                     ← NEW
(Small markdown table from `data/eval/clinician-outreach.json`:
 reviewer | sentAt | channel | status | labelsAffected)

## Error analysis — Dev-labeled (16 patients)
(existing — unchanged)

## Error analysis — Held-out (10 patients)                       ← NEW
(Per-patient FNs/FPs on the held-out set, mirroring the existing shape)

## Data-availability gaps — combined
(existing — collapse per-section gaps into one combined list)
```

| Element | Decision | Why |
|---|---|---|
| Held-out section parallel to dev-labeled, not merged | Yes. | Judges compare apples-to-apples side-by-side. Numbers are *supposed* to be close — that's the point. |
| Status header one line, three counts | "N clinician-validated / 16 dev-labeled / 10 held-out" | Mirrors existing single-line format. Suppresses GD8 caveat only when `clinician-validated > 0`. |
| Methodology adds one sentence | "labels derived from `_meta.labelingRules` applied to bundles never before seen by the eval" | Honest about verbatim-rules semantics. Future judge reads this and knows the credibility bound. |
| Outreach table from JSON | Small markdown table: reviewer, sentAt, channel, status, labelsAffected | Makes sub-gap 2 visible without being a gate. Empty file → empty section with "Outreach log not yet started." |
| Error analysis split per section | Two error analysis sections (dev-labeled + held-out) | Per-patient FP/FN lists are large; merging dilutes the held-out story. |
| ActionPlanner | Listed in both sections as "Action Planner (qualitative — synthesis, not classification)" | No TP/FP/TN/FN shape for it; no held-out metric. |

---

## 5. CLI ergonomics (Q5)

**Decision: `npm run eval` runs both sections by default; new `--dev-only`, `--held-out-only`, `--no-live` flags; cache keyed by `patientId`; held-out failure path uses the existing data-availability gap pattern.**

| Element | Decision | Why |
|---|---|---|
| Default behavior | Runs both dev-labeled (16) + held-out (10) sections in one invocation, produces one report. | Matches existing "run everything" expectation. Existing callers see no change for dev-labeled; new held-out section appears below. |
| New flags | `--dev-only` (skip held-out), `--held-out-only` (skip dev-labeled), `--no-live` (cache-only, no LLM calls). | Lets a developer iterate on held-out section without re-running the 16 dev-labeled, and vice versa. `--no-live` is critical for verification — runs off the existing `analysis_cache` rows. |
| Cache strategy | Cache keyed by `patientId` (existing `apps/api/src/db/analysisCache.ts`). Held-out patients are new IDs → cold cache → live LLM call. | Existing cache contract unchanged. Held-out patients naturally require live runs unless `--no-live` is passed. |
| Quota-exhausted failure path | Held-out patient with no cache + no live result → reported in existing "Data-availability gaps" section, same shape as dev-labeled failures (`docs/eval-report.md:71-80`). | Don't invent a new failure shape. Reuse the pattern. |
| Verification matrix | Both: (a) `--no-live` shows both sections render correctly against the existing cache rows + shows held-out rows as `data-availability: no-live-flag`; (b) one live re-run with all 26 patients when quota allows, reported in the changelog as "live numbers" — separate from the slice's pass condition. | Decouples slice verification (must work without quota) from live numbers (bonus signal). |
| Single-run vs. two-run | Single `npm run eval` invocation produces the full report. | Simpler than two commands. |
| `scripts/eval.ts` change | Reads `_meta.heldOutRows`, splits patient list internally, renders both sections. | One file change; no new scripts. `eval/computeMetrics.ts` is unchanged — same function called twice. |

---

## 6. Outreach log architecture (Q6) — sub-gap 2 parallel track

**Decision: manual JSON edit + pure-schema validation function + missing-file tolerance. Names-only PII.**

| Element | Decision | Why |
|---|---|---|
| File location | `data/eval/clinician-outreach.json` (peer to `data/eval/labels.json`) | Both files live in `data/eval/`; eval script `fs.existsSync`-handles missing. |
| Update mechanism | **Manual JSON edit**, no new CLI script. Add `scripts/outreach-validate.ts` (read-only, prints `OK` or lists errors). | Manual edit keeps the slice small. CLI tooling for outreach would be over-engineering for ~5-10 entries. |
| Validation function | `eval/outreachSchema.ts` exporting `validateOutreach(json): { ok: true } \| { ok: false; errors: string[] }`. Pure → unit-testable. Called by both `scripts/outreach-validate.ts` and `scripts/eval.ts`. | Mirrors `apply-clinician-review.ts` validation pattern: pure function, separate I/O script. |
| Missing-file tolerance | `fs.existsSync(...) === false` → render empty Outreach section with note "Outreach log not yet started." | Same pattern as missing `_meta.heldOutRows`. |
| PII handling | Reviewer names free-text ("Dr. M. Smith"); channel enum (`email` \| `in-person` \| `slack` \| `phone`); no SSN, no email required. Consent line in schema file. | Names + channel are reasonable for a POC; emails/phones would be over-collection. |

**Finalized JSON shape:**
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

**`status` enum:** `sent` | `returned` | `declined` | `no-response`. **Unit tests** (1 test file): (a) missing file → empty section; (b) malformed JSON → render with errors listed; (c) valid JSON → table renders.

**Rejected alternatives:** (A) `npm run outreach:add` interactive CLI — over-engineering for ~5-10 entries; (B) log entries into `data/audit.jsonl` — keeps one log but loses outreach framing and empty-section-when-missing UX; (C) schema requires reviewer email — PII-risky for public eval.

---

## 7. Verification matrix (Q7)

The S15 acceptance signal is the five-row matrix below, not "tests pass + eval re-runs." All five signals must be present in `verification-s15.md`.

| Fix | Verification signal | Pass condition |
|---|---|---|
| **Held-out set exists** | `data/eval/labels.json:_meta.heldOutRows` populated with 10 patient IDs | 10 patients in `_meta.heldOutRows`, all `pop-0011`..`pop-0020` |
| **Verbatim labeling** | `eval/labelFromBundle.ts` exports `labelFromBundle(bundle, dim)` | Unit test: same fixture bundle + dim → same label regardless of call site (dev-labeled or held-out path) |
| **Held-out section in eval-report** | `npm run eval --no-live` produces a Held-out section | Markdown contains `## Per-agent metrics — Held-out evaluation` with at least one row of metrics |
| **CLI flags** | `npm run eval --dev-only`, `--held-out-only`, `--no-live` work as documented | 3 unit tests (or CLI integration tests) — `--dev-only` skips held-out, `--held-out-only` skips dev-labeled, `--no-live` does not invoke the LLM |
| **Outreach log renders** | `data/eval/clinician-outreach.json` (optional) → table in eval-report | File absent → empty section with "Outreach log not yet started"; file present → table renders; malformed → errors listed inline |

The verification artifact is `verification-s15.md` (same convention as S13b / S14) and `docs/eval-report.md` regenerated by `npm run eval --no-live`. The CHANGELOG entry for S15 names all five signals as acceptance criteria.

**Live re-run expectation (separate from pass condition).** When OpenAI quota allows, `npm run eval` (no flags) re-runs all 26 patients live. The changelog reports the live held-out numbers as bonus signal — not as a pass gate, because quota is a precondition we don't control. The recent eval already failed mid-run on 13/16 patients with `quota exceeded` errors per `docs/eval-report.md:73-79`.

---

## 8. Out of scope (explicit, Q8)

- **Risk agent v2 rubric + LLM-variance investigation — S16.** The 9-FP rate, the 2026-07-07 → 07-08 behavior shift, and the S13 reversion pattern all live in S16's `design-risk-calibration-v2.md`. Mirrors S13's `design-risk-calibration.md` pattern.
- **Held-out labels via inter-rater agreement.** Rejected in Q3. Would require infrastructure (Cohen's kappa, two-dev labeling workflow) that the POC doesn't have and S14 explicitly rejected.
- **Hand-curated held-out labels.** Rejected in Q3. Breaks apples-to-apples with the dev-labeled set.
- **In-app clinician review queue.** Deferred indefinitely. The `review:render` HTML is sufficient POC UX (same call as S14 grill §7).
- **Two-tier label system** (`labels.clinician.json` "blessed" file as a separate source of truth). Not needed for POC.
- **Held-out scoring on ActionPlanner.** Qualitative-only, no TP/FP/TN/FN shape.
- **Model-version pin for the LLM API.** Cross-cutting, lives in S16 alongside the Risk rubric investigation.
- **Multilingual / low-connectivity support.** Out of scope per HL7 evaluation Open Q #7.
- **Clinician engagement itself.** S15 ships the path + the tracking; engagement happens on its own clock, not gated by the slice.

---

## 9. Engagement operationalization (sub-gap 2, parallel track)

Sub-gap 2 (0/16 clinician-validated) is partially closed by S15 — the slice ships the **path** (review form, apply script, data-driven disclosure) and the **tracking** (outreach log). The actual engagement is not a code deliverable. The slice's relationship to engagement:

- **Engagement is NOT a verification gate.** The slice ships whether or not a clinician volunteers. The "Outreach" section in `docs/eval-report.md` makes the gap visible.
- **Engagement IS the highest-leverage unblock** for P2/P4. Once a clinician runs `review:render` + `review:apply`, the eval-report's "Status" disclosure moves from "0 of 26" to "N of 26" and the GD8 caveat auto-suppresses.
- **The outreach log makes the engagement auditable.** A judge reading the eval-report can see: who was invited, when, did they respond, did they review. This is the answer to the HL7 evaluation's Open Question #2 (*"Has the HTML form been sent to any clinician for review? If not, what is the timeline?"*).

---

## Next step (ADLC)

`to-prd` — produces `prd-s15.md` covering sub-gaps 1 + 2 (held-out set + outreach log) with the 4-commit structure below. Inputs to `to-prd`: this file, `reports/HL7-Challenge-Evaluation.2026-07-08.md`, `docs/eval-report.md`, `data/eval/labels.json:_meta.labelingRules`, `apps/api/src/fhir-data/population.ts`, `apps/api/src/scripts/eval.ts`, `apps/api/src/scripts/render-clinician-review.ts`, `apps/api/src/scripts/apply-clinician-review.ts`.

The four S15 commits (preview; finalized in `prd-s15.md`):
1. `feat(S15): procedural held-out set (pop-0011..pop-0020) + labels._meta.heldOutRows`
2. `feat(S15): eval/labelFromBundle.ts — factored labeling function`
3. `feat(S15): eval-report three-section layout + Held-out evaluation section`
4. `feat(S15): clinician-outreach.json + Outreach table in eval-report`