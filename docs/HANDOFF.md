# CareSync AI — HL7 Challenge 2026 Dev Team Handoff

**Competition:** HL7 AI Challenge 2026  
**Deadline:** ~20 days from session start  
**Submitted by:** Raj Sanghvi / Bitcot  
**Team:** Multiple web, mobile, and backend developers (net-new build, no prior FHIR codebase)

---

## 1. Competition Context

The HL7 AI Challenge rewards:
- HL7 standards as the **load-bearing** backbone of the AI (not a checkbox)
- AI that is the **engine**, not the paint
- **Trustworthy by design** — safety, governance, explainability at the architecture level
- **Ambition anchored by a working core** — honest staging beats overclaiming

Key judges to design for:
- **Josh Mandel** (Microsoft/SMART Health IT) — will probe SMART on FHIR correctness and FHIR resource fidelity
- **Mandana Ahmadi** (AI Strategist) — will probe evaluation design and AI governance
- **Theresa Cullen** (Public Health) — will probe equity, population impact, and SDOH
- **Brad Genereaux** (NVIDIA) — will probe AI architecture and model choices

---

## 2. Idea Selection Process

Five ideas were evaluated against the HL7 rubric (see `HL7-Challenge-Brief.md`). Two net-new ideas were generated and formally scored:

### Idea A — SafeScript: Medication Safety Agent via CDS Hooks
**Rubric score: 89.8 / 100 — Finalist tier**

An AI agent embedded in the EHR prescribing workflow via CDS Hooks. Fetches the patient's FHIR bundle (meds, allergies, labs, problems), reasons over it with an LLM, and returns citation-backed safety cards grounded only in the patient's actual FHIR resource IDs — never hallucinated.

**Why it nearly won:**
- Citation enforcement (output tied to FHIR resource IDs) is a real architectural innovation
- CDS Hooks delivers inside the EHR — zero new UI for clinicians
- Strongest P3 (AI novelty) + P4 (safety) combination
- P4 scored 5/5 — strongest safety story of any idea evaluated

**Why it was not selected:**
- Demo requires a scripted prescribing scenario; harder to make visceral at population scale
- Less mobile/web app surface area — most of the app lives inside the EHR

---

### Idea B — CareSync AI: Multi-Agent FHIR Care Orchestrator ✅ SELECTED
**Rubric score: 90.6 / 100 — Finalist tier**

A multi-agent system where specialist sub-agents (Risk, Care Gap, SDOH, Action Planner) each reason over a complex patient's FHIR bundle and coordinate to generate a prioritized action plan — delivered as CDS Hooks cards to clinicians and FHIR Tasks to the care team, tracked via web and mobile.

**Why it won:**
- Highest P2 (clinical impact) + P5 (ambition) scores — complex patients = 50% of healthcare costs
- Multi-agent architecture mirrors how real care teams actually work — genuinely novel framing
- Best surface area for a compelling web + mobile demo
- FHIR Tasks + Subscriptions enable real-time push to mobile (judges can see the full loop)
- Widest HL7 standards footprint: FHIR R4, SMART on FHIR, CDS Hooks, FHIR Task, FHIR Subscriptions

**Rubric breakdown:**

| Pillar | Score | Weight | Points |
|--------|:-----:|:------:|:------:|
| P1 HL7 Standards Leverage | 5 | 18% | 18.0 |
| P2 Clinical Impact | 5 | 18% | 18.0 |
| P3 AI Innovation | 5 | 18% | 18.0 |
| P4 Trust/Safety/Governance | 4 | 13% | 10.4 |
| P5 Transformative Vision | 5 | 12% | 12.0 |
| P6 Proof & Evaluation | 3 | 8% | 4.8 |
| P7 Efficiency/Economics | 3 | 5% | 3.0 |
| P8 Clinician/Patient Experience | 4 | 4% | 3.2 |
| P9 Equity & Scalability | 4 | 4% | 3.2 |
| **TOTAL** | | | **90.6** |

**AI-Leverage Multiplier:** M = 1.15 — multi-agent orchestration is not achievable without LLMs; the specialist sub-agent decomposition mirrors clinical team structure in a way that is genuinely inventive.

---

## 3. CDO / Innovation Lens

> "Why would any Chief Digital Officer or hospital innovator be impressed with a task queue?"

The current demo speaks to a care coordinator. A CDO at Mayo Clinic, Cleveland Clinic, or Mass General thinks differently. Here is what they actually lose sleep over — and the four screens that speak to each:

### What CDOs actually care about

| CDO Concern | Current Demo | What Would Impress |
|---|---|---|
| **Scale** | One patient (Maria) | 847 high-risk patients analyzed overnight |
| **Financial impact** | Task queue | $2.3M HEDIS quality incentive at stake |
| **AI trust** | "The AI said so" | Audit trail traceable to FHIR resource IDs |
| **Governance** | None shown | Model version, confidence, demographic parity |
| **Burnout** | Manual task management | Ambient documentation, zero manual entry |
| **Network** | One care site | Cross-IDN patient handoffs |

### CDO-Grade Innovation: Four Screen Options

#### Option A — Population Command Center (Priority: HIGH)
Stop showing one patient. Show 847 patients as a real-time risk scatter plot (risk score × urgency). The AI has already run overnight on all of them. CDO sees: *"23 patients enter the critical zone in 72 hours. Preventing 5 admissions this month = $900K in avoidable cost."* One button deploys all agents simultaneously.

- **Why it wins:** Turns the demo from a task app into a population intelligence platform
- **Rubric impact:** +P2, +P5, +P9
- **Complexity:** Medium — build on top of the existing agent engine

#### Option B — Value-Based Care Financial Intelligence (Priority: HIGH)
Connect clinical AI to HEDIS quality measure tracking. Show real-time: *"Diabetes eye exam completion: 67% vs. 75% target. 127 reachable patients identified. $2.3M quality incentive at stake by Dec 31."* Every CDO at a risk-bearing ACO has this number on their dashboard. When the AI surfaces it automatically from FHIR data, that is the innovation.

- **Why it wins:** Speaks to the CFO and the CDO simultaneously — clinical and financial in one view
- **Rubric impact:** +P2, +P5, +P7
- **Complexity:** Medium — requires mapping FHIR Observations to HEDIS measure logic

#### Option C — AI Governance & Trust Dashboard (Priority: CRITICAL — builds next) ⭐
This is the screen that wins the *Transparency and Trust* judging category. Every CDO has been burned by an AI vendor whose system hallucinated. Show: model version history, confidence distribution across patient cohort, demographic parity metrics (risk scores broken down by race/ethnicity/age), and a live audit trail where every recommendation traces back to the exact FHIR resource IDs that drove it.

- **Why it wins:** No other team will build this. It directly addresses the CDO's board-level concern. It also turns Gate G3 and P4 from checkboxes into your strongest differentiator.
- **Rubric impact:** +P3, +P4 (4→5), +G3, potential +1.15 AI multiplier
- **Complexity:** Low-Medium — add an audit panel to the existing dashboard

#### Option D — Ambient Care Closure Loop (Priority: MEDIUM)
After the coordinator calls Maria, ambient AI listens, auto-generates FHIR CarePlan updates, closes tasks, and creates structured notes — zero manual documentation. Coordinators spend 3 hours/day on documentation today.

- **Why it wins:** Visceral "wow" moment — coordinators in the room will immediately understand the value
- **Rubric impact:** +P3, +P8
- **Complexity:** High — requires audio capture + ASR + FHIR write-back

### Recommended Build Priority

1. **Option C (AI Governance)** — add as a panel to the existing web dashboard. Highest rubric impact, lowest build complexity, most differentiated.
2. **Option A (Population view)** — build as the landing/home screen before drilling into a patient. Changes the strategic narrative.
3. **Option B (VBC)** — add as a tab in the web dashboard. Strong if any judge has a value-based care background.
4. **Option D (Ambient)** — only if you have dev capacity after the above three.

---

## 4. Design System

### Design Intent
The visual language should feel like a **clinical mission control** — not a consumer health app, not a startup product. Think the aesthetic of medical imaging software meets a Bloomberg terminal. Dark, precise, data-dense, trustworthy.

### Color Tokens

```css
--bg:            #07111E  /* Deep midnight navy — base canvas */
--surface:       #0C1829  /* Dark navy — card background */
--surface-hover: #0F2038  /* Hover state */
--surface-raised: #132842 /* Elevated card */
--border:        #1A3450  /* Subtle dividers */
--border-light:  #244A6A  /* Active borders */

/* Agent colors — each agent has a persistent identity */
--cyan:    #00C8FF  /* Orchestrator / primary accent */
--red:     #E84848  /* Risk Agent / CRITICAL priority */
--violet:  #8661D4  /* Care Gap Agent / MEDIUM priority */
--emerald: #0FC48A  /* SDOH Agent / LOW / resolved */
--amber:   #F0970A  /* Action Planner / HIGH priority */

/* Text */
--text:       #C8E6F5  /* Primary content */
--text-muted: #5A8FAA  /* Secondary / labels */
--text-dim:   #2C567A  /* FHIR resource IDs, metadata */

/* Functional */
--cyan-dim:  rgba(0,200,255,0.10)
--red-dim:   rgba(232,72,72,0.12)
--violet-dim: rgba(134,97,212,0.12)
--emerald-dim: rgba(15,196,138,0.12)
--amber-dim: rgba(240,151,10,0.12)
```

### Typography

```css
--font: -apple-system, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
--mono: 'SF Mono', 'Menlo', 'Courier New', monospace;

/* Scale */
/* 11px — FHIR resource IDs, metadata, mono citations */
/* 12px — labels, pill text (uppercase + letter-spacing: 0.5px) */
/* 13px — body text (web dashboard base) */
/* 15px — body text (mobile base) */
/* 17px — section headers */
/* 20px — patient names, page titles */
/* 28px — large data values (risk scores, counts) */
```

### Key Design Decisions

- **No emoji** — use inline SVG icons throughout. Emoji reads as consumer/casual; this is clinical.
- **Agent color identity is persistent** — the same color follows each agent from the graph node → the feed box → the task card evidence citation. This teaches the user to "read" which agent found what.
- **Monospace for all FHIR resource IDs** — every Task/4829-CARD, Observation/BNP-3394 reference appears in `--mono` at `--text-dim`. This signals real data, not invented labels.
- **Priority pills are uppercase, 10px, letter-spacing 0.5px** — clinical instruments use uppercase labeling conventions.
- **No harsh shadows** — depth via background color steps (surface → surface-raised → bg), not drop shadows.
- **Scanline overlay on canvas** — `repeating-linear-gradient` at 10% opacity creates a subtle CRT/monitor texture that reads as medical-grade display equipment.

### Anti-patterns (do not use)
- Warm cream backgrounds
- Purple-to-blue gradient heroes
- Emoji as section markers
- `rounded-xl` everywhere (use 8px cards, 4px chips, 20px pills — intentionally)
- Inter or Space Grotesk as the "safe" font choice
- Centered-everything layouts

---

## 5. Screens Built

### Screen 1: Web Dashboard — Care Coordinator Command Center
**File:** `caresync-ai.html`  
**Artifact:** https://claude.ai/code/artifact/6d43ed9b-e362-49cb-8c6b-279f82423da1

**Layout:** 3-panel (260px patient list / flex center / 300px task queue), 48px header, 100vh no-scroll

**Components:**
- **App header** — CareSync AI logo (SVG heartbeat + wordmark), FHIR R4 / SMART on FHIR / CDS Hooks pill badges, sync indicator, notification bell with badge, JC avatar
- **Patient panel** — 142-patient list with risk dot colors, condition tags, active state (Maria Chen selected with cyan left border)
- **Agent graph canvas** — `requestAnimationFrame` animation, quadratic bezier edges, particle system flowing along edges, 5-node radial layout (Orchestrator center + 4 specialist agents), per-agent color identity, radar ring pulse on orchestrator, scanline overlay, state machine: IDLE → INIT → DISPATCH → ANALYZING → SYNTHESIZING → COMPLETE
- **Agent stream feeds** — 4 boxes (one per agent), text streams word-by-word at 72ms/word with staggered start offsets (0ms / 800ms / 1600ms / 2400ms), blinking caret while streaming
- **Task queue** — 5 cards stagger-reveal after COMPLETE state, priority pills, FHIR resource ID citations in mono, FHIR Bundle tree with expand/collapse
- **Run Analysis button** — loading state with CSS spinner during analysis, re-triggerable (clears and replays)

**Patient data (Maria Chen, 68F):**
- Conditions: Type 2 Diabetes (E11.9), CHF (I50.9), Major Depressive Disorder (F33.1)
- Meds: Metformin 1000mg BID, Lisinopril 10mg, Furosemide 40mg, Sertraline 50mg
- Labs: HbA1c 8.9% (H), BNP 340 pg/mL (H), eGFR 52 mL/min (L), K+ 3.4 mEq/L (L)
- SDOH: Lives alone, transportation barrier, food insecurity (AHC-HRSN positive)
- Discharge: 48 hours prior (CHF exacerbation)
- Risk score: 87/100

---

### Screen 2: Mobile App — Field Coordinator View
**File:** `caresync-mobile.html`  
**Artifact:** https://claude.ai/code/artifact/2d4e2cab-effd-431c-81bf-94a01eadb0a1

**Layout:** 390×844px phone shell centered on page (iOS form factor), overflow hidden, realistic depth via inset shadow

**Components:**
- **iOS status bar** — time "9:41", inline SVG signal/wifi/battery icons
- **Navigation header** — back chevron, "My Tasks" title, bell with badge "5"
- **Summary stats bar** — 5 Open (cyan) | 2 Critical (red) | 87 Patients (muted)
- **Segment tabs** — Tasks (active, cyan underline) | Patients | Alerts | Profile
- **Task cards** — priority left border (agent color), 10px uppercase priority pill, patient name + condition chip, FHIR resource ID in mono, due date, [Done] + [Call] action buttons; first card shown in "tapped" state
- **Completed task** — green check circle, strikethrough text, dimmed card
- **Pull-to-refresh indicator** — CSS spinning ring + "Checking for updates..." in text-dim
- **FHIR sync indicator** — "Syncing FHIR..." with animated ring in top-right of list
- **Bottom sheet (peeking)** — drag handle, "Maria Chen — Risk Summary", "87 / 100" in large cyan, condition chips, HIGH RISK badge
- **Bottom tab bar** — 5 inline SVG icons (Tasks active in cyan, Patients, Alerts, Messages, Profile), "FHIR R4 · SMART on FHIR" footer

---

## 6. Demo Narrative (90-Second Script)

**The story:** Maria Chen, 68. Diabetic. Congestive heart failure. Discharged 48 hours ago. She is one of 142 patients on this coordinator's panel. Without CareSync, she is a row in a spreadsheet.

**Second 0–15 (Web — Patient Selected)**
Open on the web dashboard. Patient list visible on the left. "Maria Chen" is highlighted — a red CRITICAL dot beside her name. The coordinator clicks her name.

**Second 15–45 (Web — Agent Analysis)**
Click "Run Analysis." The orchestrator node in the center canvas pulses to life. Four edges light up simultaneously as the orchestrator dispatches to all four specialist agents. Each agent's feed box begins streaming its findings in real-time:
- Risk Agent: BNP 340, readmission risk 87%
- Care Gap Agent: cardiology follow-up overdue, PHQ-9 overdue
- SDOH Agent: transportation barrier, food insecurity positive
- Action Planner: synthesizing → 5 FHIR Tasks generated

**Second 45–65 (Web — Tasks Materialize)**
The right panel comes alive. Five task cards stagger-appear one by one. Each card cites the exact FHIR resource that generated it: *Task/4829-CARD, Observation/BNP-3394.* The coordinator sees what the AI found AND why.

**Second 65–90 (Mobile — Field Coordinator)**
Cut to the phone. The coordinator's mobile app already shows Maria's tasks — pushed via FHIR Subscription the moment the analysis completed. The coordinator taps "Call" on the cardiology task. Swipes "Done." The task closes. The web dashboard updates.

**Total: 90 seconds. One patient. One near-miss prevented.**

---

## 7. Technical Architecture

### Standards Used (all load-bearing)
| Standard | Role |
|---|---|
| FHIR R4 | Patient data backbone — every recommendation traces to a resource |
| SMART on FHIR | OAuth 2.0 scoped access to patient data |
| CDS Hooks | Delivery of AI recommendations into EHR workflows |
| FHIR Task | Structured work items for care coordinators |
| FHIR Subscription | Real-time push from server to mobile client |
| FHIR SDC | AHC-HRSN SDOH questionnaire administration |
| LOINC / SNOMED CT / RxNorm | Terminology bindings on all resources |

### Data Layer
- **FHIR Server:** HAPI FHIR (open source, Docker) or SMART Health IT sandbox
- **Patient data:** Synthea — generate 500+ complex patients (diabetes + CHF + depression comorbidities)
- **Command:** `synthea --population 500 --module diabetes --module congestive_heart_failure --module depression`

### Agent Architecture
```
CareSync Orchestrator (LLM)
├── Risk Agent          → reads Observation, Condition, MedicationRequest → outputs risk score + flags
├── Care Gap Agent      → reads CarePlan, Condition, Encounter → outputs gap list
├── SDOH Agent          → reads QuestionnaireResponse (AHC-HRSN), Observation → outputs SDOH flags
└── Action Planner      → reads all agent outputs → creates FHIR Task resources
```

Each agent:
- Receives a structured FHIR context (not free text)
- Returns structured JSON with findings + FHIR resource citations
- Cannot reference data not in the retrieved bundle (hallucination surface eliminated)

### Evaluation Harness (moves P6 from 3→5)
1. Generate 50 complex Synthea patients
2. Manually label ground-truth care gaps for 10 patients (one clinician, 2 hours)
3. Run CareSync agents on all 50
4. Report sensitivity/specificity vs. ground truth
5. Include in submission — this is what Judge Ahmadi is specifically looking for

### Tech Stack Recommendation
- **Backend:** Node.js or Python FastAPI — CDS Hooks service + agent orchestration
- **FHIR client:** `fhirclient` (JS) or `fhir.py` (Python)
- **LLM:** Claude claude-sonnet-4-6 via Anthropic API (structured output mode for citation enforcement)
- **Web frontend:** React or Next.js — matches the mockup layout
- **Mobile:** React Native (shares component logic with web) or Flutter
- **FHIR server:** HAPI FHIR in Docker (local dev) + deployed instance for demo
- **Real-time:** FHIR Subscriptions via WebSocket or Server-Sent Events

---

## 8. Next Screens to Build

Priority order for remaining dev capacity:

### Priority 1: AI Governance Panel (add to web dashboard)
A slide-out right panel or second tab showing:
- Every recommendation with its evidence chain (which FHIR resources, which agent, confidence score)
- Model version + timestamp for each analysis
- Demographic parity check: risk scores broken down by age, sex, race/ethnicity (using Synthea demographic data)
- Audit log feed: every FHIR read/write with timestamp and user
- "Regulatory readiness" indicator

**Why first:** Highest rubric impact (P4: 4→5), lowest build complexity, no other team will have it. Speaks directly to CDO's board-level AI governance concern.

### Priority 2: Population Command Center (new landing screen)
Before the patient detail view, add a home screen showing:
- Scatter plot of 500+ patients (risk score Y axis, days since last contact X axis)
- Quadrant overlay: Critical / High / Moderate / Stable
- "23 patients in critical zone" badge with "Deploy Agents" button
- Real-time counters: tasks completed today, readmissions prevented this month, estimated cost avoidance
- Drill-down: click any cluster → filtered patient list → patient detail

**Why second:** Changes the narrative from "task app for one patient" to "population intelligence platform." Judges see scale.

### Priority 3: Value-Based Care Tab (add to web dashboard)
A second tab alongside the patient view:
- HEDIS measure completion rates as progress bars (real-time from FHIR)
- Quality incentive dollars at stake (configurable per contract)
- AI-identified "most reachable" patients per measure
- Measure-specific task generation

---

## 9. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| "Is this calling real FHIR?" | Run HAPI FHIR locally in Docker; show network tab in demo; make actual API calls |
| Hallucination concern from judges | Citation enforcement — every agent output references FHIR resource ID; show this explicitly |
| "This is just a task app" | Lead with Population Command Center screen; show 500 patients before showing Maria |
| Demo fails live | Pre-record the 90-second demo as a backup video; run live if connection holds |
| P6 score (evaluation) | Build the 50-patient eval harness; report sensitivity/specificity in submission |
| Multi-agent latency | Show streaming UI that reveals agents working in parallel; latency becomes a feature, not a bug |

---

## 10. Files in This Repository

| File | Description |
|---|---|
| `HANDOFF.md` | This document — full dev team handoff |
| `HL7-Challenge-Brief.md` | Rubric, evaluation prompt, and full scoring of both candidate ideas |
| `caresync-ai.html` | Web dashboard mockup (self-contained, no dependencies) |
| `caresync-mobile.html` | Mobile coordinator app mockup (self-contained, no dependencies) |

---

*Last updated: Grilling session with Claude, session start ~2026-07-02*  
*Contact: raj@bitcot.com*
