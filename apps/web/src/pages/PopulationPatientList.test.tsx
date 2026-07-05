import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PopulationPatientList } from './PopulationPatientList';
import * as client from '../api/client';
import type { PatientDetail } from '../api/client';
import type { PopulationPatientListState } from './Population';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, getPatient: vi.fn() };
});

function makePatient(id: string, name: string): PatientDetail {
  return {
    patient: { id, name, gender: 'female', birthDate: '1960-01-01' },
    conditions: [],
    tasks: [],
  };
}

function renderList(state: PopulationPatientListState | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/population/patients', state }]}>
        <Routes>
          <Route path="/population/patients" element={<PopulationPatientList />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PopulationPatientList — B3 drill-in list (id list from quadrant click -> patient rows)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and renders a row per id in location.state, linking each to /patients/:id', async () => {
    vi.mocked(client.getPatient).mockImplementation((id) => Promise.resolve(makePatient(id, `Patient ${id}`)));

    renderList({ patientIds: ['p1', 'p2'], riskScoreById: { p1: 87, p2: 65 }, label: 'Critical — Act Now' });

    expect(await screen.findByText('Patient p1')).toBeInTheDocument();
    expect(await screen.findByText('Patient p2')).toBeInTheDocument();
    expect(client.getPatient).toHaveBeenCalledWith('p1');
    expect(client.getPatient).toHaveBeenCalledWith('p2');

    const link1 = screen.getByText('Patient p1').closest('a');
    expect(link1).toHaveAttribute('href', '/patients/p1');
    const link2 = screen.getByText('Patient p2').closest('a');
    expect(link2).toHaveAttribute('href', '/patients/p2');
  });

  it('shows the quadrant label and count from state', async () => {
    vi.mocked(client.getPatient).mockImplementation((id) => Promise.resolve(makePatient(id, `Patient ${id}`)));
    renderList({ patientIds: ['p1'], riskScoreById: { p1: 87 }, label: 'Critical — Act Now' });

    expect(await screen.findByText('Critical — Act Now')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('shows a per-row error fallback when one patient fetch fails, without crashing the rest of the list', async () => {
    vi.mocked(client.getPatient).mockImplementation((id) => {
      if (id === 'bad') return Promise.reject(new Error('boom'));
      return Promise.resolve(makePatient(id, `Patient ${id}`));
    });

    renderList({ patientIds: ['p1', 'bad'], riskScoreById: { p1: 87, bad: 65 }, label: 'Critical — Act Now' });

    expect(await screen.findByText('Patient p1')).toBeInTheDocument();
    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
    // The good row still renders and links correctly despite the bad one failing.
    expect(screen.getByText('Patient p1').closest('a')).toHaveAttribute('href', '/patients/p1');
  });

  it('guards against direct navigation with no state instead of crashing', () => {
    renderList(undefined);
    expect(screen.getByText(/no filter selected/i)).toBeInTheDocument();
    expect(client.getPatient).not.toHaveBeenCalled();
  });

  it('shows a loading state before the per-id fetches resolve', () => {
    vi.mocked(client.getPatient).mockReturnValue(new Promise(() => {}));
    renderList({ patientIds: ['p1'], riskScoreById: { p1: 87 }, label: 'Critical — Act Now' });
    expect(within(screen.getByRole('list')).getByText(/loading/i)).toBeInTheDocument();
  });
});
