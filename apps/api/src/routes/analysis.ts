import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, PatientBundle, ScopeDeniedError } from '../fhir/client';
import { runRiskAgent, AgentEvent } from '../agents/riskAgent';
import { validateCitations, createNarrationBuffer } from '../agents/citationValidator';

type RunAgent = (bundle: PatientBundle) => AsyncIterable<AgentEvent>;

function writeSseEvent(res: import('express').Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * S2 analysis route (B2). `POST /:id/analysis` audits + scope-guards one
 * `$everything` read of the patient's bundle (via `FhirReadService`), then
 * streams the Risk agent's output over SSE. Every flag's `fhirResourceId` is
 * validated against the bundle's `validIds` (GD11 — Seam 2) before it is
 * emitted as a `finding`; dropped citations never reach the client.
 *
 * `runAgent` defaults to the real `runRiskAgent` so production wiring needs
 * no extra step, while tests inject a stub to avoid a live OpenAI call.
 */
export function createAnalysisRouter(fhirService: FhirReadService, runAgent: RunAgent = runRiskAgent): Router {
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

    // GD11 covers narration as well as structured flags — a fabricated
    // ResourceType/id mentioned in prose is redacted before it reaches the
    // client, same as a fabricated flag.
    const narration = createNarrationBuffer(bundle.validIds);

    try {
      for await (const event of runAgent(bundle)) {
        if (event.type === 'token') {
          const safeText = narration.push(event.text);
          if (safeText) {
            writeSseEvent(res, 'token', { text: safeText });
          }
          continue;
        }

        const remainder = narration.flush();
        if (remainder) {
          writeSseEvent(res, 'token', { text: remainder });
        }

        // event.type === 'result' — the validation gate (GD11): no finding
        // reaches the client citing a resource absent from the retrieved bundle.
        const { valid, dropped } = validateCitations(event.output.flags, bundle.validIds);
        for (const flag of valid) {
          writeSseEvent(res, 'finding', flag);
        }
        writeSseEvent(res, 'complete', {
          riskScore: event.output.riskScore,
          riskLevel: event.output.riskLevel,
          readmissionProbability: event.output.readmissionProbability,
          findingCount: valid.length,
          droppedCount: dropped.length,
        });
      }
    } catch {
      // The connection is already open (res.writeHead ran above) — an SSE
      // error event is the only way left to tell the client the run failed;
      // headers can't change to a 5xx status at this point.
      writeSseEvent(res, 'error', { message: 'Analysis failed' });
    }

    res.end();
  });

  return router;
}
