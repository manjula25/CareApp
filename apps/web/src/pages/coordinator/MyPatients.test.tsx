import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyPatients } from './MyPatients';
import * as client from '../../api/client';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, getAssignedPanel: vi.fn() };
});

const panelFixture: Awaited<ReturnType<typeof client.getAssignedPanel>> = [
  { id: 'p-maria', name: 'Maria Chen', gender: 'female', birthDate: '1957-04-12', riskScore: 87, taskCount: 2, conditionTags: ['CHF', 'T2DM'], daysSinceContact: 2 },
  { id: 'p-robert', name: 'Robert Torres', gender: 'male', birthDate: '1953-09-25', riskScore: 76, taskCount: 1, conditionTags: ['COPD', 'HTN'], daysSinceContact: 5 },
  { id: 'p-james', name: 'James Anderson', gender: 'male', birthDate: '1947-06-30', riskScore: 71, taskCount: 0, conditionTags: ['CHF', 'A-Fib'], daysSinceContact: 8 },
  // Non-critical, but > 14 days since contact — used to drive the
  // "Needs Contact" filter / badge assertion without mocking a fresh patient
  // just for that path. daysSinceContact comes from the API shape now, so
  // this fixture is also wired into a 'needs_contact' expectation below.
  { id: 'p-linda', name: 'Linda Martinez', gender: 'female', birthDate: '1964-03-18', riskScore: 42, taskCount: 0, conditionTags: ['HTN', 'Anxiety'], daysSinceContact: 21 },
];

function renderMyPatients() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/coordinator']}>
        <Routes>
          <Route path="/coordinator" element={<MyPatients />} />
          <Route path="/patients/:id" element={<div>Patient Detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MyPatients — Caresync-coordinator-grid-my-patients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the grid with stats, filters, and a card per real-data patient', async () => {
    vi.mocked(client.getAssignedPanel).mockResolvedValue(panelFixture);
    renderMyPatients();

    await waitFor(() => expect(screen.getByTestId('my-patient-card-p-maria')).toBeInTheDocument());

    // Stats bar
    expect(screen.getByText('Patients')).toBeInTheDocument();
    expect(screen.getByText('Pending Tasks')).toBeInTheDocument();
    expect(screen.getByText('Need Contact')).toBeInTheDocument();

    // Filter chips
    expect(screen.getByRole('button', { name: /All/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Critical/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /High/ })).toBeInTheDocument();

    // Cards
    expect(screen.getByText('Maria Chen')).toBeInTheDocument();
    expect(screen.getByText('Robert Torres')).toBeInTheDocument();
    expect(screen.getByText('James Anderson')).toBeInTheDocument();

    // Risk pill wording comes from the riskScore -> riskLevel mapping
    const mariaCard = within(screen.getByTestId('my-patient-card-p-maria'));
    expect(mariaCard.getByText(/87/)).toBeInTheDocument();
    expect(mariaCard.getByText(/Critical/)).toBeInTheDocument();

    // View button
    expect(mariaCard.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('filters down to critical patients when the Critical chip is clicked', async () => {
    vi.mocked(client.getAssignedPanel).mockResolvedValue(panelFixture);
    renderMyPatients();

    await waitFor(() => expect(screen.getByTestId('my-patient-card-p-maria')).toBeInTheDocument());

    await screen.getByRole('button', { name: /Critical/ }).click();

    // Risk level is derived from riskScore: critical ≥ 70, high ≥ 50.
    // Maria (87), Robert (76), and James (71) all classify as critical;
    // Linda (42) is medium and falls out.
    expect(screen.getByTestId('my-patient-card-p-maria')).toBeInTheDocument();
    expect(screen.getByTestId('my-patient-card-p-robert')).toBeInTheDocument();
    expect(screen.getByTestId('my-patient-card-p-james')).toBeInTheDocument();
    expect(screen.queryByTestId('my-patient-card-p-linda')).not.toBeInTheDocument();
  });

  it('falls back to MOCK_PANEL_PATIENTS and shows the demo badge when the API errors', async () => {
    vi.mocked(client.getAssignedPanel).mockRejectedValue(new Error('server unreachable'));
    renderMyPatients();

    // The component declares `retry: 1`, so the query retries once before
    // settling on error — give the badge enough time to appear.
    await waitFor(() => expect(screen.getByTestId('demo-fallback-badge')).toBeInTheDocument(), { timeout: 5000 });
    // Mock data is shown
    expect(screen.getByTestId('my-patient-card-maria-chen-4829')).toBeInTheDocument();
    // The mock carries daysSinceContact so the contact-status label is rendered
    const mariaMockCard = within(screen.getByTestId('my-patient-card-maria-chen-4829'));
    expect(mariaMockCard.getByText(/2d since contact/)).toBeInTheDocument();
  });
});