import { useQuery } from '@tanstack/react-query';
import { getPopulationScatter, getPopulationSummary } from '../api/client';
import { riskDotColor } from '../lib/patient';
import { PopulationScatterChart } from '../components/PopulationScatterChart';

/**
 * W02 Population Dashboard (Task B2) — real S5 aggregates rendered against
 * `reference-materials/caresync-population.html`'s structure. This
 * component owns only the `.main` content region (KPI bar + zone 2 + zone
 * 3); the mockup's header/left-nav-rail chrome is already the app's real
 * shell (`components/AppShell.tsx`) and isn't rebuilt here.
 *
 * Data comes from two independent Director-only aggregate endpoints (A2):
 * `getPopulationSummary()` for the two REQUIRED computed tiles (Critical
 * Zone, Cost Avoidance) and `getPopulationScatter()` for the risk(x) x
 * urgency(y) scatter. See the per-tile comments below for exactly which
 * numbers are real vs. honestly-derived vs. a labeled placeholder — nothing
 * here is a hardcoded stand-in for the mockup's demo numbers (23 / $247,400
 * / 847 / etc).
 *
 * Documented deviations from the mockup (per CLAUDE.md's UI rules /
 * html-mockup-fidelity skill — omit content the backend can't back yet
 * rather than ship inert chrome):
 * - No week-over-week trend line under any KPI tile: S5 has no historical
 *   snapshot to diff against, so a "+4 vs last week" figure would be
 *   fabricated. Omitted entirely rather than faked.
 * - "High Risk" / "Tasks Open" / "Readmissions Prevented (30d)" tiles: no
 *   population-wide task or readmission-outcome data exists yet in S5.
 *   "High Risk" is honestly derived from the real scatter (riskScore in the
 *   amber/red bands per `lib/patient.ts`'s `riskDotColor`); the other two
 *   are rendered as clearly-labeled "—" placeholders.
 * - Critical Zone panel (mockup's per-patient list with name/age/condition
 *   tags/days-since-contact): the population aggregate API returns only
 *   `{ id, riskScore, urgency, x, y }` per patient — no identity or
 *   condition data. Rendered as the top-N highest-risk points by id/score
 *   instead of fabricating names; the "View all" mockup link is inert
 *   (no target) since drill-in navigation is task B3, not this task.
 * - "Run Batch Analysis" / "Deploy All Agents" buttons: no backing batch
 *   endpoint exists in S5 — omitted rather than shipped as inert buttons.
 * - Care Team / HEDIS Progress / Activity Feed panels: chrome only, each
 *   marked "Coming in a later slice" — no team-assignment, quality-measure,
 *   or real-time-event data exists yet (S6+).
 * - Canvas glow-pulse overlay + hover tooltip, and the quadrant divider
 *   lines/labels, on the scatter: dropped — see `PopulationScatterChart.tsx`'s
 *   doc comment.
 */

const HIGH_RISK_BANDS = new Set(['red', 'amber']);

function formatCurrencyUSD(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function KpiTile({
  value,
  label,
  valueClassName = 'text-cyan',
  testId,
}: {
  value: string;
  label: string;
  valueClassName?: string;
  testId?: string;
}) {
  return (
    <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-center border-r border-border last:border-r-0" data-testid={testId}>
      <div className={`text-stat font-bold font-mono leading-tight ${valueClassName}`}>{value}</div>
      <div className="text-xs text-text-muted mt-0.5 truncate">{label}</div>
    </div>
  );
}

function PlaceholderPanel({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex-1 bg-surface border border-border rounded-card flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
        <span className="text-body font-semibold text-text">{title}</span>
        {badge && (
          <span className="ml-auto text-xs font-bold rounded-pill px-2 py-0.5 bg-surface-raised border border-border text-text-muted">
            {badge}
          </span>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center py-8">
        <p className="text-label text-text-dim italic">Coming in a later slice</p>
      </div>
    </div>
  );
}

export function Population() {
  const summaryQuery = useQuery({ queryKey: ['population-summary'], queryFn: getPopulationSummary });
  const scatterQuery = useQuery({ queryKey: ['population-scatter'], queryFn: getPopulationScatter });

  const isLoading = summaryQuery.isLoading || scatterQuery.isLoading;
  const isError = summaryQuery.isError || scatterQuery.isError;

  const summary = summaryQuery.data;
  const scatter = scatterQuery.data ?? [];

  const highRiskCount = scatter.filter((p) => HIGH_RISK_BANDS.has(riskDotColor(p.riskScore))).length;
  const totalPatients = summary?.teamKpis.totalPatients ?? scatter.length;

  const criticalList = [...scatter].sort((a, b) => b.riskScore - a.riskScore).slice(0, 8);

  return (
    <div>
      <h1 className="text-section text-text font-bold mb-4">Population Dashboard</h1>

      {isLoading && <p className="text-body text-text-muted">Loading population data…</p>}
      {isError && <p className="text-body text-red">Could not load the population dashboard.</p>}

      {!isLoading && !isError && summary && (
        <div className="flex flex-col gap-2.5">
          {/* ZONE 1 · KPI bar */}
          <section
            className="h-[88px] flex-none flex bg-surface border border-border rounded-card overflow-hidden"
            aria-label="Population summary"
          >
            <KpiTile testId="kpi-total-patients" value={String(totalPatients)} label="Total Patients" valueClassName="text-cyan" />
            <KpiTile
              testId="kpi-critical-zone"
              value={String(summary.criticalZoneCount)}
              label="Critical Zone"
              valueClassName="text-red"
            />
            <KpiTile testId="kpi-high-risk" value={String(highRiskCount)} label="High Risk" valueClassName="text-amber" />
            <KpiTile testId="kpi-tasks-open" value="—" label="Tasks Open (not yet available)" valueClassName="text-text-dim" />
            <KpiTile
              testId="kpi-readmissions-prevented"
              value="—"
              label="Readmissions Prevented (not yet available)"
              valueClassName="text-text-dim"
            />
            <KpiTile
              testId="kpi-cost-avoidance"
              value={formatCurrencyUSD(summary.projectedCostAvoidance)}
              label="Cost Avoidance (30d)"
              valueClassName="text-emerald"
            />
          </section>

          {/* ZONE 2 · scatter + critical zone list */}
          <section className="flex-[1.45] flex gap-2.5 min-h-0">
            <div className="flex-[1.4] bg-surface border border-border rounded-card flex flex-col min-w-0" data-testid="population-scatter-chart">
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
                <span className="text-body font-semibold text-text">Patient Risk Distribution</span>
                <span className="text-xs font-bold rounded-pill px-2 py-0.5 bg-surface-raised border border-border text-text-muted">
                  {scatter.length} plotted
                </span>
              </div>
              <div className="relative flex-1 min-h-[280px] m-1.5">
                <PopulationScatterChart points={scatter} />
              </div>
            </div>

            <div className="flex-1 bg-surface border border-border rounded-card flex flex-col min-w-0">
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
                <span className="text-body font-semibold text-text">Critical Zone</span>
                <span className="text-xs font-bold rounded-pill px-2 py-0.5 bg-red-dim border border-red text-red">
                  {summary.criticalZoneCount}
                </span>
              </div>
              <div className="flex-1 flex flex-col overflow-hidden">
                {criticalList.length === 0 && (
                  <p className="text-label text-text-dim italic px-3.5 py-3">No critical-zone patients plotted.</p>
                )}
                {criticalList.map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5 px-3.5 py-2 border-b border-border last:border-b-0">
                    <span className="flex-none w-8 h-5.5 rounded-chip grid place-items-center font-mono text-xs font-bold bg-red-dim border border-red text-red">
                      {p.riskScore}
                    </span>
                    {/* No name/condition/days-since-contact: not present in
                        the S5 population aggregate API (`ScatterPoint`) —
                        see this file's top-of-file deviation note. */}
                    <span className="flex-1 min-w-0 text-label text-text truncate font-mono">Patient/{p.id}</span>
                    <span className="flex-none text-xs text-text-muted font-mono">urg {p.urgency}</span>
                  </div>
                ))}
              </div>
              <div className="flex-none flex items-center justify-between px-3.5 py-2 border-t border-border">
                {/* Inert on purpose: drill-in navigation is task B3. */}
                <span className="text-label text-text-dim">View all {summary.criticalZoneCount} →</span>
              </div>
            </div>
          </section>

          {/* ZONE 3 · placeholder panels pending S6+ */}
          <section className="flex-1 flex gap-2.5 min-h-0">
            <PlaceholderPanel title="Care Team" />
            <PlaceholderPanel title="HEDIS Progress" badge="Q4 2026" />
            <PlaceholderPanel title="Activity Feed" />
          </section>
        </div>
      )}
    </div>
  );
}
