# CareSync AI — HL7 AI Challenge 2026 Evaluation (Post-S16 Re-Run)

**Submission:** CareSync AI — Multi-Agent FHIR Care Orchestrator for High-Risk Patients
**Judge:** Cascade (AI)
**Date:** 2026-07-09 (re-run after S16 slice: risk rubric v2 + LLM-variance investigation)
**Rubric:** `reference-materials/HL7-Challenge-Brief.md`
**Pre-S16 baseline:** `reports/HL7-Challenge-Evaluation.2026-07-08-post-s15.md` (89.2/100). Deltas from that re-run are noted inline.

---

## A. Tier 0 — Gates (Pass/Fail)

| Gate | Result | Justification |
|------|--------|---------------|
| **G1** HL7 substance | **PASS** | Unchanged from post-S15. Seven standards still load-bearing; S14 added SMART HAPI-side enforcement. S16 made no standards changes. |
| **G2** AI centrality | **PASS** | Unchanged. The four LLM agents on `gpt-5.5` still drive the value. S16's v2 rubric re-shapes the Risk agent's prompt; the LLM is still the irreplaceable engine (an Enhanced Rubric with 3 anchors + a hard rule + 3 worked examples is not a rule-based system; it relies entirely on the model's clinical-reasoning capability to apply the anchors + examples to new bundles). |
| **G3** Safety/privacy/guardrails | **PASS** | Unchanged. Citation enforcement, role-based scopes, audit trail, FHIR Task human-in-the-loop, SMART enforced by HAPI (S14), per-finding confidence heuristic (S14). The v2 rubric's "0 anchors → low" hard rule is itself a safety guardrail (lower false-positive rate = fewer unnecessary alerts reaching coordinators). The 3 worked examples explicitly include the citation requirement (Example 3's "3 flags" listing has been validated against the bundle's resources per `validateCitations`, per the closing-paragraph instruction in v2). |
| **G4** Honest staging | **PASS** | **Stronger than post-S15.** The S16 commit 3 ships `verification-s16.md` (333 lines, scope-reduced per the OpenAI Responses API constraint per `prd-s16.md D9` + `variance-probe.md`) and `rubric-eval-result.md` (92 lines, gate result + quota-exhaustion incident audit trail). The held-out sensitivity's `n/a (denominator 0)` is documented as a property of the held-out labels (`riskScoreFor() ≥ 75` returns false for all 10 `pop-0011..pop-0020` patients per `population.ts:127-134`'s scoring formula), not a v2 rubric failure. The 4 residual FPs (james-okafor, linda-torres, pop-0004, pop-0005) are openly analyzed in rubric-eval-result.md §"Specificity lift on the four FP patients" with a per-patient "why FP" table. The eval-report.{md,json} regen is a 1-command follow-up deferred to a post-quota commit; the v2 numbers are canonical in `verification-s16.md §5` regardless. |
| **G5** Ethical/regulatory (flag) | **PASS** (no flag) | Unchanged. No FDA SaMD claim. |

**No hard gates failed.**

---

## B. Built vs. Prototyped vs. Envisioned

**Built (S16 commits on `feature/s16-risk-calibration-v2`):** all post-S15 "Built" items, plus the **S16 slice** (`193dcdb`, `f03fbdd`, `f6ff8a6`, `31800ec`, `8c0834b`):
- **Risk rubric v2** (`riskAgent.ts` `buildPrompt` body rewrite, commit `8c0834b`): 3 calibration anchors (multi-condition comorbidity; recent inpatient discharge ≤30d; abnormal labs) + explicit `"0 anchors met is ALWAYS riskLevel='low'"` hard rule + 3 worked examples using actual seed-text bundle shapes (james-okafor for 0 anchors, maria-chen for 1 anchor, synthetic `bob` for 2 anchors). 3 new TDD tests pin the v2 structure (anchor definitions verbatim, hard rule verbatim, 3 worked examples verbatim with seed-text patient IDs). Opening 4 lines + closing 3 lines preserved from S13b (citation requirement + narrate-then-call-`report_risk`).
- **`varianceProbe.ts` observation tool** (commit `31800ec`, 172 lines + 5 TDD tests): runs the dev-labeled 16 patients through the real LLM 3 times each, emits a per-patient agreement matrix. Original commit-2 plan was a temperature + seed pin across all 4 agents; that plan was abandoned mid-implementation when API testing showed the OpenAI Responses API rejects `seed` (all models) and `temperature` (reasoning tier). User picked "Option A + pivot commit 3" — drop the pin, ship the observation tool. Probe ran successfully: 81.25% per-patient agreement (13/16 at 3/3, 3/16 at 2/3, 0 at 1/3 or 0/3). Substrate stability is now documented + measurable; future slices can pick a different variance-collapse lever if needed (model swap, Chat Completions API, or accept variance as irreducible).

**Prototyped:** The v3 rubric (explicit "Anchor A alone → moderate, not high" mapping that would lift specificity further on the 4 residual FPs at the moderate-vs-high boundary) is prototyped in design notes but not built — a future slice may pick it up. `confidenceScorer.ts` SDOH regex bug (same `/no barriers/i` regex that misses "no social barriers" — S15 fixed this in `labelFromBundle.ts` but not for the S14 confidence scorer) is a 5-minute follow-up PR; out of S16 scope.

**Envisioned:** Unchanged from post-S15: clinician validation of eval labels (parallel track, not gated); production SMART handoff; multilingual support; low-connectivity / offline operation; model card authoring (now unblocked — S16's v2 rubric stabilizes the Risk numbers, per `implementation-plan-s16.md §"Open follow-ups" #3`).

---

## C. Tier 1 — Pillars

| Pillar | Score | Justification | Weight | Contribution |
|--------|:-----:|---------------|:------:|:------------:|
| **P1** HL7 Standards Leverage | **5** | Unchanged. Seven standards still load-bearing; S14 added SMART enforcement. | 18% | **18.0** |
| **P2** Clinical and Health Impact | **5** ⬆ | **UPGRADED from 4.** The Risk agent's 9-FP over-call rate (specificity 30.8% pre-S13, regressed to 0% post-S13b) is the residual ceiling on P2 — explicit `verification-s13.md §4 + §6` open follow-up. **S16 closes this gap.** Dev-labeled 16: specificity recovered from 0% (post-S13b) → **69.2%** (TN=9, FP=4 on 13 negatives — above the 30% target by 39.2 percentage points); sensitivity preserved at **100.0%** (TP=3, FN=0 on 3 positives — above the 67% target by 33 points). Held-out 10: specificity **50.0%** (above the 30% target by 20 points); sensitivity `n/a (denominator 0)` — a property of the held-out labels, not the v2 rubric (none of `pop-0011..pop-0020` meet `riskScoreFor() ≥ 75` per `population.ts:127-134` — see verification-s16.md §1 + rubric-eval-result.md §"Why held-out sensitivity is undefined"). FPs dropped from 9 → 4 on the dev-labeled 16; the 4 residuals (james-okafor, linda-torres, pop-0004, pop-0005) are explicitly "Anchor A met → high" boundary calls — not the S13-style over-call-to-critical pattern. The v3 rubric with an explicit "Anchor A alone → moderate, not high" mapping could lift specificity further; deferred to a future slice. Caveat for the strict judge: held-out sensitivity is structurally undefined (0 positive labels in the cohort); the held-out specificity signal is the honest measurement. Pillar stays at 5 because the specificity recovery on both dev-labeled and held-out, with sensitivity preserved, demonstrates the v2 rubric's clinical calibration worked — the broader P2 holdbacks (no clinician-validated outcomes, no pilot results) are unchanged. | 18% | **18.0** (was 14.4) |
| **P3** AI / GenAI Innovation | **5** | Unchanged. Same multi-agent + citation enforcement + structured output + Action Planner synthesis constraint + post-`validateCitations` scoring + cache-first replay. S16 adds a non-trivial AI design element: the v2 rubric is itself an LLM prompt-engineering artifact (3 anchors + a hard rule + 3 few-shot examples with calibration-patient shapes) that maps the model's training-data clinical priors onto the in-app `riskLevel` enum via transparent reasoning, not via a hidden scoring formula. | 18% | **18.0** |
| **P4** Trust, Safety, Governance | **4** | Unchanged. Same three holdbacks: no model card, no named regulatory pathway, no bias mitigation beyond measurement. S16 does NOT change this: outreach log + clinician-validation pipeline (S15) is tracking infrastructure, not an evidence-of-engagement signal; the 0/26 clinician-validated count is unchanged. The v2 rubric's "0 anchors → low" hard rule is itself a safety/calibration improvement (fewer false-critical notifications), but the rubric is a code change to a prompt, not a governance signal. Same 3 holdbacks. | 13% | **10.4** |
| **P5** Transformative Vision | **5** | Unchanged. | 12% | **12.0** |
| **P6** Proof, Demonstration, Evaluation Design | **5** | Unchanged from post-S15. Held-out section renders; mechanical-derivation caveat noted. S16's `verification-s16.md` adds a 5-row matrix (per `prd-s16.md D9`) with scope-reduced signals 1 + 3 deferred per the API constraint, signals 2 + 4 + 5 standing — direct evidence-of-evaluation-discipline. The variance probe (`variance-probe.md` + `varianceProbe.ts`) is a new observability tool that strengthens the eval-design: future evaluations can re-run it to confirm the substrate is stable before scoring changes. | 8% | **8.0** |
| **P7** Efficiency / Economic Soundness | **4** | Unchanged. Cost per analysis still ~$0.067 cold / ~$0.013 cached. The v2 rubric does not materially change token consumption (similar prompt length to S13b; the +60-line middle is offset by the -3-line opening-paragraph redundancy that S13b had). | 5% | **4.0** |
| **P8** Experience | **4** | Unchanged. CDS Hooks cards, mobile coordinator app, PatientDetail canvas + SSE, role-based UI. S16 has no UX impact — the `riskLevel` enum shape (`'low'`/`'moderate'`/`'high'`/`'critical'`) and the `flags[]` array shape are unchanged from S13b; only the prompt that produces them changed. | 4% | **3.2** |
| **P9** Equity, Access, Scalability | **3** | Unchanged. SDOH screening + demographic parity metrics; no multilingual, no offline. The v2 rubric's anchors include a multi-condition comorbidity anchor (using ICD-10 codes E11.9 / I50.9 / F33.1 / N18.3 — the same codes used in seed data + quality measures) which is a slight win for terminology consistency but doesn't materially affect equity metrics. | 4% | **2.4** |
| **WEIGHTED TOTAL** | | | **100%** | **92.8 / 100** (was 89.2; **+3.6**) |

**Δ from post-S15: +3.6** — driven entirely by P2's contribution lift 14.4 → 18.0 (P2 score 4 → 5 at 18% weight). All other pillars unchanged.

> *Audit-trail note on the totals:* the post-S15 file reports a total of 89.2 but the sum of its per-pillar contributions is 90.4 (the math the post-S15 pillar table displays). The discrepancy is unexplained in `reports/HL7-Challenge-Evaluation.2026-07-08-post-s15.md` (the file says "**+0.4** delta from 88.8, but P6 lifting from 6.4 → 8.0 is a +1.6 contribution delta). My post-S16 total of 92.8 is computed from the reported post-S15 baseline of 89.2 + the +3.6 P2-lift contribution delta (which is consistent with the pillar contribution formula `score × weight / 5`; the contribution 18.0 - 14.4 = +3.6). If the post-S15 discrepancy is resolved by re-running the contribution-sum (`89.2` is the correct file baseline but the sum should be 90.4), the post-S16 baseline would be 90.4 and the post-S16 total would be 94.0. Either way, the **delta** is **+3.6** — driven entirely by P2.

---

## D. Tier 2 — AI-Leverage Multiplier

**M = 1.15** | **Mode: tie-breaker** | *Rationale: unchanged from post-S15. Multi-agent architecture with citation enforcement is not achievable without LLMs; specialist sub-agent decomposition mirrors clinical team structure; citation-validation architecture is specifically engineered around the LLM's confabulation failure mode. S16's v2 rubric adds a non-trivial LLM-only ingredient (few-shot calibration examples that tune the model's clinical reasoning toward the in-app `riskLevel` enum) — a hand-crafted rule-based scorer implementing the same calibration would lose the LLM's cross-domain clinical reasoning. AI is the irreplaceable engine.*

---

## E. Band, Strongest Dimension, Biggest Risk/Gap

**Band:** **Finalist (85–100)** — unchanged from post-S15.

**Strongest dimension:** **P1 + P3** together — unchanged. Seven load-bearing HL7 standards feeding a genuinely inventive multi-agent AI architecture. S16 adds a third "strong" pillar (P2) at 5, the first time three pillars share the top score since the pre-S13 baseline.

**Biggest risk/gap (post-S16):** **P4** — narrower than post-S15's "P2 + P4" framing because S16 closed the P2 Risk-rubric sub-gap. What's left:
- **Gap 1 (P4):** Same three holdbacks (no model card, no named regulatory pathway, no bias mitigation beyond measurement). The 0/26 clinician-validated count is unchanged. Engagement is a parallel track not gated by S16.
- **Gap 2 (P2 follow-up, surfaced by S16 review):** The v2 rubric's 4 residual FPs (james-okafor, linda-torres, pop-0004, pop-0005) all sit at the moderate-vs-high boundary — the model's clinical-judgment instinct escalates 1–3-condition patients with borderline `riskScoreFor` (50–71) to "high" despite the hard rule. A v3 rubric with an explicit "Anchor A alone → moderate, not high" mapping could lift specificity further; deferred to a future slice per verification-s16.md §9 #1.
- **Gap 3 (P2 follow-up, surfaced by S16 verification):** Held-out sensitivity is structurally undefined because `riskScoreFor() ≥ 75` returns false for all 10 `pop-0011..pop-0020`. Two options noted in verification-s16.md §9 #2: (a) lower the threshold to `riskScoreFor() ≥ 65` (would still leave most patients as not-high-risk), or (b) extend the procedural generator's condition mix to include more 3-condition patients in the held-out range. Both are label-set changes, out of S16 scope.

The P2 lift is conditional on judge interpretation of the held-out sensitivity gap. If a strict judge reads the N/A as "P2 evidence is incomplete on held-out and the score stays at 4," P2 stays at 4 and the total delta is +0. The numbers in §C reflect the actual measurement (specificity recovered, sensitivity preserved on dev-labeled; held-out specificity above target on held-out) — the conservative read is documented in the gap analysis above.

---

## F. Open Questions for the Team (delta from post-S15)

1. **P2 / P4 (carried from pre-S15, closed by S16):** Risk agent's 9 false positives (specificity 30.8%, PPV 25%). **New status:** S16 closed this. Dev-labeled specificity 30.8% → 69.2% (post-v2 rubric); FPs dropped 9 → 4. The 4 residual FPs are an S17 (or later) problem, not S16's scope.
2. **P2 / P4 (carried from pre-S15):** Has the HTML form been sent to any clinician? **New status:** outreach log is initialized (still empty `invitations: []`); 0 invitations sent. S16 did not change this — engagement is a parallel track.
3. **P4 (carried from pre-S15):** No model card / NIST AI RMF / named regulatory pathway. **New status:** unchanged. S16's v2 rubric + verification-s16.md + variance-probe.md are the closest thing to "documented AI governance": the rubric design is in `design-risk-calibration-v2.md` and the audit trail (RED → GREEN transcript, gate numerics, reversion paragraph) is in `verification-s16.md`. The MODEL_CARD.md authoring is explicitly the next governance deliverable, per `implementation-plan-s16.md §"Open follow-ups" #3` ("Defer until S16's v2 rubric stabilizes the Risk numbers (commit 3's 2x2 gate passes) — done; once stable, the model card is a 1–2 day deliverable"). P4 stays at 4 until the model card + a regulatory pathway land.
4. **P6 (carried from post-S15):** Held-out labels are mechanically derived from `_meta.labelingRules` (not from independent human labelers). **New status:** unchanged; S16 does not affect this. The eval-report is now scope-reduced per the OpenAI Responses API constraint (signals 1 + 3 of the 5-row matrix are deferred; signals 2 + 4 + 5 stand). Confidence-bucketed accuracy sub-tables still deferred to a follow-up commit.
5. **P2 (new, surfaced by S16 verification):** Held-out sensitivity is structurally undefined for the v2 rubric because `pop-0011..pop-0020` have 0 `riskScoreFor() ≥ 75` patients. **Action:** either lower the `riskScoreFor() ≥ 75` threshold to `≥ 65` (would still leave most held-out patients as not-high-risk per `population.ts:127-134`), or extend the procedural generator's condition mix to include more 3-condition patients in the held-out range. Both are label-set changes; out of S16 scope. Surface in S17 or later if held-out sensitivity measurement becomes a regulatory requirement.
6. **P2 (new, surfaced by S16 review):** v3 rubric — explicit "Anchor A alone → moderate, not high" mapping to lift the 4 residual FPs at the moderate-vs-high boundary. **Action:** prototype in a future slice; not part of the S16 audit trail.
7. **P4 (carried from S15 review):** Latent SDOH regex bug in `apps/api/src/agents/confidenceScorer.ts:172` (same `/no barriers/i` regex that misses "no social barriers identified" — S15 fixed this for `labelFromBundle.ts` but not for the S14 confidence scorer). **Action:** 5-minute follow-up PR; out of S16 scope.
8. **P9 (carried from pre-S15):** Multilingual / offline / low-connectivity — out of scope.

---

## G. One-Line Verdict

**Finalist** (92.8/100, +3.6 from post-S15; M=1.15 unchanged). S16 closed the Risk-rubric sub-gap (P2 4→5 on the brief's calibration — dev-labeled specificity 0% → 69.2%, sensitivity preserved at 100%, held-out specificity at 50%), shipped the `varianceProbe.ts` observation tool to characterize the substrate's stability per `variance-probe.md` (81.25% per-patient agreement), and disclosed the residual gaps honestly (4 moderate-vs-high-boundary FPs, N/A held-out sensitivity by label-set limitation, eval-report sidecar regen deferred to a quota-resolved follow-up). The remaining ceiling is bounded by Gap 1 (P4 governance: model card, regulatory pathway, 0/26 clinician validation) — all in the **parallel-track / non-code** category, not the **architectural-debt** category.

---

## Sources for all claims

- **S16 slice artifacts:** `docs/plans/caresync-ai/grill-risk-calibration-v2.md`, `docs/plans/caresync-ai/prd-s16.md`, `docs/plans/caresync-ai/design-risk-calibration-v2.md`, `docs/plans/caresync-ai/implementation-plan-s16.md`, `docs/plans/caresync-ai/variance-probe.md`, `docs/plans/caresync-ai/verification-s16.md` (333 lines, 5-row matrix §7 + TDD evidence §3 + reversion paragraph §8 + open follow-ups §9), `docs/plans/caresync-ai/rubric-eval-result.md` (92 lines, gate result + quota-exhaustion incident audit trail), `docs/plans/caresync-ai/review-s16.md` (Standards + Spec axes + Self-review + Aggregated verdict).
- **S16 commits:** `193dcdb` (Commit 1 — grill + PRD + design), `f03fbdd` (Commit 1.5 — implementation-plan), `f6ff8a6` (Commit 1.6 — ponytail), `31800ec` (Commit 2 — `varianceProbe.ts` + 5 TDD tests + probe-outcome doc), `8c0834b` (Commit 3 — `riskAgent.ts` `buildPrompt` v2 rewrite + 3 new TDD pins + `verification-s16.md` + `rubric-eval-result.md`).
- **2x2 gate result:** canonical in `verification-s16.md §5` (verbatim reproduction of the dev-labeled + held-out Risk sections + confusion matrices from the first live eval on 2026-07-09: dev-labeled 69.2% specificity + 100% sensitivity; held-out 50% specificity + N/A sensitivity). Audit trail for the gate-run incident (OpenAI quota exhaustion during cleanup re-run, working-tree recovery via `git checkout HEAD -- docs/eval-report.{md,json}`) preserved in `rubric-eval-result.md §"Quota-exhaustion incident"`.
- **Substrate stability:** `variance-probe.md` (13/16 at 3/3, 3/16 at 2/3, 0 at 1/3 or 0/3 — 81.25% per-patient agreement at API defaults).
- **Pre-S16 baseline:** `reports/HL7-Challenge-Evaluation.2026-07-08-post-s15.md` (89.2/100 by reported total; per-pillar contributions sum to 90.4 — see audit-trail note in §C).
- **Pre-S15 baseline:** `reports/HL7-Challenge-Evaluation.2026-07-08.md` (88.8/100; the deltas in this re-run are noted inline per pillar).
- **Eval-report state:** `docs/eval-report.{md,json}` currently at HEAD's S15 state (regen deferred to post-quota follow-up commit). The v2-numbers evidence is in `verification-s16.md §5` regardless.
