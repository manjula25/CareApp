import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientDetail } from './PatientDetail';
import * as client from '../api/client';
import type { AnalysisHandlers } from '../api/client';

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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/patients/:id" element={<PatientDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Captures the streamAnalysis handlers + a resolver for completion. */
function captureStreamHandlers() {
  let captured: AnalysisHandlers | undefined;
  let resolveFn: () => void = () => {};
  vi.mocked(client.streamAnalysis).mockImplementation((_id, handlers) => {
    captured = handlers;
    return new Promise<void>((res) => { resolveFn = res; });
  });
  return {
    handlers: () => captured as Required<AnalysisHandlers>,
    finish: () => resolveFn(),
  };
}

describe('PatientDetail — Phase 1 lead-port data wiring + view modes', () => {
  beforeEach(() => {
    vi.mocked(client.getPatient).mockResolvedValue(mockPatient);
    vi.mocked(client.subscribeToEvents).mockReturnValue(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the Maria Chen mock patient fallback when the route id is unknown', async () => {
    vi.mocked(client.getPatient).mockRejectedValue(new Error('404'));
    renderPatientDetail('/patients/never-seen-before');
    await waitFor(() => expect(screen.getAllByText('Maria Chen').length).toBeGreaterThanOrEqual(1));
    // The hero risk badge is the most visible marker of the panel-mode render.
    expect(screen.getByTestId('patient-risk-badge')).toBeInTheDocument();
  });

  it('shows the view-mode toggle (panel / cinema / orchestrator)', async () => {
    renderPatientDetail();
    await waitFor(() => screen.getByText('Maria Chen'));
    expect(screen.getByTestId('view-mode-panel')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-cinema')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-orchestrator')).toBeInTheDocument();
  });

  it('switches to cinema view and shows its hero risk badge', async () => {
    renderPatientDetail();
    await waitFor(() => screen.getByText('Maria Chen'));
    fireEvent.click(screen.getByTestId('view-mode-cinema'));
    await waitFor(() => expect(screen.getByTestId('cinema-risk-badge')).toBeInTheDocument());
    // Cinema mode has its own Run Analysis button with a different testid.
    expect(screen.getByTestId('cinema-run-analysis')).toBeInTheDocument();
  });

  it('switches to orchestrator view and reveals the FHIR Bundle toggle', async () => {
    renderPatientDetail();
    await waitFor(() => screen.getByText('Maria Chen'));
    fireEvent.click(screen.getByTestId('view-mode-orchestrator'));
    await waitFor(() => expect(screen.getByTestId('fhir-bundle-toggle')).toBeInTheDocument());
    expect(screen.getByTestId('fhir-bundle-panel')).toBeInTheDocument();
  });
});

describe('PatientDetail — Run Analysis SSE event mapping', () => {
  beforeEach(() => {
    vi.mocked(client.getPatient).mockResolvedValue(mockPatient);
    vi.mocked(client.subscribeToEvents).mockReturnValue(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes streamAnalysis with the route id', async () => {
    renderPatientDetail();
    await waitFor(() => screen.getByText('Maria Chen'));
    captureStreamHandlers();
    fireEvent.click(screen.getByTestId('run-analysis'));
    // The new lead-ported PatientDetail doesn't pass an opts arg — `live`
    // toggling is not exposed in the simplified Run Analysis button. We
    // assert the patient id + handler bundle were passed and leave the
    // argument-length contract loose (vitest records exact-args).
    expect(client.streamAnalysis).toHaveBeenCalledTimes(1);
    const [firstArg, secondArg] = vi.mocked(client.streamAnalysis).mock.calls[0];
    expect(firstArg).toBe('maria-1');
    expect(typeof (secondArg as AnalysisHandlers).onToken).toBe('function');
  });

  it('appends a token to Risk Agent\'s stream text on a `token` event', async () => {
    renderPatientDetail();
    await waitFor(() => screen.getByText('Maria Chen'));
    const c = captureStreamHandlers();
    fireEvent.click(screen.getByTestId('run-analysis'));

    act(() => c.handlers().onToken?.('risk', 'Risk is elevated.'));
    // Risk Agent's card has status "running" and the streamed text appears in the body.
    expect(screen.getByText(/Risk is elevated\./)).toBeInTheDocument();
  });

  it('appends every finding to Risk Agent\'s findings list with severity-dot + confidence label', async () => {
    renderPatientDetail();
    await waitFor(() => screen.getByText('Maria Chen'));
    const c = captureStreamHandlers();
    fireEvent.click(screen.getByTestId('run-analysis'));

    act(() => c.handlers().onFinding?.({
      agentId: 'risk',
      text: 'HbA1c 8.9%',
      fhirResourceId: 'Observation/hba1c-1',
      severity: 'critical',
      confidence: 0.92,
    }));
    // Findings only render once the agent transitions to `complete` (matches
    // the lead project's AgentCard render condition) — flip it and verify.
    act(() => c.handlers().onComplete?.({
      agentId: 'risk',
      findingCount: 1,
      droppedCount: 0,
      riskScore: 87,
      riskLevel: 'high',
    }));
    act(() => c.finish());

    expect(screen.getByText('Observation/hba1c-1')).toBeInTheDocument();
    expect(screen.getByTestId('confidence-riskAgent-0').textContent).toMatch(/0\.92/);
    expect(screen.getByTestId('summary-riskAgent').textContent).toMatch(/high.*87/);
  });

  it('never bleeds Care Gap tokens into Risk Agent\'s card', async () => {
    renderPatientDetail();
    await waitFor(() => screen.getByText('Maria Chen'));
    const c = captureStreamHandlers();
    fireEvent.click(screen.getByTestId('run-analysis'));

    act(() => c.handlers().onToken?.('risk', 'Risk narration.'));
    act(() => c.handlers().onToken?.('careGap', 'Care gap narration.'));

    act(() => c.finish());

    // Each agent has a unique stream-text testid (`stream-{agentKey}`) so the
    // isolation check is direct — no risk of colliding with the
    // AnalysisProgressFloat's repeated "Risk Agent" labels.
    const riskStream = screen.getByTestId('stream-riskAgent');
    const careGapStream = screen.getByTestId('stream-careGapAgent');
    expect(riskStream.textContent).toBe('Risk narration.');
    expect(careGapStream.textContent).toBe('Care gap narration.');
  });

  it('passes a `task` event through to the action-planner findings so it surfaces in the Action Plan column', async () => {
    renderPatientDetail();
    await waitFor(() => screen.getByText('Maria Chen'));
    const c = captureStreamHandlers();
    fireEvent.click(screen.getByTestId('run-analysis'));

    act(() => {
      c.handlers().onTask?.({
        agentId: 'actionPlanner',
        id: 'new-task-1',
        reference: 'Condition/x',
        title: 'Cardiology follow-up',
        description: 'Schedule within 72h — BNP elevation',
        priority: 'critical',
        dueInDays: 0,
        fhirResources: ['Observation/y'],
      });
      c.finish();
    });

    const plan = await screen.findByTestId('action-plan');
    expect(plan.textContent).toContain('Cardiology follow-up');
    expect(plan.textContent).toContain('Condition/x');
  });

  it('falls back to the simulated MOCK_ANALYSIS run when streamAnalysis rejects (real stream unreachable)', async () => {
    renderPatientDetail();
    await waitFor(() => screen.getByText('Maria Chen'));
    vi.mocked(client.streamAnalysis).mockRejectedValue(new Error('network down'));

    fireEvent.click(screen.getByTestId('run-analysis'));
    // runMockSim's staggered timeouts (300/600/900/4200ms starts, 2400/3900/5300/7000ms completes,
    // 7400ms isRunning=false) need ~8s of wall clock to all fire under real timers.
    await new Promise((r) => setTimeout(r, 8500));

    // Each agent's card has its mock-side findings text rendered.
    expect(screen.getAllByText(/Complete/).length).toBeGreaterThan(0);
  }, 15000);

  it('falls back to the simulated run when streamAnalysis never produces an event within the 4s timeout', async () => {
    renderPatientDetail();
    await waitFor(() => screen.getByText('Maria Chen'));
    vi.mocked(client.streamAnalysis).mockReturnValue(new Promise(() => {})); // never resolves

    fireEvent.click(screen.getByTestId('run-analysis'));
    // 4s anyEventTimeout → runMockSim fires; then ~7.4s more for staggered timeouts. ~12s total.
    await new Promise((r) => setTimeout(r, 12500));
    expect(screen.getAllByText(/Complete/).length).toBeGreaterThan(0);
  }, 20000);
});
