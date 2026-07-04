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
  it('sends coordinator to the My Patient Panel', () => {
    expect(roleHome('coordinator')).toBe('/panel');
  });

  it('sends director and social_worker to the coming-soon placeholder', () => {
    expect(roleHome('director')).toBe('/coming-soon');
    expect(roleHome('social_worker')).toBe('/coming-soon');
  });
});
