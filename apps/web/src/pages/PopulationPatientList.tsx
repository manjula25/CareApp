import { useLocation, Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { getPatient } from '../api/client';
import { ageSexLabel, riskDotColor, RISK_DOT_CLASS } from '../lib/patient';
import { ChevronRightIcon } from '../icons';
import type { PopulationPatientListState } from './Population';

/**
 * B3 drill-in destination: the (bounded, typically <100) patient ids a
 * quadrant click on the population scatter filtered down to
 * (`Population.tsx`'s `handleQuadrantClick`), rendered as a list in the same
 * visual idiom as `PatientPanel.tsx`'s rows (dot + name/age-sex + risk score,
 * linking to `/patients/:id`). The row markup is duplicated here rather than
 * imported from `PatientPanel` — that component is Coordinator-panel-specific
 * (`getAssignedPanel()`), and this page's data source (per-id `getPatient`
 * fanned out from a Director-only quadrant filter) is unrelated; coupling
 * them would tie two different call sites to one component for no shared
 * benefit.
 *
 * No new backend endpoint: reuses the existing `getPatient(id)` call
 * (`/api/patients/:id`, already used by `PatientDetail`) once per id, in
 * parallel via `useQueries` so one failed fetch doesn't take down the whole
 * list (TanStack Query gives per-query `isError`/`isLoading`, unlike a single
 * `Promise.all`). `riskScore` isn't in `getPatient`'s response (see
 * `PatientDetail` in `api/client.ts`), so it's carried in `state` from the
 * scatter data instead of being re-fetched or faked.
 */
export function PopulationPatientList() {
  const location = useLocation();
  const state = location.state as PopulationPatientListState | null | undefined;
  const patientIds = state?.patientIds ?? [];

  const patientQueries = useQueries({
    queries: patientIds.map((id) => ({
      // Same queryKey convention as `PatientDetail.tsx` (`['patient', id]`) —
      // clicking through to `/patients/:id` from this list reuses the cache
      // entry this page just warmed instead of re-fetching.
      queryKey: ['patient', id],
      queryFn: () => getPatient(id),
    })),
  });

  return (
    <div className="max-w-2xl">
      <Link to="/population" className="text-label text-cyan hover:underline">
        ← Population Dashboard
      </Link>

      {!state && (
        <p className="text-body text-text-muted mt-4">
          No filter selected. Go back to the{' '}
          <Link to="/population" className="text-cyan hover:underline">
            Population Dashboard
          </Link>{' '}
          and click a quadrant on the risk distribution chart.
        </p>
      )}

      {state && (
        <>
          <div className="flex items-center gap-1.5 mt-3 mb-3">
            <span className="text-body font-bold text-text">{state.label}</span>
            <span className="text-label text-text-dim">({patientIds.length})</span>
          </div>

          {patientIds.length === 0 && <p className="text-body text-text-muted">No patients in this band.</p>}

          {patientIds.length > 0 && (
            <div role="list" className="border border-border rounded-card overflow-hidden bg-surface">
              {patientIds.map((id, index) => (
                <PatientRow key={id} id={id} riskScore={state.riskScoreById[id]} query={patientQueries[index]} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One patient row's fetch outcome — loosely typed since `useQueries` doesn't narrow per-entry results. */
interface PatientRowQuery {
  isLoading: boolean;
  isError: boolean;
  data?: { patient: { name: string; gender: string; birthDate: string } };
}

function PatientRow({ id, riskScore, query }: { id: string; riskScore: number | undefined; query: PatientRowQuery }) {
  if (query.isLoading) {
    return (
      <div role="listitem" className="px-3.5 py-2.5 border-b border-border last:border-b-0 text-label text-text-muted">
        Loading…
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div role="listitem" className="px-3.5 py-2.5 border-b border-border last:border-b-0 text-label text-red">
        Could not load Patient/{id}.
      </div>
    );
  }

  const { patient } = query.data;

  return (
    <Link
      to={`/patients/${id}`}
      role="listitem"
      className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border last:border-b-0 border-l-[3px] border-l-transparent hover:bg-surface-hover transition-colors"
    >
      <span className={`w-2 h-2 rounded-full flex-none ${RISK_DOT_CLASS[riskDotColor(riskScore ?? 0)]}`} />
      <div className="flex-1 min-w-0">
        <div className="text-label font-semibold text-text truncate">
          {patient.name}
          <span className="text-text-muted font-normal ml-1.5 text-xs">
            {ageSexLabel(patient.birthDate, patient.gender)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-none">
        <span className="font-mono text-xs text-text-dim" title="Risk score">
          {riskScore ?? '—'}
        </span>
        <ChevronRightIcon className="w-4 h-4 text-text-dim" />
      </div>
    </Link>
  );
}
