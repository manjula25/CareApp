import { Router } from 'express';
import { FhirReadService, ScopeDeniedError } from '../fhir/client';
import { requireAuth } from '../middleware/auth';
import { listResourcesByCategory, COMMUNITY_RESOURCES } from '../sdoh/resources';

/**
 * S11 A1 — SDOH community resource directory + audited referral (M05). The
 * resource list itself is static reference data (see sdoh/resources.ts's
 * doc), so `GET /resources` needs no `fhirService` call and no scope check
 * beyond `requireAuth` — any authenticated role can browse it. `POST
 * /referrals` is the one real write: `createServiceRequest` does the actual
 * guard + audited FHIR write (see its doc in fhir/client.ts); this router
 * stays a thin shell, matching routes/tasks.ts's style.
 */
export function createSdohRouter(fhirService: FhirReadService): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/resources', (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    res.json(listResourcesByCategory(category));
  });

  router.post('/referrals', async (req, res) => {
    const { patientId, resourceId, note } = (req.body ?? {}) as {
      patientId?: string;
      resourceId?: string;
      note?: string;
    };
    if (!patientId || typeof patientId !== 'string') {
      res.status(400).json({ error: 'patientId is required' });
      return;
    }
    if (!resourceId || typeof resourceId !== 'string') {
      res.status(400).json({ error: 'resourceId is required' });
      return;
    }

    const resource = COMMUNITY_RESOURCES.find((r) => r.id === resourceId);
    if (!resource) {
      res.status(400).json({ error: `Unknown resourceId: ${resourceId}` });
      return;
    }

    try {
      const result = await fhirService.createServiceRequest(req.auth!, patientId, {
        category: resource.category,
        resourceName: resource.name,
        note,
      });
      res.json(result);
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
