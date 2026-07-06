# Verification — CareSync AI, S8 (AI Governance & audit dashboard, W06)

> **PLAN_ID:** `caresync-ai` · **Slice:** S8 · **Date:** 2026-07-06
> **Stage:** Phase 5 (`verification-before-completion`), run on `feature/caresync-s8-governance-dashboard`
> (base `1701001` = `main`, tip `729331f`, 2 commits: `df46f4c` Phase A — governance aggregates,
> `729331f` Phase B — W06 governance view). Read `docs/plans/caresync-ai/implementation-plan.md`
> Iteration 8 and `docs/plans/caresync-ai/issues.md` S8 for the plan this verifies against — not
> re-derived here. Built via `subagent-driven-development`: one implementer subagent per phase, one
> independent reviewer subagent per phase (not the implementer grading its own work), both re-verified
> again in this consolidated pass.

## 1. Fresh command evidence (this session, 2026-07-06)

Every command below was re-run fresh in this final pass, on top of the per-phase reviewer's own
independent run (§4) — not trusted from either subagent's self-report. Local stack: Docker HAPI FHIR
already running and healthy, API + web dev servers via Playwright's `webServer` config.

| Command | Result |
|---|---|
| `cd apps/api && npx jest --runInBand` | **28 suites / 161 tests passed** |
| `cd apps/web && npx vitest run` | **19 files / 177 tests passed** |
| `cd apps/web && npx playwright test --workers=1` | **14/14 specs passed** (incl. new `director-governance.spec.ts`) |
| `cd apps/api && npx tsc --noEmit` | exit 0 |
| `cd apps/web && npx tsc --noEmit` | exit 0 |

No flakiness observed in this pass. (S3–S7's documented parallel-Jest-vs-shared-HAPI contention is an
existing environmental note, not re-triggered here — `--runInBand` was used throughout, same as S7.)

## 2. Definition-of-done check (S8 acceptance, `issues.md`)

All 6 acceptance bullets confirmed against the actual code and this session's live evidence:

1. **Audit trail lists real logged FHIR reads/writes with timestamp + user** —
   `GET /api/governance/audit` (`governance/service.ts` `getAuditTrail` → `db/audit.ts`
   `readAuditTrail`) pages the real S1 `audit_log` table, most-recent-first (`ORDER BY id DESC`),
   Director-only. Confirmed live in `director-governance.spec.ts`: real success/denied rows render
   with actor + timestamp.
2. **Each analysis shows its model version and timestamp** — `GET /api/governance/model`
   (`getModelPerformance`) reads every `analysis_cache` row via the new `readAllAnalysisCache` and
   returns `{patientId, modelVersion, createdTs}` per cached analysis. Rendered as a raw table in
   `Governance.tsx`'s Model Performance column.
3. **Confidence distribution is derived from actual agent outputs** — `getModelPerformance` buckets
   real per-finding `confidence` values (when present) into 4 documented ranges. **Known honest gap**:
   no agent (`riskAgent`/`careGapAgent`/`sdohAgent`) currently emits a `confidence` field on any
   finding (confirmed by grep across `apps/api/src/agents/`), so all buckets are 0 today. This was
   caught by the Phase A implementer, independently confirmed true by the Phase A reviewer, and
   re-confirmed here — it is documented in `governance/service.ts`'s deviation-note comment and
   surfaces honestly (all-zero bars) rather than fabricating a number. The endpoint is
   forward-compatible with no migration once an agent starts reporting confidence.
4. **Parity metrics are computed from Synthea demographics, not static numbers** — `GET
   /api/governance/parity` (`getParityMetrics`, GD12) joins every cached analysis's
   `result_json.risk.complete.riskScore` to that patient's live HAPI `Patient.birthDate`/`gender`/
   US-Core race+ethnicity extensions (`FhirReadService.getPatientDemographics`, a new scoped `_id=`
   batch fetch), then stratifies by age band/sex/race/ethnicity. Test seeds real, distinguishable HAPI
   patients and asserts both exact per-group averages and disparity direction, not a weak assertion.
5. **Eval tile renders a graceful empty/loading state until S9 provides data** — new
   `GET /api/governance/eval` reads `docs/eval-report.json` if present, else returns
   `{available:false}` (never throws, never fabricates). `docs/eval-report.json` does not exist yet
   (confirmed absent from the repo), so the tile is currently, correctly, always in its empty state —
   confirmed live in `director-governance.spec.ts` ("not yet available").
6. **API-boundary tests for the audit/parity endpoints** — `apps/api/src/routes/governance.test.ts`
   covers all four endpoints (audit/model/parity/eval), each with a happy path, a 403 (non-Director),
   and a 401 (unauthenticated) case — 14 tests total, all passing in §1.

No drift between what's claimed done and what the code does.

## 3. Spec-drift check (issues.md / implementation-plan.md vs. code)

One real plan-vs-reality mismatch, caught and resolved during implementation (not a silent deviation):

- **The plan's "confidence distribution derived from actual agent outputs" assumes a `confidence`
  field exists on agent findings — it doesn't (see §2.3).** Resolution: read `analysis_cache
  .result_json` as loosely-typed JSON (already not constrained to `AgentFlag`'s TS shape at the DB
  layer) and extract an *optional* per-finding `confidence: number` at runtime. This was treated as an
  engineering resolution of a type/runtime mismatch, not a guess at an undocumented domain rule, and
  is the honest choice under this slice's own "no fabrication" ponytail rule — the alternative
  (fabricating plausible-looking confidence numbers, as the mockup's hardcoded demo data does) would
  have violated it.

- **The plan's B2 line ("reads the S9 JSON summary if present") implies a JSON file S9 will produce,
  but doesn't name its path.** Resolution: a new minimal `GET /api/governance/eval` reads
  `docs/eval-report.json` at the repo root, documented inline as the path S9's harness should write
  to. This is additive, not a reinterpretation of committed plan text — S9 (not yet built) will need to
  target this exact path, and that expectation is now recorded in code rather than only in this
  document.

Other checks:
- **Mockup fidelity** — `reference-materials/caresync-governance.html`'s fabricated/unbacked sections
  (Model/Regulatory-Posture chips, Download Audit Report button, Agent Accuracy bars, Model Version
  History table, Areas for Review, Compliance Attestations, zone-4 framework footer, per-audit-entry
  patient name/recommendation-text/FHIR-citation/confidence%) were deliberately dropped rather than
  ported with invented numbers, each documented in `Governance.tsx`'s top-of-file comment — the same
  convention `Population.tsx` (S5) established. Structural fidelity (banner / 4-tile zone-2 / 3-column
  zone-3 with matching proportions, rounded-card/border-color visual language, native-canvas GD10
  charts) is preserved. Estimated ~80-85%, at the CLAUDE.md-required ≥80% bar, with the gap entirely
  accounted for by these documented, backend-data-driven omissions.
- **`implementation-plan.md` Iteration 8's checkboxes** — A1-A3, B1-B2, C1-C2, and the
  Definition-of-done bullets are all `[x]`, matching the actual committed state (verified by reading
  the file directly, not trusting the implementer's claim).
- **No new persisted state** — confirmed `apps/api/src/db/index.ts`'s `migrate()` is unchanged; the
  three tables (`users`, `audit_log`, `analysis_cache`) are the same ones since S1/S4. The new eval
  endpoint reads a file, not a table.
- **Director-only gating** — `governance/service.ts`'s `assertDirector` is a deliberate, minimal
  duplicate of `population/service.ts`'s (not imported — that one is module-private), same rule, same
  denial-audit call, same `DirectorOnlyError`. `/governance` is `RoleGuard role="director"`-gated in
  `App.tsx`; the nav link in `AppShell.tsx` only renders for `user.role === 'director'`.

## 4. Review notes

Both phases were built by an implementer subagent under an explicit TDD requirement (failing test
first, confirmed red for the right reason, then green), and **each phase's implementer report was
independently re-verified by a separate reviewer subagent** — not the same agent grading its own work,
and not trusted at face value: the reviewer re-read the diffs, re-ran every test suite itself, and
spot-checked specific claims (e.g., grepping for `confidence` across the agents directory to confirm
Phase A's "field doesn't exist" claim; checking `docs/eval-report.json`'s absence to confirm Phase B's
empty-state claim is currently guaranteed-true, not just handled). Both phases returned **APPROVE** —
see the phase-by-phase review transcripts in this session. This consolidated pass re-ran the full
suite + E2E one more time (§1) on top of both reviewers' independent runs, rather than relying solely
on either subagent round.

No `NEEDS_CONTEXT` escalations were needed in Phase A. Phase B had one ambiguity (which of the
mockup's 6 radar axes to drop, given only 4 real data sources) that the implementer resolved correctly
from the prompt's own next sentence rather than escalating — confirmed correct on review.

## 5. Domain-term documentation check

New domain concepts introduced by S8 — the `governance/` aggregate module (mirroring `population/`'s
shape), `PatientDemographics` (age/sex/race/ethnicity derived from live HAPI reads), the
confidence-bucket convention (`0-0.5/0.5-0.7/0.7-0.85/0.85-1.0`), the age-band convention
(`<18/18-34/35-49/50-64/65+`), the per-dimension parity-score formula
(`1 - (max avgRisk - min avgRisk) / max avgRisk`, clamped to `[0,1]`), and the `docs/eval-report.json`
path convention for the future S9 handoff — are all documented inline via doc comments at their
introduction point (`governance/service.ts`, `parityScore.ts`), consistent with the
"Domain rule:"/deviation-note convention established since S2. `docs/agents/domain.md` and
`docs/agents/issue-tracker.md` still don't exist — the same pre-existing, deferred gap noted in every
prior slice's verification (S5, S7), unchanged by S8.

## 6. Evidence-boundary labeling (CLAUDE.md)

Per CLAUDE.md's evidence-boundaries rule: all evidence in this document is **local mock / packaged UI
strength** — Jest/Vitest suites and headless Playwright runs against a local dev stack and the
existing local Docker HAPI container. This proves the actual rendered UI, the actual FHIR/audit-log
reads, and the actual demographic join work together — but it is **not** target-environment,
client-accepted, or production-hardware evidence. No such claim is made here. The confidence
distribution's all-zero state (§2.3) is an honest reflection of the current agent pipeline, not a
verification gap — re-confirmed by grep, not assumed.

## 7. Gate outcome

**PASS.** All fresh command evidence is green (§1). Definition-of-done (§2) and spec-drift (§3) checks
found one real plan-vs-reality mismatch (no `confidence` field exists on agent outputs) and one
under-specified plan detail (eval-summary file path) — both resolved honestly during implementation
(documented gap + a sensible, documented path convention) rather than papered over. No product-behavior
defects remain open, and no fabricated/hardcoded demo numbers were found anywhere in the shipped
`Governance.tsx` (confirmed independently by the Phase B reviewer and spot-checked again in this pass).

## Next step

`code-review`, covering the full branch diff since `main` along the Standards and Spec axes.
