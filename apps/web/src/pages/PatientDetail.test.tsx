import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientDetail } from './PatientDetail';
import * as client from '../api/client';
import type { AnalysisHandlers } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, getPatient: vi.fn(), streamAnalysis: vi.fn() };
});

const mockPatient = {
  patient: { id: 'maria-1', name: 'Maria Chen', gender: 'female', birthDate: '1957-03-02' },
  conditions: [{ id: 'cond-1', code: 'E11.9', display: 'Type 2 diabetes' }],
  tasks: [{ id: 't1', title: 'Existing follow-up', priority: 'high' as const, due: '2026-07-04', status: 'Open' }],
};

function renderPatientDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/patients/maria-1']}>
        <Routes>
          <Route path="/patients/:id" element={<PatientDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Arranges a run in progress and hands back the captured SSE handlers + a resolver. */
function startRun() {
  let capturedHandlers: AnalysisHandlers | undefined;
  let resolveStream: () => void = () => {};
  vi.mocked(client.streamAnalysis).mockImplementation((_id, handlers) => {
    capturedHandlers = handlers;
    return new Promise<void>((resolve) => {
      resolveStream = resolve;
    });
  });
  fireEvent.click(screen.getByRole('button', { name: /run analysis/i }));
  return {
    handlers: () => capturedHandlers!,
    resolve: () => resolveStream(),
  };
}

describe('PatientDetail — Run Analysis + four-feed grid', () => {
  beforeEach(() => {
    vi.mocked(client.getPatient).mockResolvedValue(mockPatient);
  });

  it('shows all four feeds idle before any run', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');
    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(4);
  });

  it('streams Risk feed tokens incrementally, renders a finding chip and summary, and never touches the other three idle feeds', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    const run = startRun();
    expect(client.streamAnalysis).toHaveBeenCalledWith('maria-1', expect.any(Object));

    // Other three feeds stay idle the instant a run starts.
    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(3);

    act(() => run.handlers().onToken?.('Risk is '));
    expect(screen.getByText('Risk is')).toBeInTheDocument();

    act(() => run.handlers().onToken?.('elevated.'));
    expect(screen.getByText('Risk is elevated.')).toBeInTheDocument();

    act(() =>
      run.handlers().onFinding?.({ agentId: 'risk', text: 'HbA1c 8.9%', fhirResourceId: 'Observation/hba1c-1' })
    );
    expect(screen.getByText('Observation/hba1c-1')).toBeInTheDocument();

    act(() => {
      run.handlers().onComplete?.({
        agentId: 'risk',
        riskScore: 87,
        riskLevel: 'high',
        readmissionProbability: 0.42,
        findingCount: 1,
        droppedCount: 0,
      });
      run.resolve();
    });

    const summary = await screen.findByTestId('risk-summary');
    expect(summary.textContent).toContain('high');
    expect(summary.textContent).toContain('87');

    // Still idle throughout — the other three feeds were never wired up by risk's events.
    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(3);
  });

  it('streams the Care Gap feed in isolation without affecting SDOH/Action Planner/Risk', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    const run = startRun();

    act(() =>
      run.handlers().onFinding?.({
        agentId: 'careGap',
        gapType: 'screening',
        description: 'Colonoscopy overdue',
        urgency: 'high',
        fhirResourceId: 'Condition/gap-1',
      })
    );
    expect(screen.getByText('Condition/gap-1')).toBeInTheDocument();

    act(() => run.handlers().onToken?.('Colonoscopy overdue by 3 years.'));
    expect(screen.getByText('Colonoscopy overdue by 3 years.')).toBeInTheDocument();

    act(() => {
      run.handlers().onComplete?.({ agentId: 'careGap', findingCount: 1, droppedCount: 0 });
      run.resolve();
    });

    const summary = await screen.findByTestId('care-gap-summary');
    expect(summary.textContent).toContain('1 findings');
    expect(summary.textContent).toContain('0 dropped');

    // SDOH and Action Planner were never touched by careGap's events.
    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(2);
    // Risk left idle state at run-start but has no finding chips/summary of its own.
    expect(screen.queryByTestId('risk-summary')).not.toBeInTheDocument();
  });

  it('streams the SDOH feed in isolation without affecting Care Gap/Action Planner/Risk', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    const run = startRun();

    act(() =>
      run.handlers().onFinding?.({
        agentId: 'sdoh',
        domain: 'transportation',
        finding: 'No reliable transportation',
        severity: 'moderate',
        fhirResourceId: 'Observation/sdoh-1',
      })
    );
    expect(screen.getByText('Observation/sdoh-1')).toBeInTheDocument();

    act(() => run.handlers().onToken?.('Transportation access barrier noted.'));
    expect(screen.getByText('Transportation access barrier noted.')).toBeInTheDocument();

    act(() => {
      run.handlers().onComplete?.({ agentId: 'sdoh', findingCount: 1, droppedCount: 0, referralsNeeded: ['transportation'] });
      run.resolve();
    });

    const summary = await screen.findByTestId('sdoh-summary');
    expect(summary.textContent).toContain('1 findings');
    expect(summary.textContent).toContain('0 dropped');

    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(2);
    expect(screen.queryByTestId('care-gap-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('risk-summary')).not.toBeInTheDocument();
  });

  it('streams the Action Planner feed in isolation without affecting the other three', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    const run = startRun();

    act(() =>
      run.handlers().onFinding?.({ agentId: 'actionPlanner', fhirResourceId: 'Task/planner-1' })
    );
    expect(screen.getByText('Task/planner-1')).toBeInTheDocument();

    act(() => run.handlers().onToken?.('Drafting follow-up tasks.'));
    expect(screen.getByText('Drafting follow-up tasks.')).toBeInTheDocument();

    act(() => {
      run.handlers().onComplete?.({ agentId: 'actionPlanner', findingCount: 1, droppedCount: 0 });
      run.resolve();
    });

    const summary = await screen.findByTestId('action-planner-summary');
    expect(summary.textContent).toContain('1 findings');
    expect(summary.textContent).toContain('0 dropped');

    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(2);
    expect(screen.queryByTestId('sdoh-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('care-gap-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('risk-summary')).not.toBeInTheDocument();
  });

  it('renders a newly-created Task with citation chips alongside the initially-loaded task, and bumps the open count', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    // Original task from the initial query is present before any run.
    expect(screen.getByText('Existing follow-up')).toBeInTheDocument();
    expect(screen.getByText('1 open')).toBeInTheDocument();

    const run = startRun();

    act(() => {
      run.handlers().onTask?.({
        agentId: 'actionPlanner',
        id: 'new-task-1',
        reference: 'Task/new-task-1',
        title: 'Cardiology follow-up',
        description: 'Schedule within 72h — BNP elevation',
        priority: 'critical',
        dueInDays: 0,
        fhirResources: ['Condition/x', 'Observation/y'],
      });
      run.resolve();
    });

    await screen.findByText('Cardiology follow-up');
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    expect(screen.getByText('Condition/x')).toBeInTheDocument();
    expect(screen.getByText('Observation/y')).toBeInTheDocument();

    // Original task still renders alongside the new one.
    expect(screen.getByText('Existing follow-up')).toBeInTheDocument();
    expect(screen.getByText('2 open')).toBeInTheDocument();
  });
});
