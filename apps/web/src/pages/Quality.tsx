import { useQuery } from '@tanstack/react-query';
import { getQualityMeasures } from '../api/client';
import { QualityGaugeChart } from '../components/QualityGaugeChart';

/**
 * W05/W07 Quality/HEDIS view (S11 A2) — rendered against
 * `reference-materials/caresync-quality-roi.html`'s structure (banner /
 * `#hedisChart` panel / AI-Identified Opportunity callout). This component
 * owns only the `.main` content region, same convention as `Governance.tsx`
 * — the mockup's header/nav-rail chrome is already the app's real shell
 * (`components/AppShell.tsx`).
 *
 * IMPORTANT — honest-staging deviations from the mockup (per CLAUDE.md gate
 * G4 / this repo's established discipline; see `Governance.tsx`'s own
 * deviation-note block for the exact model this follows):
 *
 * The mockup is a pitch-deck-style page full of fabricated financial
 * figures. Only ONE thing on it is real, computable data in this system: a
 * HEDIS-style measure built from two live FHIR counts (patients with a Type
 * 2 Diabetes Condition — ICD-10-CM E11.9 — vs. patients with an HbA1c
 * Observation on file — LOINC 4548-4). Everything else on the mockup is
 * either a fabricated number or an event that never happened, and is DROPPED
 * ENTIRELY rather than ported or re-fabricated:
 *
 * - `#donutChart` (cost-avoidance category breakdown: $624K/$318K/$187K/
 *   $111K) — invented categories with no backing ledger/claims data anywhere
 *   in this system.
 * - "Recent Prevented Cost Events" table (named patients — Robert Kim,
 *   Dorothy Chen, etc. — with specific dollar amounts for outcomes that never
 *   occurred) — fabricated specific clinical/financial events.
 * - "ROI Calculator" panel (assumed avoidable-admission-cost inputs) and its
 *   "$4.78M TOTAL PROJECTED ROI" — a fabricated financial model with no real
 *   admission-cost or avoidance data behind it.
 * - `#trendChart` (measure trend over time) — this system stores no
 *   historical/snapshot data, so there is no real trend to plot; faking one
 *   would misrepresent a single point-in-time count as a time series.
 * - The "HEDIS interim reporting" / "measurement period closes Dec 31"
 *   timeline — fabricated calendar events nobody configured.
 * - A second (e.g. depression-screening) measure: this system has a
 *   depression Condition (F33.1) but no paired screening-tool Observation, so
 *   a second measure would have to fabricate a screening event that never
 *   happened. One honest measure beats two, one of which is fake.
 *
 * What IS kept, rebuilt for real:
 * - The `#hedisChart` region → `QualityGaugeChart`, a single real gauge (not
 *   the mockup's multi-measure fabricated bar list) showing the real rate,
 *   numerator/denominator, and gap-patient count.
 * - The "AI-Identified Opportunity" callout → rewritten to cite the REAL
 *   `gapPatients` count (computed from live FHIR counts, not hardcoded) and a
 *   clearly-labeled illustrative incentive-dollar estimate (`gapPatients *
 *   $5,000/closed gap`, see `apps/api/src/quality/service.ts`'s
 *   `ILLUSTRATIVE_DOLLARS_PER_CLOSED_GAP` doc) — never presented as a real
 *   financial record, unlike the mockup's unlabeled "$2.3M"/"$4.78M" figures.
 */
export function Quality() {
  const measureQuery = useQuery({ queryKey: ['quality-measures'], queryFn: getQualityMeasures });

  const measure = measureQuery.data;
  const ratePercent = measure ? (measure.rate * 100).toFixed(1) : undefined;
  const incentiveDollars = measure?.illustrativeIncentiveDollars;

  return (
    <div>
      <h1 className="text-section text-text font-bold mb-4">Quality &amp; HEDIS Measures</h1>

      {measureQuery.isLoading && <p className="text-body text-text-muted">Loading quality measures…</p>}
      {measureQuery.isError && <p className="text-body text-red">Could not load the quality dashboard.</p>}

      {!measureQuery.isLoading && !measureQuery.isError && measure && (
        <div className="flex flex-col gap-2.5">
          {/* Banner — measure name + real rate as a big stat */}
          <section className="flex items-center gap-4 bg-surface-raised border border-border rounded-card px-4 py-3">
            <div className="flex flex-col min-w-0">
              <span className="text-body font-bold text-text">{measure.measureName}</span>
              <span className="text-xs text-text-muted mt-0.5">
                {measure.numerator} of {measure.denominator} diagnosed patients tested — derived from live FHIR data
              </span>
            </div>
            <span
              data-testid="quality-measure-rate"
              className="ml-auto text-title font-bold font-mono text-cyan whitespace-nowrap"
            >
              {ratePercent}%
            </span>
          </section>

          {/* HEDIS measure gauge (native Canvas, GD10) */}
          <section className="bg-surface border border-border rounded-card flex flex-col min-w-0">
            <div className="px-3.5 py-2.5 border-b border-border">
              <span className="text-body font-semibold text-text">HEDIS Measure Tracker</span>
              <div className="text-xs text-text-muted mt-0.5">
                Comprehensive Diabetes Care: HbA1c Testing — real numerator/denominator, no historical trend (no snapshot data exists)
              </div>
            </div>
            <div className="h-[100px] p-3.5" data-testid="quality-gauge-chart">
              <QualityGaugeChart
                rate={measure.rate}
                numerator={measure.numerator}
                denominator={measure.denominator}
                gapPatients={measure.gapPatients}
              />
            </div>

            {/* AI-Identified Opportunity callout — real gap count + illustrative, clearly-labeled incentive estimate */}
            <div className="mx-3.5 mb-3.5 flex items-start gap-2.5 bg-cyan-dim border border-cyan rounded-card px-3.5 py-3">
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-label font-bold text-text">AI-Identified Opportunity</span>
                <p className="text-label text-text-muted">
                  <span data-testid="quality-gap-count" className="font-bold text-text">
                    {measure.gapPatients}
                  </span>{' '}
                  patients have a Type 2 Diabetes diagnosis but no HbA1c test on file — the real, computed care gap this
                  measure exists to close.
                </p>
                <p className="text-xs text-text-dim">
                  Illustrative incentive dollars at stake (assumes $5,000 per closed care gap, not a real payer contract
                  figure):{' '}
                  <span data-testid="quality-incentive-estimate" className="font-bold text-amber">
                    ${incentiveDollars?.toLocaleString('en-US')}
                  </span>
                </p>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
