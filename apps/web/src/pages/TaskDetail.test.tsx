import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskDetail } from './TaskDetail';
import * as client from '../api/client';
import type { AssignedTaskEvent, TaskStatusTransition } from '../api/client';
import { MOCK_TASK, MOCK_TASK_NO_PHONE } from './TaskDetail.fixtures';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getTaskDetail: vi.fn(),
    transitionTask: vi.fn(),
    subscribeToEvents: vi.fn(() => () => {}),
  };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderTaskDetail(route = `/tasks/${MOCK_TASK.id}`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Spy AFTER construction so this render's useEffect captures handlers wired
  // to this very instance — the subscription suite wants to assert that
  // onTaskUpdated calls THIS queryClient's invalidateQueries.
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  return {
    queryClient,
    invalidateSpy,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/tasks/:id" element={<TaskDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  };
}

/** Waits for the priority pill to settle on its real data value — `findByTestId`
 *  on the wrapper returns the moment the JSX renders, BEFORE the TanStack query
 *  resolves. `waitFor` is required to read post-data values (mirrors Phase 2's
 *  Population.test.tsx rule). */
async function settleOnRealData() {
  await waitFor(() => {
    expect(screen.getByTestId('task-priority').textContent).toBe('CRITICAL');
  });
}

describe('TaskDetail — Phase 3 lead-port: render shape from real API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getTaskDetail).mockResolvedValue(MOCK_TASK);
    vi.mocked(client.transitionTask).mockResolvedValue({ id: MOCK_TASK.id, status: 'pending' });
  });

  it('renders the Loading state when getTaskDetail is pending', () => {
    vi.mocked(client.getTaskDetail).mockReturnValue(new Promise(() => {}));
    renderTaskDetail();
    expect(screen.getByTestId('task-loading')).toBeInTheDocument();
  });

  it('renders the Error state when getTaskDetail rejects', async () => {
    vi.mocked(client.getTaskDetail).mockRejectedValue(new Error('network down'));
    renderTaskDetail();
    await waitFor(() => expect(screen.getByTestId('task-error')).toBeInTheDocument());
  });

  it('renders the priority pill + status pill + title + patient context from real TaskDetail data', async () => {
    renderTaskDetail();
    await settleOnRealData();
    expect(screen.getByTestId('task-priority').textContent).toBe('CRITICAL');
    expect(screen.getByTestId('task-status').textContent).toBe('pending');
    expect(screen.getByTestId('task-title').textContent).toBe(MOCK_TASK.title);
    expect(screen.getByTestId('task-patient-name').textContent).toBe('Maria Chen');
    expect(screen.getByTestId('task-condition-tag').textContent).toBe('CHF');
  });

  it('renders citations inside the task-citations testid when the task carries them', async () => {
    renderTaskDetail();
    await settleOnRealData();
    const block = screen.getByTestId('task-citations');
    expect(block.textContent).toContain('Discharge summary');
    expect(block.textContent).toContain('Encounter/enc-discharge-4829');
    expect(block.textContent).toContain('BNP 420 pg/mL');
    expect(block.textContent).toContain('Observation/bnp-4829');
  });

  it('renders the Call link with patientPhone when patientPhone is present', async () => {
    renderTaskDetail();
    await settleOnRealData();
    const call = screen.getByTestId('call-link');
    expect(call).toBeInTheDocument();
    expect(call.getAttribute('href')).toBe(`tel:${MOCK_TASK.patientPhone}`);
  });

  it('hides the Call link when patientPhone is absent', async () => {
    vi.mocked(client.getTaskDetail).mockResolvedValue(MOCK_TASK_NO_PHONE);
    renderTaskDetail(`/tasks/${MOCK_TASK_NO_PHONE.id}`);
    await waitFor(() => {
      expect(screen.getByTestId('task-title').textContent).toBe(MOCK_TASK_NO_PHONE.title);
    });
    expect(screen.queryByTestId('call-link')).not.toBeInTheDocument();
  });
});

describe('TaskDetail — Phase 3 lead-port: action bar confirm steps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getTaskDetail).mockResolvedValue(MOCK_TASK);
    vi.mocked(client.transitionTask).mockResolvedValue({ id: MOCK_TASK.id, status: 'pending' });
  });

  it('calls transitionTask with "complete" when Complete is clicked (no confirm step)', async () => {
    renderTaskDetail();
    await settleOnRealData();
    fireEvent.click(screen.getByTestId('btn-complete'));
    await waitFor(() => expect(client.transitionTask).toHaveBeenCalledTimes(1));
    expect(client.transitionTask).toHaveBeenCalledWith(MOCK_TASK.id, 'complete');
    // Defer/Escalate confirm UI must NOT show up from a Complete click.
    expect(screen.queryByTestId('defer-confirm-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('escalate-confirm-warning')).not.toBeInTheDocument();
  });

  it('reveals the defer-date input on the FIRST Defer click, without firing a transition', async () => {
    renderTaskDetail();
    await settleOnRealData();
    fireEvent.click(screen.getByTestId('btn-defer'));
    expect(screen.getByTestId('defer-confirm-row')).toBeInTheDocument();
    expect(screen.getByTestId('defer-date-input')).toBeInTheDocument();
    // First click is only a reveal — no transition yet.
    expect(client.transitionTask).not.toHaveBeenCalled();
  });

  it('fires transitionTask with "defer" on the SECOND Defer click (after picking a date)', async () => {
    renderTaskDetail();
    await settleOnRealData();
    fireEvent.click(screen.getByTestId('btn-defer'));
    // User changes the date, then confirms.
    fireEvent.change(screen.getByTestId('defer-date-input'), { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByTestId('btn-confirm-defer'));
    await waitFor(() => expect(client.transitionTask).toHaveBeenCalledTimes(1));
    expect(client.transitionTask).toHaveBeenCalledWith(MOCK_TASK.id, 'defer' satisfies TaskStatusTransition);
    // After confirm, the row is hidden again and the bare Defer button returns.
    expect(screen.queryByTestId('defer-confirm-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('btn-defer')).toBeInTheDocument();
  });

  it('shows the "tap again to confirm" warning on the FIRST Escalate click, without firing a transition', async () => {
    renderTaskDetail();
    await settleOnRealData();
    fireEvent.click(screen.getByTestId('btn-escalate'));
    expect(screen.getByTestId('escalate-confirm-warning')).toBeInTheDocument();
    // First click is only a warn — no transition yet.
    expect(client.transitionTask).not.toHaveBeenCalled();
  });

  it('fires transitionTask with "escalate" on the SECOND Escalate click', async () => {
    renderTaskDetail();
    await settleOnRealData();
    fireEvent.click(screen.getByTestId('btn-escalate'));
    fireEvent.click(screen.getByTestId('btn-escalate'));
    await waitFor(() => expect(client.transitionTask).toHaveBeenCalledTimes(1));
    expect(client.transitionTask).toHaveBeenCalledWith(MOCK_TASK.id, 'escalate' satisfies TaskStatusTransition);
    // After confirm, the warning is gone.
    expect(screen.queryByTestId('escalate-confirm-warning')).not.toBeInTheDocument();
  });
});

describe('TaskDetail — Phase 3 lead-port: cross-surface event subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getTaskDetail).mockResolvedValue(MOCK_TASK);
    vi.mocked(client.transitionTask).mockResolvedValue({ id: MOCK_TASK.id, status: 'pending' });
  });

  /** Pre-render hook: replaces `subscribeToEvents` with a capturing version
   *  that stashes the handlers in a closure local to the test. The unsubscribe
   *  function is a `vi.fn()` we can assert against, mirroring the
   *  `captureStreamHandlers` pattern from PatientDetail.test.tsx. */
  function captureEventSubscription() {
    let captured: { onTaskUpdated?: (t: AssignedTaskEvent) => void } | undefined;
    const unsubscribe = vi.fn();
    vi.mocked(client.subscribeToEvents).mockImplementationOnce((handlers) => {
      captured = handlers;
      return unsubscribe;
    });
    return {
      handlers: () => captured as { onTaskUpdated: (t: AssignedTaskEvent) => void },
      unsubscribe,
    };
  }

  it('subscribes to events on mount with an onTaskUpdated handler', async () => {
    renderTaskDetail();
    await settleOnRealData();
    expect(client.subscribeToEvents).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(client.subscribeToEvents).mock.calls[0][0];
    expect(typeof arg.onTaskUpdated).toBe('function');
  });

  it('calls the unsubscribe function returned by subscribeToEvents on unmount', async () => {
    const cap = captureEventSubscription();
    const { unmount } = renderTaskDetail();
    await settleOnRealData();
    expect(cap.unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(cap.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('invalidates the task query when an onTaskUpdated event matches this task id', async () => {
    const cap = captureEventSubscription();
    const { invalidateSpy } = renderTaskDetail();
    await settleOnRealData();

    // Fire a matching event — must invalidate the ['task', id] query.
    cap.handlers().onTaskUpdated({
      id: MOCK_TASK.id,
      title: 'whatever',
      priority: 'critical',
      status: 'completed',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['task', MOCK_TASK.id] });

    // Fire a non-matching event — MUST NOT invalidate (we filter on id).
    invalidateSpy.mockClear();
    cap.handlers().onTaskUpdated({
      id: 'someone-elses-task-id',
      title: 'whatever',
      priority: 'high',
      status: 'pending',
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
