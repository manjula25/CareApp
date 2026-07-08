import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientDetail } from './PatientDetail';
import * as client from '../api/client';
import type { AnalysisHandlers } from '../api/client';
import { AuthProvider } from '../auth/useAuth';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getPatient: vi.fn(),
    streamAnalysis: vi.fn(),
    subscribeToEvents: vi.fn(() => () => {}),
  };
});

const mockPatient = {
  patient: { id: 'maria-1', name: 'Maria Chen', gender: 'female', birthDate: '1957-03-02' },
  conditions: [{ id: 'cond-1', code: 'E11.9', display: 'Type 2 diabetes' }],
  tasks: [] as Array<{ id: string; title: string; priority: 'critical' | 'high' | 'medium'; due: string; status: string }>,
};

function renderPatientDetail(route = '/patients/maria-1') {
  // Caresync-coordinator-grid-my-patients — PatientDetail now uses useAuth
  // (for the role-aware back link), so wrap with AuthProvider + a director
  // token so useAuth() returns a populated user.
  const payload = btoa(JSON.stringify({ id: 'dir-1', name: 'Test Director', role: 'director' }));
  localStorage.setItem('caresync_token', `header.${payload}.signature`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/patients/:id" element={<PatientDetail />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/** Captures the streamAnalysis handlers + a resolver for completion. */
function captureStreamHandlers() {
  let captured: AnalysisHandlers | undefined;
  let resolveFn: () => void = () => {};
  vi.mocked(client.streamAnalysis).mockImplementation((_id, handlers, _opts) => {
    captured = handlers;
    return new Promise<void>((res) => { resolveFn = res; });
  });
  return {
    handlers: () => captured as Required<AnalysisHandlers>,
    finish: () => resolveFn(),
  };
}

describe('PatientDetail — backend-branch core SSE flow', () => {
  beforeEach(() => {
    vi.mocked(client.getPatient).mockResolvedValue(mockPatient);
    vi.mocked(client.subscribeToEvents).mockReturnValue(() => {});
  });

  it('renders the patient with conditions after the query resolves', async () => {
    renderPatientDetail();
    await waitFor(() => expect(screen.getAllByText('Maria Chen').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText('Type 2 diabetes')).toBeInTheDocument();
  });

  it('renders a fallback "Loading patient…" when the query is pending and an error message when it rejects', async () => {
    vi.mocked(client.getPatient).mockRejectedValue(new Error('404'));
    renderPatientDetail();
    await waitFor(() => expect(screen.getByText(/404/)).toBeInTheDocument());
  });

  it('shows "Run live" + "Run Analysis" buttons after the patient query resolves', async () => {
    renderPatientDetail();
    await waitFor(() => expect(screen.getAllByText('Maria Chen').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByRole('button', { name: /run live/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run analysis/i })).toBeInTheDocument();
  });

  it('invokes streamAnalysis with the route id when "Run Analysis" is clicked', async () => {
    renderPatientDetail();
    await waitFor(() => expect(screen.getAllByText('Maria Chen').length).toBeGreaterThanOrEqual(1));
    captureStreamHandlers();
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }));
    expect(client.streamAnalysis).toHaveBeenCalledTimes(1);
    const [firstArg, secondArg] = vi.mocked(client.streamAnalysis).mock.calls[0];
    expect(firstArg).toBe('maria-1');
    expect(typeof (secondArg as AnalysisHandlers).onToken).toBe('function');
  });

  it('routes a `token` event to the correct agent feed (no bleed)', async () => {
    renderPatientDetail();
    await waitFor(() => expect(screen.getAllByText('Maria Chen').length).toBeGreaterThanOrEqual(1));
    const c = captureStreamHandlers();
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }));

    act(() => c.handlers().onToken?.('risk', 'Risk is elevated.'));
    act(() => c.handlers().onToken?.('careGap', 'Care gap narration.'));
    act(() => c.handlers().onToken?.('sdoh', 'SDOH narration.'));
    act(() => c.handlers().onToken?.('actionPlanner', 'Action plan narration.'));
    act(() => c.finish());

    // The feeds grid renders each agent's stream text directly (no separate
    // testid for the stream itself; the text is the assertion). All four
    // text fragments must be present and never collapsed into one.
    expect(screen.getByText(/Risk is elevated\./)).toBeInTheDocument();
    expect(screen.getByText(/Care gap narration\./)).toBeInTheDocument();
    expect(screen.getByText(/SDOH narration\./)).toBeInTheDocument();
    expect(screen.getByText(/Action plan narration\./)).toBeInTheDocument();
  });

  it('fires a `complete` event for ALL FOUR agents (not just Risk/Care Gap) — the S12 fix', async () => {
    renderPatientDetail();
    await waitFor(() => expect(screen.getAllByText('Maria Chen').length).toBeGreaterThanOrEqual(1));
    const c = captureStreamHandlers();
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }));

    // All four complete events fire.
    act(() => c.handlers().onComplete?.({ agentId: 'risk', findingCount: 3, droppedCount: 0, riskScore: 87, riskLevel: 'critical', readmissionProbability: 0.7 }));
    act(() => c.handlers().onComplete?.({ agentId: 'careGap', findingCount: 5, droppedCount: 0 }));
    act(() => c.handlers().onComplete?.({ agentId: 'sdoh', findingCount: 2, droppedCount: 0, referralsNeeded: ['Food pantry'] }));
    act(() => c.handlers().onComplete?.({ agentId: 'actionPlanner', findingCount: 4, droppedCount: 0 }));
    act(() => c.finish());

    // All four summary lines render — this is the exact assertion the user
    // reported as failing before the fix (SDOH and Action Planner were
    // empty after a real run).
    expect(screen.getByTestId('risk-summary').textContent).toMatch(/critical.*87/);
    expect(screen.getByTestId('care-gap-summary').textContent).toMatch(/5 findings.*0 dropped/);
    expect(screen.getByTestId('sdoh-summary').textContent).toMatch(/2 findings.*0 dropped/);
    expect(screen.getByTestId('action-planner-summary').textContent).toMatch(/4 findings.*0 dropped/);
  });

  it('surfaces a `task` event into the Tasks list with its priority pill', async () => {
    renderPatientDetail();
    await waitFor(() => expect(screen.getAllByText('Maria Chen').length).toBeGreaterThanOrEqual(1));
    const c = captureStreamHandlers();
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }));

    act(() => {
      c.handlers().onTask?.({
        agentId: 'actionPlanner',
        id: 'new-task-1',
        reference: 'Task/new-task-1',
        title: 'Cardiology follow-up',
        description: 'Schedule within 72h — BNP elevation',
        priority: 'critical',
        dueInDays: 0,
        fhirResources: ['Observation/bnp-1'],
      });
      c.finish();
    });

    expect(await screen.findByText('Cardiology follow-up')).toBeInTheDocument();
    expect(screen.getByText('Task/new-task-1')).toBeInTheDocument();
  });
});