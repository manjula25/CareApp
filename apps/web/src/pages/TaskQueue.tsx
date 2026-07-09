import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listTasks, type TaskListEntry } from '../api/client';
import { DemoFallbackBadge } from '../components/DemoFallbackBadge';
import { MOCK_TASKS } from '../lib/demoFallbacks';
import { FILTER_TABS, type TaskFilter } from './TaskQueue.fixtures';

/**
 * TaskQueue — compact lead-port row design with the project's real
 * `listTasks()` API + safety-net MOCK_TASKS fallback.
 *
 * Visual layer (lead):
 *   - One card per task with priority-colored left-border stripe.
 *   - Two-column row: patient name + task title on the LEFT, due date +
 *     priority pill on the RIGHT (matches reference-materials/caresync-mobile
 *     .task-card mockup).
 *   - "Overdue" treatment on dates that have passed.
 *   - In Progress chip below the title when status === 'In Progress'.
 *   - Empty "All caught up!" state when no tasks match the active filter.
 *
 * Real-data layer (project):
 *   - `useQuery(['tasks'], listTasks)` is the only source of truth while in
 *     flight. `MOCK_TASKS` is a SAFETY NET that fires only when the API
 *     errors and we have no real data — surfaced via the `DemoFallbackBadge`.
 *   - No `placeholderData`: a screenshot taken during a normal load shows
 *     the honest "Loading…" state, never mock rows impersonating real data.
 *   - Filter chips drive client-side filtering (real data, no extra fetch).
 *   - Card click navigates to /tasks/:id for the real per-task detail surface.
 *
 * Honest-staging deviations from lead:
 *   - Removed the FAB + CreateTaskSheet (no /api/tasks/:patientId/assign
 *     endpoint exists; tasks are created by the action-planner agent stream).
 *   - Removed MobileNav (AppShell provides Header + Sidebar already).
 *   - Removed the Done button on the card — task completion lives on the
 *     detail page (TaskDetail.tsx) where the defer/escalate/confirm flow
 *     can be expressed safely.
 *   - Lead's `urgent` priority → our `critical`; lead's `low` priority not
 *     surfaced (our `TaskSummary.priority` enum doesn't include it).
 */

const PRIORITY_BORDER_L: Record<TaskListEntry['priority'], string> = {
  critical: 'border-l-red',
  high: 'border-l-amber',
  medium: 'border-l-violet',
};

const PRIORITY_PILL: Record<TaskListEntry['priority'], string> = {
  critical: 'bg-red/20 text-red border border-red/30',
  high: 'bg-amber/20 text-amber border border-amber/30',
  medium: 'bg-violet/20 text-violet border border-violet/30',
};

const PRIORITY_LABEL: Record<TaskListEntry['priority'], string> = {
  critical: 'URGENT',
  high: 'HIGH',
  medium: 'MEDIUM',
};

const PRIORITY_ORDER: Record<TaskListEntry['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

const TODAY_ISO = new Date().toISOString().split('T')[0];

function isOverdue(due: string | undefined): boolean {
  if (!due) return false;
  // `due` is an ISO datetime ("2026-07-10T05:25:48.764Z"); compare on the
  // day boundary so an 11pm-due task doesn't show as overdue at 1am the same
  // day — only the date matters for the queue list.
  return due.split('T')[0] < TODAY_ISO;
}

function isOpenStatus(status: string): boolean {
  return status !== 'Done' && status !== 'Cancelled';
}

function dueDisplay(due: string | undefined): { label: string; overdue: boolean } {
  if (!due) return { label: '—', overdue: false };
  if (isOverdue(due)) return { label: 'Overdue', overdue: true };
  // Show the date in compact form: "Jul 10". Keep year for clarity.
  const d = new Date(due);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return { label: `${month} ${d.getUTCDate()}`, overdue: false };
}

/** Open tasks first (priority, then due date), completed tasks last. */
function sortTasks(tasks: TaskListEntry[]): TaskListEntry[] {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === 'Done' ? 1 : 0;
    const bDone = b.status === 'Done' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (PRIORITY_ORDER[a.priority] !== PRIORITY_ORDER[b.priority]) return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    const aTime = a.due ? new Date(a.due).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.due ? new Date(b.due).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

function CompletedTaskRow({ task }: { task: TaskListEntry }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/tasks/${task.id}`)}
      data-testid={`task-${task.id}`}
      className="w-full text-left bg-surface rounded-xl border border-border border-l-4 border-l-emerald p-3 mb-2 flex items-center justify-between gap-3 opacity-60 hover:opacity-80 transition-opacity"
    >
      <div className="flex-1 min-w-0">
        <p className="text-text font-semibold text-sm leading-tight line-through">{task.patientName}</p>
        <p className="text-text-muted text-[13px] mt-0.5 leading-snug line-through">{task.title}</p>
      </div>
      <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase bg-emerald-dim text-emerald border border-emerald">
        Done
      </span>
    </button>
  );
}

function OpenTaskRow({ task }: { task: TaskListEntry }) {
  const navigate = useNavigate();
  const due = dueDisplay(task.due);
  return (
    <button
      type="button"
      onClick={() => navigate(`/tasks/${task.id}`)}
      data-testid={`task-${task.id}`}
      className={`w-full text-left bg-surface rounded-xl border border-border ${PRIORITY_BORDER_L[task.priority]} border-l-4 p-3 mb-2 flex items-start justify-between gap-3 hover:bg-surface-raised transition-colors`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-text font-semibold text-sm leading-tight">{task.patientName}</p>
        <p className="text-text-muted text-[13px] mt-0.5 leading-snug line-clamp-2">{task.title}</p>
        {task.status === 'In Progress' && (
          <span className="inline-block mt-1.5 text-[10px] font-medium bg-violet/20 text-violet border border-violet/30 px-1.5 py-0.5 rounded">
            In Progress
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className={`text-[11px] font-medium ${due.overdue ? 'text-red' : 'text-text-muted'}`}>
          {due.label}
        </span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${PRIORITY_PILL[task.priority]}`}>
          {PRIORITY_LABEL[task.priority]}
        </span>
      </div>
    </button>
  );
}

function EmptyState() {
  return (
    <div
      data-testid="task-queue-empty-state"
      className="flex flex-col items-center justify-center py-12 text-emerald text-base font-semibold gap-2"
    >
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      All caught up!
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-surface rounded-xl border border-border border-l-4 border-l-border-light p-3 mb-2 flex items-start justify-between gap-3 animate-pulse"
        >
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-3 bg-surface-raised rounded w-2/5" />
            <div className="h-3 bg-surface-raised rounded w-4/5" />
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div className="h-2.5 bg-surface-raised rounded w-12" />
            <div className="h-3 bg-surface-raised rounded w-14" />
          </div>
        </div>
      ))}
    </>
  );
}

export function TaskQueue() {
  // Real implementation is primary. `MOCK_TASKS` is a SAFETY NET only —
  // fires when the API errors AND we have no real data. The
  // `DemoFallbackBadge` makes the fallback visible.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tasks'],
    queryFn: listTasks,
    retry: 1,
  });
  const isUsingFallback = isError;
  const tasks = isError ? MOCK_TASKS : data;

  const [filter, setFilter] = useState<TaskFilter>('all');

  // `safeTasks` is `[]`-safe during loading. The summary copy above tells
  // the user data is on its way; an empty list is the honest "no tasks" state.
  const safeTasks = tasks ?? [];
  const openCount = safeTasks.filter((t) => isOpenStatus(t.status)).length;

  const filtered = sortTasks(safeTasks).filter((t) => {
    if (filter === 'critical') return t.priority === 'critical';
    if (filter === 'today') return t.due?.split('T')[0] === TODAY_ISO;
    if (filter === 'in_progress') return t.status === 'In Progress';
    return true;
  });

  return (
    <div className="px-6 py-6">
      {/* Top bar — title + (when relevant) the badge. */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-section text-text font-bold flex items-center gap-2">
          My Tasks
          {openCount > 0 && (
            <span className="text-xs font-bold text-cyan bg-cyan-dim border border-cyan rounded-pill px-2 py-0.5">
              {openCount}
            </span>
          )}
        </h1>
        {isUsingFallback && <DemoFallbackBadge />}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-0.5">
        {FILTER_TABS.map((f) => (
          <button
            key={f.key}
            type="button"
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
      <div data-testid="task-queue-list">
        {isLoading && <SkeletonRows />}
        {!isLoading && filtered.length === 0 && <EmptyState />}
        {!isLoading && filtered.map((task) =>
          task.status === 'Done' ? (
            <CompletedTaskRow key={task.id} task={task} />
          ) : (
            <OpenTaskRow key={task.id} task={task} />
          ),
        )}
      </div>
    </div>
  );
}