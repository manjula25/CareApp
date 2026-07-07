import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Population } from './Population';
import * as client from '../api/client';
import type { PopulationSummary, ScatterPoint } from '../api/client';
import { MOCK_PATIENTS } from './Population.fixtures';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, getPopulationScatter: vi.fn(), getPopulationSummary: vi.fn() };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

/**
 * jsdom reports 0×0 rects for canvases, which makes `RiskScatterChart`'s
 * useEffect bail out before populating `dotAreasRef`. Mock the rect on the
 * prototype AND the clientWidth/clientHeight getters so the chart paints
 * (in-memory) dot positions against a known 360×400 viewport from the first
 * render onward. Without these mocks the dot-click test can never hit a dot.
 */
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 360,
    bottom: 400,
    width: 360,
    height: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return 360; },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
    configurable: true,
    get() { return 400; },
  });
});

// Deliberately NOT the lead mockup's hardcoded KPI values (247 / 12 / 64 /
// $284K) so a component that (wrongly) renders those literals instead of the
// query data would fail these assertions.
const MOCK_SUMMARY: PopulationSummary = {
  criticalZoneCount: 11,
  projectedCostAvoidance: 981234,
  teamKpis: { criticalZonePatients: 11, totalPatients: 200 },
};

const MOCK_SCATTER: ScatterPoint[] = [
  { id: 'p1', riskScore: 87, urgency: 90, x: 87, y: 90 },
  { id: 'p2', riskScore: 65, urgency: 40, x: 65, y: 40 },
  { id: 'p3', riskScore: 20, urgency: 5, x: 20, y: 5 },
  { id: 'p4', riskScore: 78, urgency: 70, x: 78, y: 70 }, // critical
  { id: 'p5', riskScore: 50, urgency: 25, x: 50, y: 25 },
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

/** Waits for the KPI tiles to settle on their real-data values — `findByTestId`
 *  on the tile wrapper itself returns the moment the JSX renders, BEFORE the
 *  TanStack queries resolve. `waitFor` is required to read post-data values. */
async function settleOnRealData() {
  await waitFor(() => {
    expect(screen.getByTestId('kpi-total-patients').textContent).toContain('200');
  });
}

/** (jsdom default is 0; we mock clientWidth/clientHeight getters + getBoundingClientRect
 *  globally in beforeAll, so a per-canvas helper isn't needed.) */

describe('Population — Phase 2 lead-port: KPI tiles + patient list layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getPopulationSummary).mockResolvedValue(MOCK_SUMMARY);
    vi.mocked(client.getPopulationScatter).mockResolvedValue(MOCK_SCATTER);
  });

  it('renders the Critical Zone + Cost Avoidance KPIs from the real summary, not the lead mockup hardcoded 12/$284K', async () => {
    renderPopulation();
    await settleOnRealData();

    const criticalTile = screen.getByTestId('kpi-critical-zone');
    expect(criticalTile.textContent).toContain('11');
    expect(criticalTile.textContent).not.toContain('12');

    const costTile = screen.getByTestId('kpi-cost-avoidance');
    expect(costTile.textContent).toContain('$981,234');
    expect(costTile.textContent).not.toContain('$284K');
  });

  it('derives Total Patients from the real summary (not the lead mockup hardcoded 247)', async () => {
    renderPopulation();
    await settleOnRealData();
    const totalTile = screen.getByTestId('kpi-total-patients');
    expect(totalTile.textContent).toContain('200');
    expect(totalTile.textContent).not.toContain('247');
  });

  it('renders Active Tasks as a clearly-labeled "not yet available" placeholder (no real source for that count)', async () => {
    renderPopulation();
    await settleOnRealData();
    const tasksTile = screen.getByTestId('kpi-tasks-open');
    expect(tasksTile.textContent).toContain('—');
    expect(tasksTile.textContent).toContain('not yet available');
    // Lead mockup's hardcoded "64" must never leak into this tile.
    expect(tasksTile.textContent).not.toContain('64');
  });

  it('mounts the scatter canvas after the scatter query resolves', async () => {
    renderPopulation();
    await settleOnRealData();
    const section = screen.getByTestId('population-scatter-section');
    expect(section.querySelector('canvas')).toBeInTheDocument();
    expect(client.getPopulationScatter).toHaveBeenCalledTimes(1);
  });

  it('renders the search input + the three filter tabs', async () => {
    renderPopulation();
    await settleOnRealData();
    expect(screen.getByTestId('patient-search')).toBeInTheDocument();
    expect(screen.getByTestId('filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('filter-critical')).toBeInTheDocument();
    expect(screen.getByTestId('filter-high-risk')).toBeInTheDocument();
  });

  it('filters the patient list to only critical (riskScore >= 75) rows when the Critical tab is clicked', async () => {
    renderPopulation();
    await settleOnRealData();

    // All 5 mock points visible before filter
    expect(screen.getByTestId('patient-row-p1')).toBeInTheDocument();
    expect(screen.getByTestId('patient-row-p2')).toBeInTheDocument();
    expect(screen.getByTestId('patient-row-p5')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('filter-critical'));

    // Only p1 (87) + p4 (78) pass the critical threshold.
    expect(screen.getByTestId('patient-row-p1')).toBeInTheDocument();
    expect(screen.getByTestId('patient-row-p4')).toBeInTheDocument();
    expect(screen.queryByTestId('patient-row-p2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('patient-row-p5')).not.toBeInTheDocument();
  });

  it('filters to high-risk (riskScore >= 60) when the High Risk tab is clicked', async () => {
    renderPopulation();
    await settleOnRealData();

    fireEvent.click(screen.getByTestId('filter-high-risk'));

    // p1 (87), p4 (78), p2 (65) all pass; p3 (20), p5 (50) do not.
    expect(screen.getByTestId('patient-row-p1')).toBeInTheDocument();
    expect(screen.getByTestId('patient-row-p4')).toBeInTheDocument();
    expect(screen.getByTestId('patient-row-p2')).toBeInTheDocument();
    expect(screen.queryByTestId('patient-row-p3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('patient-row-p5')).not.toBeInTheDocument();
  });

  it('filters the patient list by id substring when typing in the search input', async () => {
    renderPopulation();
    await settleOnRealData();

    const search = screen.getByTestId('patient-search');
    fireEvent.change(search, { target: { value: 'p4' } });

    expect(screen.getByTestId('patient-row-p4')).toBeInTheDocument();
    expect(screen.queryByTestId('patient-row-p1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('patient-row-p2')).not.toBeInTheDocument();
  });

  it('shows an empty-state message when no rows match the active filter+search', async () => {
    renderPopulation();
    await settleOnRealData();

    const search = screen.getByTestId('patient-search');
    fireEvent.change(search, { target: { value: 'no-such-id' } });

    expect(screen.getByTestId('patient-list-empty')).toBeInTheDocument();
  });
});

describe('Population — patient list row + scatter dot navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getPopulationSummary).mockResolvedValue(MOCK_SUMMARY);
    vi.mocked(client.getPopulationScatter).mockResolvedValue(MOCK_SCATTER);
  });

  it('navigates to /patients/:id when a patient list row is clicked', async () => {
    renderPopulation();
    await settleOnRealData();

    fireEvent.click(screen.getByTestId('patient-row-p1'));

    expect(mockNavigate).toHaveBeenCalledWith('/patients/p1');
  });

  it('navigates to /patients/:id when a scatter dot is clicked', async () => {
    renderPopulation();
    await settleOnRealData();
    const section = screen.getByTestId('population-scatter-section');
    const canvas = section.querySelector('canvas')!;

    // p1 = riskScore 87 → x = 44 + (87/100) * (360 - 64) = 44 + 257.68 = 301.68
    //      urgency 90  → y = 20 + ((100 - 90)/100) * (400 - 64) = 20 + 33.6 = 53.6
    // Trigger the click near that pixel — the chart's 10px hit radius catches it.
    fireEvent.click(canvas, { clientX: 302, clientY: 54 });

    expect(mockNavigate).toHaveBeenCalledWith('/patients/p1');
  });
});

describe('Population — mock fallback when both APIs reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getPopulationSummary).mockRejectedValue(new Error('summary down'));
    vi.mocked(client.getPopulationScatter).mockRejectedValue(new Error('scatter down'));
  });

  /** Waits for the MOCK_PATIENTS rows to appear (only happens after both
   *  queries have rejected). */
  async function settleOnMockFallback() {
    await waitFor(() => {
      expect(screen.getByTestId('patient-row-maria-chen-4829')).toBeInTheDocument();
    });
  }

  it('renders the 8 hardcoded MOCK_PATIENTS in the left rail when both APIs reject', async () => {
    renderPopulation();
    await settleOnMockFallback();
    MOCK_PATIENTS.forEach((p) => {
      expect(screen.getByTestId(`patient-row-${p.id}`)).toBeInTheDocument();
    });
  });

  it('marks the scatter caption as demo-mode and shows the fallback notice when on mocks', async () => {
    renderPopulation();
    await settleOnMockFallback();
    expect(screen.getByTestId('mock-fallback-notice')).toBeInTheDocument();
  });
});

describe('Population — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getPopulationSummary).mockReturnValue(new Promise(() => {}));
    vi.mocked(client.getPopulationScatter).mockReturnValue(new Promise(() => {}));
  });

  it('shows skeleton rows in the left rail while the scatter query is pending', () => {
    const { container } = renderPopulation();
    // The SkeletonRows component renders 6 animate-pulse rows.
    const skeletonRows = container.querySelectorAll('.animate-pulse');
    expect(skeletonRows.length).toBeGreaterThanOrEqual(6);
  });
});