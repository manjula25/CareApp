import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, ScopeDeniedError } from '../fhir/client';
import { listAlerts } from '../alerts/service';

/**
 * S12 B.2 — Clinical alerts derived from real FHIR data. Previously the
 * front-end hardcoded an `MOCK_ALERTS` array; that page now hits this
 * endpoint, with the same fallback shape (MOCK_ALERTS) shown only when
 * the request errors.
 *
 * Scope: requires 'clinical' via the upstream `getPopulationRiskProfile`
 * guard. Coordinator + director see alerts; social worker gets 403
 * (matches the lead-port's clinical-alerts surface, which was Director /
 * Coordinator-only in the demo).
 */
export function createAlertsRouter(fhirService: FhirReadService, db: Database.Database): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    try {
      const alerts = await listAlerts(req.auth!, fhirService, db);
      res.json(alerts);
    } catch (err) {
      if (err instanceof ScopeDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}