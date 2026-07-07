import { useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { subscribeToEvents } from '../api/client';
import type { AssignedTaskEvent } from '../api/client';
import { Header } from './layout/Header';
import { Sidebar } from './layout/Sidebar';
import { MobileNav } from './layout/MobileNav';

const TOAST_DURATION_MS = 6000;

interface Toast {
  id: number;
  message: string;
}

export function AppShell() {
  const { user } = useAuth();
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
        setToasts((prev) => (prev.some((t) => t.message === message) ? prev : [...prev, { id, message }]));
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, TOAST_DURATION_MS);
      },
    });

    return unsubscribe;
  }, [user, queryClient]);

  return (
    <div className="flex flex-col bg-bg" style={{ height: '100vh', overflow: 'hidden' }}>
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <MobileNav />

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="flex items-center gap-2 bg-surface-raised border border-cyan rounded-card px-3.5 py-2.5 shadow-lg max-w-sm"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00C8FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span className="text-label text-text">{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
