import './env'; // load .env before riskAgent.ts constructs `new OpenAI()`
import express from 'express';
import cors from 'cors';
import { getDb } from './db';
import { createAuthRouter } from './routes/auth';
import { createPatientsRouter } from './routes/patients';
import { createAnalysisRouter } from './routes/analysis';
import { createPopulationRouter } from './routes/population';
import { orchestrate } from './agents/orchestrator';
import { FhirReadService } from './fhir/client';
import { generateKeyPair } from './smart/keys';
import { createTokenServer } from './smart/tokenServer';
import { SmartTokenClient } from './smart/tokenClient';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';
const PORT = process.env.PORT ?? 4000;
const SMART_CLIENT_ID = 'caresync-api';
const SMART_TOKEN_ENDPOINT = process.env.SMART_TOKEN_ENDPOINT ?? `http://localhost:${PORT}/smart/token`;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
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
  const { publicKey, privateKey } = generateKeyPair();
  app.use('/smart', createTokenServer({ clientId: SMART_CLIENT_ID, tokenEndpoint: SMART_TOKEN_ENDPOINT, clientPublicKey: publicKey }));
  const tokenClient = new SmartTokenClient({ clientId: SMART_CLIENT_ID, tokenEndpoint: SMART_TOKEN_ENDPOINT, privateKey });

  const fhirService = new FhirReadService(db, FHIR_BASE_URL, tokenClient);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/patients', createPatientsRouter(fhirService));
  // S2 — a second router on the same base path; the real runRiskAgent is the
  // default so no extra wiring is needed beyond mounting this route.
  // S4 A2 — `db` threads through so the route can read/write `analysis_cache`;
  // `orchestrate` is passed explicitly (not defaulted) since it now sits
  // before `db` in the parameter list.
  app.use('/api/patients', createAnalysisRouter(fhirService, orchestrate, db));
  // S5 A2 — Director-only population dashboard aggregates (W02).
  app.use('/api/population', createPopulationRouter(fhirService, db));

  app.listen(PORT, () => {
    console.log(`API listening on :${PORT}`);
  });
}

export default app;
