import { Router } from 'express';
import { DirectorOnlyError, FhirReadService, ScopeDeniedError } from '../fhir/client';
import { requireAuth } from '../middleware/auth';

interface CarePlanRequestBody {
  goals?: string[];
  interventions?: { text: string; frequency?: string }[];
  sdohActions?: { barrier: string; resource?: string; status?: string }[];
}

/**
 * S12 C.2 — `POST /api/care-plans/:patientId` accepts the
 * `CarePlanBuilder.tsx` page's payload (goals / interventions / SDOH
 * actions), builds a FHIR CarePlan via `FhirReadService.createCarePlan`,
 * and returns the new CarePlan id. The actual scope-check + audit + FHIR
 * write happen inside `createCarePlan` (mirrors the routes/tasks.ts +
 * routes/sdoh.ts thin-shell pattern). Coordinator-or-above per the page's
 * `RoleGuard role="coordinator"` — the underlying FHIR call gates on
 * `'clinical'` scope (createCarePlan's doc), which the coordinator role
 * holds.
 */
export function createCarePlansRouter(fhirService: FhirReadService): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/:patientId', async (req, res) => {
    const { patientId } = req.params;
    const body = (req.body ?? {}) as CarePlanRequestBody;

    if (!Array.isArray(body.goals) || !Array.isArray(body.interventions)) {
      res.status(400).json({ error: 'goals (string[]) and interventions ({text}[]) are required' });
      return;
    }

    try {
      const result = await fhirService.createCarePlan(req.auth!, patientId, {
        goals: body.goals,
        interventions: body.interventions.filter((i) => i && typeof i.text === 'string'),
        sdohActions: body.sdohActions,
      });
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