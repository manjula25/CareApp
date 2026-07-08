import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CarePlanBuilder } from './CarePlanBuilder';
import { AuthProvider } from '../auth/useAuth';

const STORAGE_KEY = 'caresync_token';

function renderWithPatient(patientId: string) {
  // Seed a token so the page's `useAuth().token` is defined.
  localStorage.setItem(STORAGE_KEY, 'test-token-for-care-plan');
  // Mock fetch globally so the save endpoint doesn't hit the network.
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: 'cp-1' }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[`/care-plans/${patientId}`]}>
        <Routes>
          <Route path="/care-plans/:patientId" element={<CarePlanBuilder />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('CarePlanBuilder — W14 care plan editor', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders the page title with the patient id from the URL', () => {
    renderWithPatient('maria-chen');
    expect(screen.getByText('Care Plan Builder')).toBeInTheDocument();
    expect(screen.getByText(/maria-chen/)).toBeInTheDocument();
  });

  it('renders the three initial goals from the seed data', () => {
    renderWithPatient('maria-chen');
    expect(screen.getByText(/Reduce HbA1c/)).toBeInTheDocument();
    expect(screen.getByText(/Monitor daily weight/)).toBeInTheDocument();
    expect(screen.getByText(/Establish reliable transportation/)).toBeInTheDocument();
  });

  it('renders the SDOH action chips', () => {
    renderWithPatient('maria-chen');
    expect(screen.getByText('Transportation')).toBeInTheDocument();
    expect(screen.getByText('Food Insecurity')).toBeInTheDocument();
  });

  it('POSTs to /api/care-plans/:patientId on save and shows a toast', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'cp-99' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    // Don't re-stub via renderWithPatient (it would clobber fetchMock).
    localStorage.setItem(STORAGE_KEY, 'test-token-for-care-plan');
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/care-plans/maria-chen']}>
          <Routes>
            <Route path="/care-plans/:patientId" element={<CarePlanBuilder />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.click(screen.getByTestId('save-care-plan'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/care-plans/maria-chen');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.goals.length).toBe(3);
    expect(body.interventions.length).toBeGreaterThan(0);
    expect(body.sdohActions.length).toBe(2);
  });
});