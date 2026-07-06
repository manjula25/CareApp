import { Router } from 'express';
import { DirectorOnlyError, FhirReadService, ScopeDeniedError, TaskStatusTransition } from '../fhir/client';
import { requireAuth } from '../middleware/auth';

const VALID_TRANSITIONS: TaskStatusTransition[] = ['complete', 'defer', 'escalate'];

/**
 * S6 A1 — Director-scoped Task assignment. `assignTask` on `FhirReadService`
 * does the actual guard + audited write (see client.ts doc); this router is
 * a thin HTTP shell over it, matching the other route files' style (parse
 * request → call the service → map its errors to a status code).
 */
export function createTasksRouter(fhirService: FhirReadService): Router {
  const router = Router();
  router.use(requireAuth);

  // S7 A1 — role-filtered task listing. `listTasks` does the actual
  // per-task domain filter (see its doc in client.ts); this stays a thin
  // shell, matching the assign route below.
  router.get('/', async (req, res) => {
    const tasks = await fhirService.listTasks(req.auth!);
    res.json(tasks);
  });

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

  // S7 A2 — audited status-transition write. `transitionTask` does the
  // actual per-task domain-scope check + transition (see its doc in
  // client.ts); this stays a thin shell, matching the assign route above.
  router.patch('/:id/status', async (req, res) => {
    const { transition } = (req.body ?? {}) as { transition?: string };
    if (!transition || !VALID_TRANSITIONS.includes(transition as TaskStatusTransition)) {
      res.status(400).json({ error: `transition must be one of: ${VALID_TRANSITIONS.join(', ')}` });
      return;
    }

    try {
      const result = await fhirService.transitionTask(req.auth!, req.params.id, transition as TaskStatusTransition);
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
