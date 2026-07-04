import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { getPatient } from '../api/client';

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
          <h1 className="text-title text-text mb-1">{data.patient.name}</h1>
          <p className="text-label text-text-dim font-mono mb-6">Patient/{data.patient.id}</p>

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
