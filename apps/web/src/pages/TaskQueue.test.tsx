import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskQueue } from './TaskQueue';
import * as client from '../api/client';
import { MOCK_TASKS, today } from './TaskQueue.fixtures';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, listTasks: vi.fn(), completeTask: vi.fn() };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderTaskQueue() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TaskQueue />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Waits for the summary bar to render its real-data counts — equivalent to
 *  Phase 2's `settleOnRealData`: TanStack's `useQuery` only resolves after
 *  the test microtask queue flushes, so `findByTestId` alone isn't enough.
 *  Anchors on the summary bar (not a specific task card) so tests that
 *  override the dataset still pass. */
async function settleOnRealData() {
  await waitFor(() => {
    expect(screen.getByTestId('task-queue-summary')).toBeInTheDocument();
    // Summary renders zero-filled counts even while data loads, so anchor on
    // a task card too — guaranteed to mount only after `data` resolves.
    expect(screen.getByTestId('task-t-d1')).toBeInTheDocument();
  });
}

describe('TaskQueue — Phase 3 lead-port: summary stats + task cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.listTasks).mockResolvedValue(MOCK_TASKS);
    vi.mocked(client.completeTask).mockResolvedValue({ id: 't-d1', status: 'Done' });
  });

  it('renders the 3 summary stats (Open / Critical / Patients) from real listTasks data', async () => {
    renderTaskQueue();
    await settleOnRealData();

    // 4 open (t-d1..t-d4), 1 Done (t-d5)
    const open = screen.getByTestId('task-queue-summary-open');
    expect(open.textContent).toContain('4');

    // only t-d1 is critical
    const critical = screen.getByTestId('task-queue-summary-critical');
    expect(critical.textContent).toContain('1');

    // 5 unique patients across the 5 fixtures
    const patients = screen.getByTestId('task-queue-summary-patients');
    expect(patients.textContent).toContain('5');
  });

  it('renders a card for each task returned by listTasks', async () => {
    renderTaskQueue();
    await settleOnRealData();
    MOCK_TASKS.forEach((t) => {
      expect(screen.getByTestId(`task-${t.id}`)).toBeInTheDocument();
    });
  });

  it('renders the 4 filter chips (All / Critical / Today / In Progress)', async () => {
    renderTaskQueue();
    await settleOnRealData();
    expect(screen.getByTestId('task-queue-filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('task-queue-filter-critical')).toBeInTheDocument();
    expect(screen.getByTestId('task-queue-filter-today')).toBeInTheDocument();
    expect(screen.getByTestId('task-queue-filter-in-progress')).toBeInTheDocument();
  });

  it('filters to only critical-priority tasks when the Critical tab is clicked', async () => {
    renderTaskQueue();
    await settleOnRealData();

    fireEvent.click(screen.getByTestId('task-queue-filter-critical'));

    expect(screen.getByTestId('task-t-d1')).toBeInTheDocument();
    expect(screen.queryByTestId('task-t-d2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-t-d3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-t-d4')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-t-d5')).not.toBeInTheDocument();
  });

  it('filters to only tasks due today when the Today tab is clicked', async () => {
    renderTaskQueue();
    await settleOnRealData();

    fireEvent.click(screen.getByTestId('task-queue-filter-today'));

    // t-d1 has due === today; the rest are future or past.
    expect(screen.getByTestId('task-t-d1')).toBeInTheDocument();
    expect(screen.queryByTestId('task-t-d2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-t-d3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-t-d4')).not.toBeInTheDocument();
  });

  it('filters to only In Progress tasks when the In Progress tab is clicked', async () => {
    renderTaskQueue();
    await settleOnRealData();

    fireEvent.click(screen.getByTestId('task-queue-filter-in-progress'));

    expect(screen.getByTestId('task-t-d3')).toBeInTheDocument();
    expect(screen.queryByTestId('task-t-d1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-t-d2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-t-d4')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-t-d5')).not.toBeInTheDocument();
  });

  it('navigates to /tasks/:id when a task card is clicked', async () => {
    renderTaskQueue();
    await settleOnRealData();

    fireEvent.click(screen.getByTestId('task-t-d1'));

    expect(mockNavigate).toHaveBeenCalledWith('/tasks/t-d1');
  });

  it('calls completeTask with the task id when the Done button is clicked', async () => {
    renderTaskQueue();
    await settleOnRealData();

    // `act` flushes the synchronous portion of the async mutation; without
    // it the post-click `mock.calls` read can run before `mutationFn` is
    // invoked, since `mutate()` schedules its call on a microtask.
    await act(async () => {
      fireEvent.click(screen.getByTestId('task-done-t-d1'));
    });

    // TanStack's `mutate(variables, options)` passes both to the
    // `mutationFn`, so the mock receives `(id, mutateOptions)` — assert
    // only on the first positional arg (the id) to keep the test stable
    // against TanStack internal changes.
    expect(client.completeTask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.completeTask).mock.calls[0][0]).toBe('t-d1');
    // The Done button must stop propagation so it does NOT also trigger
    // card navigation — same concern as the in-tree TaskQueue.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the All caught up! empty state when the filter matches no tasks', async () => {
    // Override the dataset so no task is In Progress.
    vi.mocked(client.listTasks).mockResolvedValue([
      { id: 't-x', patientId: 'p1', patientName: 'Nobody Inprogress', title: 'Open task', priority: 'high', status: 'Open', due: today },
    ]);
    renderTaskQueue();
    await waitFor(() => {
      expect(screen.getByTestId('task-t-x')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-queue-filter-in-progress'));

    const empty = screen.getByTestId('task-queue-empty-state');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain('All caught up!');
  });
});

describe('TaskQueue — loading + error states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Loading tasks… when listTasks is pending', () => {
    vi.mocked(client.listTasks).mockReturnValue(new Promise(() => {}));
    renderTaskQueue();
    expect(screen.getByText('Loading tasks…')).toBeInTheDocument();
  });

  it('shows the error message when listTasks rejects', async () => {
    vi.mocked(client.listTasks).mockRejectedValue(new Error('network down'));
    renderTaskQueue();
    await waitFor(() => {
      expect(screen.getByText('Could not load the task queue.')).toBeInTheDocument();
    });
  });
});