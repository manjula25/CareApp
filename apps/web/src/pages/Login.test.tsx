import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/useAuth';
import { Login } from './Login';

// Mock only the network surface used by useAuth.login — everything else
// (state, navigation) runs through the real module so the wiring stays
// exercised in test. The token shape mirrors what the API's signToken
// emits: base64url JSON payload with id/name/role.
vi.mock('../api/client', async () => {
  function makeToken(role: 'director' | 'coordinator' | 'social_worker', name: string) {
    const payload = btoa(JSON.stringify({ id: `${role}-1`, name, role }));
    return `header.${payload}.signature`;
  }
  return {
    login: vi.fn(async (email: string) => {
      if (email.startsWith('director'))     return { token: makeToken('director',    'Dana Director') };
      if (email.startsWith('coordinator'))  return { token: makeToken('coordinator', 'Cara Coordinator') };
      if (email.startsWith('socialworker')) return { token: makeToken('social_worker','Sam Socialworker') };
      throw new Error('Invalid credentials');
    }),
    AUTH_LOGOUT_EVENT: 'caresync:auth-logout',
  };
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/population" element={<div>Director Home</div>} />
          <Route path="/coordinator" element={<div>Coordinator Home</div>} />
          <Route path="/tasks" element={<div>Social Worker Home</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Login', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the demo-accounts picker with one row per role', () => {
    renderLogin();
    expect(screen.getByTestId('demo-accounts')).toBeInTheDocument();
    expect(screen.getByTestId('demo-account-director')).toHaveTextContent('Director');
    expect(screen.getByTestId('demo-account-coordinator')).toHaveTextContent('Coordinator');
    expect(screen.getByTestId('demo-account-social_worker')).toHaveTextContent('Social Worker');
  });

  it('shows each seeded email next to its role', () => {
    renderLogin();
    expect(screen.getByText('director@caresync.demo')).toBeInTheDocument();
    expect(screen.getByText('coordinator@caresync.demo')).toBeInTheDocument();
    expect(screen.getByText('socialworker@caresync.demo')).toBeInTheDocument();
  });

  it('clicking a demo row fills the email and password fields', () => {
    renderLogin();

    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(emailInput.value).toBe('');
    expect(passwordInput.value).toBe('');

    fireEvent.click(screen.getByTestId('demo-account-coordinator'));

    expect(emailInput.value).toBe('coordinator@caresync.demo');
    expect(passwordInput.value).toBe('Demo1234!');
  });

  it('clicking a demo row then submitting lands on that role home', async () => {
    renderLogin();

    fireEvent.click(screen.getByTestId('demo-account-director'));
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Director Home')).toBeInTheDocument();
    });
  });

  it('surfaces the error message when the picked account fails to authenticate', async () => {
    // We can't induce an API failure through the picker (the rows only
    // map to seeded accounts), so exercise the error path by typing bad
    // credentials directly. This locks in the failure-mode UI so the
    // picker doesn't accidentally regress the error rendering.
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'stranger@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid email or password.')).toBeInTheDocument();
    });
  });
});

