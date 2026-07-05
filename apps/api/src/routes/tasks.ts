import { Router } from 'express';
import { DirectorOnlyError, FhirReadService, ScopeDeniedError } from '../fhir/client';
import { requireAuth } from '../middleware/auth';

/**
 * S6 A1 — Director-scoped Task assignment. `assignTask` on `FhirReadService`
 * does the actual guard + audited write (see client.ts doc); this router is
 * a thin HTTP shell over it, matching the other route files' style (parse
 * request → call the service → map its errors to a status code).
 */
export function createTasksRouter(fhirService: FhirReadService): Router {
  const router = Router();
  router.use(requireAuth);

  router.patch('/:id/assign', async (req, res) => {
    const { coordinatorId } = (req.body ?? {}) as { coordinatorId?: string };
    if (!coordinatorId || typeof coordinatorId !== 'string') {
      res.status(400).json({ error: 'coordinatorId is required' });
      return;
    }

    try {
      const result = await fhirService.assignTask(req.auth!, req.params.id, coordinatorId);
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
