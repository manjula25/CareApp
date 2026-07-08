import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPopulationScatter, getPopulationSummary, type ScatterPoint } from '../api/client';
import type { Patient } from '../types';
import { MOCK_PATIENTS, CRITICAL_RISK_THRESHOLD, HIGH_RISK_THRESHOLD } from './Population.fixtures';
// S12 B.2 — reapply demo-fallback wiring on top of PR #14's lead-port.
import { DemoFallbackBadge } from '../components/DemoFallbackBadge';

/**
 * Phase 2 of the lead-project integration: `Population.tsx` is now lead's
 * `pages/director/PopulationDashboard.tsx` (602 lines) — two-column
 * director-overview layout (40% patient list + 60% KPI + scatter) — adapted
 * to:
 *   - my real `getPopulationScatter()` + `getPopulationSummary()` APIs
 *     (lead's `/api/population/patients` doesn't exist on my backend)
 *   - my `ScatterPoint` shape (id, riskScore, urgency, x, y) instead of
 *     lead's `Patient` (no name/MRN/conditions/days-since-contact on the
 *     scatter endpoint, so the real-mode list row shows `Patient/{id}` +
 *     urgency instead of name + condition chip)
 *   - my `/patients/:id` route (not lead's `/director/patients/:id`)
 *
 * Honest-staging notes (mirroring my pre-port documented deviations):
 *   - "Active Tasks" KPI tile has no real source — rendered as "—" with
 *     a clearly-labeled `not yet available` subtext (not the mockup's
 *     hardcoded "64 open").
 *   - Scatter axes are risk(x) × urgency(y) (my S5 schema), not lead's
 *     days-since-contact × risk-score (their mock schema). The critical
 *     threshold line stays at riskScore = 75 (matches my backend's
 *     `CRITICAL_RISK_THRESHOLD` and the lead's "Critical" line position).
 *   - Patient list in real mode shows `Patient/{id}` + urgency instead of
 *     name + conditions + days-since-contact — `ScatterPoint` doesn't carry
 *     those fields. Mock fallback restores the richer row shape from
 *     `MOCK_PATIENTS`.
 *   - The previous quadrant-drill-in (`/population/patients`) is removed;
 *     dot click navigates straight to `/patients/:id` (matches lead's UX
 *     and the demo flow). `pages/PopulationPatientList.tsx` becomes dead
 *     code but is left in place for any slice that wants to revive it.
 *   - Search filters by `id` substring in real mode, by `id`/`name`/`mrn`/
 *     `conditions` in mock fallback (matches the lead's search affordance
 *     against the data the source actually has).
 */

type FilterTab = 'All' | 'Critical' | 'High Risk';

/** Unified row shape for the left-rail patient list. Real-mode rows have only
 *  the scatter fields populated; mock-fallback rows carry the full Patient
 *  shape so the row UI can render name + conditions + days-since-contact. */
interface DisplayPatient {
  id: string;
  riskScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  urgency?: number;
  name?: string;
  mrn?: string;
  conditions?: string[];
  daysSinceContact?: number;
}

function deriveRiskLevel(score: number): DisplayPatient['riskLevel'] {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function formatCurrencyUSD(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  badgeColor: 'cyan' | 'red' | 'emerald' | 'amber';
  badgeLabel: string;
  testId?: string;
}

function KpiCard({ label, value, badgeColor, badgeLabel, testId }: KpiCardProps) {
  const colorMap: Record<string, { text: string; bg: string }> = {
    cyan: { text: 'text-cyan', bg: 'bg-cyan-dim' },
    red: { text: 'text-red', bg: 'bg-red-dim' },
    emerald: { text: 'text-emerald', bg: 'bg-emerald-dim' },
    amber: { text: 'text-amber', bg: 'bg-amber-dim' },
  };
  const colors = colorMap[badgeColor];
  return (
    <div className="bg-surface-raised border border-border rounded-xl p-4 flex flex-col gap-2 min-w-0" data-testid={testId}>
      <span className="text-text-muted text-sm leading-tight">{label}</span>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-2xl font-bold ${colors.text}`}>{value}</span>
        <span className={`${colors.bg} ${colors.text} text-xs font-semibold px-2 py-0.5 rounded-full`}>
          {badgeLabel}
        </span>
      </div>
    </div>
  );
}

// ── Risk Scatter Chart ───────────────────────────────────────────────────────

interface RiskScatterChartProps {
  points: DisplayPatient[];
  onDotClick: (id: string) => void;
}

function RiskScatterChart({ points, onDotClick }: RiskScatterChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotAreasRef = useRef<Array<{ x: number; y: number; r: number; id: string }>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const W = rect.width;
    const H = rect.height;
    const padLeft = 44;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 44;
    const chartW = W - padLeft - padRight;
    const chartH = H - padTop - padBottom;

    // Compute dot hit-test positions FIRST (independent of `getContext`
    // support — jsdom returns null from `getContext`, so we can't paint
    // there, but the click handler only needs the in-memory dot positions
    // to be populated for tests + user clicks to work). This split also
    // keeps the test harness free of canvas-implementation deps.
    const newDotAreas: Array<{ x: number; y: number; r: number; id: string }> = [];
    const DOT_R = 7;
    points.forEach((p) => {
      const score = Math.min(Math.max(p.riskScore, 0), 100);
      const urg = p.urgency ?? p.riskScore;
      const yVal = Math.min(Math.max(urg, 0), 100);
      const dx = padLeft + (score / 100) * chartW;
      const dy = padTop + ((100 - yVal) / 100) * chartH;
      newDotAreas.push({ x: dx, y: dy, r: DOT_R, id: p.id });
    });
    dotAreasRef.current = newDotAreas;

    // Now paint to the canvas if a 2D context is actually available (skipped
    // under jsdom / SSR — the dots are still clickable above).
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0C1829';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#1A3450';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gx = padLeft + (i / 4) * chartW;
      ctx.beginPath();
      ctx.moveTo(gx, padTop);
      ctx.lineTo(gx, padTop + chartH);
      ctx.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const gy = padTop + (i / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(padLeft, gy);
      ctx.lineTo(padLeft + chartW, gy);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = '#244A6A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, padTop + chartH);
    ctx.lineTo(padLeft + chartW, padTop + chartH);
    ctx.stroke();

    // Tick labels
    ctx.fillStyle = '#5A8FAA';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ['0', '25', '50', '75', '100'].forEach((lbl, i) => {
      const tx = padLeft + (i / 4) * chartW;
      ctx.fillText(lbl, tx, padTop + chartH + 16);
    });
    ctx.fillText('Risk Score', padLeft + chartW / 2, padTop + chartH + 34);

    ctx.textAlign = 'right';
    ['0', '25', '50', '75', '100'].forEach((lbl, i) => {
      const ty = padTop + chartH - (i / 4) * chartH;
      ctx.fillText(lbl, padLeft - 8, ty + 4);
    });
    ctx.save();
    ctx.translate(12, padTop + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Urgency', 0, 0);
    ctx.restore();

    // Critical threshold dashed line at riskScore = 75 (vertical x-axis split)
    const thresholdX = padLeft + (CRITICAL_RISK_THRESHOLD / 100) * chartW;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(232, 72, 72, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(thresholdX, padTop);
    ctx.lineTo(thresholdX, padTop + chartH);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(232, 72, 72, 0.6)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Critical ≥ 75', thresholdX + 4, padTop + 12);

    // Dots (re-derive positions rather than reuse dotAreasRef, which is the
    // hit-test source — keeps paint and hit-test fully independent).
    points.forEach((p) => {
      const score = Math.min(Math.max(p.riskScore, 0), 100);
      const urg = p.urgency ?? p.riskScore;
      const yVal = Math.min(Math.max(urg, 0), 100);
      const dx = padLeft + (score / 100) * chartW;
      const dy = padTop + ((100 - yVal) / 100) * chartH;
      const isCritical = p.riskLevel === 'critical';
      const color = isCritical ? '#E84848' : p.riskLevel === 'high' ? '#F0970A' : '#0FC48A';

      ctx.save();
      if (isCritical) {
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#E84848';
      }
      ctx.beginPath();
      ctx.arc(dx, dy, DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(dx, dy, DOT_R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }, [points]);

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let closest: { x: number; y: number; r: number; id: string } | null = null;
    let minDist = 10;

    for (const dot of dotAreasRef.current) {
      const dist = Math.sqrt((mx - dot.x) ** 2 + (my - dot.y) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closest = dot;
      }
    }

    if (closest) onDotClick(closest.id);
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-[400px] rounded-xl cursor-crosshair"
      style={{ display: 'block' }}
      onClick={handleCanvasClick}
      data-testid="population-scatter-canvas"
    />
  );
}

// ── Patient Row ──────────────────────────────────────────────────────────────

interface PatientRowProps {
  patient: DisplayPatient;
  onClick: () => void;
}

function riskBadgeClass(level: DisplayPatient['riskLevel']): string {
  switch (level) {
    case 'critical': return 'bg-red text-white';
    case 'high': return 'bg-amber text-bg';
    case 'medium': return 'text-amber border border-amber bg-transparent';
    case 'low': return 'bg-emerald text-bg';
  }
}

function PatientRow({ patient, onClick }: PatientRowProps) {
  const hasRichData = patient.name !== undefined;
  return (
    <button
      onClick={onClick}
      data-testid={`patient-row-${patient.id}`}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors text-left border-b border-border last:border-b-0"
    >
      <div
        className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold tabular-nums ${riskBadgeClass(patient.riskLevel)}`}
      >
        {patient.riskScore}
      </div>
      <div className="flex-1 min-w-0">
        {hasRichData ? (
          <>
            <div className="text-text font-medium text-sm truncate">{patient.name}</div>
            <div className="text-text-muted text-xs truncate mt-0.5">{patient.conditions?.join(', ')}</div>
          </>
        ) : (
          <>
            <div className="text-text font-mono text-sm truncate">Patient/{patient.id}</div>
            <div className="text-text-muted text-xs truncate mt-0.5">urgency {patient.urgency}</div>
          </>
        )}
      </div>
      {patient.daysSinceContact !== undefined && (
        <div className="flex-shrink-0 text-xs font-semibold text-text-dim bg-surface-raised border border-border rounded-md px-2 py-1 whitespace-nowrap">
          {patient.daysSinceContact}d
        </div>
      )}
    </button>
  );
}

// ── Skeleton rows for loading ────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3 animate-pulse border-b border-border last:border-b-0"
        >
          <div className="w-10 h-10 rounded-lg bg-surface-raised flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-surface-raised rounded w-3/5" />
            <div className="h-2.5 bg-surface-raised rounded w-4/5" />
          </div>
          <div className="w-8 h-6 bg-surface-raised rounded flex-shrink-0" />
        </div>
      ))}
    </>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function Population() {
  const navigate = useNavigate();

  const scatterQuery = useQuery({
    queryKey: ['population-scatter'],
    queryFn: getPopulationScatter,
  });
  const summaryQuery = useQuery({
    queryKey: ['population-summary'],
    queryFn: getPopulationSummary,
  });

  /**
   * Mock fallback chain for the patient list + scatter data: real scatter
   * wins; on reject / empty we fall back to MOCK_PATIENTS (synthetic urgency =
   * riskScore so dots plot on the diagonal). The fallback only kicks in when
   * the entire fetch is unusable — a partial scatter still wins over mocks.
   */
  const usingMockFallback =
    !!scatterQuery.isError ||
    !scatterQuery.data ||
    scatterQuery.data.length === 0;

  const displayPatients: DisplayPatient[] = useMemo(() => {
    if (!usingMockFallback && scatterQuery.data) {
      return scatterQuery.data.map((p: ScatterPoint) => ({
        id: p.id,
        riskScore: p.riskScore,
        riskLevel: deriveRiskLevel(p.riskScore),
        urgency: p.urgency,
      }));
    }
    return MOCK_PATIENTS.map((p: Patient) => ({
      id: p.id,
      name: p.name,
      mrn: p.mrn,
      conditions: p.conditions,
      daysSinceContact: p.daysSinceContact,
      riskScore: p.riskScore,
      riskLevel: p.riskLevel,
      urgency: p.riskScore,
    }));
  }, [scatterQuery.data, usingMockFallback]);

  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [search, setSearch] = useState('');

  const filterTabs: FilterTab[] = ['All', 'Critical', 'High Risk'];

  const filtered = useMemo(() => {
    return displayPatients.filter((p) => {
      const matchesFilter =
        activeFilter === 'All' ||
        (activeFilter === 'Critical' && p.riskScore >= CRITICAL_RISK_THRESHOLD) ||
        (activeFilter === 'High Risk' && p.riskScore >= HIGH_RISK_THRESHOLD);

      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        p.id.toLowerCase().includes(q) ||
        (p.name?.toLowerCase().includes(q) ?? false) ||
        (p.mrn?.toLowerCase().includes(q) ?? false) ||
        (p.conditions?.some((c) => c.toLowerCase().includes(q)) ?? false);

      return matchesFilter && matchesSearch;
    });
  }, [displayPatients, activeFilter, search]);

  // KPI source-of-truth: prefer real summary; fall back to derived counts
  // from the loaded scatter, and finally to zero/placeholder values.
  const totalPatients =
    summaryQuery.data?.teamKpis.totalPatients ?? displayPatients.length;
  const criticalCount =
    summaryQuery.data?.criticalZoneCount ??
    displayPatients.filter((p) => p.riskScore >= CRITICAL_RISK_THRESHOLD).length;
  const costAvoidance = summaryQuery.data?.projectedCostAvoidance ?? 0;

  const isLoading = scatterQuery.isLoading || summaryQuery.isLoading;

  return (
    <div className="flex h-[calc(100vh-48px)] overflow-hidden bg-bg flex-col">
      {/* S12 B.2 — fallback safety net: when the scatter endpoint is unreachable,
          surface the DemoFallbackBadge at the top of the page so a judge never
          sees a "Demo mode" notice without a visible indicator. (PR #14
          already has the usingMockFallback text notice below the scatter.) */}
      {usingMockFallback && (
        <div className="flex items-center gap-2 px-6 py-2 border-b border-border bg-surface-raised">
          <DemoFallbackBadge />
          <span className="text-text-dim text-xs">Real scatter endpoint unreachable — showing 8-patient demo list.</span>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
      {/* LEFT — Patient list */}
      <aside
        className="flex flex-col border-r border-border bg-surface overflow-hidden"
        style={{ width: '40%', minWidth: 280 }}
        data-testid="population-patient-list"
      >
        <div className="px-4 pt-5 pb-3 border-b border-border flex-shrink-0">
          <h2 className="text-text font-semibold text-base mb-3">Patients</h2>

          <input
            type="text"
            placeholder="Search id, name, MRN, condition…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="patient-search"
            className="w-full bg-surface border border-border-light text-text placeholder:text-text-dim rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan transition-colors mb-3"
          />

          <div className="flex gap-2">
            {filterTabs.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                data-testid={`filter-${f.toLowerCase().replace(' ', '-')}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  activeFilter === f
                    ? 'bg-cyan text-bg'
                    : 'bg-surface-raised text-text-muted hover:text-text'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto" data-testid="patient-list-body">
          {isLoading ? (
            <SkeletonRows />
          ) : filtered.length === 0 ? (
            <p className="text-text-muted text-sm text-center mt-10 px-4" data-testid="patient-list-empty">
              No patients match your filters.
            </p>
          ) : (
            filtered.map((p) => (
              <PatientRow
                key={p.id}
                patient={p}
                onClick={() => navigate(`/patients/${p.id}`)}
              />
            ))
          )}
        </div>
      </aside>

      {/* RIGHT — KPIs + scatter */}
      <main className="flex-1 flex flex-col overflow-y-auto p-6 gap-6 min-w-0">
        <section data-testid="kpi-section">
          <h2 className="text-text-muted text-xs font-semibold uppercase tracking-widest mb-3">
            Program Overview
          </h2>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <KpiCard
              testId="kpi-total-patients"
              label="Total Patients"
              value={String(totalPatients)}
              badgeColor="cyan"
              badgeLabel="total"
            />
            <KpiCard
              testId="kpi-critical-zone"
              label="Critical Zone"
              value={String(criticalCount)}
              badgeColor="red"
              badgeLabel="urgent"
            />
            <KpiCard
              testId="kpi-tasks-open"
              label="Tasks Open"
              value="—"
              badgeColor="cyan"
              badgeLabel="not yet available"
            />
            <KpiCard
              testId="kpi-cost-avoidance"
              label="Cost Avoidance (30d)"
              value={formatCurrencyUSD(costAvoidance)}
              badgeColor="emerald"
              badgeLabel="saved"
            />
          </div>
        </section>

        <section className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3" data-testid="population-scatter-section">
          <div className="flex items-center justify-between flex-shrink-0">
            <h2 className="text-text font-semibold text-sm">Risk Distribution</h2>
            <div className="flex items-center gap-4 text-xs text-text-muted">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red" />
                Critical
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber" />
                High
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald" />
                Med / Low
              </span>
            </div>
          </div>

          <RiskScatterChart points={filtered} onDotClick={(id) => navigate(`/patients/${id}`)} />

          <p className="text-text-dim text-xs text-center flex-shrink-0">
            {usingMockFallback
              ? 'Demo mode — showing hardcoded patients (real scatter endpoint unreachable).'
              : 'Click any dot to open the patient record'}
          </p>
        </section>

        {usingMockFallback && !isLoading && (
          <p className="text-text-dim text-xs italic" data-testid="mock-fallback-notice">
            Scatter endpoint unavailable — rendering the 8-patient demo list.
          </p>
        )}
      </main>
    </div>
      </div>
  );
}