# CareSync AI — Implementation Plan

> **Status:** Locked via grilling session — 2026-07-04
> **Author:** Manjula / Bitcot
> **Inputs:** `HANDOFF.md`, `reference-materials/` (6 HTML mockups + HL7 Challenge Brief), grilling session 2026-07-04
> **Competition:** HL7 AI Challenge 2026 · Deadline ~19 days
> **This document is the source of truth for build decisions; the paired PRD is `docs/plans/caresync-ai/prd.md`.**

---

## 0. How to read this

This plan is the consolidated output of a grilling session that resolved the
open forks in the build. It has three layers:

1. **Decisions Log (GD1–GD13)** — what we're building and *why*, with the
   rejected alternatives recorded so we don't relitigate them.
2. **Architecture & scope** — the system these decisions imply.
3. **Execution plan** — phased order, standards-conformance matrix (honest
   staging), evaluation harness, risks, and the one open decision.

ADLC position: this sits between `docs/plans/caresync-ai/prd.md` (specify) and a
per-feature `implementation-plan.md` (plan). Feed it into `writing-plans` →
`ponytail` to produce the task-level plan for each work stream.

---

## 1. Decisions Log

### GD1 — Build scope: full monorepo (locked)
Build the full stack, for real:
- **HAPI FHIR R4** self-hosted in Docker
- **Synthea** for the population
- **Live Claude agents** (not scripted)
- **SMART on FHIR** for FHIR access

*Rejected:* UI-only or thin-mock-backend. Chosen because the rubric rewards
HL7 standards as *load-bearing* (G1) and AI as the *engine* (G2) — a mock
backend forfeits both gates.

### GD2 — Live agents + cache + recorded fallback (locked)
Agents make real Claude calls. To make the demo stage-safe without faking AI:
- On demo patients, a prior **successful analysis is cached** and replayed
  instantly and deterministically.
- **Judges can trigger a fresh live run on demand** (proves it's real).
- A **pre-recorded 90-second video** is the ultimate fallback if the network
  dies on stage.
- **Honest-staging framing:** "cached from a real prior run, re-runnable live."

*Rejected:* always-live-no-cache (too risky on stage); scripted-in-demo (risks
the GenAI-washing anti-gaming flag if judges probe).

### GD3 — FHIR data: curated hero + Synthea population (locked)
- **Maria Chen** (and 1–2 backup hero patients) hand-authored as controlled
  FHIR R4 bundles with exact labs/conditions/SDOH (HbA1c 8.9%, BNP 340,
  eGFR 52, K+ 3.4, AHC-HRSN positive, 48h post-CHF discharge, risk 87).
- **~500 Synthea patients** (diabetes + CHF + depression modules) for the
  population scatter and risk distribution.
- **Both loaded into the same HAPI server** — every read is real FHIR.

*Rejected:* pure-Synthea cherry-pick (hero data not controllable);
curated-only (population narrative too thin for the CDO scale story).

### GD4 — Mobile stack: PWA / responsive web (locked 2026-07-05)
Resolved at the S7 pre-work gate, ahead of Iteration 7. **PWA / responsive
web, one codebase**, demoed in a phone frame — the plan's own recommendation,
accepted as-is:
- Zero second toolchain (no React Native/Expo build pipeline).
- Real FHIR Subscription push (via the S6 relay) works in-browser, no native
  push infra needed.
- M02/M03 build against `reference-materials/caresync-mobile.html` as one
  responsive codebase alongside web.

*Rejected:* React Native (Expo) — would add a second toolchain and rework
Iteration 7's architecture for no demo-critical benefit; Flow 3 is
mobile-only but not native-only.

### GD5 — Auth: app JWT + SMART Backend Services (locked)
- Users log in with email/password → **app JWT** carrying role.
- The API holds a **SMART on FHIR Backend Services** client (client-credentials,
  signed JWT assertion) to read/write HAPI with system scopes.
- **Role determines which FHIR scopes/queries the API issues** — Social Worker
  is scoped to SDOH-domain resources, Coordinator broader, Director aggregate.
- **Honest framing:** standalone care-coordination app using SMART app-to-server
  auth. No EHR launch claimed.

*Rejected:* full per-user SMART EHR/standalone launch (heaviest wiring, HAPI
OAuth is fiddly — deferred to "envisioned"); JWT-only-no-OAuth (risks the
"FHIR-shaped-not-FHIR-native" flag).

### GD6 — CDS Hooks: minimal real service (locked)
Ship a real **patient-view CDS Hooks service** that returns agent findings as
cards, demoable via the **public CDS Hooks sandbox** pointed at our service +
HAPI. Hardens G1/P1. ~1–1.5 days on top of the agent engine.

*Rejected:* CDS-Hooks-as-envisioned (loses a standard from the P1 story);
full-EHR-launch demo (heaviest item on the board, competes with core screens).

### GD7 — FHIR Subscription: real HAPI rest-hook → relay (locked)
- Create a real **FHIR Subscription** on HAPI (rest-hook on Task create/update).
- HAPI calls our **backend webhook**; backend **relays to the client over
  SSE/websocket**.
- Genuinely a FHIR Subscription (visible in the network tab), not app-level SSE
  relabeled.
- Web client wired first; mobile subscribes once GD4 resolves.

*Rejected:* app-level-SSE-only (loses the Subscription standard).

### GD8 — Evaluation harness (locked; targets P6 3→4, slot to 5)
P6 is the weakest pillar (3/5) and the one Judge Ahmadi is named to probe.
- **Harness code is clinician-agnostic**; labeling determines the claim earned.
- **Team is devs-only** → baseline is **dev-labeled**, targeting an honest
  **P6 ~4**. Legitimate because hero-patient ground truth is *definitional*
  (we authored Maria's gaps; the agent either finds them or doesn't).
- **Clinician-validation slot:** the label file is structured so a clinician
  can review/override the ~10 Synthea rows later. If any clinician is found for
  ~90 min pre-submission → upgrade the claim to "clinician-validated" → **P6 5**.
- **Scope:** ~5 curated hero + ~10 Synthea patients.
  - **Care Gap + Risk agents:** sensitivity / specificity / PPV.
  - **SDOH agent:** agreement rate.
  - **Action Planner:** qualitative (it's synthesis, not classification).
- **Report the error analysis** (misses + false positives) — this is what
  pushes 4→5 and defuses the hallucination-hand-waving flag.
- Committed `npm run eval` regenerates the report; headline numbers surfaced on
  **W06 Governance**.

### GD9 — Screen scope: three tiers (locked)
| Tier | Screens | Commitment |
|---|---|---|
| **Demo-critical (fully functional)** | W02, W03, W06, W12, M02, M03 | **Firm** |
| **Demo-supporting (designed + partial)** | W04, W05, W07, W14, M04, M05, M08 | Stretch |
| **Shell (nav only, placeholder content)** | W08, W09, W10, W11, W13, W15, W16, M06, M07, M09, M10 | Nav only |

The 6 demo-critical screens are the non-negotiable core; everything else flexes.

### GD10 — Mockup porting: faithful React port (locked)
- Port the **6 existing HTML mockups** faithfully to React, preserving the
  exact design tokens (§ HANDOFF color/type) and the **canvas agent graph**
  animation (`requestAnimationFrame`, bezier edges, particle flow, per-agent
  color identity, state machine IDLE→…→COMPLETE).
- The **15 screens without mockups** are built to the same design system but
  simpler (data-dense, no bespoke animation).
- **No chart library** for the signature visuals — native Canvas API, to
  preserve visual identity.

### GD11 — Citation enforcement is real (locked; core P3/P4)
- Every agent uses **structured output** and must cite **FHIR resource IDs that
  exist in the retrieved bundle**.
- The backend **validates every citation against the bundle** and drops/flags
  any hallucinated ID before it reaches the UI.
- This is the architectural innovation the submission leans on — it is
  **non-negotiably real**, not asserted.

### GD12 — Demographic parity computed from real data (locked; G3/P4)
Demographic parity metrics on W06 (risk scores by age/sex/race/ethnicity) are
**computed from real Synthea demographics**, not static display numbers.

### GD13 — Agents on Claude Sonnet 5; testing stack (locked; **provider revised 2026-07-04**)
- **Agent model (original):** **Claude Sonnet 5 (`claude-sonnet-5`)** — the
  current Sonnet tier fits parallel multi-agent calls and the P7 cost story.
  (Consider Haiku 4.5 for the cheapest agents if latency/cost pressure appears.)
- **Agent model (revised, S2):** No Anthropic API key was available to prove
  the live-call verification step (D3) for S2. Rather than block the slice,
  the agent provider was swapped to **OpenAI, `gpt-5.5`** (current flagship,
  Responses API, structured outputs via `text.format`/tool calling) — a
  straight substitution under the same `runRiskAgent`/`AgentEvent` contract,
  not a dual-provider toggle. **This is a real, user-approved revision of a
  previously "locked" decision, not a silent swap** — recorded here so later
  slices (S3's three additional agents) build against OpenAI, not Anthropic.
  Revisit if an Anthropic key becomes available and the team wants to switch
  back or run both.
- **Testing:** Vitest (web unit) · Jest + Supertest (API) · Playwright (E2E on
  the 3 demo flows). TDD per ADLC.

---

## 2. Architecture (implied by the decisions)

```
Browser (React + Vite + TS, Tailwind, Zustand, TanStack Query)
  │  app JWT (role)                          Canvas agent graph (native)
  │  SSE / ws  ◄──────────────── relay ◄── FHIR Subscription webhook
  ▼
Express API (TS)
  ├── auth/          JWT issue/verify, role → SMART scope map
  ├── fhir/          SMART Backend Services client → HAPI (client-credentials)
  ├── agents/        Risk · CareGap · SDOH · ActionPlanner (OpenAI gpt-5.5 — GD13 revised)
  │                    → structured output, citations validated vs bundle
  ├── orchestrator/  parallel dispatch + SSE stream of findings
  ├── cds-hooks/     patient-view service (public sandbox demoable)
  ├── subscriptions/ HAPI rest-hook receiver → relay
  ├── population/    aggregate stats over HAPI
  ├── quality/       HEDIS measure calc
  ├── audit/         recommendation audit log + parity computation
  └── eval/          npm run eval → sensitivity/specificity/PPV report
        │
        ▼
HAPI FHIR R4 (Docker)  ◄── curated hero bundles + ~500 Synthea patients
SQLite (better-sqlite3) ── users, sessions, audit log, analysis cache
```

**Cache (GD2):** last successful analysis per patient persisted (SQLite);
demo mode replays it; `?live=1` forces a fresh Claude run.

---

## 3. Standards conformance matrix (G4 honest staging)

| Standard | Status | Evidence in build |
|---|---|---|
| FHIR R4 | **Built** | HAPI reads/writes; every recommendation cites a resource ID |
| SMART on FHIR | **Partial (S1 honest-staging note, 2026-07-04)** | Client assertion (RS256, RFC 7523) minted, exchanged with a self-hosted token endpoint, cached to expiry, and attached as `Authorization: Bearer` on every HAPI call — all real, tested code (`apps/api/src/smart/`). Role→scope denial is real and enforced API-side (B4/B5). What is **not** yet true: HAPI itself does not require or validate that token — the stock `hapiproject/hapi` Docker image ships no shell/wget/curl, so no bearer-token authorization interceptor could be configured into it without a custom Java build, which is out of scope for S1. Verified empirically: `curl http://localhost:8080/fhir/Patient/maria-chen` with no Authorization header still returns 200. Per the S1 ponytail contingency: treat SMART as API-side token issuance only until a custom HAPI interceptor lands (G1) — do not claim SMART is enforced by HAPI. |
| CDS Hooks | **Built (minimal)** | patient-view service, public sandbox demo (GD6) |
| FHIR Task | **Built** | Action Planner creates Tasks; role-filtered queues |
| FHIR Subscription | **Built** | HAPI rest-hook → relay → client (GD7) |
| FHIR SDC / AHC-HRSN | **Built** | SDOH agent reads QuestionnaireResponse |
| LOINC / SNOMED / RxNorm / ICD-10 | **Built** | terminology bindings on curated + Synthea data |
| SMART EHR/standalone launch (per-user OAuth) | **Envisioned** | documented, not wired (GD5) |
| Ambient documentation (HANDOFF Option D) | **Envisioned** | out of scope this cycle |

---

## 4. Evaluation harness (P6 detail — GD8)

```
data/eval/labels.json      ← ground truth (dev-labeled; clinician-overridable rows)
scripts/eval.ts            ← npm run eval
  1. load labeled patients from HAPI
  2. run 4 agents over each (live or cached)
  3. compare findings vs labels
  4. compute per-agent metrics + error analysis
  5. write docs/eval-report.md + JSON for W06 tile
```
- **Metrics:** CareGap/Risk → sensitivity, specificity, PPV; SDOH → agreement;
  ActionPlanner → qualitative notes.
- **Error analysis section is mandatory** in the report.
- **Claim ships as dev-labeled (~4)**; clinician validation of the 10 Synthea
  rows upgrades to 5 with no code change.

---

## 5. Execution order

Sequenced for the locked decisions. Web-first (GD4). "Phase" = a shippable
checkpoint.

| # | Task | Depends on | Est. days |
|---|------|-----------|:---:|
| 1 | Monorepo scaffold + tooling (Vite/TS/Tailwind, Express/TS, ESLint, Vitest/Jest/Playwright) | — | 0.5 |
| 2 | Docker HAPI FHIR + Synthea gen (500) + **curated hero bundles** + bulk import | — | 1 |
| 3 | Auth: JWT login + role middleware + **SMART Backend Services** client to HAPI | 1 | 1 |
| 4 | FHIR client service (typed fetchers, role→scope enforcement) | 2,3 | 1 |
| 5 | **Agents + orchestrator + SSE + citation validation + cache** (GD2/GD11) | 3,4 | 2.5 |
| 6 | Population + Quality/HEDIS + Audit/**parity** APIs (GD12) | 4,5 | 1 |
| 7 | Frontend shell + routing + role guards + auth + **design tokens** (GD10) | 1,3 | 1 |
| 8 | W02 Population Dashboard (canvas scatter) + login | 6,7 | 1 |
| 9 | W03 Patient Detail + **canvas agent graph** + streaming feeds + Task cards | 5,7 | 1.5 |
| 10 | W06 AI Governance (parity, audit trail, **eval tile**) | 6,9 | 1 |
| 11 | W12 My Patient Panel + Task Management | 6,7 | 1 |
| 12 | **CDS Hooks** patient-view service + sandbox demo (GD6) | 5 | 1.5 |
| 13 | **FHIR Subscription** rest-hook + relay → web live update (GD7) | 5,9 | 1 |
| 14 | **Mobile decision (GD4)** + M02 Task Queue + M03 Task Detail | 7,13 | 2 |
| 15 | **Eval harness** + report + W06 wiring (GD8) | 5,10 | 1 |
| 16 | Demo-supporting screens (W04/W05/W07/W14/M04/M05/M08) as capacity allows | 6,7 | flex |
| 17 | Shell screens (nav only) | 7 | 0.5 |
| 18 | Playwright E2E on 3 demo flows + **record 90s fallback video** | all | 1 |
| 19 | Presentation / judge deck (reuse `caresync-pitch-deck.html`) | all | 1 |
| | **Core total (excl. flex #16)** | | **~19 days** |

**Critical path to a defensible submission:** 1→2→3→4→5→9→10→13→14→15→18.
Tasks 8, 11, 12, 16, 17 parallelize across developers once 5 and 7 land.

---

## 6. Rubric impact summary

| Pillar | Current | Plan target | Lever |
|---|:---:|:---:|---|
| P1 Standards | 5 | 5 | 5 load-bearing standards, all Built (GD6/GD7) |
| P4 Trust/Governance | 4 | **5** | real citation validation (GD11) + computed parity (GD12) + audit trail |
| P6 Proof/Eval | **3** | **4 (→5)** | eval harness + error analysis (GD8); clinician slot → 5 |
| G3 Safety-by-design | pass | strengthened | citations validated, scopes enforced, human-action-required Tasks |
| G4 Honest staging | pass | strengthened | §3 matrix + GD2 cache framing |

---

## 7. Risks & mitigations

| Risk | Mitigation | Decision |
|---|---|---|
| Live demo fails on stage | Cache + on-demand live re-run + recorded video | GD2 |
| "Is this real FHIR?" | HAPI in Docker, show network tab, real reads/writes | GD1/GD5 |
| Hallucinated citations | Backend validates every ID against the bundle | GD11 |
| Mobile slips (it's on the demo path) | Decision hard-deadlined to Phase 3; PWA is the cheap default | GD4 |
| P6 stays weak | Harness is ~1 day, highest ROI item; ships as honest 4 | GD8 |
| Multi-agent latency/cost | Parallel dispatch shown as streaming (latency = feature); Sonnet 5 tier; cache | GD2/GD13 |
| Synthea data too messy for hero | Hero patients hand-authored, deterministic | GD3 |

---

## 8. Open decision (must resolve by Phase 3)

**GD4 — Mobile stack: RESOLVED 2026-07-05 — PWA / responsive web.** See §1
GD4 for the recorded decision. No decisions currently open.

---

## Next step (ADLC)

Feed each work stream (agents, FHIR/auth, web screens, eval) into
`writing-plans` → `ponytail` to produce task-level `implementation-plan.md`
files under `docs/plans/{PLAN_ID}/`, then drive them with
`subagent-driven-development`. Resolve GD4 before the mobile stream starts.
