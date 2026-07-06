import { Router } from 'express';
import Database from 'better-sqlite3';
import { readAnalysisCache, AnalysisCacheRow } from '../db/analysisCache';
import { mapAnalysisResultToCards } from './cdsCardMapping';
import { AnalysisResultJson } from './analysis';

type ReadCache = (db: Database.Database, patientId: string) => AnalysisCacheRow | null;

/**
 * Load-bearing beyond this task: S10 A2's service endpoint is mounted at
 * `POST /cds-services/{id}`, i.e. `POST /cds-services/caresync-patient-view`,
 * so this discovery descriptor's `id` must match that route exactly for a
 * CDS Hooks client to find it. Exported (mirrors `riskAgent.ts`'s exported
 * `MODEL`) so A2 can `import { CDS_PATIENT_VIEW_SERVICE_ID } from
 * './cdsHooks'` and reuse this exact value for its route path/match, instead
 * of a second literal that could drift from this one.
 */
export const CDS_PATIENT_VIEW_SERVICE_ID = 'caresync-patient-view';

/**
 * S10 A1 — CDS Hooks discovery endpoint (`GET /cds-services`), per the CDS
 * Hooks spec (https://cds-hooks.org/specification/current/#discovery). NOT
 * behind `requireAuth` — the public CDS Hooks sandbox that calls this has no
 * CareSync session token, unlike every other router in this repo.
 */
export function createCdsHooksRouter(db: Database.Database, readCache: ReadCache = readAnalysisCache): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      services: [
        {
          hook: 'patient-view',
          title: 'CareSync AI Patient-View Findings',
          description:
            "Returns CareSync AI's validated risk/care-gap/SDOH findings for the patient in context, with FHIR citations.",
          id: CDS_PATIENT_VIEW_SERVICE_ID,
          prefetch: {
            patient: 'Patient/{{context.patientId}}',
          },
        },
      ],
    });
  });

  /**
   * S10 A2 — the patient-view service itself
   * (https://cds-hooks.org/specification/current/#calling-a-cds-service).
   * Cache-only (see plan's "Why cache-only" note): CDS Hooks services are
   * called synchronously by the EHR/sandbox under a low-second timeout
   * budget, and this codebase has no reusable non-streaming
   * orchestrate→validate→cache function to call inline — that sequence
   * lives coupled to SSE framing inside routes/analysis.ts. So a cache miss
   * here returns `cards: []` (a valid CDS Hooks response) rather than
   * triggering a live run. NOT behind `requireAuth`, same as discovery
   * above — the calling EHR/sandbox has no CareSync session token.
   */
  router.post('/:id', (req, res) => {
    if (req.params.id !== CDS_PATIENT_VIEW_SERVICE_ID) {
      res.status(404).json({ error: `Unknown CDS service id: ${req.params.id}` });
      return;
    }

    const patientId = req.body?.context?.patientId;
    if (!patientId) {
      res.status(400).json({ error: 'context.patientId is required' });
      return;
    }

    const cached = readCache(db, patientId);
    if (!cached) {
      res.json({ cards: [] });
      return;
    }

    res.json({ cards: mapAnalysisResultToCards(cached.resultJson as AnalysisResultJson) });
  });

  return router;
}
