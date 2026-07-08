# HL7 AI Challenge 2026 - Evaluation Framework and Scoring Rubric

A judging instrument for scoring **contest submissions** to the HL7 AI Challenge. It is built around one governing insight: this is not a generic "AI in healthcare" contest, it is a contest about **HL7 standards being the load-bearing enabler of an AI breakthrough**. The scoring is weighted so that the depth and correctness of HL7 usage, the genuine centrality of the AI, and the ambition of the idea all count more than surface polish or production maturity.

> **Calibration note (read first).** This is a *contest* rubric, not a funding-diligence rubric. It is tuned to reward ambition and a well-architected vision, and it judges safety, guardrails, compliance, and interoperability **at the architecture and design level plus what is demonstrated** - not by forensic audit of the code. Early-stage and proof-of-concept work is expected and is not penalized as such. The one strict expectation is honest staging: a submission must clearly separate what is *built*, what is *prototyped*, and what is *envisioned*.

---

## 1. How this rubric reads the challenge

Four signals drove the design:

1. **Standards are the thesis, not a checkbox.** The stated aims are to "demonstrate the power of HL7 standards" and show "how HL7 is driving real-world solutions." A solution where FHIR / v2 / CDA is incidental should not out-score one where it is essential, even if the former is flashier.
2. **The judges skew toward trust, evidence, and deployment thinking.** The bench includes SMART on FHIR, Da Vinci, FAIR data and knowledge-graph, explainability-and-governance, and open-standards-at-scale expertise. Explainability, evaluation design, privacy-preserving architecture, and a credible path to deployment will be scrutinized - but as design and reasoning, appropriate to a contest.
3. **AI must be the engine, not the paint.** Every impact-bearing pillar is weighted by how uniquely and centrally AI / GenAI is applied. This is handled two ways: a dedicated AI pillar, plus an optional cross-cutting multiplier (Section 5) that scales the score by AI substance.
4. **Ambition is an asset, not a risk.** Contests exist to surface bold ideas. A transformative swing with a sound architecture and a demonstrated core is worth more than a safe, fully-proven increment.

---

## 2. Scoring architecture

Three tiers, applied in order.

- **Tier 0 - Gates (pass / fail).** Threshold conditions. A submission that fails a hard gate is not competitive regardless of brilliance elsewhere. Gates stop "AI theater," standards name-dropping, and maturity-overclaiming from reaching the leaderboard.
- **Tier 1 - Weighted pillars (the score).** Nine pillars, each scored 1-5, combined into a weighted 0-100 total. This is the primary ranking.
- **Tier 2 - AI-Leverage Multiplier (optional overlay).** A single modifier that rewards genuine AI centrality and ingenuity and penalizes bolt-on AI. Use as a tie-breaker, or as a full overlay in a mature judging round.

---

## 3. Tier 0 - Gates (pass / fail)

Each gate is answered Yes / No. Recommended: hard-fail G1-G4; G5 is a documented-risk flag rather than an automatic fail. Gates are assessed at the architectural / design level and against what the submission actually demonstrates or specifies.

| # | Gate | Pass condition | Why it exists |
|---|------|----------------|---------------|
| G1 | **HL7 substance** | The solution genuinely depends on one or more HL7 standards (FHIR, v2.x, CDA/C-CDA, SMART on FHIR, CDS Hooks, Bulk FHIR, FHIRcast, terminology bindings). Removing the standard would break or materially degrade it. | This challenge is about HL7. Claiming "we output FHIR" at the last mile is not substance. |
| G2 | **AI centrality** | AI / GenAI is material to the value delivered, not decorative. The core capability would not exist, or would be far weaker, without the model. | Prevents conventional software with an AI veneer from competing as an "AI" entry. |
| G3 | **Safety, privacy and guardrails by design** | The architecture addresses patient-safety hazards, PHI handling (de-identification, consent, access control, minimization), and AI guardrails. Judged as design intent and demonstrated controls, not as an audited codebase. | Healthcare stakes. A design that ignores safety cannot win, even in a contest. |
| G4 | **Honest staging of claims** | The submission clearly distinguishes what is built vs. prototyped vs. envisioned, and does not present vision as shipped reality. Ambition is welcome; misrepresentation is not. | The contest-appropriate replacement for "everything must be in production." Guards against overclaiming maturity. |
| G5 | **Ethical and regulatory posture** (flag) | No deceptive use, no obvious regulatory violation; regulated-use claims acknowledge the applicable pathway (FDA SaMD, EU AI Act, IVDR, etc.) at the level of awareness, not full submission. | Surfaces legal risk to judges without penalizing early-stage work. |

---

## 4. Tier 1 - Weighted pillars

Weights are a recommended default and are meant to be tuned. Rationale is given per pillar so you can re-balance defensibly. Each pillar is scored 1-5; anchors for levels 1, 3, and 5 are given, with 2 and 4 as interpolations.

**Scale meaning:** 1 = Poor / absent, 2 = Emerging, 3 = Solid / credible, 4 = Strong, 5 = Exemplary / field-leading.

### Pillar weights at a glance

| # | Pillar | Weight | One-line rationale |
|---|--------|:------:|--------------------|
| P1 | HL7 Standards Leverage and Interoperability | 18% | The differentiator for *this* challenge; standards must be load-bearing. |
| P2 | Clinical and Health Impact - demonstrated and credibly projected | 18% | Both realized and plausibly reachable transformation in number and quality of outcomes. |
| P3 | AI / GenAI Innovation and Substance | 18% | Novelty and appropriateness of the AI, and whether it is the engine. |
| P4 | Trust, Safety, Governance and Explainability - by design | 13% | Non-negotiable in healthcare; judged at the architectural level. |
| P5 | Transformative Vision and Ambition | 12% | Rewards the bold, hard swing a contest exists to surface. |
| P6 | Proof, Demonstration and Evaluation Design - stage-appropriate | 8% | Is the core claim shown to work, and is the validation thinking sound. |
| P7 | Efficiency and Economic Soundness | 5% | No fatal cost flaw; efficient by design; a credible path to affordability. |
| P8 | Experience - Clinician and Patient | 4% | Workflow fit and reduction of friction and cognitive burden. |
| P9 | Equity, Access and Scalability | 4% | Reach across diverse and low-resource settings; generalizability. |
| | **Total** | **100%** | |

---

### P1 - HL7 Standards Leverage and Interoperability (18%)

**Core question:** How deeply, correctly, and creatively does the solution use HL7 standards, and does the AI genuinely depend on and advance them?

**What to look for:** correct and idiomatic use of the relevant standard (not just valid JSON that happens to be FHIR-shaped); the right resources / profiles / terminology bindings (USCDI, LOINC, SNOMED CT, ICD, RxNorm); portability across EHRs and vendors; use of the ecosystem where apt (SMART on FHIR launch, CDS Hooks, Bulk FHIR, subscriptions); whether the AI consumes or produces standards-native data as a first-class dependency; and whether the work contributes back a reusable pattern, profile, or implementation guide.

**AI lens:** the strongest entries use standards to *feed and ground* the AI - FHIR-native context as grounding for a GenAI model, or knowledge-graph / terminology structure that constrains hallucination.

| Level | Anchor |
|:-----:|--------|
| 1 | Standards are cosmetic or claimed but not evidenced. A last-mile export at best. |
| 3 | Correct, meaningful use of at least one standard that is integral to the data flow; the AI clearly consumes or emits standards-native data. |
| 5 | Standards are the backbone. Idiomatic multi-standard use, proper profiling and terminology, cross-vendor portability, and a reusable contribution back to the community. The AI would be impossible without the interoperability layer. |

### P2 - Clinical and Health Impact: demonstrated and credibly projected (18%)

**Core question:** How much better, and for how many, does this make health outcomes - in both number and quality - counting both what is shown and what is credibly reachable?

**What to look for:** two dimensions scored together - *breadth* (patients / clinicians / sites / populations) and *depth* (how much the outcome improves: mortality, time-to-treatment, diagnostic accuracy, avoided harm, readmission, access). In a contest, a demonstrated improvement in a pilot plus a well-reasoned projection to scale is fully creditable. Prefer hard clinical or operational endpoints over proxy metrics; reward step-changes over marginal gains.

**AI lens:** the improvement should be traceable to the AI capability, not to a process change that happened to ship alongside it.

| Level | Anchor |
|:-----:|--------|
| 1 | Impact is hand-waved, or an incremental convenience with no outcome logic. |
| 3 | Credible improvement on a meaningful endpoint shown at pilot scale, with a defensible projection to broader impact. |
| 5 | Demonstrated large improvement on high-value outcomes, with a rigorous, believable path to population-level transformation across both breadth and depth. |

### P3 - AI / GenAI Innovation and Substance (18%)

**Core question:** Is the AI genuinely novel and well-matched to the problem, or a familiar technique dressed up - or GenAI used where it should not be?

**What to look for:** appropriateness of technique (not GenAI for its own sake); novel architecture where it earns its place (agentic workflows, retrieval-grounding, multimodal fusion, symbolic + statistical hybrids, knowledge-graph grounding); solving something previously intractable rather than automating something already easy; defensible reasons for the model and design choices.

**AI lens:** reward ingenuity specific to healthcare constraints - grounding against clinical terminologies, uncertainty-aware outputs, handling of messy real-world clinical data - over generic model application.

| Level | Anchor |
|:-----:|--------|
| 1 | Off-the-shelf model on a solved problem, or GenAI mis-applied where deterministic methods fit better. |
| 3 | Sound, well-justified application of AI to a real problem, with at least one genuinely thoughtful design choice. |
| 5 | Inventive, hard-to-copy AI approach that unlocks something not previously feasible, with technique clearly fitted to clinical constraints. |

### P4 - Trust, Safety, Governance and Explainability - by design (13%)

**Core question:** Is the solution *architected* so that a clinician, patient, and regulator could trust it in production?

**What to look for (at the design and demonstrated-control level):** explainability / traceability of AI outputs; human-in-the-loop where stakes demand it; hallucination and error controls; awareness of bias and fairness across subpopulations; privacy-preserving architecture; auditability and monitoring intent; clear accountability; and honest handling of failure modes and limitations. Alignment to a recognized governance frame (risk management, model cards, a named regulatory pathway) is a plus. Judges assess the architecture and the guardrails shown - not a line-by-line code audit.

**AI lens:** GenAI entries are held to a higher bar - confabulation risk must be explicitly engineered against in the design, not hand-waved.

| Level | Anchor |
|:-----:|--------|
| 1 | Black box with no safety, bias, or explainability consideration; privacy addressed vaguely or not at all. |
| 3 | Reasonable safeguards in the design: some explainability, a human check where needed, privacy handled, limitations acknowledged. |
| 5 | Trustworthy-by-design: transparent, auditable, bias-aware, privacy-preserving, with a monitoring and governance story mapped to an applicable frame. |

### P5 - Transformative Vision and Ambition (12%)

**Core question:** How bold and consequential is the idea, and is the ambition matched by a coherent architecture rather than empty aspiration?

**What to look for:** the size of the problem being attacked; whether success would change the standard of care or the interoperability landscape rather than shave a few percent; originality of the framing; and - critically - whether the ambition is *anchored* by a sound architecture and a demonstrated core, so it reads as a credible moonshot rather than vaporware. Reward teams that reach; do not reward reaching with nothing underneath.

**AI lens:** the most creditable ambition uses AI plus HL7 to attempt something that neither could do alone.

| Level | Anchor |
|:-----:|--------|
| 1 | Timid and incremental, or grand claims with no architecture or demonstrated core beneath them. |
| 3 | A genuinely ambitious goal with a coherent architecture and a working core proving the central bet. |
| 5 | A field-shifting vision, credibly anchored: bold problem, original framing, sound architecture, and a demonstrated core that makes the ambition believable. |

### P6 - Proof, Demonstration and Evaluation Design - stage-appropriate (8%)

**Core question:** Is the core claim actually shown to work, and is the thinking about how to validate it sound for the stage?

**What to look for:** a working demonstration of the central capability (not slideware); an evaluation approach appropriate to a contest - sensible baselines, held-out data, a defined way of measuring the AI's behavior (accuracy, calibration, failure taxonomy); reproducibility of what is shown; and honest acknowledgment of what has not yet been tested. Production deployment is a bonus, not a requirement.

**AI lens:** a purpose-built evaluation *plan* for the model's behavior scores far above a single flattering number.

| Level | Anchor |
|:-----:|--------|
| 1 | Pure concept or slideware; nothing demonstrated; no evaluation thinking. |
| 3 | A working proof-of-concept of the core claim, with a sensible, if partial, evaluation approach and honest scope. |
| 5 | A convincing, reproducible demonstration plus a rigorous, stage-appropriate evaluation design (and, where present, real-world results). |

### P7 - Efficiency and Economic Soundness (5%)

**Core question:** Is there a fatal cost flaw, and is the approach efficient enough to be plausible at scale?

**What to look for:** rough total cost of ownership (compute, integration, maintenance, human oversight); compute and data efficiency; a plausible - not proven - path to affordability or sustainability; and awareness of cost in resource-limited settings. In a contest, credible reasoning beats audited ROI.

**AI lens:** an efficient model or architecture that delivers the outcome without heroic compute beats a brute-force approach that only pencils out in a lab.

| Level | Anchor |
|:-----:|--------|
| 1 | Economics ignored or clearly unsustainable at any scale. |
| 3 | No fatal cost flaw; a plausible efficiency and sustainability story. |
| 5 | Efficient by design with a compelling, well-reasoned economic path, including for constrained settings. |

### P8 - Experience: Clinician and Patient (4%)

**Core question:** Does it fit the way real people work and reduce friction rather than add it?

**What to look for:** integration into existing workflow and EHR surfaces rather than yet another separate app; reduction of cognitive load and clicks; accessibility; clarity and trust for patients; and any evidence, even early, that intended users engaged with it.

**AI lens:** reward AI that disappears into the workflow (ambient, in-context) over AI that demands new user behavior.

| Level | Anchor |
|:-----:|--------|
| 1 | Clunky, bolted-on, adds burden, or ignores the end user. |
| 3 | Usable and reasonably integrated; a user could adopt it without major disruption. |
| 5 | A superlative, low-friction experience embedded in the workflow, with signs of real engagement and reduced burden. |

### P9 - Equity, Access and Scalability (4%)

**Core question:** Would it work for diverse populations and scale beyond the launch site without breaking?

**What to look for:** attention to performance across demographic and clinical subgroups; applicability to underserved or low-resource settings; generalizability beyond the training or demo environment; and a technical path to scale safely and securely.

**AI lens:** reward explicit attention to equitable model behavior and to graceful operation on low-connectivity or low-data infrastructure.

| Level | Anchor |
|:-----:|--------|
| 1 | One narrow setting; equity and generalization unaddressed. |
| 3 | Some attention to equity and a plausible generalization and scale path. |
| 5 | Demonstrated or well-reasoned equitable performance across populations and settings, with a credible path to broad, safe scale. |

---

## 5. Tier 2 - AI-Leverage Multiplier (optional overlay)

The mechanism for weighting outcomes by *how uniquely and centrally AI is applied*. Two submissions can post identical outcome numbers while one is AI-driven and the other is a process change with AI bolted on.

Assign a single multiplier **M** from the judge's read of AI centrality and ingenuity.

| M | Meaning |
|:---:|---------|
| 1.15 | AI is the irreplaceable engine and the approach is genuinely inventive. |
| 1.00 | AI is central and competently applied (default). |
| 0.85 | AI helps but the outcome is mostly attributable to non-AI factors. |
| 0.70 | AI is decorative / theater; it could be removed with little loss. |

**Two ways to apply it:**

- **Tie-breaker mode (recommended default):** compute the Tier 1 weighted score normally; use M only to separate submissions within a few points of each other.
- **Overlay mode (mature round):** multiply the P2 + P3 + P5 contribution (the outcome, AI, and ambition core) by M before summing. Leave gates and other pillars unmodified.

Cap the effect so a single judgment call cannot dominate: never let M move a total by more than roughly 10 points. The multiplier is a scalpel for distinguishing substance from theater, not a second scoring system.

---

## 6. Scoring mechanics

**Weighted total (0-100):**

```
Total = SUM over pillars of ( pillar_score / 5 ) * weight_percent
```

Worked example: a strong, ambitious entry scoring P1=5, P2=4, P3=5, P4=4, P5=5, P6=3, P7=3, P8=4, P9=3:

```
(5/5*18)+(4/5*18)+(5/5*18)+(4/5*13)+(5/5*12)+(3/5*8)+(3/5*5)+(4/5*4)+(3/5*4)
= 18 + 14.4 + 18 + 10.4 + 12 + 4.8 + 3 + 3.2 + 2.4  = 86.2
```

**Score bands (guide, not law):**

| Band | Total | Reading |
|------|:-----:|---------|
| Finalist / winner tier | 85-100 | Standards-central, AI-driven, ambitious, with a demonstrated core. |
| Strong | 70-84 | Clearly competitive; likely a gap in demonstration, economics, or reach. |
| Promising | 55-69 | Good idea, not yet demonstrated or not yet standards-deep. |
| Not competitive | < 55, or any hard-gate fail | |

**Tie-breakers, in order:** (1) AI-Leverage Multiplier M; (2) P5 Ambition; (3) P2 Clinical Impact; (4) P1 HL7 Leverage; (5) P3 AI Innovation.

**Multi-judge use:** score independently, then reconcile. Flag any pillar where judges differ by 2 or more points for discussion rather than silent averaging - divergence usually means the submission is ambiguous on that dimension, which is itself information.

---

## 7. Decoy and anti-gaming watch-list

Contest submissions are prone to specific forms of impressive-looking emptiness. Dock, or gate, on these:

- **GenAI-washing:** a language model wrapped around a problem that deterministic software solved better and cheaper. (Hits P3 and G2.)
- **FHIR-shaped, not FHIR-native:** valid-looking payloads that no real system consumes; standards claimed in the abstract but not exercised. (Hits P1 and G1.)
- **Vision without a core - vaporware:** a grand narrative with nothing demonstrated. This is the contest analogue of the old demo-to-production gap: honest ambition anchored by a working core is rewarded (P5), but ambition with no core is not. (Hits P5, P6, and G4.)
- **Maturity overclaiming:** presenting envisioned features as shipped. (Hits G4.)
- **Benchmark cherry-picking:** one flattering metric, no baseline, no held-out data. (Hits P6.)
- **Hallucination hand-waving:** a GenAI clinical tool with no confabulation controls in the design. (Hits P4 and G3.)
- **Equity as a footnote:** "works for everyone" with no subgroup reasoning. (Hits P9.)

---

## 8. Quick-reference scorecard

Copy per submission.

```
Submission: ____________________   Judge: ____________   Date: __________

TIER 0 - GATES (Yes/No; any hard No = not competitive)
  G1 HL7 substance ................... [ ]
  G2 AI centrality ................... [ ]
  G3 Safety/privacy/guardrails design  [ ]
  G4 Honest staging of claims ........ [ ]
  G5 Ethical/regulatory (flag) ....... [ ]   Notes: ______________________

TIER 1 - PILLARS (score 1-5)                       weight   contribution
  P1 HL7 Leverage and Interoperability ...   __     18%      ____
  P2 Clinical Impact (shown + projected) .   __     18%      ____
  P3 AI / GenAI Innovation and Substance .   __     18%      ____
  P4 Trust/Safety/Governance (by design) .   __     13%      ____
  P5 Transformative Vision and Ambition ..   __     12%      ____
  P6 Proof, Demo and Evaluation Design ...   __      8%      ____
  P7 Efficiency and Economic Soundness ...   __      5%      ____
  P8 Experience (Clinician and Patient) ..   __      4%      ____
  P9 Equity, Access, Scalability .........   __      4%      ____
                                             WEIGHTED TOTAL:  ____ / 100

TIER 2 - AI-LEVERAGE MULTIPLIER M .........   ____ (0.70 - 1.15)
  Mode used:  [ ] tie-breaker   [ ] overlay
  Adjusted total (if overlay): ____ / 100

BAND: [ ] Finalist 85+  [ ] Strong 70-84  [ ] Promising 55-69  [ ] <55

Built vs. prototyped vs. envisioned (summary): __________________
Strongest dimension: ____________________________________________
Biggest risk / gap:  ____________________________________________
Open questions for the team: ____________________________________
One-line verdict:    ____________________________________________
```

---

*Weights and bands are defaults, not doctrine. If your round wants to reward, say, cost and experience more heavily than this panel would, re-balance the relevant pillars upward and document the change so scores stay comparable across judges.*