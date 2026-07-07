import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Quality } from './Quality';
import * as client from '../api/client';
import type { QualityMeasureResult } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getQualityMeasures: vi.fn(),
  };
});

// Deliberately non-trivial/non-zero numbers so a tile that (wrongly)
// hardcodes a value instead of deriving it from the query's data would fail
// these assertions — same convention Governance.test.tsx's MOCK_MODEL uses.
const MOCK_MEASURE: QualityMeasureResult = {
  measureId: 'diabetes-hba1c-testing',
  measureName: 'Comprehensive Diabetes Care: HbA1c Testing',
  numerator: 1,
  denominator: 286,
  rate: 1 / 286,
  gapPatients: 285,
  illustrativeIncentiveDollars: 285 * 5000,
};

function renderQuality() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Quality />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Quality — W05/W07 real HEDIS measure dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getQualityMeasures).mockResolvedValue(MOCK_MEASURE);
  });

  it('renders the measure name and its real rate as a big stat', async () => {
    renderQuality();
    expect(await screen.findByText('Comprehensive Diabetes Care: HbA1c Testing')).toBeInTheDocument();
    const rate = await screen.findByTestId('quality-measure-rate');
    expect(rate).toHaveTextContent('0.3%');
  });

  it('renders the real gap-patient count, not a hardcoded value', async () => {
    renderQuality();
    const gap = await screen.findByTestId('quality-gap-count');
    expect(gap).toHaveTextContent('285');
  });

  it('renders the illustrative incentive-dollar estimate, clearly labeled as illustrative/assumed', async () => {
    renderQuality();
    const incentive = await screen.findByTestId('quality-incentive-estimate');
    expect(incentive).toHaveTextContent('1,425,000');
    expect(screen.getByText(/illustrative/i)).toBeInTheDocument();
    expect(screen.getByText(/\$5,000/)).toBeInTheDocument();
  });

  it('renders the native canvas gauge chart', async () => {
    renderQuality();
    await screen.findByTestId('quality-measure-rate');
    expect(document.querySelector('canvas')).toBeInTheDocument();
  });

  it('does not render any of the fabricated mockup content (ROI calculator total, donut chart, named prevented-cost patients, trend chart)', async () => {
    renderQuality();
    await screen.findByTestId('quality-measure-rate');
    expect(screen.queryByText(/4\.78M/)).not.toBeInTheDocument();
    expect(screen.queryByText(/TOTAL PROJECTED ROI/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Recent Prevented Cost Events/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Robert Kim/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dorothy Chen/)).not.toBeInTheDocument();
    expect(screen.queryByText(/depression screening/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ROI Calculator/i)).not.toBeInTheDocument();
  });

  it('shows a loading state, then an error state on failure', async () => {
    vi.mocked(client.getQualityMeasures).mockReturnValue(new Promise(() => {}));
    renderQuality();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows an error state when the query fails', async () => {
    vi.mocked(client.getQualityMeasures).mockRejectedValue(new Error('boom'));
    renderQuality();
    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
  });
});
