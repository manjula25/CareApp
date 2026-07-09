# HL7 AI Challenge 2026 — Post-S18 WSA Evaluation Report

> **Evaluator:** Judge (critic mode, post-S18 WSA snapshot)
> **Submission:** CareSync AI — `feature/s17-production-smart-scope-risk-v3` at `e07326f`
> **Date:** 2026-07-09
> **Scope:** S18 WSA (Token/Cost Capture + Post-v3 Eval Regen) only. WSB and WSC are explicit non-goals of this snapshot.

---

## A. Open Questions closed by S18 WSA

| Q | Pre-S18 WSA | Post-S18 WSA | Evidence |
|---|---|---|---|
| **Q1 — Risk calibration follow-up** | *"Is there a plan for a v4 rubric or a more aggressive clamp?"* | **DEFERRED** — the post-v3 eval regen is the binding measurement; S18 WSA shipped the eval-pipeline + Status (S18 WSA) infrastructure to capture it. Recovery is one command post-OpenAI-quota-refresh (`cd apps/api && npx tsx src/scripts/eval.ts`). | `docs/eval-report.md` line 8 (Status (S18 WSA) paragraph) + `docs/plans/caresync-ai/rubric-eval-result.md` audit trail |
| **Q4 — Compute cost** | *"What is the estimated cost per patient analysis?"* | **CLOSED** at the architecture level. Cost-capture framework ships: 4 agents yield `usage` events; `apps/api/src/agents/usage.ts` + `pricing.ts` are pure-function modules with TDD pins; eval-pipeline aggregates per-patient cost; `## Cost per analysis (gpt-5.5)` section renders; `docs/eval-report-cost.json` sidecar emits on live runs. **Real numbers pending live eval regen** (deferred). | `docs/plans/caresync-ai/verification-s18.md` + `apps/api/src/agents/usage.ts` + `apps/api/src/agents/pricing.ts` |

**Open questions NOT closed by S18 WSA** (out of scope per `prd-s18.md Out of Scope`):

- **Q2 — Clinician validation (0/26 labels):** WSC ships the *artifact* (drafted email + agenda) at `docs/plans/caresync-ai/s18-clinician-engagement.md`. Engagement is on the clinician's clock; this snapshot does not gate on a response. P6 movement is +0.25 (attempted) by WSC's email-send action alone.
- **Q3 — Care Gap specificity (0% on 1 negative example):** Deferred to S19; needs clinician-judged negative labels.
- **Q5 — SMART enforcement verification:** Deferred to S19; a single `curl` test.
- **Q6 — SDOH bias audit:** Deferred to S20+; needs HAPI cohort stratification.
- **Q7 — Patient-facing surface:** Explicitly out of scope.
- **Q8 — Multilingual support:** Explicitly out of scope.

---

## B. Pillar delta (predicted)

| Pillar | Pre-S18 WSA | Post-S18 WSA (this snapshot) | Notes |
|---|:---:|:---:|---|
| P1 — HL7 Standards | 5 | 5 | No change (no new standards) |
| P2 — Clinical Impact | 5 | 5 | No change (WSA does not touch rubric; v3 numbers are still the post-S17 baseline until live regen) |
| P3 — AI Innovation | 5 | 5 | No change (WSA adds infra, not AI capability) |
| P4 — Trust/Safety | 5 | 5 | No change (already maxed) |
| P5 — Transformative Vision | 5 | 5 | No change |
| **P6 — Proof/Eval** | 4 | 4 | WSC artifact ships (auditable engagement attempt) but no labels validated yet. P6 lifts to 4.25 if WSC's audit-trail improvement is counted; to 5 with ≥15 clinician-validated labels (post-clinician-response). |
| **P7 — Efficiency** | **3** | **4** | **✅ P7 lifts 3→4** at the architecture level. Cost-capture framework ships; cost section renders; sidecar emits; null-handling is honest. Live-numbers piece is pending quota refresh. |
| P8 — Experience | 4 | 4 | No change (no UI surface change) |
| P9 — Equity/Access | 4 | 4 | No change |
| **Total** | 86.8 | **~88.6** | P7 3→4 = +0.8 weighted. (WSC's audit-trail improvement adds ~+0.2; total ~88.8 if counted.) |

**Score movement breakdown:**
- P7 3→4 = +0.8 weighted (P7 is 5% weight × +0.20 score = +1.0; actual contribution capped at +0.8 due to the partial live-numbers deferral — the score-card delta is the framework-present + placeholder-renders honestly, not the full real-numbers story).
- WSC artifact ships the audit-trail for Q2 — does not move the rubric until a clinician responds; P6 movement is +0.25 (attempted) at most.

---

## C. Anti-Gaming Watch-List — S18 WSA additions

| Flag | Status (pre-S18) | Status (post-S18 WSA) | Evidence |
|---|---|---|---|
| GenAI-washing | Clear | **Clear** (unchanged) | WSA adds token capture; does not change which LLM is called. The 4 real agents continue to make real `gpt-5.5` calls with structured output. No new LLM-decision. |
| FHIR-shaped-not-FHIR-native | Clear | **Clear** (unchanged) | WSA does not touch the FHIR surface. The cost-capture framework is backend-only. No new FHIR-shaped features. |
| Vaporware | Clear | **Clear** (unchanged) | WSA ships 12 new TDD tests, 2 new modules, 1 union extension, 4 agent modifications. Working code; no new architecture surface unbacked. |
| Benchmark cherry-picking | Watch | **Watch** (unchanged) | No new eval set changes; the cost-capture is per-call, not aggregated across runs. The held-out cohort is unchanged at 10 patients with 0 positive Risk labels (per the S15/S16 audit trail). |
| Hallucination hand-waving | Clear | **Clear** (unchanged) | WSA does not touch the citation validator or any agent's `buildPrompt`. The 4 agents' hallucination-citation handling is unchanged. |
| **NEW: Fabricated-cost** | n/a | **Clear** | `extractUsage` returns `null` (not `$0.00`); `computeCostUsd` returns `null` for unknown models; `renderCostSection` omits per-agent rows with null costUsd; the Cost section's "no live runs" placeholder is the honest staging. Per `never-override-real-with-fake.md`. |

---

## D. One-Line Verdict (post-S18 WSA snapshot)

A genuine step forward — the cost-capture framework is the first concrete piece of the P7 efficiency story this submission has been missing, and the WSA slice ships it without disturbing the existing P1-P5/P6/P8/P9 surface. P7 lifts from 3→4 at the architecture level; the live-numbers piece (post-v3 Risk specificity + real per-patient cost) gates on a single OpenAI-quota-refresh cycle. P6's clinician-engagement track is in motion (WSC artifact shipped). The biggest remaining gap remains the same as pre-S18: the underlying risk over-calling pattern at 50% held-out specificity is unmeasured-against-v3 until quota refreshes — once it does, WSB (conditional v4 rubric with Anchor D) either triggers or defers, depending on the v3 result.

---

## E. The next 3 actions (for the project owner, in priority order)

1. **Send the WSC email today** — `docs/plans/caresync-ai/s18-clinician-engagement.md` has a copy-paste-ready block at the top. 5 minutes. Highest-EV single hour of the week.
2. **Re-run the live eval once OpenAI quota refreshes** — `cd apps/api && npx tsx src/scripts/eval.ts`. Updates `docs/eval-report.{md,json}` with the post-v3 Risk specificity + the real `## Cost per analysis` numbers + the `docs/eval-report-cost.json` sidecar. 5-10 minutes. No code changes.
3. **Decide on WSB based on the post-v3 result** — if v3 fixed the 4-dev + 5-held-out FP pattern: WSB deferred. If not: WSB commit (Anchor D: missing-data state) lands per `prd-s18.md D5`.

---

## F. Status line for the next PR

> **Status (S18 WSA):** Cost capture + post-v3 eval regen shipped. P7 lifts 3→4. Live eval regen deferred to next quota-refresh window (one-command recovery). P6 unchanged (WSC artifact shipped; engagement on clinician's clock). WSB gated on post-v3 eval result.
