import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { getTaskDetail, transitionTask, type TaskStatusTransition } from '../api/client';
import { PRIORITY_LABEL, PRIORITY_CLASS, dueLabel } from '../lib/task';

// S7 B2 — M03 Task Detail. No matching reference-materials/*.html mockup
// exists for this screen (per the implementation plan's own note), so this
// builds to the design tokens/patterns already established by
// PatientDetail.tsx and TaskQueue.tsx rather than inventing a new visual
// language — card/pill/chip classes, citation-chip markup, and priority
// pill colors are all reused as-is.

const TRANSITION_LABEL: Record<TaskStatusTransition, string> = {
  complete: 'Complete',
  defer: 'Defer',
  escalate: 'Escalate',
};

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['task', id],
    queryFn: () => getTaskDetail(id!),
    enabled: !!id,
  });

  const transitionMutation = useMutation({
    mutationFn: (transition: TaskStatusTransition) => transitionTask(id!, transition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  return (
    <div className="max-w-2xl">
      <Link to="/tasks" className="text-label text-cyan hover:underline">
        ← Back to Tasks
      </Link>

      {isLoading && <p className="text-body text-text-muted mt-4">Loading task…</p>}
      {isError && <p className="text-body text-red mt-4">Could not load this task.</p>}

      {data && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[9px] font-bold tracking-wide rounded-pill border px-2 py-0.5 ${PRIORITY_CLASS[data.priority]}`}>
              {PRIORITY_LABEL[data.priority]}
            </span>
            <span className="text-xs font-semibold text-text-muted border border-border-light rounded-pill px-2 py-px">
              {data.status}
            </span>
            <span className="text-xs text-text-muted ml-auto">Due: {dueLabel(data.due)}</span>
          </div>

          <h1 className="text-section font-bold text-text mb-1">{data.title}</h1>
          <p className="font-mono text-[10.5px] text-text-dim mb-6">{`Task/${data.id}`}</p>

          <h2 className="text-section text-text mb-2">Justifying patient context</h2>
          <div className="border border-border rounded-card overflow-hidden mb-2 bg-surface p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-label font-semibold text-text">{data.patientName}</span>
              {data.conditionTag && (
                <span className="text-xs text-text-muted bg-bg border border-border rounded-chip px-1.5 py-px">
                  {data.conditionTag}
                </span>
              )}
              <span className="font-mono text-xs text-text-dim ml-auto">Patient/{data.patientId}</span>
            </div>

            {data.citations.length === 0 ? (
              <p className="text-xs text-text-muted">No citations recorded for this task.</p>
            ) : (
              <div className="flex flex-wrap gap-1" data-testid="task-citations">
                {data.citations.map((c) => (
                  <span
                    key={c.reference}
                    className="font-mono text-[10px] text-text-dim bg-bg border border-border rounded-chip px-1.5 py-0.5"
                  >
                    {c.display} · {c.reference}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 mt-6">
            {(['complete', 'defer', 'escalate'] as TaskStatusTransition[]).map((transition) => (
              <button
                key={transition}
                onClick={() => transitionMutation.mutate(transition)}
                disabled={transitionMutation.isPending}
                className="h-8 px-3.5 rounded-md bg-surface border border-border text-text text-xs font-semibold disabled:opacity-60 disabled:cursor-default"
              >
                {TRANSITION_LABEL[transition]}
              </button>
            ))}
            {data.patientPhone && (
              <a
                href={`tel:${data.patientPhone}`}
                className="h-8 px-3.5 rounded-md bg-cyan-dim border border-cyan text-cyan text-xs font-semibold flex items-center"
              >
                Call
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
