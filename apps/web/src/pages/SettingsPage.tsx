import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';

const roleLabels: Record<string, { label: string; color: string }> = {
  director: { label: 'Care Director', color: '#00C8FF' },
  coordinator: { label: 'Care Coordinator', color: '#8661D4' },
  social_worker: { label: 'Social Worker', color: '#0FC48A' },
};

interface HealthProbe {
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}

/** Probe `/api/health` and measure round-trip latency. Real value, not hardcoded. */
async function probeHealth(): Promise<HealthProbe> {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000';
  const token = localStorage.getItem('caresync_token');
  const start = performance.now();
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    });
    const elapsed = Math.round(performance.now() - start);
    if (!res.ok) return { ok: false, latencyMs: elapsed, error: `HTTP ${res.status}` };
    return { ok: true, latencyMs: elapsed };
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    return { ok: false, latencyMs: elapsed, error: (err as Error).message };
  }
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const roleInfo = user ? (roleLabels[user.role] ?? { label: user.role, color: '#00C8FF' }) : null;

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: probeHealth,
    // Keep the status fresh while the page is open; this is the actual
    // round-trip time to the API, useful for the demo presenter.
    refetchInterval: 30_000,
    retry: 0,
  });

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-text mb-8">Settings</h1>

      <section className="mb-6">
        <h2 className="text-xs font-semibold text-text-dim uppercase tracking-widest mb-3">Profile</h2>
        <div className="bg-surface border border-border rounded-xl p-5 flex items-center gap-5">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
            style={{ background: 'rgba(0,200,255,0.12)', color: '#00C8FF', border: '2px solid rgba(0,200,255,0.3)' }}
          >
            {user ? initials(user.name) : 'CS'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-text font-semibold text-base truncate">{user?.name ?? 'Unknown User'}</div>
            {roleInfo && (
              <span
                className="inline-block mt-1.5 px-2 py-0.5 rounded text-xs font-semibold"
                style={{ background: `${roleInfo.color}1A`, color: roleInfo.color }}
              >
                {roleInfo.label}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="mb-6" data-testid="system-status">
        <h2 className="text-xs font-semibold text-text-dim uppercase tracking-widest mb-3">System Status</h2>
        <div className="bg-surface border border-border rounded-xl divide-y divide-border">
          {/* Single live row — a real round-trip probe of `/api/health`. The
              `latencyMs` is whatever the browser just measured, not a
              hardcoded "42ms" string. No fake statuses for subsystems that
              aren't independently measurable here (AI Engine, SSE Streaming)
              — better to show nothing than invent numbers. */}
          <div className="flex items-center justify-between px-5 py-3.5" data-testid="health-row">
            <span className="text-text-muted text-sm">CareSync API (round-trip)</span>
            <div className="flex items-center gap-3">
              <span className="text-text-dim text-xs font-mono" data-testid="health-latency">
                {healthQuery.isLoading && healthQuery.data === undefined
                  ? 'measuring…'
                  : healthQuery.data?.latencyMs !== null && healthQuery.data?.latencyMs !== undefined
                    ? `${healthQuery.data.latencyMs}ms`
                    : '—'}
              </span>
              <span
                className="flex items-center gap-1.5 text-xs font-medium"
                style={{
                  color: healthQuery.data?.ok ? '#0FC48A' : '#E84848',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: healthQuery.data?.ok ? '#0FC48A' : '#E84848',
                    boxShadow: healthQuery.data?.ok ? '0 0 4px #0FC48A' : '0 0 4px #E84848',
                  }}
                />
                {healthQuery.data?.ok ? 'Operational' : (healthQuery.data?.error ?? 'Unreachable')}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-xs font-semibold text-text-dim uppercase tracking-widest mb-3">About</h2>
        <div className="bg-surface border border-border rounded-xl divide-y divide-border">
          {[
            ['Application', 'CareSync AI'],
            ['FHIR Standard', 'R4 (4.0.1)'],
            ['Competition', 'HL7 AI Challenge 2026'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between px-5 py-3.5">
              <span className="text-text-dim text-sm">{label}</span>
              <span className="text-text-muted text-sm font-mono">{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#E84848' }}>
          Session
        </h2>
        <div className="bg-surface border rounded-xl p-5" style={{ borderColor: 'rgba(232,72,72,0.25)' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text text-sm font-medium">Sign out</div>
              <div className="text-text-dim text-xs mt-0.5">End your current session and return to login</div>
            </div>
            {!showLogoutConfirm ? (
              <button
                onClick={() => setShowLogoutConfirm(true)}
                className="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{ background: 'rgba(232,72,72,0.12)', color: '#E84848', border: '1px solid rgba(232,72,72,0.3)' }}
              >
                Sign out
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-sm text-text-dim hover:text-text-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLogout}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                  style={{ background: '#E84848', color: '#fff' }}
                >
                  Confirm
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}