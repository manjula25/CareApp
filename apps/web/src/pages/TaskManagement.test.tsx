import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskManagement } from './TaskManagement';
import * as client from '../api/client';
import type { TaskListEntry } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    listTasks: vi.fn(),
    transitionTask: vi.fn(),
  };
});

// S12 B.2 — disable page-level placeholderData fallback so tests run against
// the mocked API response, not the lib/demoFallbacks.ts values.
vi.mock('../lib/demoFallbacks', () => ({
  MOCK_TASKS: [],
}));

const SAMPLE_TASKS: TaskListEntry[] = [
  { id: 't1', patientId: 'maria-chen', patientName: 'Maria Chen', title: '48h call', priority: 'critical', due: '2026-07-08', status: 'requested' },
  { id: 't2', patientId: 'p2', patientName: 'Robert Torres', title: 'Transport', priority: 'high', due: '2026-07-10', status: 'in-progress' },
  { id: 't3', patientId: 'p3', patientName: 'Dorothy Williams', title: 'Eye exam', priority: 'high', due: '2026-07-12', status: 'completed' },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TaskManagement />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TaskManagement — W13 task management center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.listTasks).mockResolvedValue(SAMPLE_TASKS);
  });

  it('renders the three tabs with counts derived from the API data', async () => {
    renderPage();
    // Wait for the placeholderData (empty array) to be replaced by the
    // resolved SAMPLE_TASKS — the count badge updates from 0 to 1.
    await screen.findByTestId('tab-pending');
    await screen.findByText('48h call', {}, { timeout: 4000 });
    expect(screen.getByTestId('tab-pending')).toHaveTextContent('To Do1');
    expect(screen.getByTestId('tab-in_progress')).toHaveTextContent('In Progress1');
    expect(screen.getByTestId('tab-completed')).toHaveTextContent('Completed1');
  });

  it('maps FHIR status (requested / in-progress / completed) to lead-style tab status', async () => {
    renderPage();
    // Tab "To Do" (pending) should show only the requested task (t1)
    expect(await screen.findByText('48h call', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText('Transport')).not.toBeInTheDocument();
  });

  it('renders the demo-fallback badge when the query fails', async () => {
    vi.mocked(client.listTasks).mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByTestId('demo-fallback-badge', {}, { timeout: 4000 })).toBeInTheDocument();
  });
});