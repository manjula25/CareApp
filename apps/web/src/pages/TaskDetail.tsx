import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  getTaskDetail,
  transitionTask,
  subscribeToEvents,
  type TaskStatusTransition,
  type AssignedTaskEvent,
} from '../api/client';
import { PRIORITY_LABEL, PRIORITY_CLASS, dueLabel, isOverdue } from '../lib/task';
import { isoDay } from './TaskDetail.fixtures';

/**
 * Phase 3 of the lead-project integration: `TaskDetail.tsx` is now lead's
 * `apps/web/src/pages/mobile/TaskDetail.tsx` (273 lines), adapted to:
 *   - my real `getTaskDetail(id)` / `transitionTask(id, transition)` APIs
 *     (lead's design called a stub `fetch('/api/tasks/:id/status', ...)` —
 *     same wire endpoint, kept `transitionTask` instead).
 *   - my `/tasks/:id` route (not lead's `/mobile/tasks/:id`).
 *   - my `TaskDetail` type (no `description` / `fhirResourceId` /
 *     `assignedTo` / `createdAt` — see the skipped sections below).
 *
 * 390px phone frame dropped — rendered at normal web content width
 * (`max-w-2xl`) per user direction.
 *
 * Honest-staging notes:
 *   - Borrowed two UX affordances from lead's design: the defer-date inline
 *     picker (first click reveals the date input, second click fires the
 *     `defer` transition) and the escalation confirm step (first click shows
 *     "tap again to confirm", second click fires the `escalate` transition).
 *     Complete still fires on first click (lead's behavior).
 *   - Skipped description / FHIR Evidence / Assigned To / Created sections:
 *     my `getTaskDetail` API doesn't return those fields (it returns only
 *     id / title / priority / due / status / patientId / patientName /
 *     conditionTag / citations / patientPhone). A future API slice could
 *     surface them; until then the page renders without them rather than
 *     inventing fields.
 *   - Deferring today calls `transitionTask(id, 'defer')`, which only changes
 *     `status` on the backend. My `transitionTask` signature has no
 *     `dueDate` override param, so the picked date in the defer-date input
 *     is captured locally and discarded. Lead's stub accepted it as
 *     `extra: { dueDate }`. A future slice can extend the API + client
 *     signature; today's defer just resets the task to pending.
 *   - Subscribed to `subscribeToEvents({ onTaskUpdated })` on mount, with
 *     cleanup on unmount. The handler invalidates the `['task', id]` and
 *     `['tasks']` queries so a coordinator/peer status change refetches this
 *     view (closes handoff's open grill-question #4 about cross-surface sync).
 *   - Kept the existing `data-testid="task-citations"` so downstream test
 *     suites don't break.
 *   - Added an overdue-red treatment on the due label (compares `due` against
 *     today and flips to `text-red font-medium` if past); the lead applied
 *     the same pattern to its `MOCK_TASKS[0]` "overdue" task.
 *   - No matching `reference-materials/*.html` mockup for this view, so
 *     styling stays consistent with the existing PatientDetail/TaskQueue
 *     card/pill/chip classes (same convention as the pre-port version).
 */

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

  // Cross-surface sync: when any peer (coordinator / etc.) updates the task,
  // refetch this view. Driven by the /api/events SSE relay; cleaned up on
  // unmount.
  useEffect(() => {
    if (!id) return;
    const unsubscribe = subscribeToEvents({
      onTaskUpdated: (task: AssignedTaskEvent) => {
        if (task.id !== id) return;
        queryClient.invalidateQueries({ queryKey: ['task', id] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      },
    });
    return unsubscribe;
  }, [id, queryClient]);

  // Confirm-step state mirrors lead's mobile design. Complete fires on first
  // click (no confirm). Defer/Escalate enter a confirm step first.
  const [deferPending, setDeferPending] = useState(false);
  const [deferDate, setDeferDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return isoDay(d);
  });
  const [escalateConfirming, setEscalateConfirming] = useState(false);

  function handleComplete() {
    transitionMutation.mutate('complete');
  }
  function handleDefer() {
    if (!deferPending) {
      setDeferPending(true);
      return;
    }
    // Lead's stub PATCHed the picked date; my `transitionTask` doesn't accept
    // a date override (see honest-staging note in the file header). The picked
    // date is captured-once into `deferDate` for show, then discarded.
    transitionMutation.mutate('defer');
    setDeferPending(false);
  }
  function handleEscalate() {
    if (!escalateConfirming) {
      setEscalateConfirming(true);
      return;
    }
    transitionMutation.mutate('escalate');
    setEscalateConfirming(false);
  }

  const overdue = data ? isOverdue(data.due) : false;
  const disableActions = transitionMutation.isPending;

  return (
    <div className="max-w-2xl">
      <Link to="/tasks" className="text-label text-cyan hover:underline">
        ← Back to Tasks
      </Link>

      {isLoading && <p className="text-body text-text-muted mt-4" data-testid="task-loading">Loading task…</p>}
      {isError && <p className="text-body text-red mt-4" data-testid="task-error">Could not load this task.</p>}

      {data && (
        <div className="mt-4" data-testid="task-detail-body">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              data-testid="task-priority"
              className={`text-[9px] font-bold tracking-wide rounded-pill border px-2 py-0.5 ${PRIORITY_CLASS[data.priority]}`}
            >
              {PRIORITY_LABEL[data.priority]}
            </span>
            <span
              data-testid="task-status"
              className="text-xs font-semibold text-text-muted border border-border-light rounded-pill px-2 py-px"
            >
              {data.status}
            </span>
            <span
              data-testid="task-due"
              className={clsx(
                'text-xs ml-auto',
                overdue ? 'text-red font-medium' : 'text-text-muted'
              )}
            >
              {overdue ? 'Overdue — ' : 'Due: '}{dueLabel(data.due)}
            </span>
          </div>

          <h1 data-testid="task-title" className="text-section font-bold text-text mb-1">{data.title}</h1>
          <p className="font-mono text-[10.5px] text-text-dim mb-6">{`Task/${data.id}`}</p>

          <h2 className="text-section text-text mb-2">Justifying patient context</h2>
          <div className="border border-border rounded-card overflow-hidden mb-2 bg-surface p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <span data-testid="task-patient-name" className="text-label font-semibold text-text">
                {data.patientName}
              </span>
              {data.conditionTag && (
                <span
                  data-testid="task-condition-tag"
                  className="text-xs text-text-muted bg-bg border border-border rounded-chip px-1.5 py-px"
                >
                  {data.conditionTag}
                </span>
              )}
              <span className="font-mono text-xs text-text-dim ml-auto">{`Patient/${data.patientId}`}</span>
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

          <div className="flex items-center gap-2 mt-6 flex-wrap">
            <button
              onClick={handleComplete}
              disabled={disableActions}
              data-testid="btn-complete"
              className="h-8 px-3.5 rounded-md bg-emerald-dim border border-emerald text-emerald text-xs font-semibold disabled:opacity-60 disabled:cursor-default"
            >
              {TRANSITION_LABEL.complete}
            </button>

            {!deferPending ? (
              <button
                onClick={handleDefer}
                disabled={disableActions}
                data-testid="btn-defer"
                className="h-8 px-3.5 rounded-md bg-surface border border-border text-text text-xs font-semibold disabled:opacity-60 disabled:cursor-default"
              >
                {TRANSITION_LABEL.defer}
              </button>
            ) : (
              <div className="flex items-center gap-2" data-testid="defer-confirm-row">
                <label className="text-text-muted text-xs font-medium">Defer to:</label>
                <input
                  type="date"
                  value={deferDate}
                  onChange={(e) => setDeferDate(e.target.value)}
                  data-testid="defer-date-input"
                  className="h-8 px-2 bg-surface border border-border rounded-md text-text text-xs"
                />
                <button
                  onClick={handleDefer}
                  disabled={disableActions}
                  data-testid="btn-confirm-defer"
                  className="h-8 px-3.5 rounded-md bg-amber-dim border border-amber text-amber text-xs font-semibold disabled:opacity-60 disabled:cursor-default"
                >
                  Confirm Defer
                </button>
              </div>
            )}

            <button
              onClick={handleEscalate}
              disabled={disableActions}
              data-testid="btn-escalate"
              className={clsx(
                'h-8 px-3.5 rounded-md text-xs font-semibold disabled:opacity-60 disabled:cursor-default',
                escalateConfirming
                  ? 'bg-red-dim border border-red text-red'
                  : 'bg-transparent border border-red text-red'
              )}
            >
              {escalateConfirming ? 'Escalate (confirm)' : TRANSITION_LABEL.escalate}
            </button>

            {data.patientPhone && (
              <a
                href={`tel:${data.patientPhone}`}
                data-testid="call-link"
                className="h-8 px-3.5 rounded-md bg-cyan-dim border border-cyan text-cyan text-xs font-semibold flex items-center"
              >
                Call
              </a>
            )}
          </div>

          {escalateConfirming && (
            <p
              data-testid="escalate-confirm-warning"
              className="text-xs text-red mt-2"
            >
              This will notify the Director. Tap Escalate again to confirm.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
