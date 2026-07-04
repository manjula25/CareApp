import Database from 'better-sqlite3';
import { migrate } from '../db';
import { FhirReadService, ScopeDeniedError } from './client';
import { AuthTokenPayload } from '../auth/jwt';

const coordinator: AuthTokenPayload = { id: 'coord-1', name: 'Cara Coordinator', role: 'coordinator' };
const socialWorker: AuthTokenPayload = { id: 'sw-1', name: 'Sam Socialworker', role: 'social_worker' };

// Exercised against the real disposable HAPI container + seed data from
// apps/api/src/scripts/import-fhir.ts (Seam 1 reference pattern).
describe('FhirReadService', () => {
  let db: Database.Database;
  let service: FhirReadService;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    service = new FhirReadService(db, process.env.FHIR_BASE_URL ?? 'http://localhost:8080/fhir');
  });

  it('lets a Coordinator read Maria Chen conditions', async () => {
    const conditions = await service.getConditions(coordinator, 'maria-chen');
    expect(conditions.map((c) => c.display)).toEqual(
      expect.arrayContaining(['Heart failure, unspecified', 'Type 2 diabetes mellitus without complications'])
    );
  });

  it('denies a Social Worker reading non-SDOH conditions', async () => {
    await expect(service.getConditions(socialWorker, 'maria-chen')).rejects.toBeInstanceOf(ScopeDeniedError);
  });

  it('writes an audit row for every read, including denials', async () => {
    await service.getConditions(coordinator, 'maria-chen');
    await service.getConditions(socialWorker, 'maria-chen').catch(() => undefined);

    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actor: 'coord-1', outcome: 'success', fhir_resource: 'Condition/maria-chen' });
    expect(rows[1]).toMatchObject({ actor: 'sw-1', outcome: 'denied', fhir_resource: 'Condition/maria-chen' });
  });

  it('lets any role read basic patient demographics', async () => {
    const patient = await service.getPatient(socialWorker, 'maria-chen');
    expect(patient.name).toBe('Maria Chen');
  });

  it('returns the assigned panel with risk score and task count', async () => {
    const panel = await service.getAssignedPanel(coordinator);
    const maria = panel.find((p) => p.id === 'maria-chen');
    expect(maria).toMatchObject({ name: 'Maria Chen', riskScore: 87, taskCount: 2 });
    expect(panel.length).toBeGreaterThanOrEqual(6);
  });
});
