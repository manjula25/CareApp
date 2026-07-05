import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../auth/useAuth';
import { AppShell } from './AppShell';
import * as client from '../api/client';
import type { AssignedTaskEvent } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, subscribeToEvents: vi.fn() };
});

function tokenFor(role: string): string {
  const payload = btoa(JSON.stringify({ id: 'user-1', name: 'Test User', role }));
  return `header.${payload}.signature`;
}

function renderShell(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/panel']}>
        <AuthProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/panel" element={<div>Panel content</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppShell — S6 B1 live assignment notification', () => {
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    unsubscribe = vi.fn();
    vi.mocked(client.subscribeToEvents).mockReturnValue(unsubscribe);
  });

  it('does not open an event subscription for a non-coordinator role', () => {
    localStorage.setItem('caresync_token', tokenFor('director'));
    const queryClient = new QueryClient();

    renderShell(queryClient);

    expect(client.subscribeToEvents).not.toHaveBeenCalled();
  });

  it('opens an event subscription for a coordinator', () => {
    localStorage.setItem('caresync_token', tokenFor('coordinator'));
    const queryClient = new QueryClient();

    renderShell(queryClient);

    expect(client.subscribeToEvents).toHaveBeenCalledTimes(1);
  });

  it('shows a toast and invalidates the assigned-panel query on a relayed assignment event', async () => {
    localStorage.setItem('caresync_token', tokenFor('coordinator'));
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderShell(queryClient);

    const onAssignment = vi.mocked(client.subscribeToEvents).mock.calls[0][0].onAssignment!;
    const task: AssignedTaskEvent = {
      id: 'task-1',
      title: 'Medication reconciliation follow-up',
      priority: 'high',
      status: 'Open',
      ownerId: 'user-1',
    };
    act(() => onAssignment(task));

    await waitFor(() => {
      expect(screen.getByText(/New task assigned: Medication reconciliation follow-up/)).toBeInTheDocument();
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['assigned-panel'] });
  });

  it('shows only one toast when the same assignment is relayed twice in a row (HAPI double-delivery)', async () => {
    localStorage.setItem('caresync_token', tokenFor('coordinator'));
    const queryClient = new QueryClient();

    renderShell(queryClient);

    const onAssignment = vi.mocked(client.subscribeToEvents).mock.calls[0][0].onAssignment!;
    const task: AssignedTaskEvent = {
      id: 'task-1',
      title: 'Medication reconciliation follow-up',
      priority: 'high',
      status: 'Open',
      ownerId: 'user-1',
    };
    act(() => onAssignment(task));
    act(() => onAssignment(task));

    await waitFor(() => {
      expect(screen.getAllByText(/New task assigned: Medication reconciliation follow-up/)).toHaveLength(1);
    });
  });

  it('unsubscribes on unmount', () => {
    localStorage.setItem('caresync_token', tokenFor('coordinator'));
    const queryClient = new QueryClient();

    const { unmount } = renderShell(queryClient);
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
