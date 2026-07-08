import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, ScopeDeniedError, DirectorOnlyError } from '../fhir/client';
import { getDiabetesHba1cMeasure } from '../quality/service';

// S12 A.4 — `/api/quality/deadlines` returns the upcoming HEDIS submission
// deadlines for the Quality dashboard. Static POC calendar (HEDIS submission
// windows are quarterly and don't change daily); `daysRemaining` is computed
// at request time so the dashboard never shows a stale "60 days" when today
// is actually 45 days from the deadline. Director-only — same gating as
// `/measures`.
interface HEDISDeadline {
  measure: string;
  dueDate: string; // YYYY-MM-DD
}

const HEDIS_DEADLINES: HEDISDeadline[] = [
  { measure: 'HEDIS Hybrid Measures Submission', dueDate: '2026-08-15' },
  { measure: 'CMS Star Ratings Data Lock', dueDate: '2026-09-01' },
  { measure: 'Quality Improvement Report — Q3', dueDate: '2026-07-31' },
];

function daysFromToday(dueDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00');
  return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

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

  // S12 A.4 — same Director-only pattern as `/measures`. Static data + a
  // runtime daysRemaining computation; no HAPI round-trip.
  router.get('/deadlines', (req, res) => {
    if (req.auth!.role !== 'director') {
      res.status(403).json({ error: 'Director role required for /api/quality/deadlines' });
      return;
    }
    res.json({
      deadlines: HEDIS_DEADLINES.map((d) => ({
        measure: d.measure,
        dueDate: d.dueDate,
        daysRemaining: daysFromToday(d.dueDate),
      })),
    });
  });

  return router;
}
