import { Router, Response } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, PatientBundle, ScopeDeniedError, FhirNotFoundError } from '../fhir/client';
import { orchestrate } from '../agents/orchestrator';
import { AgentEvent, AgentId } from '../agents/agent';
import { validateCitations, validateCitationList, applyConfidence, createNarrationBuffer, NarrationBuffer, AgentFlag } from '../agents/citationValidator';
import { scoreRiskFlag, scoreCareGap, scoreSdohBarrier, deriveActionPlannerTaskConfidence, clampRiskLevel, FindingWithConfidence } from '../agents/confidenceScorer';
import { readAnalysisCache, writeAnalysisCache, AnalysisCacheEntry, AnalysisCacheRow } from '../db/analysisCache';
import { getMockAnalysis } from './mockAnalysis';
import { writeAudit } from '../db/audit';
// All four agent modules currently export the same MODEL constant
// ('gpt-5.5') — riskAgent's is used here as the single source of truth for
// what gets recorded as `modelVersion` on the cache row.
import { MODEL } from '../agents/riskAgent';

type RunAnalysis = (bundle: PatientBundle) => AsyncIterable<AgentEvent>;
type ReadCache = (db: Database.Database, patientId: string) => AnalysisCacheRow | null;
type WriteCache = (db: Database.Database, entry: AnalysisCacheEntry) => void;

// Exported (S6 A3) so the event relay hub (routes/eventHub.ts) can reuse the
// exact same SSE framing for `/api/events` instead of re-authoring it.
export function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * A2 (S4) — everything needed to replay the exact same `token`/`finding`/
 * `task`/`complete` SSE sequence a live run produced, without re-touching
 * HAPI or the LLM. Per bundle-driven agent (risk/careGap/sdoh): the accumulated
 * SAFE (GD11-redacted, as-emitted) narration text, the citation-gate-SURVIVING
 * findings (in emission order), plus that agent's `complete` payload. For
 * actionPlanner: its narration, the full created-Task payloads (id/reference/
 * title/description/priority/assignTo/dueInDays/fhirResources) — not just
 * ids — because S3's replacePatientTasks deletes+recreates Tasks with new
 * ids on every live run, so an id-only cache would dangle; plus its
 * `complete` payload.
 *
 * `narration` holds only the SAFE text the live run actually emitted (the
 * `safeText`/`remainder` values that already passed through
 * `createNarrationBuffer`'s GD11 gate) — never the raw model `event.text` —
 * so a replay can't leak an unvalidated citation the live path would have
 * redacted. `agentId` is intentionally omitted from each entry here (it's
 * implied by the key) and re-added at emit time on both the live and replay
 * paths, so the two paths share one event shape by construction.
 */
export interface AnalysisResultJson {
  risk: {
    narration: string;
    // Findings carry agent-specific extras (severity, confidence, finding
    // text) that are forwarded verbatim to the SSE event payload. The wire
    // shape is permissive — extras show up in the web's `AnalysisFinding`
    // via its `[key: string]: unknown` index signature.
    findings: (AgentFlag & { finding?: string; severity?: string; confidence?: number })[];
    complete: { riskScore: number; riskLevel: string; readmissionProbability: number; findingCount: number; droppedCount: number };
  };
  careGap: {
    narration: string;
    findings: { gapType: string; description: string; lastDone?: string; dueDate?: string; urgency: string; fhirResourceId: string; severity?: string; confidence?: number }[];
    complete: { findingCount: number; droppedCount: number };
  };
  sdoh: {
    narration: string;
    findings: { domain: string; finding: string; severity: string; fhirResourceId: string; confidence?: number }[];
    complete: { findingCount: number; droppedCount: number; referralsNeeded: string[] };
  };
  actionPlanner: {
    narration: string;
    tasks: {
      id: string;
      reference: string;
      title: string;
      description: string;
      priority: string;
      domain?: 'clinical' | 'sdoh';
      assignTo?: string;
      dueInDays?: number;
      fhirResources: string[];
      confidence: number;
    }[];
    complete: { findingCount: number; droppedCount: number };
  };
}

/**
 * Replays a cached `AnalysisResultJson` as the identical `token`/`finding`/
 * `task`/`complete` SSE sequence a live run would have produced — same phased
 * order (each agent narrates, then its findings, then its complete;
 * actionPlanner last), same `agentId` tagging, same `{ agentId, text }`
 * token payload shape — so the canvas AND the per-agent reasoning feed
 * (`PatientDetail.tsx`, which renders accumulated `token` text) can't tell a
 * replay from a live run. No HAPI or LLM call on this path.
 *
 * A live run streams an agent's narration in many small `token` chunks as it
 * reasons; a replay emits the whole accumulated narration as one `token`
 * event — the plan states pacing is cosmetic, only ordering is load-bearing,
 * and the client accumulates `token` text either way. An empty (or absent,
 * for a legacy row) narration emits no token event, matching a live run that
 * produced no safe narration for that agent.
 */
function replayCachedAnalysis(res: Response, result: AnalysisResultJson): void {
  if (result.risk.narration) {
    writeSseEvent(res, 'token', { agentId: 'risk', text: result.risk.narration });
  }
  for (const finding of result.risk.findings) {
    writeSseEvent(res, 'finding', { agentId: 'risk', ...finding });
  }
  writeSseEvent(res, 'complete', { agentId: 'risk', ...result.risk.complete });

  if (result.careGap.narration) {
    writeSseEvent(res, 'token', { agentId: 'careGap', text: result.careGap.narration });
  }
  for (const finding of result.careGap.findings) {
    writeSseEvent(res, 'finding', { agentId: 'careGap', ...finding });
  }
  writeSseEvent(res, 'complete', { agentId: 'careGap', ...result.careGap.complete });

  if (result.sdoh.narration) {
    writeSseEvent(res, 'token', { agentId: 'sdoh', text: result.sdoh.narration });
  }
  for (const finding of result.sdoh.findings) {
    writeSseEvent(res, 'finding', { agentId: 'sdoh', ...finding });
  }
  writeSseEvent(res, 'complete', { agentId: 'sdoh', ...result.sdoh.complete });

  if (result.actionPlanner.narration) {
    writeSseEvent(res, 'token', { agentId: 'actionPlanner', text: result.actionPlanner.narration });
  }
  for (const task of result.actionPlanner.tasks) {
    writeSseEvent(res, 'task', { agentId: 'actionPlanner', ...task });
  }
  writeSseEvent(res, 'complete', { agentId: 'actionPlanner', ...result.actionPlanner.complete });

  writeSseEvent(res, 'done', {});
}

/**
 * S3/S4 analysis route (B3, then A2). Audits + scope-guards one `$everything`
 * read of the patient's bundle (via `FhirReadService`), then streams the full
 * four-agent orchestration (risk/careGap/sdoh in parallel, then the action
 * planner) over SSE. Every citation — a flag/gap/barrier's `fhirResourceId`,
 * or a task's `fhirResources` list — is validated against the bundle's
 * `validIds` (GD11 — Seam 2) before it is emitted as a `finding`/`task`, or,
 * for tasks, before it is persisted to HAPI via `replacePatientTasks`.
 * Dropped citations never reach the client or HAPI.
 *
 * S4 A2 — cache-aware modes:
 *  - `?live=1`: always runs the orchestrator, streams live, then persists the
 *    run to `analysis_cache` (overwriting any prior row) before `done`.
 *  - no `?live=1`, cache row exists: replays that row's `resultJson` as the
 *    identical `finding`/`task`/`complete` sequence a live run produced —
 *    zero orchestrator calls, zero HAPI reads/writes.
 *  - no `?live=1`, no cache row (cold cache): falls back to a live run
 *    exactly like `?live=1`, so the first view of any patient is always live
 *    and gets cached for the next one.
 *
 * `runAnalysis`/`readCache`/`writeCache` default to the real implementations
 * so production wiring needs no extra step, while tests inject stubs to
 * avoid a live OpenAI call and to assert on cache reads/writes.
 */
export function createAnalysisRouter(
  fhirService: FhirReadService,
  runAnalysis: RunAnalysis = orchestrate,
  db: Database.Database,
  readCache: ReadCache = readAnalysisCache,
  writeCache: WriteCache = writeAnalysisCache
): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/:id/analysis', async (req, res) => {
    const patientId = req.params.id;
    const isLive = req.query.live === '1';

    if (!isLive) {
      const cached = readCache(db, patientId);
      if (cached) {
        // Replay skips `getPatientBundle` entirely (no HAPI call), but that
        // method is also the ONLY place role→scope enforcement + audit
        // logging happens for this data. `assertScope` is the same guard
        // `getPatientBundle` runs internally, called directly so the
        // invariant can't drift between the live and replay code paths —
        // it's a local role comparison, no HAPI request, so calling it here
        // doesn't cost the HAPI round-trip replay exists to avoid. On
        // success we write our own audit row (mirroring `getPatientBundle`'s
        // guard-then-audit pattern) since `assertScope` only audits denials.
        try {
          fhirService.assertScope(req.auth!, 'clinical', `Patient/${patientId}/$everything`);
        } catch (err) {
          if (err instanceof ScopeDeniedError) {
            res.status(403).json({ error: err.message });
            return;
          }
          throw err;
        }
        writeAudit(db, {
          actor: req.auth!.id,
          action: 'read',
          fhirResource: `Patient/${patientId}/$everything`,
          outcome: 'success',
        });

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        try {
          replayCachedAnalysis(res, cached.resultJson as AnalysisResultJson);
        } catch {
          // Same error-boundary convention the live path uses below: headers
          // are already sent by this point, so an SSE `error` event is the
          // only way left to signal failure (e.g. a malformed/legacy cached
          // shape) — no `done` fires on this path either.
          writeSseEvent(res, 'error', { message: 'Analysis failed' });
        }
        res.end();
        return;
      }
      // Cold cache: no row yet for this patient — fall through to the same
      // live path `?live=1` takes, below.
    }

    let bundle: PatientBundle;
    try {
      bundle = await fhirService.getPatientBundle(req.auth!, patientId);
    } catch (err) {
      if (err instanceof ScopeDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      // HAPI 404 — patient id isn't in the FHIR store. Two demo-friendly paths:
      //   (a) a MOCK-fixture patient id (e.g. `maria-chen-4829`) has a canned
      //       analysis we can replay so the UI shows the full analysis flow.
      //   (b) genuinely unknown id → clean JSON 404 (no HTML stack trace).
      if (err instanceof FhirNotFoundError) {
        const mock = getMockAnalysis(patientId);
        if (mock) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          replayCachedAnalysis(res, mock);
          res.end();
          return;
        }
        res.status(404).json({ error: 'Patient not found', patientId });
        return;
      }
      throw err;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // GD11 covers narration as well as structured citations. Four agents can
    // interleave token events in the merged orchestrated stream, so this
    // keeps one buffer per agentId (lazily created on first token, flushed
    // when THAT agent's own result arrives) — a single shared buffer would
    // scramble agent A's trailing characters with agent B's.
    const narrationBuffers = new Map<AgentId, NarrationBuffer>();
    function narrationFor(agentId: AgentId): NarrationBuffer {
      let buffer = narrationBuffers.get(agentId);
      if (!buffer) {
        buffer = createNarrationBuffer(bundle.validIds);
        narrationBuffers.set(agentId, buffer);
      }
      return buffer;
    }

    // Accumulated in step with every emitted SSE event below so the cache
    // row written on success is exactly what was streamed — not a
    // re-derivation that could drift from it.
    const resultJson: AnalysisResultJson = {
      risk: { narration: '', findings: [], complete: { riskScore: 0, riskLevel: 'low', readmissionProbability: 0, findingCount: 0, droppedCount: 0 } },
      careGap: { narration: '', findings: [], complete: { findingCount: 0, droppedCount: 0 } },
      sdoh: { narration: '', findings: [], complete: { findingCount: 0, droppedCount: 0, referralsNeeded: [] } },
      actionPlanner: { narration: '', tasks: [], complete: { findingCount: 0, droppedCount: 0 } },
    };

    // S14 Commit 3 — collects every validated (post-GD11) finding's
    // (fhirResourceId, confidence) pair as each classifier agent's result
    // arrives, so the Action Planner's `deriveActionPlannerTaskConfidence`
    // has the upstream findings in hand by the time its own result event
    // lands. The orchestrator runs Risk/CareGap/SDOH concurrently and only
    // schedules Action Planner once all three are exhausted (see
    // orchestrator.ts), so by the time we hit the `else` branch below, the
    // three `agentFindings.push(...)` calls above have already happened.
    const agentFindings: FindingWithConfidence[] = [];

    // Accumulates ONLY the safe (GD11-redacted, actually-emitted) narration
    // text per agent, so the cache captures exactly what streamed and a
    // replay re-emits the same prose — never the raw model tokens.
    const narrationText = new Map<AgentId, string>();
    function appendNarration(agentId: AgentId, text: string): void {
      narrationText.set(agentId, (narrationText.get(agentId) ?? '') + text);
    }

    try {
      for await (const event of runAnalysis(bundle)) {
        if (event.type === 'token') {
          const safeText = narrationFor(event.agentId).push(event.text);
          if (safeText) {
            appendNarration(event.agentId, safeText);
            writeSseEvent(res, 'token', { agentId: event.agentId, text: safeText });
          }
          continue;
        }
        // S18 WSA — token-usage events are cost-only (consumed by the
        // eval pipeline; see scripts/eval.ts:runLive). The SSE/citation
        // flow below expects a `result` event; `usage` events skip it.
        if (event.type === 'usage') {
          continue;
        }

        const remainder = narrationFor(event.agentId).flush();
        if (remainder) {
          appendNarration(event.agentId, remainder);
          writeSseEvent(res, 'token', { agentId: event.agentId, text: remainder });
        }

        // event.type === 'result' — the validation gate (GD11): no finding
        // (or Task) reaches the client/HAPI citing a resource absent from the
        // retrieved bundle.
        if (event.agentId === 'risk') {
          const clampedOutput = clampRiskLevel(bundle, event.output);
          const { valid, dropped } = validateCitations(clampedOutput.flags, bundle.validIds);
          // S14 Commit 3 — score each surviving flag with the bundle-evidence
          // heuristic (citation count + abnormal lab + recent encounter).
          // Dropped flags get no score (they never reach the client).
          const scored = applyConfidence(valid, (flag) => scoreRiskFlag(flag, bundle));
          for (const finding of scored) {
            agentFindings.push({ fhirResourceId: finding.fhirResourceId, confidence: finding.confidence });
            writeSseEvent(res, 'finding', { agentId: 'risk', ...finding });
          }
          // S19 Thread D — surface the `_safetyNetApplied` sentinel into the
          // persisted `complete` shape so the eval harness can render
          // `## Safety-net activity` in `docs/eval-report.md`. The field
          // is omitted when the clamp was a no-op (preserves high/critical
          // or is non-applicable to low/moderate inputs).
          const complete = {
            riskScore: clampedOutput.riskScore,
            riskLevel: clampedOutput.riskLevel,
            readmissionProbability: clampedOutput.readmissionProbability,
            findingCount: scored.length,
            droppedCount: dropped.length,
            ...(clampedOutput._safetyNetApplied ? { safetyNetApplied: clampedOutput._safetyNetApplied } : {}),
          };
          writeSseEvent(res, 'complete', { agentId: 'risk', ...complete });
          resultJson.risk = { narration: narrationText.get('risk') ?? '', findings: scored, complete };
        } else if (event.agentId === 'careGap') {
          const { valid, dropped } = validateCitations(event.output.gaps, bundle.validIds);
          // S14 Commit 3 — score each surviving gap from the Condition →
          // required LOINC mapping (mirrors data/eval/labels.json's
          // _meta.labelingRules.careGap).
          const scored = applyConfidence(valid, (gap) => scoreCareGap(gap, bundle));
          for (const finding of scored) {
            agentFindings.push({ fhirResourceId: finding.fhirResourceId, confidence: finding.confidence });
            writeSseEvent(res, 'finding', { agentId: 'careGap', ...finding });
          }
          const complete = { findingCount: scored.length, droppedCount: dropped.length };
          writeSseEvent(res, 'complete', { agentId: 'careGap', ...complete });
          resultJson.careGap = { narration: narrationText.get('careGap') ?? '', findings: scored, complete };
        } else if (event.agentId === 'sdoh') {
          const { valid, dropped } = validateCitations(event.output.barriers, bundle.validIds);
          // S14 Commit 3 — score each surviving barrier by whether the cited
          // resource is a real AHC-HRSN Observation with positive screening.
          const scored = applyConfidence(valid, (barrier) => scoreSdohBarrier(barrier, bundle));
          for (const finding of scored) {
            agentFindings.push({ fhirResourceId: finding.fhirResourceId, confidence: finding.confidence });
            writeSseEvent(res, 'finding', { agentId: 'sdoh', ...finding });
          }
          const complete = { findingCount: scored.length, droppedCount: dropped.length, referralsNeeded: event.output.referralsNeeded };
          writeSseEvent(res, 'complete', { agentId: 'sdoh', ...complete });
          resultJson.sdoh = { narration: narrationText.get('sdoh') ?? '', findings: scored, complete };
        } else {
          // actionPlanner — all-or-nothing per task (validateCitationList): a
          // task whose citations ALL drop must never reach HAPI. `valid` is
          // narrowed to each surviving task's valid fhirResources only.
          const { valid, dropped } = validateCitationList(
            event.output.tasks,
            (task) => task.fhirResources,
            (task, ids) => ({ ...task, fhirResources: ids }),
            bundle.validIds
          );

          // S14 Commit 3 — Action Planner task confidence is DERIVED from the
          // three classifier agents' already-collected findings (pushed above
          // as each result event arrived). `deriveActionPlannerTaskConfidence`
          // returns one number per task in input order; we zip them back onto
          // the surviving task objects so they ride the SSE + cache row
          // alongside the validated task shape.
          const taskConfidences = deriveActionPlannerTaskConfidence(valid, agentFindings);
          const validWithConfidence = valid.map((task, i) => ({ ...task, confidence: taskConfidences[i] }));

          // Always call replacePatientTasks, even with an empty `valid`, so a
          // re-run with zero surviving tasks still clears prior CareSync
          // Tasks for this patient (B2's replace guarantee).
          const created = await fhirService.replacePatientTasks(req.auth!, patientId, validWithConfidence);
          const tasks = created.map((task, i) => {
            const source = validWithConfidence[i];
            return {
              id: task.id,
              reference: `Task/${task.id}`,
              title: source.title,
              description: source.description,
              priority: source.priority,
              domain: source.domain,
              assignTo: source.assignTo,
              dueInDays: source.dueInDays,
              fhirResources: source.fhirResources,
              confidence: source.confidence,
            };
          });
          tasks.forEach((task) => writeSseEvent(res, 'task', { agentId: 'actionPlanner', ...task }));

          const complete = { findingCount: validWithConfidence.length, droppedCount: dropped.length };
          writeSseEvent(res, 'complete', { agentId: 'actionPlanner', ...complete });
          resultJson.actionPlanner = { narration: narrationText.get('actionPlanner') ?? '', tasks, complete };
        }
      }

      // Every agent — including the Action Planner's Task-creation step —
      // has now fully finished. Persist this run (A2: cache-aware route) so
      // the next non-live view of this patient replays it. This is
      // best-effort: the real work (the streamed findings/tasks + the HAPI
      // Task writes) already succeeded by this point, so a persistence hiccup
      // must NOT flip an otherwise-successful run into the `error` path (which
      // would hang the client's graph in `synthesizing` with no `done`). Log
      // and continue to `done`; the only cost of a missed write is that the
      // next non-live view re-runs live instead of replaying.
      try {
        writeCache(db, { patientId, resultJson, modelVersion: MODEL, createdTs: new Date().toISOString() });
      } catch (err) {
        console.error('analysis cache write failed (run still succeeded):', err);
      }
      writeSseEvent(res, 'done', {});
    } catch {
      // The connection is already open (res.writeHead ran above) — an SSE
      // error event is the only way left to tell the client the run failed;
      // headers can't change to a 5xx status at this point. No `done` fires
      // on this path — its absence is itself part of the failure signal.
      writeSseEvent(res, 'error', { message: 'Analysis failed' });
    }

    res.end();
  });

  return router;
}
