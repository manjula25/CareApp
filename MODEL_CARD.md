# CareSync AI — Model Card

> **Reviewer-facing model card** for the AI components of CareSync AI — Multi-Agent FHIR Care Orchestrator for High-Risk Patients.
> **Version:** 2026-07-10 · **Submission:** HL7 AI Challenge 2026
> **Companion documents:** [`SUBMISSION.md`](./SUBMISSION.md) (problem framing) · [`SOLUTION_OVERVIEW.md`](./docs/SOLUTION_OVERVIEW.md) (architecture) · [`docs/eval-report.md`](./docs/eval-report.md) (current evaluation) · [`HANDOFF.md`](./HANDOFF.md) (project context)

---

## 1. Model identity

- **System name:** CareSync AI — multi-agent FHIR care orchestrator
- **AI components:**
  - **Risk agent** — 30-day readmission risk (low / moderate / high / critical)
  - **Care Gap agent** — monitoring-gap detection (HbA1c overdue for diabetes, BNP overdue for CHF, eGFR overdue for CKD)
  - **SDOH agent** — AHC-HRSN barrier screening (LOINC 71802-3)
  - **Action Planner** — synthesizes FHIR Task list from upstream findings
- **Model:** OpenAI `gpt-5.5` via the Responses API with structured-output function tools
- **Deterministic components (non-LLM):**
  - Citation validator (`apps/api/src/agents/citationValidator.ts`) — drops fabricated `ResourceType/id` citations
  - Narration redactor (`redactUnvalidatedCitations` + `NarrationBuffer` with 96-char lookahead)
  - Confidence scorer (`apps/api/src/agents/confidenceScorer.ts`) — per-finding deterministic confidence from bundle evidence
  - Risk-level clamp (`clampRiskLevel`) — post-hoc deterministic safety net
- **Decision date / status:** Active development as of 2026-07-10; S18 WSA landed cost capture; S19 lands this card + parity mitigation + safety-net transparency

---

## 2. Intended use

CareSync AI is a **decision-support tool** for care coordinators managing high-risk patients post-discharge. Concretely:

- Reads a patient's full FHIR record via `Patient/$everything`
- Dispatches four LLM agents in parallel (Risk, Care Gap, SDOH), then synthesizes findings into prioritized FHIR Task list (Action Planner)
- Surfaces findings inside the EHR workflow via CDS Hooks `patient-view` service
- Mobile-responsive PWA for care coordinators (task queue + task detail with citations)
- **All FHIR Task creation requires human coordinator action** — the system proposes, the human disposes

The intended user is a licensed care coordinator (RN, social worker, or care manager) with access to a CDS Hooks-compliant EHR. The patient population is high-risk complex patients driving ~50% of healthcare costs.

---

## 3. Out-of-scope uses

The system is **NOT** designed for:

- **Autonomous clinical decision-making.** No diagnosis, no prescribing, no autonomous follow-up scheduling. The `SUBMISSION.md §3.2` posture is explicit: decision-support, not autonomous decision-maker.
- **Diagnostic use.** Risk levels are a 30-day readmission heuristic, not a diagnostic claim.
- **ICU / critical-care monitoring.** Out-of-scope by design.
- **Populations outside US Core demographics.** The demographic parity computation reads US Core race/ethnicity extensions; the AHC-HRSN SDOH screening is in English. Populations without US Core extensions are not represented in parity aggregates.
- **Real-time alerting.** Latency is multi-second LLM-call latency per patient, not sub-second alerting latency.

---

## 4. Architecture summary

```
                    ┌─────────────────────────────┐
                    │     HAPI FHIR R4 (Docker)    │
                    │   Patient, Condition, Obs,   │
                    │   Task, RiskAssessment       │
                    └────────────┬────────────────┘
                                 │ $everything
                    ┌────────────▼────────────────┐
                    │   FhirReadService + SMART    │
                    │   Backend Services (RS256)   │
                    └────────────┬────────────────┘
                                 │ PatientBundle
                    ┌────────────▼────────────────┐
                    │     Citation validator       │
                    │  (validateCitations + 96-char │
                    │   NarrationBuffer redaction) │
                    └────────────┬────────────────┘
                                 │ validIds
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
   ┌────▼─────┐           ┌──────▼──────┐          ┌──────▼──────┐
   │  Risk    │           │  Care Gap   │          │   SDOH      │
   │  agent   │           │   agent     │          │   agent     │
   │ gpt-5.5  │           │  gpt-5.5    │          │  gpt-5.5    │
   └────┬─────┘           └──────┬──────┘          └──────┬──────┘
        │ 3 concurrent             │                      │
        └────────────────────────┼───────────────────────┘
                                 │ race-based merge (async iter)
                    ┌────────────▼────────────────┐
                    │     Confidence scorer       │
                    │  (per-finding, deterministic)│
                    └────────────┬────────────────┘
                                 │
                    ┌────────────▼────────────────┐
                    │    clampRiskLevel safety net │
                    │  (deterministic, post-hoc)   │
                    └────────────┬────────────────┘
                                 │
                    ┌────────────▼────────────────┐
                    │     Action Planner            │
                    │     gpt-5.5 (sequential)      │
                    └────────────┬────────────────┘
                                 │ FHIR Tasks
                    ┌────────────▼────────────────┐
                    │  CDS Hooks patient-view       │
                    │  (delivers cards into EHR)    │
                    └───────────────────────────────┘
```

**Key architectural invariants:**
- Every LLM finding cites a `ResourceType/id` that must exist in the bundle's `validIds` set; fabricated citations are dropped before reaching the client or HAPI.
- Free-text narration is redacted via streaming `NarrationBuffer` with 96-char lookahead — any subsequent reference to a dropped citation is also redacted.
- The deterministic `clampRiskLevel` safety net downgrades the LLM's 'high' or 'critical' to 'moderate' when the bundle lacks sufficient evidence (deterministic score < 75, no abnormal labs, no recent encounter). Audit trail: see `## Safety-net activity` in `docs/eval-report.md`.
- Per-finding confidence is a deterministic function of bundle evidence (citation count + abnormal lab presence + recent encounter presence), not model self-report.

---

## 5. Training data disclosure

**All patient data in this submission is synthetic.** Specifically:

- **Curated hero/panel patients (maria-chen, james-okafor, linda-torres, robert-kim, angela-diaz, samuel-wright):** hand-authored by the development team in `apps/api/src/fhir-data/seed-patients.ts`. No PHI. No real patient data ever imported.
- **Procedural population (pop-0001..pop-0500):** generated deterministically by `apps/api/src/fhir-data/population.ts` from a seeded PRNG (mulberry32, seed `0xc0ffee`). Same inputs → same outputs every run.
- **Synthea substitution:** `plan.md §3` discloses that real Synthea is replaced with the deterministic procedural generator (the project's Docker setup does not include Java/Synthea; see `verification-s5.md` for the precedent).
- **No model training.** The agents call `gpt-5.5` via API; no fine-tuning, no RLHF, no embedding fine-tuning. The agents are pure inference + structured output.

---

## 6. Evaluation results

Detailed evaluation results live in [`docs/eval-report.md`](./docs/eval-report.md). Status line at top of that file is the canonical "where we are right now" snapshot. Key headline numbers as of 2026-07-10 (post-S18 WSA):

- **Risk agent:** dev sensitivity 66.7% (one new FN — pop-0007 — flagged for clinician review via the WSC engagement), specificity 84.6%; held-out specificity 100%, sensitivity N/A (denominator 0)
- **Care Gap agent:** dev sensitivity 100%, specificity 0% (single negative example, maria-chen — flagged in `_meta.limitations`; S19 seeds more)
- **SDOH agent:** dev agreement 93.8% (15/16)
- **Cost:** $0.3950 / patient avg (gpt-5.5); projected $395 / 1000-patient monthly cohort

The Risk sensitivity regression (100% → 66.7%) is **diagnosed as a label/generator drift** (see `grill-s19.md` Cross-cut 1), not a clamp bug. S19 Thread C3 repairs the label.

For the rubric-level (HL7 judge) evaluation, see `reports/HL7-Challenge-Evaluation.2026-07-10-fresh.md`.

---

## 7. Risk and limitations

The system has the following documented limitations. Reviewers should weigh findings against these.

| Limitation | Why it matters |
|---|---|
| **Confidence is a bundle-evidence heuristic, not a calibrated probability** | `scoreRiskFlag` returns `min(0.9, 0.3 + 0.2·citationCount + 0.2·hasAbnormalLab + 0.2·recentEncounter)`. A 0.9 finding is not a "90% likely" claim — it's a "3 of 3 evidence signals present" marker. Treat as ordinal, not cardinal. |
| **Ground truth is dev-labeled, not clinician-validated** | All 26 ground-truth labels in `data/eval/labels.json` were interpreted by the development team per `_meta.labelingRules`. The `clinicianOverride` slot exists for clinician corrections; 0/26 are clinician-validated as of 2026-07-10. S19 Thread E ships the WSC outreach to a clinician. |
| **Small n** | 26 patients (16 dev-labeled + 10 held-out) does not support strong statistical claims about sensitivity / specificity. The metrics are reported with denominators and confidence intervals are NOT computed (one of the open questions for S20+). |
| **`clampRiskLevel` may downgrade true positives** | The safety net is rule-based and conservative. A patient whose LLM output says 'high' but whose bundle evidence is sparse will be downgraded to 'moderate' even if the LLM was clinically correct. S19 Thread D adds audit-row transparency on each downgrade so the behavior is observable. |
| **Population is 500 procedural patients, not a clinical sample** | All parity, risk-score-distribution, and SDOH aggregates run against a deterministic 500-patient procedural cohort. Real-world distributions (especially across race/ethnicity, insurance type, geography) are not represented. |
| **Deterministic clamp is rule-based, not learned** | The clamp uses fixed thresholds (`CRITICAL_RISK_THRESHOLD = 75`, recency bonuses). It does not learn from new evidence. Future rubric versions may supersede the clamp; see S16 design doc for the iteration history. |
| **LLM output is non-deterministic at temperature > 0** | Variance probe (`apps/api/src/eval/varianceProbe.ts`) shows 81.25% per-patient agreement across 3 runs. A patient the system calls 'high' today may be called 'moderate' on a re-run; this is the reason for the citation validator + clamp safety net. |

---

## 8. NIST AI RMF mapping

| Function | Concrete code path |
|---|---|
| **GOVERN** | Role-based scope enforcement (`apps/api/src/auth/scopes.ts`); Director-only gates on governance endpoints (`apps/api/src/governance/service.ts`); audit trail in SQLite (`apps/api/src/db/audit.ts`); denial logging on guard violations |
| **MAP** | Explicit patient cohort via `Patient/$everything` (`apps/api/src/fhir/client.ts:getPatientBundle`); per-agent schemas cite the bundle's `validIds`; bundle evidence is the only context the agents see (no hidden system prompts, no external knowledge) |
| **MEASURE** | Sensitivity / specificity / PPV computation (`apps/api/src/eval/computeMetrics.ts`); demographic parity (`apps/api/src/governance/service.ts:getParityMetrics`); confidence distribution (`getModelPerformance`); cost capture (`apps/api/src/agents/pricing.ts` + `usage.ts`); LLM-variance probe (`apps/api/src/eval/varianceProbe.ts`) |
| **MANAGE** | Citation validator drops fabricated citations; narration redactor (`redactUnvalidatedCitations`); deterministic `clampRiskLevel` safety net; per-finding confidence scoring; parity mitigation escalation (S19 Thread B); human-in-the-loop FHIR Task creation requiring coordinator action; safety-net transparency (S19 Thread D); outreach to clinicians for label validation (S19 Thread E) |

---

## 9. Contact and acknowledgments

- **Submission contact:** see the submission challenge portal entry for CareSync AI / Bitcot
- **Code review and feedback:** open an issue against this repository
- **Clinician reviewers:** the `data/eval/clinician-outreach.json` log records the engagement. Clinicians who validate labels via the `npm run review:apply` flow are acknowledged in the post-engagement verification artifact
- **Standards references:** FHIR R4, SMART Backend Services, CDS Hooks, FHIR Subscription, FHIR SDC / AHC-HRSN, LOINC, SNOMED CT, ICD-10, US Core — all referenced in `docs/SOLUTION_OVERVIEW.md` §2

---

*This model card is committed at `MODEL_CARD.md` (repo root). An integrity test in `apps/api/test/docs-model-card.test.ts` asserts the file exists with all 9 sections in order — preventing accidental deletion of the artifact. Updates to the model card should be made in the same commit as any architectural change that affects sections 4, 6, 7, or 8.*