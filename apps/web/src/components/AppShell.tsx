import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { LogoIcon, BellIcon, LogoutIcon } from '../icons';

const ROLE_LABEL: Record<string, string> = {
  director: 'Director',
  coordinator: 'Care Coordinator',
  social_worker: 'Social Worker',
};

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function AppShell() {
  const { user, logout } = useAuth();

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
    </div>
  );
}
