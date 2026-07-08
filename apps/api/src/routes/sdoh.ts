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

  // S12 A.5 — `GET /api/sdoh/screening/:patientId` returns any
  // QuestionnaireResponse resources on the patient's record (the AHC-HRSN
  // screening tool stores its answers as `item[]` on a single QR per
  // encounter). Empty screening is a valid state — `screeningFound: false`,
  // `responses: []`, status 200 — not a 404, so the mobile UI can render
  // "no screening on file" without an error toast. Uses the dedicated
  // SDOH-domain `FhirReadService.getSdohScreening` so a Social Worker can read
  // it without tripping the clinical scope guard on `getPatientBundle`.
  router.get('/screening/:patientId', async (req, res) => {
    try {
      const responses = await fhirService.getSdohScreening(req.auth!, req.params.patientId);

      res.json({
        patientId: req.params.patientId,
        screeningFound: responses.length > 0,
        // Keep only the clinician-relevant slice of each QR (id, status,
        // authored, questionnaire reference, item count) — the raw `item`
        // tree is verbose and the UI flattens it client-side.
        responses: responses.map((r: any) => ({
          id: r.id,
          status: r.status,
          authored: r.authored,
          questionnaire: r.questionnaire,
          itemCount: Array.isArray(r.item) ? r.item.length : 0,
        })),
      });
    } catch (err) {
      if (err instanceof ScopeDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
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
