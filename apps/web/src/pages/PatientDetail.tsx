import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { getPatient } from '../api/client';
import { ageSexLabel } from '../lib/patient';

export function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => getPatient(id!),
    enabled: !!id,
  });

  return (
    <div>
      <Link to="/panel" className="text-label text-cyan hover:underline">
        ← My Patient Panel
      </Link>

      {isLoading && <p className="text-body text-text-muted mt-4">Loading patient…</p>}
      {isError && <p className="text-body text-red mt-4">{(error as Error).message}</p>}

      {data && (
        <div className="mt-4">
          {/* Top bar matches reference-materials/caresync-ai.html's .pt-bar — the
              "Run Analysis" button in that reference is S2 (no agent exists yet),
              so it's intentionally left out here per the S1 honest-staging rule. */}
          <div className="h-11 flex items-center gap-2.5 px-4 -mx-6 -mt-6 mb-6 border-b border-border bg-surface">
            <span className="text-section font-bold text-text">{data.patient.name}</span>
            <span className="text-body text-text-muted">{ageSexLabel(data.patient.birthDate, data.patient.gender)}</span>
            <span className="font-mono text-xs text-text-dim flex-1 truncate">| Patient/{data.patient.id}</span>
          </div>

          <h2 className="text-section text-text mb-2">Active Conditions</h2>
          <div className="border border-border rounded-card overflow-hidden">
            {data.conditions.map((condition) => (
              <div key={condition.id} className="px-4 py-3 border-b border-border last:border-b-0 bg-surface">
                <p className="text-body text-text">{condition.display}</p>
                <p className="text-xs font-mono text-text-dim">
                  ICD-10 {condition.code} · Condition/{condition.id}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
