import { useQuery } from '@tanstack/react-query';
import { getTeamPerformance } from '../api/client';
import { DemoFallbackBadge } from '../components/DemoFallbackBadge';
import { MOCK_TEAM } from '../lib/demoFallbacks';
import type { CoordinatorWorkload } from '../api/client';
import { StatTile } from '../components/StatTile';

/**
 * W04 Team performance view (S11 A3) — no matching reference mockup exists
 * for this screen, so it's built to HANDOFF.md §4's design tokens and the
 * Tailwind class vocabulary already established by `Governance.tsx`/
 * `Quality.tsx` (bg-surface/border-border/rounded-card/rounded-pill/stat-tile
 * layout), not a new visual language. Computes live from the real Task
 * ownership/status returned by `GET /api/team/performance` at request time —
 * an empty coordinator list or all-zero counts is an honest reflection of
 * current demo state, not a bug.
 */

function CoordinatorRow({ coordinator }: { coordinator: CoordinatorWorkload }) {
  const percent = Math.round(coordinator.completionRate * 1000) / 10;
  return (
    <div
      data-testid="team-coordinator-row"
      className="px-3.5 py-2.5 border-b border-border last:border-b-0 flex items-center gap-4"
    >
      <span className="text-body font-semibold text-text flex-1 min-w-0 truncate">{coordinator.name}</span>
      <span className="text-label text-text-muted w-24 flex-none text-right">{coordinator.assignedCount} assigned</span>
      <span className="text-label text-text-muted w-24 flex-none text-right">{coordinator.completedCount} completed</span>
      <div className="flex items-center gap-2 w-40 flex-none">
        <div className="flex-1 h-2 rounded-pill bg-surface-raised border border-border overflow-hidden">
          <div className="h-full bg-cyan rounded-pill" style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
        <span className="text-label font-mono text-text w-14 flex-none text-right">{percent.toFixed(1)}%</span>
      </div>
    </div>
  );
}

export function Team() {
  // Real implementation is primary. `MOCK_TEAM` is a SAFETY NET only —
  // kicks in when the query has errored AND we have no real data. The
  // `DemoFallbackBadge` makes the fallback visible.
  const performanceQuery = useQuery({
    queryKey: ['team-performance'],
    queryFn: getTeamPerformance,
    retry: 1,
  });
  const isUsingFallback = performanceQuery.isError;
  const performance = performanceQuery.isError ? MOCK_TEAM : performanceQuery.data;
  const overallPercent = performance ? (Math.round(performance.overallCompletionRate * 1000) / 10).toFixed(1) : undefined;

  const noCoordinators = performance !== undefined && performance.coordinators.length === 0;
  const allZeroActivity =
    performance !== undefined &&
    performance.coordinators.length > 0 &&
    performance.coordinators.every((c) => c.assignedCount === 0) &&
    performance.totalTasks > 0;

  return (
    <div className="px-6 py-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-section text-text font-bold">Team Performance</h1>
        {isUsingFallback && <DemoFallbackBadge />}
      </div>

      {performanceQuery.isLoading && <p className="text-body text-text-muted">Loading team performance…</p>}
      {performanceQuery.isError && <p className="text-body text-red">Could not load the team performance dashboard.</p>}

      {!performanceQuery.isLoading && !performanceQuery.isError && performance && (
        <div className="flex flex-col gap-2.5">
          {/* Summary stat row */}
          <section className="grid grid-cols-3 gap-2.5">
            <StatTile testId="team-summary-total-tasks" label="Total Tasks" value={String(performance.totalTasks)} valueClassName="text-cyan" />
            <StatTile testId="team-summary-unassigned" label="Unassigned" value={String(performance.unassignedCount)} valueClassName="text-amber" />
            <StatTile testId="team-summary-completion-rate" label="Overall Completion Rate" value={`${overallPercent}%`} valueClassName="text-emerald" />
          </section>

          {/* Per-coordinator workload */}
          <section className="bg-surface border border-border rounded-card flex flex-col min-w-0">
            <div className="px-3.5 py-2.5 border-b border-border">
              <span className="text-body font-semibold text-text">Coordinator Workload</span>
              <div className="text-xs text-text-muted mt-0.5">
                Assigned/completed counts and completion rate, computed live from real Task ownership
              </div>
            </div>

            {noCoordinators && (
              <p className="text-label text-text-dim italic px-3.5 py-3">No coordinators are currently seeded.</p>
            )}

            {!noCoordinators && allZeroActivity && (
              <p className="text-label text-text-dim italic px-3.5 py-3">
                No tasks currently assigned to any coordinator — all {performance.totalTasks} task
                {performance.totalTasks === 1 ? ' is' : 's are'} unassigned.
              </p>
            )}

            {!noCoordinators &&
              performance.coordinators.map((coordinator) => (
                <CoordinatorRow key={coordinator.coordinatorId} coordinator={coordinator} />
              ))}
          </section>
        </div>
      )}
    </div>
  );
}
