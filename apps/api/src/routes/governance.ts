import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, ScopeDeniedError } from '../fhir/client';
import { getAuditTrail, getModelPerformance, getParityMetrics, getEvalSummary, DirectorOnlyError } from '../governance/service';

const DEFAULT_LIMIT = 50;

/**
 * S8 A1 — Director-only W06 governance aggregate endpoints (audit trail,
 * model performance, demographic parity), mirroring routes/population.ts's
 * shape exactly: a thin HTTP shell over governance/service.ts, mapping
 * DirectorOnlyError/ScopeDeniedError to 403 the same way population's router
 * does.
 */
export function createGovernanceRouter(fhirService: FhirReadService, db: Database.Database): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/audit', (req, res) => {
    try {
      const limit = parseNonNegativeInt(req.query.limit, DEFAULT_LIMIT);
      const offset = parseNonNegativeInt(req.query.offset, 0);
      const result = getAuditTrail(req.auth!, db, limit, offset);
      res.json(result);
    } catch (err) {
      if (err instanceof DirectorOnlyError || err instanceof ScopeDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get('/model', (req, res) => {
    try {
      const result = getModelPerformance(req.auth!, db);
      res.json(result);
    } catch (err) {
      if (err instanceof DirectorOnlyError || err instanceof ScopeDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get('/parity', async (req, res) => {
    try {
      const result = await getParityMetrics(req.auth!, fhirService, db);
      res.json(result);
    } catch (err) {
      if (err instanceof DirectorOnlyError || err instanceof ScopeDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // S8 B2 — B2's eval headline tile; see governance/service.ts's
  // EVAL_REPORT_PATH doc for the exact file this reads.
  router.get('/eval', (req, res) => {
    try {
      const result = getEvalSummary(req.auth!, db);
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

// `?limit=`/`?offset=` — this repo has no prior list-endpoint pagination
// convention (routes/tasks.ts and routes/patients.ts both return unpaged
// lists), so limit/offset was picked as the plainest SQL-native convention;
// any non-numeric or negative value falls back to the given default rather
// than 500ing on a malformed query string.
function parseNonNegativeInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
