import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listTasks, completeTask, type TaskListEntry } from '../api/client';
import { PRIORITY_LABEL, PRIORITY_CLASS, dueLabel } from '../lib/task';

// S7 B1 — M02 Task Queue, built against reference-materials/caresync-mobile.html
// ("My Tasks", 390×844 phone shell). Per the GD4 decision this is demoed inside
// a decorative phone frame; the chrome below (status bar, nav header) carries
// no functionality of its own. Scope decisions locked in the implementation
// plan (Iteration 7 Phase B / B1) and NOT relitigated here:
//   - Segment tabs (Tasks/Patients/Alerts/Profile) — skipped, only Tasks has content.
//   - Bottom "Patient Risk Summary" sheet — deferred, no backing single-patient
//     focus concept exists yet in this list view.
//   - Bottom tab bar (Tasks/Patients/Alerts/Messages/Profile) — skipped, no
//     sibling screens ready.
//   - Back button + notification bell/badge in the nav header — skipped, no
//     backing data (nowhere to navigate back to from a role's home screen; no
//     notification feed).
//   - "Call" button on each card — explicitly scoped to B2/M03's task-detail
//     screen by the plan's own architecture note, not this list.
// The one interactive element that DOES belong here per both the mockup and
// the plan: "Done", wired to PATCH /api/tasks/:id/status.
//
// S7 B2 — each card now also navigates to /tasks/:id (M03) on click; "Done"
// stops propagation so it keeps completing the task in place instead of also
// triggering a navigation (same click-vs-navigate concern PatientPanel.tsx's
// row Links don't have to solve, since they have no nested interactive
// element — Task cards do).

const PRIORITY_BORDER_L: Record<TaskListEntry['priority'], string> = {
  critical: 'border-l-red',
  high: 'border-l-amber',
  medium: 'border-l-violet',
};

const PRIORITY_ORDER: Record<TaskListEntry['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

function isOpenStatus(status: string): boolean {
  return status !== 'Done' && status !== 'Cancelled';
}

/** Open tasks first (priority, then due date), completed tasks last — matches the mockup's card order. */
function sortTasks(tasks: TaskListEntry[]): TaskListEntry[] {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === 'Done' ? 1 : 0;
    const bDone = b.status === 'Done' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (PRIORITY_ORDER[a.priority] !== PRIORITY_ORDER[b.priority]) return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return new Date(a.due).getTime() - new Date(b.due).getTime();
  });
}

/** Decorative-only status-bar strip — same visual identity as the mockup, no live clock/signal. */
function StatusBarChrome() {
  return (
    <div className="h-[34px] flex-none flex items-center justify-between px-5 border-b border-border/40">
      <span className="text-label font-semibold text-text">9:41</span>
      <div className="flex items-center gap-1.5 text-text">
        <svg width="16" height="11" viewBox="0 0 18 12" fill="none" aria-hidden="true">
          <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor" />
          <rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor" />
          <rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" opacity="0.35" />
        </svg>
        <svg width="22" height="11" viewBox="0 0 25 12" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3" stroke="currentColor" strokeOpacity="0.4" />
          <rect x="2" y="2" width="15" height="8" rx="1.6" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`flex-1 flex items-center justify-center gap-1.5 text-label font-semibold ${className}`}>
      <span className="text-body font-bold">{value}</span> {label}
    </div>
  );
}

function CompletedTaskCard({ task }: { task: TaskListEntry }) {
  const navigate = useNavigate();
  return (
    <div
      data-testid={`task-${task.id}`}
      onClick={() => navigate(`/tasks/${task.id}`)}
      className="bg-surface border border-border border-l-[3px] border-l-emerald rounded-card p-3 mb-2.5 opacity-60 cursor-pointer"
    >
      <div className="flex items-center gap-2.5">
        <span className="w-[22px] h-[22px] rounded-full bg-emerald-dim border border-emerald flex items-center justify-center flex-none text-emerald">
          <svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden="true">
            <path d="M1 4.5 L4 7.5 L10 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-body font-bold text-text-muted line-through truncate">{task.title}</p>
          <p className="text-xs text-text-dim mt-0.5">
            {task.status} · <span className="font-mono">{`Task/${task.id}`}</span>
          </p>
        </div>
        <span className="text-[9px] font-bold tracking-wide rounded-pill border px-2 py-0.5 text-emerald bg-emerald-dim border-emerald flex-none">
          Done
        </span>
      </div>
    </div>
  );
}

function OpenTaskCard({
  task,
  onComplete,
  completing,
}: {
  task: TaskListEntry;
  onComplete: (id: string) => void;
  completing: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div
      data-testid={`task-${task.id}`}
      onClick={() => navigate(`/tasks/${task.id}`)}
      className={`bg-surface-raised border border-border ${PRIORITY_BORDER_L[task.priority]} border-l-[3px] rounded-card p-3 mb-2.5 cursor-pointer`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[9px] font-bold tracking-wide rounded-pill border px-2 py-0.5 ${PRIORITY_CLASS[task.priority]}`}>
          {PRIORITY_LABEL[task.priority]}
        </span>
        <span className="text-xs font-semibold text-text-muted truncate">{task.patientName}</span>
        {task.conditionTag && (
          <span className="text-xs font-semibold text-text-muted bg-surface border border-border rounded-pill px-2 py-0.5 whitespace-nowrap">
            {task.conditionTag}
          </span>
        )}
      </div>

      <p className="text-body font-bold text-text mb-1.5">{task.title}</p>
      <p className="font-mono text-[10.5px] text-text-dim mb-2.5">{`Task/${task.id}`}</p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-text-muted bg-bg border border-border rounded-md px-2.5 py-1 whitespace-nowrap">
            Due: {dueLabel(task.due)}
          </span>
          <span className="text-xs font-semibold text-text-muted border border-border-light rounded-pill px-2 py-px whitespace-nowrap">
            {task.status}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onComplete(task.id);
          }}
          disabled={completing}
          className="h-7 px-3.5 rounded-md bg-surface border border-border text-text text-xs font-semibold disabled:opacity-60 disabled:cursor-default flex-none"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export function TaskQueue() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['tasks'], queryFn: listTasks });
  const completeMutation = useMutation({
    mutationFn: completeTask,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const tasks = data ?? [];
  const openCount = tasks.filter((t) => isOpenStatus(t.status)).length;
  const criticalCount = tasks.filter((t) => t.priority === 'critical').length;
  const patientsCount = new Set(tasks.map((t) => t.patientId)).size;
  const sorted = sortTasks(tasks);

  return (
    <div className="mx-auto w-[390px] max-w-full bg-bg border border-border rounded-[32px] overflow-hidden shadow-lg flex flex-col">
      <StatusBarChrome />

      {/* Nav header — title only per the B1 scope decision (no back button, no bell/badge: no backing data for either). */}
      <div className="h-12 flex-none flex items-center justify-center border-b border-border">
        <span className="text-nav font-bold text-text">My Tasks</span>
      </div>

      {/* Summary bar — 3 real stats, no segment tabs (Patients/Alerts/Profile have no content in this slice). */}
      <div className="h-11 flex-none bg-surface-raised border-b border-border flex items-center">
        <SummaryStat label="Open" value={openCount} className="text-cyan" />
        <span className="w-px h-[18px] bg-border-light" aria-hidden="true" />
        <SummaryStat label="Critical" value={criticalCount} className="text-red" />
        <span className="w-px h-[18px] bg-border-light" aria-hidden="true" />
        <SummaryStat label="Patients" value={patientsCount} className="text-text-muted" />
      </div>

      <div className="flex-1 p-3.5 overflow-y-auto min-h-[240px]">
        {isLoading && <p className="text-body text-text-muted">Loading tasks…</p>}
        {isError && <p className="text-body text-red">Could not load the task queue.</p>}
        {data && sorted.length === 0 && <p className="text-body text-text-muted">No tasks assigned.</p>}
        {sorted.map((task) =>
          task.status === 'Done' ? (
            <CompletedTaskCard key={task.id} task={task} />
          ) : (
            <OpenTaskCard
              key={task.id}
              task={task}
              onComplete={(id) => completeMutation.mutate(id)}
              completing={completeMutation.isPending && completeMutation.variables === task.id}
            />
          )
        )}
      </div>
    </div>
  );
}
