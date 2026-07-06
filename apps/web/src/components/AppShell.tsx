import { useEffect, useRef, useState } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { subscribeToEvents } from '../api/client';
import type { AssignedTaskEvent } from '../api/client';
import { LogoIcon, BellIcon, LogoutIcon } from '../icons';

const ROLE_LABEL: Record<string, string> = {
  director: 'Director',
  coordinator: 'Care Coordinator',
  social_worker: 'Social Worker',
};

const TOAST_DURATION_MS = 6000;

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface Toast {
  id: number;
  message: string;
}

/**
 * S6 B1 — the Coordinator's live-assignment notification. Only coordinators
 * receive `assignment` events (see `routes/events.ts`'s webhook — it relays
 * to the Task's `ownerId` only), so the relay connection is opened only for
 * that role rather than for every logged-in user. No `M02` task queue exists
 * yet (that's S7) — the live update this slice owns is `PatientPanel`'s
 * `assigned-panel` query, invalidated here so it refetches wherever it's
 * mounted; this toast is what tells the Coordinator something changed if
 * they're looking at a different page.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToastId = useRef(0);

  useEffect(() => {
    if (!user || user.role !== 'coordinator') return;

    const unsubscribe = subscribeToEvents({
      onAssignment: (task: AssignedTaskEvent) => {
        queryClient.invalidateQueries({ queryKey: ['assigned-panel'] });

        const message = `New task assigned: ${task.title}`;
        const id = nextToastId.current++;
        // HAPI's rest-hook delivery for a single Task update has been
        // observed to fire twice in quick succession (confirmed against the
        // local instance) — skip a second toast with the same text rather
        // than showing the Coordinator two identical notifications.
        setToasts((prev) => (prev.some((t) => t.message === message) ? prev : [...prev, { id, message }]));
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, TOAST_DURATION_MS);
      },
    });

    return unsubscribe;
  }, [user, queryClient]);

  return (
    <div className="min-h-screen bg-bg">
      <header className="h-12 flex items-center gap-4 px-4 border-b border-border bg-surface">
        <div className="flex items-center gap-2">
          <LogoIcon className="text-cyan" />
          <span className="text-nav text-text-muted font-medium">
            CareSync<b className="text-cyan font-bold"> AI</b>
          </span>
        </div>

        <div className="flex gap-2 flex-1">
          <span className="text-xs uppercase tracking-wide text-text-muted border border-border-light rounded-pill px-2.5 py-0.5 bg-surface-raised whitespace-nowrap">
            FHIR R4
          </span>
          <span className="text-xs uppercase tracking-wide text-text-muted border border-border-light rounded-pill px-2.5 py-0.5 bg-surface-raised whitespace-nowrap">
            SMART on FHIR
          </span>
        </div>

        {user && (
          <div className="flex items-center gap-4">
            {/* S7 B1 — minimal nav affordance so Coordinators (and Social Workers,
                whose own home is now /tasks) can reach the M02 task queue.
                Director has no PRD story for it, so no link for that role. */}
            {(user.role === 'coordinator' || user.role === 'social_worker') && (
              <Link to="/tasks" className="text-label text-text-muted hover:text-text transition-colors">
                Tasks
              </Link>
            )}
            {/* S7 B3 — W13's nav-only shell (per GD9); PRD story 24 scopes it to
                the Coordinator. */}
            {user.role === 'coordinator' && (
              <Link to="/task-center" className="text-label text-text-muted hover:text-text transition-colors">
                Task Center
              </Link>
            )}
            {/* S8 B3 — the Director's only nav affordance to reach W06 from
                anywhere other than their post-login home (`/population`);
                Coordinator/Social Worker have no PRD story for this screen,
                so no link for those roles (mirrors the Tasks/Task Center
                links above, which are likewise scoped to their own roles). */}
            {user.role === 'director' && (
              <Link to="/governance" className="text-label text-text-muted hover:text-text transition-colors">
                Governance
              </Link>
            )}
            <BellIcon className="text-text-muted w-4 h-4" />
            <span
              className="w-7 h-7 rounded-full bg-surface-raised border border-border-light text-cyan text-xs font-bold flex items-center justify-center"
              title={`${user.name} · ${ROLE_LABEL[user.role] ?? user.role}`}
            >
              {initials(user.name)}
            </span>
            <button
              onClick={logout}
              className="flex items-center gap-1 text-label text-text-muted hover:text-text transition-colors"
            >
              <LogoutIcon className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="p-6">
        <Outlet />
      </main>

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="flex items-center gap-2 bg-surface-raised border border-cyan rounded-card px-3.5 py-2.5 shadow-lg max-w-sm"
            >
              <BellIcon className="text-cyan w-4 h-4 flex-none" />
              <span className="text-label text-text">{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
