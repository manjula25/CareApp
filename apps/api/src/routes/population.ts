import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, ScopeDeniedError } from '../fhir/client';
import {
  getPopulationScatter,
  getPopulationSummary,
  getRiskDistribution,
  DirectorOnlyError,
} from '../population/service';

/**
 * S5 A2 — Director-only population aggregate endpoints for the W02 dashboard
 * (scatter plot + summary tiles). Both routes are audited (see
 * population/service.ts: a denial audit on the Director-only gate, a success
 * audit from FhirReadService.getPopulationRiskProfile on an allowed read) and
 * both mirror the ScopeDeniedError → 403 pattern already used by
 * routes/patients.ts and routes/analysis.ts.
 */
export function createPopulationRouter(fhirService: FhirReadService, db: Database.Database): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/scatter', async (req, res) => {
    try {
      const points = await getPopulationScatter(req.auth!, fhirService, db);
      res.json(points);
    } catch (err) {
      if (err instanceof DirectorOnlyError || err instanceof ScopeDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get('/summary', async (req, res) => {
    try {
      const summary = await getPopulationSummary(req.auth!, fhirService, db);
      res.json(summary);
    } catch (err) {
      if (err instanceof DirectorOnlyError || err instanceof ScopeDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // S12 A.3 — Director-only risk-level bar-chart data for the W02 dashboard.
  // Same auth pattern as `/scatter` and `/summary`; throws flow through the
  // global error handler (S12 A.1) when not a known scope/director error.
  router.get('/risk-distribution', async (req, res) => {
    try {
      const buckets = await getRiskDistribution(req.auth!, fhirService, db);
      res.json(buckets);
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
