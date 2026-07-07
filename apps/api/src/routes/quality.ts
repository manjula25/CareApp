import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, ScopeDeniedError, DirectorOnlyError } from '../fhir/client';
import { getDiabetesHba1cMeasure } from '../quality/service';

/**
 * S11 A2 — Quality/HEDIS measure aggregate (W05/W07): a thin HTTP shell over
 * quality/service.ts, mirroring routes/governance.ts's shape exactly
 * (`requireAuth`, DirectorOnlyError/ScopeDeniedError -> 403, Director-only).
 */
export function createQualityRouter(fhirService: FhirReadService, db: Database.Database): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/measures', async (req, res) => {
    try {
      const result = await getDiabetesHba1cMeasure(req.auth!, fhirService, db);
      res.json(result);
    } catch (err) {
      if (err instanceof DirectorOnlyError || err instanceof ScopeDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}
