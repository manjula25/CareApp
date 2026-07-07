import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, ScopeDeniedError, DirectorOnlyError } from '../fhir/client';
import { getTeamPerformance } from '../team/service';

/**
 * S11 A3 — Team performance aggregate (W04): a thin HTTP shell over
 * team/service.ts, mirroring routes/quality.ts's shape exactly
 * (`requireAuth`, DirectorOnlyError/ScopeDeniedError -> 403, Director-only).
 */
export function createTeamRouter(fhirService: FhirReadService, db: Database.Database): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/performance', async (req, res) => {
    try {
      const result = await getTeamPerformance(req.auth!, fhirService, db);
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
