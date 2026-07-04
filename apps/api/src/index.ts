import express from 'express';
import cors from 'cors';
import { getDb } from './db';
import { createAuthRouter } from './routes/auth';
import { createPatientsRouter } from './routes/patients';
import { FhirReadService } from './fhir/client';

const FHIR_BASE_URL = process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

if (require.main === module) {
  const db = getDb();
  const fhirService = new FhirReadService(db, FHIR_BASE_URL);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/patients', createPatientsRouter(fhirService));

  const PORT = process.env.PORT ?? 4000;
  app.listen(PORT, () => {
    console.log(`API listening on :${PORT}`);
  });
}

export default app;
