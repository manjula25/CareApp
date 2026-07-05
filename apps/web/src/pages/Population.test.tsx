import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Population } from './Population';
import * as client from '../api/client';
import type { PopulationSummary, ScatterPoint } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, getPopulationScatter: vi.fn(), getPopulationSummary: vi.fn() };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Deliberately NOT 23 / $247,400 — the mockup's hardcoded KPI values — so a
// component that (wrongly) hardcodes those strings instead of rendering the
// query's data would fail these assertions.
const MOCK_SUMMARY: PopulationSummary = {
  criticalZoneCount: 11,
  projectedCostAvoidance: 981234,
  teamKpis: { criticalZonePatients: 11, totalPatients: 200 },
};

const MOCK_SCATTER: ScatterPoint[] = [
  { id: 'p1', riskScore: 87, urgency: 90, x: 87, y: 90 },
  { id: 'p2', riskScore: 65, urgency: 40, x: 65, y: 40 },
  { id: 'p3', riskScore: 20, urgency: 5, x: 20, y: 5 },
];

function renderPopulation() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Population />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Population — W02 dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getPopulationSummary).mockResolvedValue(MOCK_SUMMARY);
    vi.mocked(client.getPopulationScatter).mockResolvedValue(MOCK_SCATTER);
  });

  it('renders the Critical Zone and Cost Avoidance KPI tiles from the fetched summary, not the mockup hardcoded values', async () => {
    renderPopulation();

    const criticalTile = await screen.findByTestId('kpi-critical-zone');
    expect(within(criticalTile).getByText('11')).toBeInTheDocument();
    expect(within(criticalTile).queryByText('23')).not.toBeInTheDocument();

    const costTile = screen.getByTestId('kpi-cost-avoidance');
    expect(within(costTile).getByText('$981,234')).toBeInTheDocument();
    expect(within(costTile).queryByText('$247,400')).not.toBeInTheDocument();
  });

  it('derives the Total Patients tile from the real summary data (also not the mockup hardcoded 847)', async () => {
    renderPopulation();
    const totalTile = await screen.findByTestId('kpi-total-patients');
    expect(within(totalTile).getByText('200')).toBeInTheDocument();
  });

  it('passes the fetched scatter points down to the scatter chart', async () => {
    renderPopulation();
    // The chart canvas only mounts once the query resolves and data is passed in.
    const chart = await screen.findByTestId('population-scatter-chart');
    expect(chart.querySelector('canvas')).toBeInTheDocument();
    expect(client.getPopulationScatter).toHaveBeenCalledTimes(1);
  });

  it('renders Care Team / HEDIS Progress / Activity Feed panels as documented placeholders, not fabricated data', async () => {
    renderPopulation();
    await screen.findByTestId('kpi-critical-zone');

    expect(screen.getByText('Care Team')).toBeInTheDocument();
    expect(screen.getByText('HEDIS Progress')).toBeInTheDocument();
    expect(screen.getByText('Activity Feed')).toBeInTheDocument();
    expect(screen.getAllByText(/coming in a later slice/i)).toHaveLength(3);
  });

  it('shows a loading state before data resolves and a clear error state on failure', async () => {
    vi.mocked(client.getPopulationSummary).mockReturnValue(new Promise(() => {}));
    renderPopulation();
    expect(screen.getByText(/loading population/i)).toBeInTheDocument();
  });
});

describe('Population — quadrant click drill-in (Task B3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getPopulationSummary).mockResolvedValue(MOCK_SUMMARY);
    vi.mocked(client.getPopulationScatter).mockResolvedValue(MOCK_SCATTER);
  });

  /** Same 300x200 CSS-pixel fixture used by the geometry + scatter-chart click tests. */
  function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
    Object.defineProperty(canvas, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: height, configurable: true });
  }

  it('navigates to /population/patients with the ids/risk scores/label for the clicked quadrant only', async () => {
    const { container } = renderPopulation();
    const chart = await screen.findByTestId('population-scatter-chart');
    const canvas = chart.querySelector('canvas')!;
    sizeCanvas(canvas, 300, 200);

    // p1 (riskScore 87, urgency 90) is the only MOCK_SCATTER point in the
    // critical (high risk/high urgency) band; p2 (65/40) is "watch", p3
    // (20/5) is "stable" — clicking the critical corner must filter down to
    // just p1, not the whole population.
    fireEvent.click(canvas, { clientX: 250, clientY: 40 });

    expect(mockNavigate).toHaveBeenCalledWith('/population/patients', {
      state: {
        patientIds: ['p1'],
        riskScoreById: { p1: 87 },
        label: 'Critical — Act Now',
      },
    });
    expect(container).toBeInTheDocument();
  });

  it('filters to a different id set for a different quadrant', async () => {
    renderPopulation();
    const chart = await screen.findByTestId('population-scatter-chart');
    const canvas = chart.querySelector('canvas')!;
    sizeCanvas(canvas, 300, 200);

    // High risk (x=250 -> risk ~85), low urgency (y=150 -> urgency ~11) = "watch" -> only p2.
    fireEvent.click(canvas, { clientX: 250, clientY: 150 });

    expect(mockNavigate).toHaveBeenCalledWith('/population/patients', {
      state: {
        patientIds: ['p2'],
        riskScoreById: { p2: 65 },
        label: 'Watch — Overdue Contact',
      },
    });
  });
});
