import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAssignedPanel } from '../api/client';
import { ChevronRightIcon } from '../icons';

function riskColor(score: number): string {
  if (score >= 75) return 'text-red';
  if (score >= 50) return 'text-amber';
  return 'text-emerald';
}

export function PatientPanel() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['assigned-panel'], queryFn: getAssignedPanel });

  return (
    <div>
      <h1 className="text-title text-text mb-4">My Patient Panel</h1>

      {isLoading && <p className="text-body text-text-muted">Loading panel…</p>}
      {isError && <p className="text-body text-red">Could not load your patient panel.</p>}

      {data && (
        <div className="border border-border rounded-card overflow-hidden">
          {data.map((patient) => (
            <Link
              key={patient.id}
              to={`/patients/${patient.id}`}
              className="flex items-center justify-between px-4 py-3 border-b border-border last:border-b-0 bg-surface hover:bg-surface-hover transition-colors"
            >
              <span className="text-body text-text">{patient.name}</span>
              <div className="flex items-center gap-6">
                <span className="text-label text-text-muted">
                  <span className="font-mono text-text-dim">{patient.taskCount}</span> tasks
                </span>
                <span className={`text-body font-semibold ${riskColor(patient.riskScore)}`}>
                  {patient.riskScore}
                </span>
                <ChevronRightIcon className="w-4 h-4 text-text-dim" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
