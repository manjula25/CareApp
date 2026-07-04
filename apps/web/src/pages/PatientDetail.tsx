import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { getPatient, type TaskSummary } from '../api/client';
import { ageSexLabel } from '../lib/patient';
import { PRIORITY_LABEL, dueLabel } from '../lib/task';

const PRIORITY_CLASS: Record<TaskSummary['priority'], string> = {
  critical: 'text-red bg-red-dim border-red',
  high: 'text-amber bg-amber-dim border-amber',
  medium: 'text-violet bg-violet-dim border-violet',
};

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
          <div className="border border-border rounded-card overflow-hidden mb-6">
            {data.conditions.map((condition) => (
              <div key={condition.id} className="px-4 py-3 border-b border-border last:border-b-0 bg-surface">
                <p className="text-body text-text">{condition.display}</p>
                <p className="text-xs font-mono text-text-dim">
                  ICD-10 {condition.code} · Condition/{condition.id}
                </p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-section text-text">Tasks</h2>
            <span className="text-xs font-bold text-cyan bg-cyan-dim border border-cyan rounded-pill px-2.5 py-0.5">
              {data.tasks.length} open
            </span>
          </div>
          {data.tasks.length === 0 && <p className="text-body text-text-muted">No open tasks.</p>}
          {data.tasks.map((task) => (
            <div key={task.id} className="bg-surface-raised border border-border rounded-card p-2.5 mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`text-[9px] font-bold tracking-wide rounded-pill border px-2 py-0.5 ${PRIORITY_CLASS[task.priority]}`}
                >
                  {PRIORITY_LABEL[task.priority]}
                </span>
                <span className="text-xs text-text-muted">Due: {dueLabel(task.due)}</span>
              </div>
              <p className="text-body font-bold text-text mb-1.5">{task.title}</p>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] text-text-dim">Task/{task.id}</span>
                <span className="text-xs font-semibold text-text-muted border border-border-light rounded-pill px-2 py-px">
                  {task.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
