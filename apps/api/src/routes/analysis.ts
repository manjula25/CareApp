import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, PatientBundle, ScopeDeniedError } from '../fhir/client';
import { orchestrate } from '../agents/orchestrator';
import { AgentEvent, AgentId } from '../agents/agent';
import { validateCitations, validateCitationList, createNarrationBuffer, NarrationBuffer } from '../agents/citationValidator';

type RunAnalysis = (bundle: PatientBundle) => AsyncIterable<AgentEvent>;

function writeSseEvent(res: import('express').Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * S3 analysis route (B3). Audits + scope-guards one `$everything` read of the
 * patient's bundle (via `FhirReadService`), then streams the full four-agent
 * orchestration (risk/careGap/sdoh in parallel, then the action planner) over
 * SSE. Every citation — a flag/gap/barrier's `fhirResourceId`, or a task's
 * `fhirResources` list — is validated against the bundle's `validIds` (GD11 —
 * Seam 2) before it is emitted as a `finding`/`task`, or, for tasks, before it
 * is persisted to HAPI via `replacePatientTasks`. Dropped citations never
 * reach the client or HAPI.
 *
 * `runAnalysis` defaults to the real `orchestrate` so production wiring needs
 * no extra step, while tests inject a stub to avoid a live OpenAI call.
 */
export function createAnalysisRouter(fhirService: FhirReadService, runAnalysis: RunAnalysis = orchestrate): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/:id/analysis', async (req, res) => {
    let bundle: PatientBundle;
    try {
      bundle = await fhirService.getPatientBundle(req.auth!, req.params.id);
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
          writeSseEvent(res, 'complete', {
            agentId: 'risk',
            riskScore: event.output.riskScore,
            riskLevel: event.output.riskLevel,
            readmissionProbability: event.output.readmissionProbability,
            findingCount: valid.length,
            droppedCount: dropped.length,
          });
        } else if (event.agentId === 'careGap') {
          const { valid, dropped } = validateCitations(event.output.gaps, bundle.validIds);
          for (const gap of valid) {
            writeSseEvent(res, 'finding', { agentId: 'careGap', ...gap });
          }
          writeSseEvent(res, 'complete', {
            agentId: 'careGap',
            findingCount: valid.length,
            droppedCount: dropped.length,
          });
        } else if (event.agentId === 'sdoh') {
          const { valid, dropped } = validateCitations(event.output.barriers, bundle.validIds);
          for (const barrier of valid) {
            writeSseEvent(res, 'finding', { agentId: 'sdoh', ...barrier });
          }
          writeSseEvent(res, 'complete', {
            agentId: 'sdoh',
            findingCount: valid.length,
            droppedCount: dropped.length,
            referralsNeeded: event.output.referralsNeeded,
          });
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
          const created = await fhirService.replacePatientTasks(req.auth!, req.params.id, valid);
          created.forEach((task, i) => {
            const source = valid[i];
            writeSseEvent(res, 'task', {
              agentId: 'actionPlanner',
              id: task.id,
              reference: `Task/${task.id}`,
              title: source.title,
              description: source.description,
              priority: source.priority,
              assignTo: source.assignTo,
              dueInDays: source.dueInDays,
              fhirResources: source.fhirResources,
            });
          });

          writeSseEvent(res, 'complete', {
            agentId: 'actionPlanner',
            findingCount: valid.length,
            droppedCount: dropped.length,
          });
        }
      }

      // Every agent — including the Action Planner's Task-creation step —
      // has now fully finished. This is the one terminal signal a consumer
      // (S4's web client) needs to know the whole run ended.
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
