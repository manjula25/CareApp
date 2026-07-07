import Database from 'better-sqlite3';
import { AuthTokenPayload } from '../auth/jwt';
import { writeAudit } from '../db/audit';
import { DirectorOnlyError, FhirReadService } from '../fhir/client';

export { DirectorOnlyError };

/**
 * Director-only gate, mirroring quality/service.ts's own `assertDirector`
 * exactly (role check, denial audit, throw DirectorOnlyError) — a deliberate,
 * minimal duplicate of the same rule rather than an import, matching how
 * quality/service.ts itself duplicates governance/service.ts's version (see
 * that module's doc for why: the function is private to each module).
 */
function assertDirector(actor: AuthTokenPayload, db: Database.Database, resource: string): void {
  if (actor.role !== 'director') {
    writeAudit(db, { actor: actor.id, action: 'read', fhirResource: resource, outcome: 'denied' });
    throw new DirectorOnlyError(actor.role, 'access team performance aggregates');
  }
}

export interface CoordinatorWorkload {
  coordinatorId: string;
  name: string;
  assignedCount: number;
  completedCount: number;
  completionRate: number; // completedCount/assignedCount, 0 if assignedCount is 0
}

export interface TeamPerformanceResult {
  coordinators: CoordinatorWorkload[];
  unassignedCount: number; // tasks with no owner at all
  totalTasks: number;
  overallCompletionRate: number; // completed / total, 0 if total is 0
}

interface CoordinatorRow {
  id: string;
  name: string;
}

/**
 * S11 A3 — team performance aggregate (W04): coordinator workload,
 * completion rates, and unassigned-task count. Director-only
 * (`assertDirector` above), matching Population's/Governance's/Quality's own
 * cross-patient aggregates.
 *
 * Computes live from whatever the real Task state is at request time — same
 * convention as every other aggregate in this codebase (Population,
 * Governance, Quality all compute live, not from a static snapshot). This
 * demo's seeded panel carries exactly one coordinator and 7 real Tasks, all
 * currently unassigned/`requested` (no frontend UI calls the S6 A1 assign
 * endpoint yet) — so a fresh run honestly shows 0 assigned/0 completed/N
 * unassigned until an assignment/completion actually happens live. That is
 * correct, expected behavior, not a bug: this function does not fabricate
 * placeholder team members or activity to make the aggregate look "fuller."
 *
 * "Gate -> read -> transform" shape, matching quality/service.ts's
 * `getDiabetesHba1cMeasure`: the actual FHIR I/O lives in
 * `FhirReadService.getTaskOwnershipSummary`, this function only gates, joins
 * against the app's own `users` table (coordinators), and aggregates.
 */
export async function getTeamPerformance(
  actor: AuthTokenPayload,
  fhirService: FhirReadService,
  db: Database.Database
): Promise<TeamPerformanceResult> {
  assertDirector(actor, db, 'Population/team-performance');

  const coordinatorRows = db.prepare('SELECT id, name FROM users WHERE role = ?').all('coordinator') as CoordinatorRow[];
  const tasks = await fhirService.getTaskOwnershipSummary(actor);

  const coordinators: CoordinatorWorkload[] = coordinatorRows.map((row) => {
    const ownedTasks = tasks.filter((t) => t.ownerCoordinatorId === row.id);
    const assignedCount = ownedTasks.length;
    const completedCount = ownedTasks.filter((t) => t.status === 'completed').length;
    const completionRate = assignedCount > 0 ? completedCount / assignedCount : 0;
    return { coordinatorId: row.id, name: row.name, assignedCount, completedCount, completionRate };
  });

  const unassignedCount = tasks.filter((t) => t.ownerCoordinatorId === undefined).length;
  const totalTasks = tasks.length;
  const totalCompleted = tasks.filter((t) => t.status === 'completed').length;
  const overallCompletionRate = totalTasks > 0 ? totalCompleted / totalTasks : 0;

  return { coordinators, unassignedCount, totalTasks, overallCompletionRate };
}
