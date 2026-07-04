import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, ScopeDeniedError } from '../fhir/client';

export function createPatientsRouter(fhirService: FhirReadService): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/assigned', async (req, res) => {
    const panel = await fhirService.getAssignedPanel(req.auth!);
    res.json(panel);
  });

  router.get('/:id', async (req, res) => {
    try {
      const [patient, conditions] = await Promise.all([
        fhirService.getPatient(req.auth!, req.params.id),
        fhirService.getConditions(req.auth!, req.params.id),
      ]);
      res.json({ patient, conditions });
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
