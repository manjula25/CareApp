import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getAuditTrail, getModelPerformance, getParityMetrics, getEvalSummary } from '../api/client';
import { DemoFallbackBadge } from '../components/DemoFallbackBadge';
import { MOCK_AUDIT_TRAIL, MOCK_MODEL_PERFORMANCE, MOCK_PARITY } from '../lib/demoFallbacks';
import { averageConfidence } from '../lib/confidenceChartGeometry';
import { buildParityAxes } from '../lib/parityScore';
import { ConfidenceChart } from '../components/ConfidenceChart';
import { ParityRadarChart } from '../components/ParityRadarChart';
import { StatTile } from '../components/StatTile';

/**
 * W06 AI Governance Center (S8 Phase B) — real S8 A1-A3 aggregates rendered
 * against `reference-materials/caresync-governance.html`'s structure (banner
 * / zone 2 metric tiles / zone 3 three-column layout). This component owns
 * only the `.main` content region, same convention as `Population.tsx` — the
 * mockup's header/nav-rail chrome is already the app's real shell
 * (`components/AppShell.tsx`).
 *
 * Documented deviations from the mockup (per CLAUDE.md's UI rules /
 * html-mockup-fidelity skill — omit content the backend can't back yet
 * rather than ship inert chrome):
 * - Banner: dropped the "Model: CareSync-v2.3.1" chip (no model-version
 *   string is tracked anywhere — `getModelPerformance()` returns a version
 *   PER cached analysis, not one global "the model" version), "Regulatory
 *   Posture: ... Compliant" chip, and "Download Audit Report" button (no
 *   export endpoint exists). The one chip kept is an honest count of real
 *   audited events (`auditQuery.data.total`).
 * - Zone 2 tiles: "Analyses Run (30d)" (no time-windowed count exists;
 *   replaced with "Analyses Cached," a real, honestly-labeled count of
 *   `ModelPerformanceResult.analyses`). "Model Confidence (avg)" is real but
 *   approximated: the API only returns bucketed counts, not raw per-finding
 *   confidence values, so this is a count-weighted average of bucket
 *   midpoints (`confidenceChartGeometry.ts`'s `averageConfidence`, itself
 *   documented there) — renders "—" (not a fabricated 0%) whenever every
 *   bucket is empty, which is true today (no agent emits a confidence field
 *   yet — see `governance/service.ts`'s deviation note). "Flagged for
 *   Review" is real: the count of findings in the lowest (`0-0.5`) confidence
 *   bucket, same "auto-flagged" framing the mockup uses at a different
 *   threshold. "Demographic Parity Score" is replaced with a clearly-labeled
 *   average of the 4 real per-dimension parity values computed in
 *   `parityScore.ts` (also driving the radar below) — not the mockup's
 *   single fabricated 0.94.
 * - Column A (Audit Trail): real, from `getAuditTrail()`, most-recent-first,
 *   paged via limit/offset (Prev/Next). Renders only the real row shape
 *   (`ts`/`actor`/`action`/`resource`/`outcome`) — the mockup's per-entry
 *   patient name, natural-language recommendation text, FHIR citation, and
 *   confidence% don't exist on the real `audit_log` row and are not
 *   fabricated here.
 * - Column B (Model Performance): `ConfidenceChart` (real 4-bucket
 *   distribution) plus a raw `analyses` table (patientId/modelVersion/
 *   createdTs). Dropped entirely: "Agent Accuracy by Type" (no per-agent
 *   sensitivity/specificity/accuracy numbers exist anywhere in this system)
 *   and "Model Version History" (no version-history data exists) — both
 *   would be 100% fabricated if ported.
 * - Column C (Demographic Equity Monitor): `ParityRadarChart` (4 real axes —
 *   see `parityScore.ts`'s `buildParityAxes` doc for why Payer Type/
 *   Geography/Language were dropped rather than faked) plus the raw
 *   byAgeBand/bySex/byRace/byEthnicity group-stat tables. Dropped entirely:
 *   "Areas for Review" (hardcoded language/payer-type flags with no backing
 *   data) and "Compliance Attestations" (claiming formal HIPAA/FHIR-
 *   conformance "Compliant" status nobody has attested to).
 * - Zone 4 footer (framework badges + "Export Full Audit Log"): dropped
 *   entirely — no export endpoint, and framework-mapping claims are the same
 *   fabrication problem as the attestations above.
 * - Eval headline tile (S8 B2): calls `getEvalSummary()`. S9 (the JSON
 *   summary producer) doesn't exist on this branch, so `available` is always
 *   `false` today — rendered as a graceful, clearly-labeled empty state
 *   ("Evaluation report not yet available — coming with S9"), same
 *   `PlaceholderPanel` convention `Population.tsx` uses for its own
 *   not-yet-built panels, never a fabricated number.
 */

const AUDIT_PAGE_LIMIT = 20;

// The 4 fixed bucket ranges `governance/service.ts`'s CONFIDENCE_BUCKETS
// emits — the lowest one is the "unreliable, unfit to act on" band that
// service's own doc comment calls out, so it doubles as this tile's
// "Flagged for Review" definition (a real count, not a fabricated one).
const LOWEST_CONFIDENCE_BUCKET = '0-0.5';

function GroupStatTable({ title, groups }: { title: string; groups: { group: string; patientCount: number; avgRiskScore: number }[] }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-text-muted mb-1">{title}</div>
      {groups.length === 0 && <p className="text-xs text-text-dim italic">No populated groups.</p>}
      {groups.length > 0 && (
        <table className="w-full text-xs font-mono">
          <tbody>
            {groups.map((g) => (
              <tr key={g.group} className="border-t border-border">
                <td className="py-1 pr-2 text-text truncate max-w-[9rem]">{g.group}</td>
                <td className="py-1 pr-2 text-text-dim">n={g.patientCount}</td>
                <td className="py-1 text-text-muted text-right">avg risk {g.avgRiskScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Renders whatever headline field(s) make sense from the S9 JSON, defensively — S9's exact shape isn't defined yet, so this must not crash on an unexpected one. */
function EvalSummaryContent({ summary }: { summary: unknown }) {
  if (summary && typeof summary === 'object' && typeof (summary as Record<string, unknown>).headline === 'string') {
    return <p className="text-body text-text">{(summary as Record<string, unknown>).headline as string}</p>;
  }
  return <pre className="text-xs text-text-muted whitespace-pre-wrap break-words">{JSON.stringify(summary, null, 2)}</pre>;
}

export function Governance() {
  const [offset, setOffset] = useState(0);

  // Real implementation is primary. `MOCK_*` are SAFETY NETS only — they
  // fire when a query has errored AND we have no real data. The
  // `DemoFallbackBadge` makes the fallback visible. The audit query uses
  // `keepPreviousData` for pagination UX (the previous page should stay
  // mounted while the next offset's page is in flight), which is unrelated
  // to the demo fallback.
  const auditQuery = useQuery({
    queryKey: ['governance-audit', offset],
    queryFn: () => getAuditTrail(AUDIT_PAGE_LIMIT, offset),
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const modelQuery = useQuery({
    queryKey: ['governance-model'],
    queryFn: getModelPerformance,
    retry: 1,
  });
  const parityQuery = useQuery({
    queryKey: ['governance-parity'],
    queryFn: getParityMetrics,
    retry: 1,
  });
  const evalQuery = useQuery({ queryKey: ['governance-eval'], queryFn: getEvalSummary });

  const isLoading = auditQuery.isLoading || modelQuery.isLoading || parityQuery.isLoading;
  const isError = auditQuery.isError || modelQuery.isError || parityQuery.isError;
  const isUsingFallback = isError || auditQuery.isError;

  // Real data wins; mock fires only on error.
  const audit = auditQuery.isError ? MOCK_AUDIT_TRAIL : auditQuery.data;
  const model = modelQuery.isError ? MOCK_MODEL_PERFORMANCE : modelQuery.data;
  const parity = parityQuery.isError ? MOCK_PARITY : parityQuery.data;

  const avgConfidence = model ? averageConfidence(model.confidenceDistribution) : undefined;
  const flaggedCount = model?.confidenceDistribution.find((b) => b.range === LOWEST_CONFIDENCE_BUCKET)?.count ?? 0;
  const parityAxes = parity ? buildParityAxes(parity) : [];
  const avgParity = parityAxes.length > 0 ? parityAxes.reduce((sum, a) => sum + a.value, 0) / parityAxes.length : undefined;

  return (
    <div className="px-6 py-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-section text-text font-bold">AI Governance Center</h1>
        {isUsingFallback && <DemoFallbackBadge />}
      </div>

      {isLoading && <p className="text-body text-text-muted">Loading governance data…</p>}
      {isError && <p className="text-body text-red">Could not load the governance dashboard.</p>}

      {!isLoading && !isError && audit && model && parity && (
        <div className="flex flex-col gap-2.5">
          {/* ZONE 1 · banner */}
          <section className="flex items-center gap-2 bg-surface-raised border border-border rounded-card px-4 py-3">
            <span className="text-body font-bold text-text mr-auto">AI Governance Center</span>
            <span className="text-xs font-bold rounded-pill px-2.5 py-1 bg-cyan-dim border border-cyan text-cyan whitespace-nowrap">
              {audit.total} audited events
            </span>
          </section>

          {/* ZONE 2 · metric tiles */}
          <section className="grid grid-cols-4 gap-2.5">
            <StatTile testId="governance-tile-analyses-cached" label="Analyses Cached" value={String(model.analyses.length)} valueClassName="text-cyan" />
            <StatTile
              testId="governance-tile-confidence-avg"
              label="Model Confidence (avg)"
              value={avgConfidence === undefined ? '—' : `${Math.round(avgConfidence * 100)}%`}
              valueClassName="text-cyan"
              note={avgConfidence === undefined ? 'No confidence values reported yet' : undefined}
            />
            <StatTile
              testId="governance-tile-flagged"
              label="Flagged for Review"
              value={String(flaggedCount)}
              valueClassName="text-amber"
              note="Findings below 50% confidence"
            />
            <StatTile
              testId="governance-tile-parity-avg"
              label="Parity (avg of 4 derived scores)"
              value={avgParity === undefined ? '—' : avgParity.toFixed(2)}
              valueClassName="text-emerald"
              note="1.0 = perfect parity"
            />
          </section>

          {/* ZONE 3 · three columns */}
          <section className="flex-1 flex gap-2.5 min-h-0">
            {/* COLUMN A — Audit Trail */}
            <div className="flex-[1.2] bg-surface border border-border rounded-card flex flex-col min-w-0">
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
                <span className="text-body font-semibold text-text">Recommendation Audit Trail</span>
                <span className="text-xs text-text-muted ml-auto">Every FHIR read/write, most recent first</span>
              </div>
              <div className="flex-1 overflow-y-auto" data-testid="governance-audit-trail">
                {audit.entries.length === 0 && <p className="text-label text-text-dim italic px-3.5 py-3">No audit events yet.</p>}
                {audit.entries.map((entry, i) => (
                  <div key={`${entry.ts}-${i}`} className="px-3.5 py-2 border-b border-border last:border-b-0">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="font-mono text-xs text-text-dim flex-none">{entry.ts}</span>
                      <span className="text-label font-bold text-text flex-none">{entry.actor}</span>
                      <span className="text-xs font-bold uppercase tracking-wide text-text-muted flex-none">{entry.action}</span>
                      <span
                        className={`ml-auto text-xs font-bold uppercase tracking-wide flex-none ${
                          entry.outcome === 'success' ? 'text-emerald' : entry.outcome === 'denied' ? 'text-red' : 'text-amber'
                        }`}
                      >
                        {entry.outcome}
                      </span>
                    </div>
                    <div className="font-mono text-xs text-text-muted mt-0.5 truncate">{entry.resource}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between px-3.5 py-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setOffset((o) => Math.max(0, o - AUDIT_PAGE_LIMIT))}
                  disabled={offset === 0}
                  className="text-label text-cyan disabled:text-text-dim disabled:cursor-not-allowed hover:underline"
                >
                  Prev
                </button>
                <span className="text-xs text-text-dim">
                  {audit.entries.length === 0 ? 0 : offset + 1}-{offset + audit.entries.length} of {audit.total}
                </span>
                <button
                  type="button"
                  onClick={() => setOffset((o) => o + AUDIT_PAGE_LIMIT)}
                  disabled={offset + AUDIT_PAGE_LIMIT >= audit.total}
                  className="text-label text-cyan disabled:text-text-dim disabled:cursor-not-allowed hover:underline"
                >
                  Next
                </button>
              </div>
            </div>

            {/* COLUMN B — Model Performance */}
            <div className="flex-1 bg-surface border border-border rounded-card flex flex-col min-w-0">
              <div className="px-3.5 py-2.5 border-b border-border">
                <span className="text-body font-semibold text-text">Model Performance</span>
                <div className="text-xs text-text-muted mt-0.5">Confidence distribution ({model.analyses.length} cached analyses)</div>
              </div>
              <div className="flex-1 flex flex-col gap-2.5 p-3.5 min-h-0 overflow-y-auto">
                <div className="h-[140px] flex-none" data-testid="governance-confidence-chart">
                  <ConfidenceChart buckets={model.confidenceDistribution} />
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-text-muted mb-1">Cached Analyses</div>
                  {model.analyses.length === 0 && <p className="text-xs text-text-dim italic">No cached analyses yet.</p>}
                  {model.analyses.length > 0 && (
                    <table className="w-full text-xs font-mono">
                      <tbody>
                        {model.analyses.map((a) => (
                          <tr key={a.patientId} className="border-t border-border">
                            <td className="py-1 pr-2 text-text truncate">{a.patientId}</td>
                            <td className="py-1 pr-2 text-text-muted">{a.modelVersion}</td>
                            <td className="py-1 text-text-dim text-right">{a.createdTs}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* COLUMN C — Demographic Equity Monitor */}
            <div className="flex-1 bg-surface border border-border rounded-card flex flex-col min-w-0">
              <div className="px-3.5 py-2.5 border-b border-border">
                <span className="text-body font-semibold text-text">Demographic Equity Monitor</span>
                <div className="text-xs text-text-muted mt-0.5">Parity derived from real cached risk scores × HAPI demographics</div>
              </div>
              <div className="flex-1 flex flex-col gap-2.5 p-3.5 min-h-0 overflow-y-auto">
                <div className="h-[160px] flex-none" data-testid="governance-parity-chart">
                  <ParityRadarChart axes={parityAxes} />
                </div>
                <GroupStatTable title="By Age Band" groups={parity.byAgeBand} />
                <GroupStatTable title="By Sex" groups={parity.bySex} />
                <GroupStatTable title="By Race" groups={parity.byRace} />
                <GroupStatTable title="By Ethnicity" groups={parity.byEthnicity} />
              </div>
            </div>
          </section>

          {/* Eval headline tile (S8 B2) — separate, clearly-labeled panel. */}
          <section className="bg-surface border border-border rounded-card flex flex-col min-w-0" data-testid="governance-eval-tile">
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
              <span className="text-body font-semibold text-text">Evaluation Report (S9)</span>
            </div>
            <div className="px-3.5 py-3">
              {evalQuery.isLoading && <p className="text-label text-text-muted">Loading evaluation report…</p>}
              {evalQuery.isError && <p className="text-label text-red">Could not load the evaluation report.</p>}
              {!evalQuery.isLoading && !evalQuery.isError && evalQuery.data && !evalQuery.data.available && (
                <p className="text-label text-text-dim italic">Evaluation report not yet available — coming with S9.</p>
              )}
              {!evalQuery.isLoading && !evalQuery.isError && evalQuery.data?.available && (
                <EvalSummaryContent summary={evalQuery.data.summary} />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
