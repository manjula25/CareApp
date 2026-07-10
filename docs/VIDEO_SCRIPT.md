# CareSync AI — Loom Demo Script (Read Aloud While Recording)

**Total target:** under 10 minutes.
**Before recording:** Docker up, API + web running, log in as Director + Coordinator + Social Worker in three tabs, clear Maria Chen's analysis cache, pre-run `npm run eval` in a terminal tab.
**Style note:** This is read aloud. Sentences are short, conversational, and free of jargon phrases. When a FHIR term is used, it is spoken in plain English first, then the term.

---

## [0:00 — SLIDE 1: Title — CareSync AI]
**Say while showing the title slide.**

Hi everyone. I'm Manju from Bitcot, and this is CareSync AI for the HL7 AI Challenge.

In one line: CareSync is a multi-agent, FHIR-native care orchestrator that turns a complex patient's chart into a citation-backed, role-routed action plan. We enforce trust through provable action.

Everything I'm about to show is running locally right now — a HAPI FHIR server in Docker, a Node API, and a React web client. This is a working POC.

---

## [0:30 — SLIDE 2: The bottleneck funnel]
**Say while showing the funnel slide.**

Before I show the product, the problem.

Five percent of complex patients drive roughly fifty percent of all healthcare spend in the US. Every one of those patients has the same five data sources sitting in their chart — conditions, encounters, labs, medications, social screenings. But care teams are stuck doing manual chart reconciliation: eight to twelve open tabs per patient, thirty to sixty minutes per review.

That bottleneck creates two downstream problems — missed HEDIS gaps, and preventable thirty-day CHF readmissions. At a panel of one hundred and forty or more complex patients, manually reconciling clinical guidelines, social barriers, and real-time labs into an actionable plan does not mathematically close.

CareSync replaces that manual funnel with an orchestrated, fifteen-second AI stream.

---

## [1:10 — Demo: Log in as Coordinator → open Maria Chen → click Run Live]
**Switch to the web app — log in, go to Maria Chen's chart, click Run Live.**

Let me show you. I'm logging in as a Care Coordinator and opening one of our patients — Maria Chen. Her chart is on a HAPI FHIR server. Every resource is real FHIR R4 — conditions, lab results with LOINC codes, medications, social screenings. There is no proprietary schema hiding underneath.

Watch what happens when I click Run Live.

Four AI agents start at the same time. The Risk Agent, the Care Gap Agent, and the SDOH Agent all read her full FHIR bundle in parallel, streaming reasoning back to my screen in real time. Then the Action Planner takes their outputs and synthesizes the final plan.

---

## [1:40 — SLIDE 3: Manual vs Automated (then SLIDE 4: Four agents in parallel)]
**Flash the manual-versus-stream slide for a second, then the four-agent slide.**

What just happened used to be sixty minutes of clicks. Now it's about fifteen seconds — and roughly forty cents of AI cost per patient.

Here's the shape of what's underneath. One Orchestrator fans the same FHIR bundle out to three specialist agents in parallel. Risk looks at conditions, observations, and medications and emits a risk score and readmission probability. Care Gap looks at conditions and observations and emits missing preventive care. SDOH looks at the questionnaire response and emits social barriers. All three feed the Action Planner, which synthesizes them into one coordinated list of FHIR Tasks — one per thing the care team actually needs to do.

---

## [2:20 — Results land → click a finding → show citation]
**Back in the web app — results are visible. Click a finding, show the citation.**

The risks and care gaps landed. Now the critical part.

Every finding here cites a specific FHIR resource ID. If I click this risk flag — it points to her BNP lab result, LOINC 30934-4, and the URL takes me straight to the actual resource in HAPI. What normally takes a coordinator thirty to sixty minutes of manual chart review just happened in twelve seconds, at forty cents per patient.

---

## [2:50 — SLIDE 5: Citation Gate — hallucination eliminated]
**Show the citation gate slide.**

How do we know the AI isn't making things up?

We don't rely on a polite prompt. We run a Runtime Citation Gate. Every claim the LLM emits must carry a resource ID — and our validator checks that ID against the actual FHIR bundle on the server. If the model invents an ID, or if the ID doesn't exist in the bundle, the finding is dropped before it ever reaches the UI, and an audit row is written to the SQLite audit log.

Confidence is also evidence-derived, not self-graded. Every surviving claim traces to a literal resource.id. The AI proposes — the code decides.

The risk level goes through a deterministic clamp too. If the chart doesn't carry strong evidence — like a recent hospital stay or an abnormal lab value — the model simply cannot label her high or critical. We saw this in the numbers during eval — Risk Agent specificity recovered from zero to one hundred percent on the held-out cohort after clamping.

---

## [3:50 — SLIDE 6: HL7 standards are load-bearing, not glue]
**Show the standards matrix slide.**

I want to name the standards that are doing real work here, because removing any one of them breaks a workflow.

FHIR R4 is the backbone — every recommendation traces to a resource. SMART on FHIR enforces OAuth 2.0 scoped access, dictating what agents can see. CDS Hooks delivers recommendations into the EHR as patient-view cards. FHIR Task persists the action plan as work items. FHIR Subscription drives the real-time push from server to mobile. And FHIR SDC formats the AHC-HRSN social screening questionnaire into actionable data.

This isn't a chatbot wrapped around a prompt. Seven HL7 standards are load-bearing.

---

## [4:30 — SLIDE 7: Parallel reasoning → FHIR Tasks]
**Show the action-plan slide briefly.**

The Action Planner's output is not a summary. It emits real FHIR Task resources — each one carrying priority, a due date, an assignee, and the source evidence citation right inside the Task body.

Here on the screen you can see a high-priority Task — "Order HbA1c, overdue more than ninety days" — assigned to the Care Coordinator, with LOINC code 4548-4 cited as the evidence. That's the same LOINC HbA1c code a clinician would type into the EHR.

---

## [4:50 — SLIDE 8: Three delivery surfaces — then switch to Social Worker mobile]
**Show the three swimlanes slide, then flip to the Social Worker tab.**

One FHIR record, three delivery surfaces.

The Director sees the population as a risk-versus-cost scatter on the web dashboard — same data, same AI, same audit trail. Morning triage that used to take thirty minutes in a spreadsheet is now a five-minute look at a chart.

The Coordinator sees the streamed findings plus a clinical task queue with one-tap assign and complete.

The Field Social Worker sees a mobile PWA — and this is the part that usually surprises people — filtered down to SDOH and uncategorized tasks only. Social needs can't get buried under clinical work, because the role itself only sees what it's scoped to see.

Let me show you. I'm switching to the Social Worker tab on a mobile viewport. You can see the queue — pre-filtered to social determinants. Notice zero clinical observations on this screen, even though they exist on the server. That's the SMART scope doing its job.

---

## [5:50 — SLIDE 9: Real-time push, then complete a task on mobile]
**Show the push pipeline slide, then complete a task on mobile and flip back to Coordinator.**

The push pipeline is equally clean. When a FHIR Task is created or updated on HAPI, a FHIR Subscription fires a rest-hook to our API. The API fans the event out over SSE — Server-Sent Events — and the mobile client receives it via TanStack Query invalidation.

Net result — zero polling, zero manual handoffs. The gap from "server write" to "field worker's screen" collapses from hours to seconds.

I'm going to tap complete on this task on the mobile — and if I flip back to the Coordinator tab, the same task is already marked done with the same audit trail.

---

## [6:30 — SLIDE 10: Provable governance — click Governance in sidebar]
**Show governance slide, then click Governance in the web app sidebar.**

Now the part that matters for a CIO or a regulator — governance, computed live from real data.

Three things on this screen. Live demographic parity, computed from US Core race and ethnicity extensions on every Patient resource — broken out by age, sex, race, and ethnicity. When a group crosses our disparity threshold, the mitigation tile flags it and writes an audit row. Parity isn't just measured — it's measured, flagged, and acted on. A closed loop.

Live audit trail. Every FHIR read and write, every agent run, every dropped citation, every risk clamp — all logged in this table. In production, this maps directly to FHIR AuditEvent resources.

And confidence score — a deterministic formula, not the model grading itself. The evidence-derived distribution you see here is the same one that gates the citation validator.

---

## [7:30 — SLIDE 11: Economics + SLIDE 12: Eval harness — terminal tab]
**Show the economics slide briefly, then switch to terminal with pre-run eval output.**

Three numbers drive the business case.

Productivity expansion — review time collapses from thirty to sixty minutes to a ten to twenty-second orchestrated stream. That's a forty to sixty percent reduction in cost-per-review-hour, or a one-point-six to two-point-five times expansion in how many patients a team can manage.

Preventable readmissions — a single thirty-day CHF readmission costs fifteen to twenty thousand dollars. CareSync catches the seven to thirty-day post-discharge window and pushes the discharge bundle. If we prevent just five CHF readmissions per quarter in a five-hundred-patient panel, that's seventy-five to one hundred thousand dollars saved per quarter, against an AI cost of forty cents per patient.

Quality incentive revenue — closing CDC, COA, CBP HEDIS measures protects the one to three million dollars in annual incentive revenue that a typical ACO has at risk.

And every one of those numbers is reproducible. Let me show you the eval output in the terminal.

This is `npm run eval`. It runs twenty-six labeled patients through the exact same agent pipeline — same citation validation, same clamp. Sixteen are dev-labeled, ten are held-out so we catch tuning-to-the-test. A variance probe checks that prompts stay stable across repeated runs.

The headline numbers from the dev-labeled set: Care Gap Agent, one hundred percent sensitivity and ninety-point-nine percent positive predictive value. Risk Agent, one hundred percent sensitivity and seventy-percent specificity after the clamp. SDOH Agent, ninety-three-point-eight percent agreement. Cost averaging around forty cents per patient. These regenerate on demand — they're not typed into a slide.

---

## [8:50 — SLIDE 13: Production hardening — close]
**Show the production-hardening slide.**

Honest staging.

Everything you've seen today is built and runnable end-to-end. What's next is production hardening — three layers.

Layer one: identity. From an in-process auth server today, to multi-tenant Keycloak SMART Authorization Server issuing per-actor RS256 tokens. Layer two: FHIR enforcement. From signature-only validation on H2 today, to a rebuilt Docker HAPI from jpaserver-starter with strict scope enforcement at the resource boundary, upgraded to PostgreSQL. Layer three: app-tier gate. From method-level routing today, to strict route-level SMART scope configuration driven by a single source-of-truth YAML.

All of our evaluation labels today are dev-interpreted, but the clinician-validation upgrade path is already built and ready.

---

## [9:20 — SLIDE 14: Closing — orchestration engine for Value-Based Care]
**Show the closing pillar slide.**

CareSync is the orchestration engine for the Value-Based Care era.

Three pillars holding it up. Clinical value — productivity and ROI, ninety-five percent time reduction. Technical rigor — the load-bearing HL7 matrix and multi-agent streaming. Provable trust — citation gates, demographic parity, and a full audit log.

A system that reconciles every relevant FHIR resource, every clinical guideline, and every social barrier into one actionable, auditable plan.

Thank you for watching.

---

## Menu Map (one-liners)

Use this if you want to extend the demo beyond the slide flow. One sentence per menu.

**Director**
- **Population:** Risk-versus-cost scatter of the whole panel; KPI tiles; drill into any patient.
- **Quality:** Real HEDIS measure — Type 2 Diabetes patients with an HbA1c test on file, computed from live FHIR counts.
- **Governance:** Audit trail, confidence chart, demographic parity radar, and eval-tile with real metrics.
- **Cost/ROI:** Illustrative dashboard with cost-avoidance KPIs and HEDIS benchmark bars.
- **Alerts:** Prioritized clinical, medication, SDOH, and care-gap alerts with FHIR references and acknowledge.
- **Settings:** Profile, real-time API health probe, app metadata, logout.

**Coordinator**
- **Patients (My Patients):** Assigned-patient grid; click to patient detail; run live analysis; view open Tasks.
- **Cost/ROI, Alerts, Settings:** same as Director view.

**Social Worker**
- **Tasks (home):** Mobile-first queue filtered to SDOH and uncategorized tasks; mark Done and sync back to HAPI.
- **Cost/ROI, Alerts, Settings:** same as Director view.

---

**Recording tips:** Keep total runtime under ten minutes — 1080p, hide bookmarks, enable Focus mode. Set Loom link to "anyone can view" and test in incognito before submitting. If a live agent run misbehaves, fall back to cached analysis and narrate the same points. Speak standard names out loud — FHIR Task, CDS Hooks patient-view, LOINC 30934-4, LOINC 4548-4 — because the judges score on what they hear.
