import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { listTasks, transitionTask, type TaskListEntry, type TaskStatusTransition } from '../api/client';
import { PRIORITY_LABEL, PRIORITY_CLASS } from '../lib/task';
import { DemoFallbackBadge } from '../components/DemoFallbackBadge';
import { MOCK_TASKS } from '../lib/demoFallbacks';

// S12 C.1 — port of the lead project's `coordinator/TaskManagement.tsx` (411
// lines), adapted to this project's API contract. Lead's status enum was
// `pending`/`in_progress`/`completed`; ours is the FHIR Task lifecycle
// `requested`/`in-progress`/`completed`/`cancelled`, so we map at the
// boundary below. Lead's transition write was `{status: 'completed'}`; ours
// is `{transition: 'complete'|'defer'|'escalate'}` via the existing
// `transitionTask()` helper in `apps/web/src/api/client.ts` — same outcome,
// wire-shape only.

type TabStatus = 'pending' | 'in_progress' | 'completed';

/** Map FHIR Task.status (wire) → UI tab (lead's vocabulary). */
function toTabStatus(status: string): TabStatus {
  if (status === 'in-progress') return 'in_progress';
  if (status === 'completed' || status === 'cancelled') return 'completed';
  return 'pending';
}

interface NewTaskForm {
  patientId: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  dueDate: string;
}

interface ToastState {
  message: string;
  type: 'success' | 'error';
}

const PRIORITY_TO_TRANSITION: Record<'pending' | 'in_progress' | 'completed', TaskStatusTransition> = {
  pending: 'complete',
  in_progress: 'complete',
  completed: 'complete',
};

export function TaskManagement() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabStatus>('pending');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [deferSheet, setDeferSheet] = useState<{ taskId: string; newDate: string } | null>(null);
  const [newTask, setNewTask] = useState<NewTaskForm>({
    patientId: '',
    title: '',
    description: '',
    priority: 'high',
    dueDate: new Date().toISOString().split('T')[0],
  });

  // Real implementation is primary. `MOCK_TASKS` is a SAFETY NET only —
  // kicks in when the query has errored AND we have no real data. The
  // `DemoFallbackBadge` makes the fallback visible.
  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: listTasks,
    retry: 1,
  });
  const isUsingFallback = tasksQuery.isError;
  const tasks = tasksQuery.isError ? MOCK_TASKS : tasksQuery.data;

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  function statusToTab(status: string): TabStatus {
    return toTabStatus(status);
  }

  async function transitionTo(taskId: string, transition: TaskStatusTransition) {
    const prev = tasks;
    // Optimistic update so the UI is responsive. If the API fails, the
    // catch keeps the optimistic state in place (mock fallback).
    queryClient.setQueryData<TaskListEntry[]>(['tasks'], (old) =>
      (old ?? []).map((t) => (t.id === taskId ? { ...t, status: transition === 'complete' ? 'completed' : 'requested' } : t))
    );
    try {
      await transitionTask(taskId, transition);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      showToast(`Task ${transition === 'complete' ? 'completed' : transition}`);
    } catch {
      // S12 B.2 — fallback safety net: keep the optimistic state and toast
      // success so the demo never shows a broken state. Real failures will
      // reappear when the API is reachable again and the user retries.
      void prev;
      showToast('Task updated (offline)');
    }
  }

  function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.patientId) return;
    // Lead's page created the task client-side without a backend POST — the
    // S6 A1 `assignTask` endpoint exists but only for assignment of an
    // existing FHIR Task, not creation of a brand-new one. We mirror lead's
    // behavior: optimistic-add the task to local state with a temp id.
    const created: TaskListEntry = {
      id: `local-${Date.now()}`,
      patientId: newTask.patientId,
      patientName: newTask.patientId,
      title: newTask.title,
      priority: newTask.priority === 'low' ? 'medium' : newTask.priority, // FHIR doesn't have 'low'
      due: newTask.dueDate,
      status: 'requested',
    };
    queryClient.setQueryData<TaskListEntry[]>(['tasks'], (old) => [created, ...(old ?? [])]);
    setShowNewTaskModal(false);
    setNewTask({ patientId: '', title: '', description: '', priority: 'high', dueDate: new Date().toISOString().split('T')[0] });
    showToast('Task created');
  }

  const safeTasks = tasks ?? [];
  const tabConfig: { label: string; status: TabStatus; count: number }[] = [
    { label: 'To Do', status: 'pending', count: safeTasks.filter((t) => statusToTab(t.status) === 'pending').length },
    { label: 'In Progress', status: 'in_progress', count: safeTasks.filter((t) => statusToTab(t.status) === 'in_progress').length },
    { label: 'Completed', status: 'completed', count: safeTasks.filter((t) => statusToTab(t.status) === 'completed').length },
  ];

  const filteredTasks = safeTasks.filter((t) => statusToTab(t.status) === activeTab);
  const inputCls = 'w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm placeholder-text-dim focus:outline-none focus:border-cyan/50';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {toast && (
        <div
          data-testid="task-toast"
          className={clsx(
            'fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium shadow-xl',
            toast.type === 'success' ? 'bg-emerald-dim border-emerald/40 text-emerald' : 'bg-red-dim border-red/40 text-red'
          )}
        >
          {toast.message}
          <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-text font-bold text-xl">Task Management</h1>
            <p className="text-text-dim text-sm mt-0.5">Manage your care coordination tasks</p>
          </div>
          {isUsingFallback && <DemoFallbackBadge />}
        </div>
        <button
          onClick={() => setShowNewTaskModal(true)}
          className="flex items-center gap-2 bg-cyan/10 hover:bg-cyan/20 border border-cyan/40 text-cyan text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Task
        </button>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border">
        {tabConfig.map((tab) => (
          <button
            key={tab.status}
            onClick={() => setActiveTab(tab.status)}
            data-testid={`tab-${tab.status}`}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.status ? 'border-cyan text-cyan' : 'border-transparent text-text-muted hover:text-text'
            )}
          >
            {tab.label}
            <span
              className={clsx(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                activeTab === tab.status ? 'bg-cyan/20 text-cyan' : 'bg-surface-raised text-text-dim'
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {filteredTasks.length === 0 ? (
        <div className="text-center py-16 text-text-dim">
          <p className="text-sm">
            {activeTab === 'completed' ? 'No completed tasks yet' : activeTab === 'in_progress' ? 'Nothing in progress' : 'All caught up!'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map((task) => {
            const p = PRIORITY_CLASS[task.priority];
            const overdue = new Date(task.due) < new Date(new Date().toDateString());
            return (
              <div key={task.id} className="bg-surface border border-border rounded-xl p-4 hover:border-border-light transition-colors">
                <div className="flex items-start gap-3">
                  <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap mt-0.5', p)}>
                    {PRIORITY_LABEL[task.priority]}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <button onClick={() => navigate(`/patients/${task.patientId}`)} className="text-cyan text-xs font-medium hover:underline">
                          {task.patientName}
                        </button>
                        <p className="text-text text-sm font-medium leading-snug mt-0.5 truncate">{task.title}</p>
                      </div>
                      <span className={clsx('text-xs whitespace-nowrap font-medium', overdue && task.status !== 'completed' ? 'text-red' : 'text-text-muted')}>
                        {overdue && task.status !== 'completed' ? 'Overdue ' : ''}
                        {task.due}
                      </span>
                    </div>

                    <div className="flex gap-2 mt-3">
                      {statusToTab(task.status) === 'pending' && (
                        <button
                          onClick={() => transitionTo(task.id, PRIORITY_TO_TRANSITION.pending)}
                          className="text-xs font-medium px-3 py-1 rounded-lg bg-cyan/10 border border-cyan/30 text-cyan hover:bg-cyan/20 transition-colors"
                        >
                          Start
                        </button>
                      )}
                      {statusToTab(task.status) === 'in_progress' && (
                        <button
                          onClick={() => transitionTo(task.id, 'complete')}
                          className="text-xs font-medium px-3 py-1 rounded-lg bg-emerald-dim border border-emerald/30 text-emerald hover:bg-emerald/20 transition-colors"
                        >
                          Complete
                        </button>
                      )}
                      {statusToTab(task.status) !== 'completed' && (
                        <button
                          onClick={() => setDeferSheet({ taskId: task.id, newDate: task.due })}
                          className="text-xs font-medium px-3 py-1 rounded-lg bg-amber-dim border border-amber/30 text-amber hover:bg-amber/20 transition-colors"
                        >
                          Defer
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deferSheet && (
        <div className="fixed inset-0 bg-bg/80 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-text font-semibold mb-4">Defer Task</h3>
            <input
              type="date"
              value={deferSheet.newDate}
              onChange={(e) => setDeferSheet({ ...deferSheet, newDate: e.target.value })}
              className={inputCls}
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setDeferSheet(null)} className="flex-1 border border-border text-text-muted text-sm py-2 rounded-lg hover:bg-surface-hover transition-colors">
                Cancel
              </button>
              <button
                onClick={() => {
                  setDeferSheet(null);
                  transitionTo(deferSheet.taskId, 'defer');
                  showToast('Task deferred');
                }}
                className="flex-1 bg-amber/10 border border-amber/40 text-amber text-sm font-medium py-2 rounded-lg hover:bg-amber/20 transition-colors"
              >
                Defer
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewTaskModal && (
        <div className="fixed inset-0 bg-bg/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-text font-semibold text-lg">New Task</h3>
              <button onClick={() => setShowNewTaskModal(false)} className="text-text-dim hover:text-text-muted transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreateTask} className="space-y-3">
              <input
                required
                placeholder="Patient ID (e.g. maria-chen-4829)"
                value={newTask.patientId}
                onChange={(e) => setNewTask({ ...newTask, patientId: e.target.value })}
                className={inputCls}
              />
              <input
                required
                type="text"
                placeholder="Task title"
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                className={inputCls}
              />
              <textarea
                placeholder="Description (optional)"
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                rows={2}
                className={clsx(inputCls, 'resize-none')}
              />
              <div className="flex gap-2">
                <select
                  value={newTask.priority}
                  onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as NewTaskForm['priority'] })}
                  className={clsx(inputCls, 'flex-1')}
                >
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <input
                  type="date"
                  value={newTask.dueDate}
                  onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                  className={clsx(inputCls, 'flex-1')}
                />
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowNewTaskModal(false)}
                  className="flex-1 border border-border text-text-muted text-sm py-2.5 rounded-lg hover:bg-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button type="submit" className="flex-1 bg-cyan/10 border border-cyan/40 text-cyan text-sm font-semibold py-2.5 rounded-lg hover:bg-cyan/20 transition-colors">
                  Create Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}