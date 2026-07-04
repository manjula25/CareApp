import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { PulseIcon, LogoutIcon } from '../icons';

const ROLE_LABEL: Record<string, string> = {
  director: 'Director',
  coordinator: 'Care Coordinator',
  social_worker: 'Social Worker',
};

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-bg">
      <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-surface">
        <div className="flex items-center gap-2 text-cyan">
          <PulseIcon className="w-5 h-5" />
          <span className="text-label uppercase tracking-wide font-semibold">CareSync AI</span>
        </div>
        {user && (
          <div className="flex items-center gap-4">
            <span className="text-body text-text-muted">
              {user.name} <span className="text-text-dim">· {ROLE_LABEL[user.role] ?? user.role}</span>
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
    </div>
  );
}
