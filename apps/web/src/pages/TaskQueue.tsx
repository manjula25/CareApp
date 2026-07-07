import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listTasks, completeTask, type TaskListEntry } from '../api/client';
import { PRIORITY_LABEL, PRIORITY_CLASS, dueLabel } from '../lib/task';
import { FILTER_TABS, type TaskFilter } from './TaskQueue.fixtures';

/**
 * Phase 3 of the lead-project integration: `TaskQueue.tsx` is now lead's
 * `pages/mobile/TaskQueue.tsx` (295 lines) — filterable task queue with
 * priority left-border cards + Due/Status pills + Done button — adapted
 * to:
 *   - my real `listTasks()` API (lead's `fetch('/api/tasks')` was unwrapped
 *     ad-hoc; the same endpoint now goes through my client)
 *   - my `TaskListEntry` shape (no description/fhirResourceId/assignedTo/
 *     createdAt; `due` field name not `dueDate`; priority enum is
 *     critical/high/medium not urgent/high/medium/low)
 *   - my real `completeTask(id)` mutation (lead's Done button was UI-only;
 *     ours PATCHes `/api/tasks/:id/status` with `transition: 'complete'`)
 *   - my `/tasks/:id` route (not lead's `/mobile/tasks/:id`)
 *
 * Honest-staging deviations from lead's mobile-styled screen:
 *   - Dropped the 390px phone frame wrapper per user direction (regression
 *     from S7 B1 GD4) — this page now renders at full web width inside
 *     `AppShell.tsx` like every other per-screen content.
 *   - Dropped `StatusBarChrome` — purely decorative, AppShell provides the
 *     real Header chrome.
 *   - Dropped the FAB + `CreateTaskSheet` — no `/api/tasks/:patientId/assign`
 *     endpoint exists on my backend; surfacing a UI for a stub would be a
 *     placebo. Tasks are created by the action-planner agent stream instead.
 *   - Dropped `MobileNav` (Tasks/SDOH bottom bar) — AppShell already provides
 *     Header + Sidebar nav.
 *   - Mapped lead's `urgent` priority → my `critical`; lead's `low` priority
 *     not surfaced (my `TaskSummary.priority` enum doesn't include it).
 *   - Wired Done button to real `completeTask(id)` mutation (lead's Done was
 *     a UI-only no-op — its only "success" was a local state flip).
 *   - Replaced lead's `border-l-cyan` (medium priority) with `border-l-violet`
 *     to match my established `PRIORITY_CLASS` medium color and keep card
 *     left-borders consistent with the priority pills elsewhere in the app.
 *   - Replaced lead's `bg-red` urgent-count badge with the existing 3-stat
 *     Open/Critical/Patients summary bar (already used in the previous
 *     in-tree version of this page).
 */

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

/** Open tasks first (priority, then due date), completed tasks last. */
function sortTasks(tasks: TaskListEntry[]): TaskListEntry[] {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === 'Done' ? 1 : 0;
    const bDone = b.status === 'Done' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (PRIORITY_ORDER[a.priority] !== PRIORITY_ORDER[b.priority]) return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return new Date(a.due).getTime() - new Date(b.due).getTime();
  });
}

function SummaryStat({ label, value, className, testId }: { label: string; value: number; className: string; testId: string }) {
  return (
    <div
      data-testid={testId}
      className={`flex-1 flex items-center justify-center gap-1.5 text-label font-semibold ${className}`}
    >
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
          <p className="text-xs text-text-dim mt-0.5 font-mono">{`Task/${task.id}`}</p>
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
          data-testid={`task-done-${task.id}`}
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

function EmptyState() {
  return (
    <div
      data-testid="task-queue-empty-state"
      className="flex flex-col items-center justify-center h-48 text-emerald text-base font-semibold gap-2"
    >
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      All caught up!
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

  const [filter, setFilter] = useState<TaskFilter>('all');

  const tasks = data ?? [];
  const openCount = tasks.filter((t) => isOpenStatus(t.status)).length;
  const criticalCount = tasks.filter((t) => t.priority === 'critical').length;
  const patientsCount = new Set(tasks.map((t) => t.patientId)).size;

  const filtered = sortTasks(tasks).filter((t) => {
    if (filter === 'critical') return t.priority === 'critical';
    if (filter === 'today') return dueLabel(t.due) === 'Today';
    if (filter === 'in_progress') return t.status === 'In Progress';
    return true;
  });

  return (
    <div>
      <h1 className="text-section text-text font-bold mb-3">My Tasks</h1>

      {/* Summary bar — 3 real stats from listTasks data (not lead's hardcoded "12"). */}
      <div className="h-11 flex-none bg-surface-raised border border-border rounded-card flex items-center mb-3" data-testid="task-queue-summary">
        <SummaryStat label="Open" value={openCount} className="text-cyan" testId="task-queue-summary-open" />
        <span className="w-px h-[18px] bg-border-light" aria-hidden="true" />
        <SummaryStat label="Critical" value={criticalCount} className="text-red" testId="task-queue-summary-critical" />
        <span className="w-px h-[18px] bg-border-light" aria-hidden="true" />
        <SummaryStat label="Patients" value={patientsCount} className="text-text-muted" testId="task-queue-summary-patients" />
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-0.5">
        {FILTER_TABS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            data-testid={f.testId}
            className={`shrink-0 px-3 py-1 rounded-pill text-xs font-medium border transition-colors ${
              filter === f.key
                ? 'bg-cyan text-bg border-cyan'
                : 'bg-surface border-border text-text-muted hover:text-text'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Task list */}
      <div>
        {isLoading && <p className="text-body text-text-muted">Loading tasks…</p>}
        {isError && <p className="text-body text-red">Could not load the task queue.</p>}
        {data && filtered.length === 0 && <EmptyState />}
        {filtered.map((task) =>
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