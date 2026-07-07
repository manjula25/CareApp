import Database from 'better-sqlite3';
import { migrate } from '../db';
import { AuthTokenPayload } from '../auth/jwt';
import { FhirReadService, TaskOwnershipEntry } from '../fhir/client';
import { DirectorOnlyError, getTeamPerformance } from './service';

const director: AuthTokenPayload = { id: 'dir-1', name: 'Dana Director', role: 'director' };
const coordinator: AuthTokenPayload = { id: 'coord-1', name: 'Cara Coordinator', role: 'coordinator' };
const socialWorker: AuthTokenPayload = { id: 'sw-1', name: 'Sam Socialworker', role: 'social_worker' };

function insertCoordinator(db: Database.Database, id: string, name: string): void {
  db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(
    id,
    `${id}@caresync.demo`,
    'not-a-real-hash',
    name,
    'coordinator'
  );
}

function stubFhirService(entries: TaskOwnershipEntry[]): FhirReadService {
  const getTaskOwnershipSummary = jest.fn().mockResolvedValue(entries);
  return { getTaskOwnershipSummary } as unknown as FhirReadService;
}

// S11 A3 — pure arithmetic over `getTaskOwnershipSummary`'s raw task/owner
// list, stubbed here so the aggregation math is unit-tested in isolation from
// any real HAPI call (the real-network shape is already covered by
// fhir/client.test.ts's getTaskOwnershipSummary suite).
describe('getTeamPerformance (S11 A3 — team performance aggregate, W04)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
  });

  it('computes per-coordinator assigned/completed counts and completion rate, plus unassigned/total/overall rate', async () => {
    insertCoordinator(db, 'coord-1', 'Cara Coordinator');
    insertCoordinator(db, 'coord-2', 'Cody Coordinator');

    const fhirService = stubFhirService([
      { taskId: 't1', status: 'completed', ownerCoordinatorId: 'coord-1' },
      { taskId: 't2', status: 'requested', ownerCoordinatorId: 'coord-1' },
      { taskId: 't3', status: 'requested', ownerCoordinatorId: 'coord-1' },
      { taskId: 't4', status: 'completed', ownerCoordinatorId: 'coord-2' },
      { taskId: 't5', status: 'requested' }, // unassigned
      { taskId: 't6', status: 'requested' }, // unassigned
    ]);

    const result = await getTeamPerformance(director, fhirService, db);

    expect(result.coordinators).toEqual(
      expect.arrayContaining([
        { coordinatorId: 'coord-1', name: 'Cara Coordinator', assignedCount: 3, completedCount: 1, completionRate: 1 / 3 },
        { coordinatorId: 'coord-2', name: 'Cody Coordinator', assignedCount: 1, completedCount: 1, completionRate: 1 },
      ])
    );
    expect(result.coordinators).toHaveLength(2);
    expect(result.unassignedCount).toBe(2);
    expect(result.totalTasks).toBe(6);
    expect(result.overallCompletionRate).toBe(2 / 6);
  });

  it('guards against divide-by-zero: a coordinator with 0 assigned tasks gets completionRate 0, not NaN', async () => {
    insertCoordinator(db, 'coord-1', 'Cara Coordinator');
    const fhirService = stubFhirService([]);

    const result = await getTeamPerformance(director, fhirService, db);

    expect(result.coordinators).toEqual([
      { coordinatorId: 'coord-1', name: 'Cara Coordinator', assignedCount: 0, completedCount: 0, completionRate: 0 },
    ]);
    expect(result.unassignedCount).toBe(0);
    expect(result.totalTasks).toBe(0);
    expect(result.overallCompletionRate).toBe(0);
  });

  it('returns an empty coordinators list when no coordinators are seeded, without crashing', async () => {
    const fhirService = stubFhirService([{ taskId: 't1', status: 'requested' }]);

    const result = await getTeamPerformance(director, fhirService, db);

    expect(result.coordinators).toEqual([]);
    expect(result.unassignedCount).toBe(1);
    expect(result.totalTasks).toBe(1);
  });

  it('denies a Coordinator (Director-only) and writes a denied audit row, without calling FHIR', async () => {
    insertCoordinator(db, 'coord-1', 'Cara Coordinator');
    const fhirService = stubFhirService([]);

    await expect(getTeamPerformance(coordinator, fhirService, db)).rejects.toBeInstanceOf(DirectorOnlyError);
    expect(fhirService.getTaskOwnershipSummary).not.toHaveBeenCalled();

    const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'coord-1', outcome: 'denied' });
  });

  it('denies a Social Worker (Director-only)', async () => {
    const fhirService = stubFhirService([]);
    await expect(getTeamPerformance(socialWorker, fhirService, db)).rejects.toBeInstanceOf(DirectorOnlyError);
    expect(fhirService.getTaskOwnershipSummary).not.toHaveBeenCalled();
  });
});
