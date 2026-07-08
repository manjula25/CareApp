import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { FhirReadService, ScopeDeniedError, FhirNotFoundError } from '../fhir/client';

export function createPatientsRouter(fhirService: FhirReadService): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/assigned', async (req, res) => {
    const panel = await fhirService.getAssignedPanel(req.auth!);
    res.json(panel);
  });

  router.get('/:id', async (req, res) => {
    try {
      const [patient, conditions, tasks] = await Promise.all([
        fhirService.getPatient(req.auth!, req.params.id),
        fhirService.getConditions(req.auth!, req.params.id),
        fhirService.getTasks(req.auth!, req.params.id),
      ]);
      res.json({ patient, conditions, tasks });
    } catch (err) {
      if (err instanceof ScopeDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      // S12 follow-up — HAPI returns 404 for unknown patient ids (e.g. a
      // demo route like `/patients/maria-chen-4829` that exists only in the
      // MOCK fixtures). Return a clean JSON 404 so the UI's `buildDisplayPatient`
      // MOCK-fallback path runs instead of Express's default HTML error page.
      if (err instanceof FhirNotFoundError) {
        res.status(404).json({ error: 'Patient not found', patientId: req.params.id });
        return;
      }
      throw err;
    }
  });

  return router;
}
