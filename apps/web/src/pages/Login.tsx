import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, roleHome, type Role } from '../auth/useAuth';
import { LogoIcon } from '../icons';

// Demo accounts — kept in sync with apps/api/src/db/seed.ts so the picker
// can never advertise a login that the API would reject. If a new role is
// added in the seed, add it here too.
interface DemoAccount {
  email: string;
  name: string;
  role: Role;
  label: string;
}

const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: 'director@caresync.demo',    name: 'Dana Director',     role: 'director',     label: 'Director' },
  { email: 'coordinator@caresync.demo', name: 'Cara Coordinator',  role: 'coordinator',  label: 'Coordinator' },
  { email: 'socialworker@caresync.demo', name: 'Sam Socialworker', role: 'social_worker', label: 'Social Worker' },
];
const DEMO_PASSWORD = 'Demo1234!';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      navigate(roleHome(user.role), { replace: true });
    } catch {
      setError('Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  }

  function applyDemoAccount(account: DemoAccount) {
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-card p-6" data-testid="login-form">
          <div className="flex items-center gap-2 text-cyan mb-6">
            <LogoIcon />
            <span className="text-section font-semibold">CareSync AI</span>
          </div>

          <label className="block text-label uppercase tracking-wide text-text-muted mb-1" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mb-4 bg-surface-raised border border-border rounded-chip px-3 py-2 text-body text-text focus:outline-none focus:border-border-light"
          />

          <label className="block text-label uppercase tracking-wide text-text-muted mb-1" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mb-4 bg-surface-raised border border-border rounded-chip px-3 py-2 text-body text-text focus:outline-none focus:border-border-light"
          />

          {error && <p className="text-body text-red mb-4">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-cyan-dim border border-cyan text-cyan rounded-chip py-2 text-label uppercase tracking-wide hover:bg-cyan/20 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* Demo accounts — mirrors the lead project Login page. Clicking a
            row fills the form; the user still hits Sign in (matches the
            lead's behaviour and keeps the path through the same submit
            handler, so the error/rate-limit/session code is exercised). */}
        <section
          aria-label="Demo accounts"
          data-testid="demo-accounts"
          className="bg-surface border border-border rounded-card p-4"
        >
          <p className="text-label uppercase tracking-wide text-text-dim mb-3">
            Demo accounts
          </p>
          <ul className="flex flex-col gap-1">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => applyDemoAccount(account)}
                  data-testid={`demo-account-${account.role}`}
                  className="w-full text-left flex items-center justify-between gap-3 rounded-chip px-2 py-2 hover:bg-surface-hover focus:outline-none focus:bg-surface-hover transition-colors"
                >
                  <span className="flex flex-col min-w-0">
                    <span className="text-body text-text-muted truncate">{account.name}</span>
                    <span className="text-label text-text-dim truncate">{account.email}</span>
                  </span>
                  <span className="shrink-0 text-label text-cyan-dim bg-surface-raised border border-border rounded-pill px-2 py-0.5">
                    {account.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-label text-text-dim mt-3">
            Password: <code className="text-text-muted">{DEMO_PASSWORD}</code> for all accounts
          </p>
        </section>
      </div>
    </div>
  );
}
