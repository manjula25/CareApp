import './env'; // load .env before riskAgent.ts constructs `new OpenAI()`
import express from 'express';
import cors from 'cors';
import { getDb } from './db';
import { createAuthRouter } from './routes/auth';
import { createPatientsRouter } from './routes/patients';
import { createAnalysisRouter } from './routes/analysis';
import { createPopulationRouter } from './routes/population';
import { createGovernanceRouter } from './routes/governance';
import { createQualityRouter } from './routes/quality';
import { createTeamRouter } from './routes/team';
import { createTasksRouter } from './routes/tasks';
import { createSdohRouter } from './routes/sdoh';
import { createCarePlansRouter } from './routes/carePlans';
import { createAlertsRouter } from './routes/alerts';
import { createEventsRouter, createSubscriptionWebhookRouter } from './routes/events';
import { createEventHub } from './routes/eventHub';
import { createCdsHooksRouter } from './routes/cdsHooks';
import { ensureTaskSubscription } from './fhir/subscription';
import { orchestrate } from './agents/orchestrator';
import { FhirReadService } from './fhir/client';
import { generateKeyPair } from './smart/keys';
import { createTokenServer } from './smart/tokenServer';
import { SmartTokenClient } from './smart/tokenClient';
import { createSmartAuthMiddleware, smartAuthErrorHandler, wrapRouterWithSmartAuth } from './middleware/smartAuth';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';
const PORT = process.env.PORT ?? 4000;
const SMART_CLIENT_ID = 'caresync-api';
const SMART_TOKEN_ENDPOINT = process.env.SMART_TOKEN_ENDPOINT ?? `http://localhost:${PORT}/smart/token`;
// S6 A2 — must be reachable from *inside* the HAPI container, not the host;
// `host.docker.internal` is Docker Desktop's route back to the host.
const SUBSCRIPTION_CALLBACK_URL =
  process.env.SUBSCRIPTION_CALLBACK_URL ?? `http://host.docker.internal:${PORT}/api/fhir/subscription-hook`;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// S12 A.1 — global error handler. Must be LAST in the middleware chain (after
// all routes), so any uncaught throw that escapes a route handler hits this.
// Mirrors the lead project's index.ts:75-78 shape; guarantees a consistent
// JSON `{error}` envelope on otherwise-unhandled failures so clients never see
// Express's default HTML error page.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  const db = getDb();

  // SMART Backend Services (B6): the client's keypair is generated at boot
  // and registered in-process with the token server below — see
  // src/smart/keys.ts for why there's no separate registration step in
  // this POC. See plan.md §3 for the honest-staging note: HAPI itself does
  // not yet require/validate this token (the stock hapiproject/hapi image
  // ships no shell to configure a bearer-token interceptor into); the
  // token is minted, exchanged, cached, and attached to every HAPI call.
  //
  // S17 (Open Question 8): when SMART_JWKS_URL is set, the middleware
  // switches to RS256 production mode (Keycloak JWKS). The in-process
  // token server is still mounted for POC backward compat — production
  // deployments point SMART_TOKEN_ENDPOINT at Keycloak instead.
  const { publicKey, privateKey } = generateKeyPair();
  app.use('/smart', createTokenServer({
    clientId: SMART_CLIENT_ID,
    tokenEndpoint: SMART_TOKEN_ENDPOINT,
    clientPublicKey: publicKey,
    audience: process.env.SMART_AUDIENCE,
  }));
  const tokenClient = new SmartTokenClient({
    clientId: SMART_CLIENT_ID,
    tokenEndpoint: SMART_TOKEN_ENDPOINT,
    privateKey,
    external: !!process.env.SMART_JWKS_URL,
  });

  // S14 Commit 4 (A) + S17 (Open Question 8) — SMART-on-FHIR enforcement at
  // the app tier. Mounts on every HAPI-touching route so a
  // missing/tampered/expired/out-of-scope bearer token surfaces a structured
  // 401/403 here in addition to whatever HAPI does.
  //
  // Two verification modes:
  // - POC (default): HS256 via serverSecret (in-process token server).
  // - Production: RS256 via Keycloak JWKS (when SMART_JWKS_URL is set).
  //
  // Scope enforcement:
  // - POC: method-level (coarse GET/POST gate with wildcard scopes).
  // - Production: route-level (per-endpoint scopes like
  //   `GET /api/patients/:id → ['patient/Patient.read']`).
  //   Route-level takes precedence when both are configured.
  //
  // KEEPS `requireAuth` (the login tier) on each route. NOT mounted on
  // /api/auth, /api/health, /api/events, /cds-services.
  const smartAuth = createSmartAuthMiddleware({
    serverSecret: process.env.SMART_SERVER_SECRET ?? 'caresync-dev-authz-server-secret-do-not-use-in-production',
    jwksUrl: process.env.SMART_JWKS_URL,
    issuer: process.env.SMART_ISSUER,
    audience: process.env.SMART_AUDIENCE,
    requiredScopesByMethod: {
      GET: ['system/*.read', 'patient/*.read', 'user/*.read'],
      POST: ['system/*.write', 'patient/*.write', 'user/*.write'],
      PUT: ['system/*.write', 'patient/*.write', 'user/*.write'],
      PATCH: ['system/*.write', 'patient/*.write', 'user/*.write'],
      DELETE: ['system/*.write', 'patient/*.write', 'user/*.write'],
    },
    requiredScopesByRoute: {
      // Patients
      'GET /api/patients/assigned': ['patient/Patient.read', 'system/Patient.read'],
      'GET /api/patients/:id': ['patient/Patient.read', 'system/Patient.read'],
      // Analysis (reads clinical resources, writes analysis cache)
      'POST /api/patients/:id/analysis': ['patient/Observation.read', 'patient/Condition.read', 'system/Observation.read', 'system/Condition.read'],
      // Population (Director-only, system-wide reads)
      'GET /api/population/scatter': ['system/*.read'],
      'GET /api/population/summary': ['system/*.read'],
      'GET /api/population/risk-distribution': ['system/*.read'],
      // Governance (Director-only, system-wide reads)
      'GET /api/governance/audit': ['system/*.read'],
      'GET /api/governance/model': ['system/*.read'],
      'GET /api/governance/parity': ['system/*.read'],
      'GET /api/governance/eval': ['system/*.read'],
      // Tasks
      'GET /api/tasks': ['patient/Task.read', 'system/Task.read'],
      'GET /api/tasks/:id': ['patient/Task.read', 'system/Task.read'],
      'PATCH /api/tasks/:id/assign': ['system/Task.write'],
      'PATCH /api/tasks/:id/status': ['patient/Task.write', 'system/Task.write'],
      // SDOH
      'GET /api/sdoh/resources': ['patient/*.read', 'system/*.read'],
      'GET /api/sdoh/screening/:patientId': ['patient/Observation.read', 'system/Observation.read'],
      'POST /api/sdoh/referrals': ['patient/*.write', 'system/*.write'],
      // Care Plans (Director-only write)
      'POST /api/care-plans/:patientId': ['system/CarePlan.write'],
      // Alerts
      'GET /api/alerts': ['patient/*.read', 'system/*.read'],
      // Quality (Director-only)
      'GET /api/quality/measures': ['system/*.read'],
      'GET /api/quality/deadlines': ['system/*.read'],
      // Team (Director-only)
      'GET /api/team/performance': ['system/*.read'],
    },
  });

  const fhirService = new FhirReadService(db, FHIR_BASE_URL, tokenClient);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/patients', wrapRouterWithSmartAuth(createPatientsRouter(fhirService), smartAuth));
  // S2 — a second router on the same base path; the real runRiskAgent is the
  // default so no extra wiring is needed beyond mounting this route.
  // S4 A2 — `db` threads through so the route can read/write `analysis_cache`;
  // `orchestrate` is passed explicitly (not defaulted) since it now sits
  // before `db` in the parameter list.
  app.use('/api/patients', wrapRouterWithSmartAuth(createAnalysisRouter(fhirService, orchestrate, db), smartAuth));
  // S5 A2 — Director-only population dashboard aggregates (W02).
  app.use('/api/population', wrapRouterWithSmartAuth(createPopulationRouter(fhirService, db), smartAuth));
  // S8 A1-A3 — Director-only governance/audit dashboard aggregates (W06).
  app.use('/api/governance', wrapRouterWithSmartAuth(createGovernanceRouter(fhirService, db), smartAuth));
  // S6 A1 — Director-scoped Task assignment.
  app.use('/api/tasks', wrapRouterWithSmartAuth(createTasksRouter(fhirService), smartAuth));
  // S11 A1 — SDOH community resource directory + audited referral (M05).
  app.use('/api/sdoh', wrapRouterWithSmartAuth(createSdohRouter(fhirService), smartAuth));
  // S12 C.2 — `POST /api/care-plans/:patientId` for the Care Plan Builder.
  app.use('/api/care-plans', wrapRouterWithSmartAuth(createCarePlansRouter(fhirService), smartAuth));
  // S12 B.2 — clinical alerts derived from real FHIR risk profiles.
  app.use('/api/alerts', wrapRouterWithSmartAuth(createAlertsRouter(fhirService, db), smartAuth));
  // S11 A2 — Director-only Quality/HEDIS measure aggregate (W05/W07).
  app.use('/api/quality', wrapRouterWithSmartAuth(createQualityRouter(fhirService, db), smartAuth));
  // S11 A3 — Director-only team performance aggregate (W04).
  app.use('/api/team', wrapRouterWithSmartAuth(createTeamRouter(fhirService, db), smartAuth));
  // S6 A3 — the client relay (`/api/events`) and HAPI's webhook target
  // (`/api/fhir/subscription-hook`) share one in-process hub instance.
  // Not SMART-gated: /api/events is the client SSE relay (gated on
  // requireAuth); /api/fhir is HAPI's own server-to-server webhook callback
  // (see events.ts note about the stock image having no bearer-token slot).
  const eventHub = createEventHub();
  app.use('/api/events', createEventsRouter(eventHub));
  app.use('/api/fhir', createSubscriptionWebhookRouter(eventHub));
  // S10 A1/A2 — CDS Hooks discovery + patient-view service. Different URL
  // namespace by spec (NOT under /api) and deliberately not auth'd — see
  // routes/cdsHooks.ts. S10 A2 reads the same `analysis_cache` table S4's
  // analysis.ts writes, via the already-available `db` instance.
  app.use('/cds-services', createCdsHooksRouter(db));

  // S14 Commit 4 (A) — SMART auth error handler. Mounted AFTER the routers
  // so any `SmartAuthError` thrown out of the middleware above is caught
  // here and translated to the documented JSON response shape. Non-SMART
  // errors fall through to the global 500 handler above (Express error
  // handlers in mount order, only SMART ones short-circuit).
  app.use(smartAuthErrorHandler);

  app.listen(PORT, () => {
    console.log(`API listening on :${PORT}`);
  });

  // S6 A2 — idempotent at every boot; non-fatal on failure (e.g. HAPI not
  // yet reachable, or rest-hook delivery unsupported in this environment) —
  // logged and the server still starts, per the plan's honest-staging note.
  ensureTaskSubscription(FHIR_BASE_URL, SUBSCRIPTION_CALLBACK_URL)
    .then((result) => {
      console.log(`FHIR Task Subscription ${result.created ? 'created' : 'already exists'}: ${result.id}`);
    })
    .catch((err) => {
      console.error('Could not ensure FHIR Task Subscription (continuing without live delivery):', err);
    });
}

export default app;
