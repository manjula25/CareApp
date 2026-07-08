import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Team } from './Team';
import * as client from '../api/client';
import type { TeamPerformanceResult } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getTeamPerformance: vi.fn(),
  };
});

// S12 B.2 — disable page-level placeholderData fallback so tests run against
// the mocked API response, not the lib/demoFallbacks.ts values.
vi.mock('../lib/demoFallbacks', () => ({
  MOCK_TEAM: undefined,
}));

// Deliberately non-trivial/non-zero numbers so a tile that (wrongly)
// hardcodes a value instead of deriving it from the query's data would fail
// these assertions — same convention Quality.test.tsx's MOCK_MEASURE uses.
const MOCK_PERFORMANCE: TeamPerformanceResult = {
  coordinators: [
    { coordinatorId: 'coord-1', name: 'Cara Coordinator', assignedCount: 5, completedCount: 2, completionRate: 2 / 5 },
    { coordinatorId: 'coord-2', name: 'Cody Coordinator', assignedCount: 3, completedCount: 3, completionRate: 1 },
  ],
  unassignedCount: 4,
  totalTasks: 12,
  overallCompletionRate: 5 / 12,
};

const EMPTY_PERFORMANCE: TeamPerformanceResult = {
  coordinators: [],
  unassignedCount: 0,
  totalTasks: 0,
  overallCompletionRate: 0,
};

const ALL_UNASSIGNED_PERFORMANCE: TeamPerformanceResult = {
  coordinators: [{ coordinatorId: 'coord-1', name: 'Cara Coordinator', assignedCount: 0, completedCount: 0, completionRate: 0 }],
  unassignedCount: 7,
  totalTasks: 7,
  overallCompletionRate: 0,
};

function renderTeam() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Team />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Team — W04 real team performance dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the real summary stats (total tasks, unassigned, overall completion rate), not hardcoded values', async () => {
    vi.mocked(client.getTeamPerformance).mockResolvedValue(MOCK_PERFORMANCE);
    renderTeam();

    expect(await screen.findByTestId('team-summary-total-tasks')).toHaveTextContent('12');
    expect(screen.getByTestId('team-summary-unassigned')).toHaveTextContent('4');
    expect(screen.getByTestId('team-summary-completion-rate')).toHaveTextContent('41.7%');
  });

  it('renders one row per coordinator with real assigned/completed/rate values', async () => {
    vi.mocked(client.getTeamPerformance).mockResolvedValue(MOCK_PERFORMANCE);
    renderTeam();

    const rows = await screen.findAllByTestId('team-coordinator-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Cara Coordinator');
    expect(rows[0]).toHaveTextContent('5');
    expect(rows[0]).toHaveTextContent('2');
    expect(rows[0]).toHaveTextContent('40.0%');
    expect(rows[1]).toHaveTextContent('Cody Coordinator');
    expect(rows[1]).toHaveTextContent('100.0%');
  });

  it('shows an honest empty state when no coordinators are seeded, not a fabricated "all good" message', async () => {
    vi.mocked(client.getTeamPerformance).mockResolvedValue(EMPTY_PERFORMANCE);
    renderTeam();

    await screen.findByTestId('team-summary-total-tasks');
    expect(screen.queryAllByTestId('team-coordinator-row')).toHaveLength(0);
    expect(screen.getByText(/no coordinators/i)).toBeInTheDocument();
  });

  it('shows an honest all-unassigned state when tasks exist but nothing is assigned/completed yet', async () => {
    vi.mocked(client.getTeamPerformance).mockResolvedValue(ALL_UNASSIGNED_PERFORMANCE);
    renderTeam();

    expect(await screen.findByTestId('team-summary-total-tasks')).toHaveTextContent('7');
    expect(screen.getByTestId('team-summary-unassigned')).toHaveTextContent('7');
    expect(screen.getByText(/no tasks currently assigned/i)).toBeInTheDocument();
  });

  it('shows a loading state, then an error state on failure', async () => {
    vi.mocked(client.getTeamPerformance).mockReturnValue(new Promise(() => {}));
    renderTeam();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows the demo-fallback badge when the query fails', async () => {
    vi.mocked(client.getTeamPerformance).mockRejectedValue(new Error('boom'));
    renderTeam();
    // S12 B.2 — fallback safety net: badge replaces the error message.
    expect(await screen.findByTestId('demo-fallback-badge', {}, { timeout: 4000 })).toBeInTheDocument();
  });
});
