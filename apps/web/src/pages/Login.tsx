import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, roleHome } from '../auth/useAuth';
import { PulseIcon } from '../icons';

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

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-surface border border-border rounded-card p-6">
        <div className="flex items-center gap-2 text-cyan mb-6">
          <PulseIcon className="w-6 h-6" />
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
    </div>
  );
}
