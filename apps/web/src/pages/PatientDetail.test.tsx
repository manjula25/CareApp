import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientDetail } from './PatientDetail';
import * as client from '../api/client';
import type { AnalysisHandlers, AssignedTaskEvent } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, getPatient: vi.fn(), streamAnalysis: vi.fn(), subscribeToEvents: vi.fn() };
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
    vi.mocked(client.subscribeToEvents).mockReturnValue(vi.fn());
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
    expect(client.streamAnalysis).toHaveBeenCalledWith('maria-1', expect.any(Object), { live: false });

    // Other three feeds stay idle the instant a run starts.
    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(3);

    act(() => run.handlers().onToken?.('risk', 'Risk is '));
    expect(screen.getByText('Risk is')).toBeInTheDocument();

    act(() => run.handlers().onToken?.('risk', 'elevated.'));
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

  it('flips the Care Gap feed live on its first token alone — matching the real backend, which narrates via tokens throughout and only emits finding/complete at the very end of its own stream', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    const run = startRun();
    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(3);

    // Only a token arrives — no finding/complete yet, reproducing the real
    // narrate-then-result ordering instead of the test-only finding-first shortcut.
    act(() => run.handlers().onToken?.('careGap', 'Checking care plan...'));

    expect(screen.getByText('Checking care plan...')).toBeInTheDocument();
    // Care Gap's box must already be live; SDOH and Action Planner remain idle.
    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(2);
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

    act(() => run.handlers().onToken?.('careGap', 'Colonoscopy overdue by 3 years.'));
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

    act(() => run.handlers().onToken?.('sdoh', 'Transportation access barrier noted.'));
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

    act(() => run.handlers().onToken?.('actionPlanner', 'Drafting follow-up tasks.'));
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

  it('attributes each agent\'s token to its own feed box even when Risk and Care Gap tokens interleave before either agent has emitted a finding/complete', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    const run = startRun();

    // Reproduces the real interleaving order from the backend: Risk's first
    // token, then Care Gap's first token — BEFORE either agent has emitted any
    // finding/complete event — then Risk finishes, then Care Gap finishes.
    act(() => run.handlers().onToken?.('risk', 'Risk narration.'));
    act(() => run.handlers().onToken?.('careGap', 'Care gap narration.'));

    // Risk was already "started" (it's the first agent to run), so its token
    // renders immediately. Care Gap's box only flips out of idle once its own
    // finding/complete arrives below — but the text buffered from this early
    // token must already be attributed to careGap, not risk, so it surfaces
    // in the Care Gap box (not Risk's) once Care Gap starts rendering.
    expect(screen.getByText('Risk narration.')).toBeInTheDocument();

    act(() =>
      run.handlers().onFinding?.({ agentId: 'risk', text: 'HbA1c 8.9%', fhirResourceId: 'Observation/hba1c-1' })
    );
    act(() => {
      run.handlers().onComplete?.({
        agentId: 'risk',
        riskScore: 87,
        riskLevel: 'high',
        readmissionProbability: 0.42,
        findingCount: 1,
        droppedCount: 0,
      });
    });

    act(() =>
      run.handlers().onFinding?.({
        agentId: 'careGap',
        gapType: 'screening',
        description: 'Colonoscopy overdue',
        urgency: 'high',
        fhirResourceId: 'Condition/gap-1',
      })
    );
    act(() => {
      run.handlers().onComplete?.({ agentId: 'careGap', findingCount: 1, droppedCount: 0 });
      run.resolve();
    });

    // Care Gap's narration must never have bled into the Risk feed box, and
    // vice versa — each feed box shows only its own agent's text.
    const riskBox = (await screen.findByTestId('risk-summary')).closest('div.flex.flex-col')!;
    const careGapBox = (await screen.findByTestId('care-gap-summary')).closest('div.flex.flex-col')!;

    expect(riskBox.textContent).toContain('Risk narration.');
    expect(riskBox.textContent).not.toContain('Care gap narration.');
    expect(careGapBox.textContent).toContain('Care gap narration.');
    expect(careGapBox.textContent).not.toContain('Risk narration.');
  });

  it('runs the default "Run Analysis" button without forcing a live run (cache-first)', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    vi.mocked(client.streamAnalysis).mockReturnValue(new Promise<void>(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }));

    expect(client.streamAnalysis).toHaveBeenCalledWith('maria-1', expect.any(Object), { live: false });
  });

  it('forces a live run when the "Run live" button is clicked', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    vi.mocked(client.streamAnalysis).mockReturnValue(new Promise<void>(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /run live/i }));

    expect(client.streamAnalysis).toHaveBeenCalledWith('maria-1', expect.any(Object), { live: true });
  });

  it('labels the mode by what was requested, not an asserted outcome', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    // No label before any run.
    expect(screen.queryByTestId('analysis-mode')).not.toBeInTheDocument();

    // Resolve immediately so `running` clears and the second click isn't blocked.
    vi.mocked(client.streamAnalysis).mockResolvedValue(undefined);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /run analysis/i }));
    });
    expect(screen.getByTestId('analysis-mode').textContent).toBe('requested: cached');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /run live/i }));
    });
    expect(screen.getByTestId('analysis-mode').textContent).toBe('requested: live');
  });

  it('disables both the Run Analysis and Run live buttons while a run is in progress', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    const run = startRun();

    expect(screen.getByRole('button', { name: /analyzing/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /run live/i })).toBeDisabled();

    act(() => run.resolve());
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

// S7 B3 — cross-surface sync: PatientDetail subscribes to the relay (every
// role, unlike AppShell's coordinator-only toast) and, on a `task-updated`
// event for THIS patient, invalidates its own `['patient', id]` query so the
// task list refetches live — no page reload, no manual refresh button.
describe('PatientDetail — S7 B3 live task-updated relay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getPatient).mockResolvedValue(mockPatient);
  });

  function captureSubscription() {
    let captured: { onTaskUpdated?: (task: AssignedTaskEvent) => void } | undefined;
    const unsubscribe = vi.fn();
    vi.mocked(client.subscribeToEvents).mockImplementation((handlers) => {
      captured = handlers;
      return unsubscribe;
    });
    return { handlers: () => captured!, unsubscribe };
  }

  it('subscribes to the relay on mount', async () => {
    captureSubscription();
    renderPatientDetail();
    await screen.findByText('Maria Chen');

    expect(client.subscribeToEvents).toHaveBeenCalledTimes(1);
  });

  it('refetches the patient when a task-updated event matches this patient id', async () => {
    const sub = captureSubscription();
    renderPatientDetail();
    await screen.findByText('Maria Chen');
    expect(client.getPatient).toHaveBeenCalledTimes(1);

    act(() => {
      sub.handlers().onTaskUpdated?.({
        id: 't1',
        title: 'Existing follow-up',
        priority: 'high',
        status: 'Done',
        patientId: 'maria-1',
      });
    });

    await waitFor(() => expect(client.getPatient).toHaveBeenCalledTimes(2));
  });

  it('ignores a task-updated event for a different patient', async () => {
    const sub = captureSubscription();
    renderPatientDetail();
    await screen.findByText('Maria Chen');
    expect(client.getPatient).toHaveBeenCalledTimes(1);

    act(() => {
      sub.handlers().onTaskUpdated?.({
        id: 't2',
        title: 'Someone else\'s task',
        priority: 'low',
        status: 'Done',
        patientId: 'someone-else',
      });
    });

    // Give any (incorrect) refetch a chance to happen before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getPatient).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', async () => {
    const sub = captureSubscription();
    const { unmount } = renderPatientDetail();
    await screen.findByText('Maria Chen');

    unmount();

    expect(sub.unsubscribe).toHaveBeenCalled();
  });
});
