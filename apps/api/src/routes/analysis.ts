import { Router, Response } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, PatientBundle, ScopeDeniedError } from '../fhir/client';
import { orchestrate } from '../agents/orchestrator';
import { AgentEvent, AgentId } from '../agents/agent';
import { validateCitations, validateCitationList, createNarrationBuffer, NarrationBuffer, AgentFlag } from '../agents/citationValidator';
import { readAnalysisCache, writeAnalysisCache, AnalysisCacheEntry, AnalysisCacheRow } from '../db/analysisCache';
// All four agent modules currently export the same MODEL constant
// ('gpt-5.5') — riskAgent's is used here as the single source of truth for
// what gets recorded as `modelVersion` on the cache row.
import { MODEL } from '../agents/riskAgent';

type RunAnalysis = (bundle: PatientBundle) => AsyncIterable<AgentEvent>;
type ReadCache = (db: Database.Database, patientId: string) => AnalysisCacheRow | null;
type WriteCache = (db: Database.Database, entry: AnalysisCacheEntry) => void;

function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * A2 (S4) — everything needed to replay the exact same `finding`/`task`/
 * `complete` SSE sequence a live run produced, without re-touching HAPI or
 * the LLM. Per bundle-driven agent (risk/careGap/sdoh): the citation-gate-
 * SURVIVING findings (in emission order) plus that agent's `complete`
 * payload. For actionPlanner: the full created-Task payloads (id/reference/
 * title/description/priority/assignTo/dueInDays/fhirResources) — not just
 * ids — because S3's replacePatientTasks deletes+recreates Tasks with new
 * ids on every live run, so an id-only cache would dangle; plus its
 * `complete` payload. `agentId` is intentionally omitted from each entry
 * here (it's implied by the key) and re-added at emit time on both the live
 * and replay paths, so the two paths share one shape by construction.
 */
export interface AnalysisResultJson {
  risk: {
    findings: AgentFlag[];
    complete: { riskScore: number; riskLevel: string; readmissionProbability: number; findingCount: number; droppedCount: number };
  };
  careGap: {
    findings: { gapType: string; description: string; lastDone?: string; dueDate?: string; urgency: string; fhirResourceId: string }[];
    complete: { findingCount: number; droppedCount: number };
  };
  sdoh: {
    findings: { domain: string; finding: string; severity: string; fhirResourceId: string }[];
    complete: { findingCount: number; droppedCount: number; referralsNeeded: string[] };
  };
  actionPlanner: {
    tasks: {
      id: string;
      reference: string;
      title: string;
      description: string;
      priority: string;
      assignTo?: string;
      dueInDays?: number;
      fhirResources: string[];
    }[];
    complete: { findingCount: number; droppedCount: number };
  };
}

/**
 * Replays a cached `AnalysisResultJson` as the identical `finding`/`task`/
 * `complete` SSE sequence a live run would have produced — same phased
 * order (each agent's own findings before its own complete, actionPlanner
 * last), same `agentId` tagging — so the canvas (S4 Task B) can't tell the
 * two apart. No HAPI or LLM call on this path.
 */
function replayCachedAnalysis(res: Response, result: AnalysisResultJson): void {
  for (const finding of result.risk.findings) {
    writeSseEvent(res, 'finding', { agentId: 'risk', ...finding });
  }
  writeSseEvent(res, 'complete', { agentId: 'risk', ...result.risk.complete });

  for (const finding of result.careGap.findings) {
    writeSseEvent(res, 'finding', { agentId: 'careGap', ...finding });
  }
  writeSseEvent(res, 'complete', { agentId: 'careGap', ...result.careGap.complete });

  for (const finding of result.sdoh.findings) {
    writeSseEvent(res, 'finding', { agentId: 'sdoh', ...finding });
  }
  writeSseEvent(res, 'complete', { agentId: 'sdoh', ...result.sdoh.complete });

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
        // it's a local role comparison (+ a denial audit write), no HAPI
        // request, so calling it here doesn't cost the HAPI round-trip
        // replay exists to avoid.
        try {
          fhirService.assertScope(req.auth!, 'clinical', `Patient/${patientId}/$everything`);
        } catch (err) {
          if (err instanceof ScopeDeniedError) {
            res.status(403).json({ error: err.message });
            return;
          }
          throw err;
        }

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
      risk: { findings: [], complete: { riskScore: 0, riskLevel: 'low', readmissionProbability: 0, findingCount: 0, droppedCount: 0 } },
      careGap: { findings: [], complete: { findingCount: 0, droppedCount: 0 } },
      sdoh: { findings: [], complete: { findingCount: 0, droppedCount: 0, referralsNeeded: [] } },
      actionPlanner: { tasks: [], complete: { findingCount: 0, droppedCount: 0 } },
    };

    try {
      for await (const event of runAnalysis(bundle)) {
        if (event.type === 'token') {
          const safeText = narrationFor(event.agentId).push(event.text);
          if (safeText) {
            writeSseEvent(res, 'token', { agentId: event.agentId, text: safeText });
          }
          continue;
        }

        const remainder = narrationFor(event.agentId).flush();
        if (remainder) {
          writeSseEvent(res, 'token', { agentId: event.agentId, text: remainder });
        }

        // event.type === 'result' — the validation gate (GD11): no finding
        // (or Task) reaches the client/HAPI citing a resource absent from the
        // retrieved bundle.
        if (event.agentId === 'risk') {
          const { valid, dropped } = validateCitations(event.output.flags, bundle.validIds);
          for (const flag of valid) {
            writeSseEvent(res, 'finding', { agentId: 'risk', ...flag });
          }
          const complete = {
            riskScore: event.output.riskScore,
            riskLevel: event.output.riskLevel,
            readmissionProbability: event.output.readmissionProbability,
            findingCount: valid.length,
            droppedCount: dropped.length,
          };
          writeSseEvent(res, 'complete', { agentId: 'risk', ...complete });
          resultJson.risk = { findings: valid, complete };
        } else if (event.agentId === 'careGap') {
          const { valid, dropped } = validateCitations(event.output.gaps, bundle.validIds);
          for (const gap of valid) {
            writeSseEvent(res, 'finding', { agentId: 'careGap', ...gap });
          }
          const complete = { findingCount: valid.length, droppedCount: dropped.length };
          writeSseEvent(res, 'complete', { agentId: 'careGap', ...complete });
          resultJson.careGap = { findings: valid, complete };
        } else if (event.agentId === 'sdoh') {
          const { valid, dropped } = validateCitations(event.output.barriers, bundle.validIds);
          for (const barrier of valid) {
            writeSseEvent(res, 'finding', { agentId: 'sdoh', ...barrier });
          }
          const complete = { findingCount: valid.length, droppedCount: dropped.length, referralsNeeded: event.output.referralsNeeded };
          writeSseEvent(res, 'complete', { agentId: 'sdoh', ...complete });
          resultJson.sdoh = { findings: valid, complete };
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

          // Always call replacePatientTasks, even with an empty `valid`, so a
          // re-run with zero surviving tasks still clears prior CareSync
          // Tasks for this patient (B2's replace guarantee).
          const created = await fhirService.replacePatientTasks(req.auth!, patientId, valid);
          const tasks = created.map((task, i) => {
            const source = valid[i];
            return {
              id: task.id,
              reference: `Task/${task.id}`,
              title: source.title,
              description: source.description,
              priority: source.priority,
              assignTo: source.assignTo,
              dueInDays: source.dueInDays,
              fhirResources: source.fhirResources,
            };
          });
          tasks.forEach((task) => writeSseEvent(res, 'task', { agentId: 'actionPlanner', ...task }));

          const complete = { findingCount: valid.length, droppedCount: dropped.length };
          writeSseEvent(res, 'complete', { agentId: 'actionPlanner', ...complete });
          resultJson.actionPlanner = { tasks, complete };
        }
      }

      // Every agent — including the Action Planner's Task-creation step —
      // has now fully finished. Persist this run (A2: cache-aware route) so
      // the next non-live view of this patient replays it, then emit the one
      // terminal signal a consumer (S4's web client) needs to know the whole
      // run ended.
      writeCache(db, { patientId, resultJson, modelVersion: MODEL, createdTs: new Date().toISOString() });
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
