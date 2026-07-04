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

  it('lets a Coordinator read Maria Chen tasks with title, priority, and due date', async () => {
    const tasks = await service.getTasks(coordinator, 'maria-chen');
    expect(tasks).toHaveLength(2);
    const medrec = tasks.find((t) => t.id === 'maria-chen-task-medrec');
    expect(medrec).toMatchObject({ title: 'Medication reconciliation follow-up', priority: 'high', status: 'Open' });
    expect(new Date(medrec!.due).toString()).not.toBe('Invalid Date');
    expect(tasks.map((t) => t.priority)).toEqual(expect.arrayContaining(['high', 'medium']));
  });

  it('denies a Social Worker reading tasks (non-SDOH clinical read)', async () => {
    await expect(service.getTasks(socialWorker, 'maria-chen')).rejects.toBeInstanceOf(ScopeDeniedError);
  });

  it('returns the assigned panel with risk score, task count, and list-row display fields', async () => {
    const panel = await service.getAssignedPanel(coordinator);
    const maria = panel.find((p) => p.id === 'maria-chen');
    expect(maria).toMatchObject({
      name: 'Maria Chen',
      riskScore: 87,
      taskCount: 2,
      gender: 'female',
      birthDate: '1958-04-12',
    });
    expect(maria!.conditionTags).toEqual(expect.arrayContaining(['CHF', 'Diabetes']));
    expect(maria!.conditionTags.length).toBeLessThanOrEqual(2);
    expect(panel.length).toBeGreaterThanOrEqual(6);
  });
});

describe('FhirReadService with a SMART token client', () => {
  it('attaches the SMART access token as a Bearer header on every HAPI call', async () => {
    const db = new Database(':memory:');
    migrate(db);
    const tokenClient = { getAccessToken: jest.fn().mockResolvedValue('smart-access-token') };
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ resourceType: 'Patient', id: 'maria-chen', name: [{ given: ['Maria'], family: 'Chen' }] }),
    } as Response);

    const service = new FhirReadService(db, 'http://localhost:8080/fhir', tokenClient);
    await service.getPatient(coordinator, 'maria-chen');

    expect(tokenClient.getAccessToken).toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer smart-access-token');
    fetchSpy.mockRestore();
  });
});
