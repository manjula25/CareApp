import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './useAuth';
import { RoleGuard } from './RoleGuard';
import { roleHome } from './useAuth';

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/panel']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route
            path="/panel"
            element={
              <RoleGuard>
                <div>Protected Panel</div>
              </RoleGuard>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('RoleGuard', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('redirects unauthenticated users to /login', () => {
    renderGuarded();
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  it('renders the protected content for an authenticated user', () => {
    const payload = btoa(JSON.stringify({ id: 'coord-1', name: 'Cara Coordinator', role: 'coordinator' }));
    localStorage.setItem('caresync_token', `header.${payload}.signature`);
    renderGuarded();
    expect(screen.getByText('Protected Panel')).toBeInTheDocument();
  });
});

describe('roleHome', () => {
  it('sends director to the Population Dashboard', () => {
    expect(roleHome('director')).toBe('/population');
  });

  it('sends coordinator to the /coordinator grid (lead-project port)', () => {
    // caresync-coordinator-grid-my-patients — coordinators now land on the
    // /coordinator grid view (port of the lead project's MyPatients)
    // instead of /task-center. /task-center stays reachable via the sidebar.
    expect(roleHome('coordinator')).toBe('/coordinator');
  });

  it('sends social_worker to the mobile task queue (M02)', () => {
    expect(roleHome('social_worker')).toBe('/tasks');
  });
});

function renderPopulationGuard() {
  return render(
    <MemoryRouter initialEntries={['/population']}>
      <AuthProvider>
        <Routes>
          <Route path="/coordinator" element={<div>Coordinator My Patients</div>} />
          <Route
            path="/population"
            element={
              <RoleGuard role="director">
                <div>Population Dashboard</div>
              </RoleGuard>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

function setAuthedUser(role: string) {
  const payload = btoa(JSON.stringify({ id: 'user-1', name: 'Test User', role }));
  localStorage.setItem('caresync_token', `header.${payload}.signature`);
}

describe('RoleGuard role restriction', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('lets a director reach a director-only route', () => {
    setAuthedUser('director');
    renderPopulationGuard();
    expect(screen.getByText('Population Dashboard')).toBeInTheDocument();
  });

  it('redirects a coordinator away from a director-only route to their own home', () => {
    setAuthedUser('coordinator');
    renderPopulationGuard();
    expect(screen.getByText('Coordinator My Patients')).toBeInTheDocument();
    expect(screen.queryByText('Population Dashboard')).not.toBeInTheDocument();
  });
});
