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
  tasks: [],
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

describe('PatientDetail — Run Analysis + Risk feed', () => {
  beforeEach(() => {
    vi.mocked(client.getPatient).mockResolvedValue(mockPatient);
  });

  it('shows all four feeds idle before any run', async () => {
    renderPatientDetail();
    await screen.findByText('Maria Chen');
    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(4);
  });

  it('streams Risk feed tokens incrementally, renders a finding chip and summary, and never touches the other three idle feeds', async () => {
    let capturedHandlers: AnalysisHandlers | undefined;
    let resolveStream: () => void = () => {};
    vi.mocked(client.streamAnalysis).mockImplementation((_id, handlers) => {
      capturedHandlers = handlers;
      return new Promise<void>((resolve) => {
        resolveStream = resolve;
      });
    });

    renderPatientDetail();
    await screen.findByText('Maria Chen');

    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }));

    expect(client.streamAnalysis).toHaveBeenCalledWith('maria-1', expect.any(Object));
    expect(capturedHandlers).toBeDefined();

    // Other three feeds stay idle the instant a run starts.
    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(3);

    act(() => capturedHandlers!.onToken?.('Risk is '));
    expect(screen.getByText('Risk is')).toBeInTheDocument();

    act(() => capturedHandlers!.onToken?.('elevated.'));
    expect(screen.getByText('Risk is elevated.')).toBeInTheDocument();

    act(() =>
      capturedHandlers!.onFinding?.({ text: 'HbA1c 8.9%', fhirResourceId: 'Observation/hba1c-1' })
    );
    expect(screen.getByText('Observation/hba1c-1')).toBeInTheDocument();

    act(() => {
      capturedHandlers!.onComplete?.({
        riskScore: 87,
        riskLevel: 'high',
        readmissionProbability: 0.42,
        findingCount: 1,
        droppedCount: 0,
      });
      resolveStream();
    });

    const summary = await screen.findByTestId('risk-summary');
    expect(summary.textContent).toContain('high');
    expect(summary.textContent).toContain('87');

    // Still idle throughout — the other three feeds were never wired up.
    expect(screen.getAllByText('Awaiting analysis run…')).toHaveLength(3);
  });
});
