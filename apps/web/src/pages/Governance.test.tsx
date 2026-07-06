import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Governance } from './Governance';
import * as client from '../api/client';
import type { AuditTrailResult, ModelPerformanceResult, ParityResult, EvalSummaryResult } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getAuditTrail: vi.fn(),
    getModelPerformance: vi.fn(),
    getParityMetrics: vi.fn(),
    getEvalSummary: vi.fn(),
  };
});

const MOCK_AUDIT: AuditTrailResult = {
  entries: [
    { ts: '2026-07-06T09:42:18.000Z', actor: 'coord-1', action: 'read', resource: 'Patient/maria-chen', outcome: 'success' },
    { ts: '2026-07-06T09:31:05.000Z', actor: 'coord-2', action: 'read', resource: 'Patient/robert-kim', outcome: 'denied' },
  ],
  total: 37,
  limit: 20,
  offset: 0,
};

// Deliberately NOT all-zero, so a tile that (wrongly) hardcodes "0" or "—"
// instead of deriving from the query's data would fail these assertions,
// EXCEPT confidenceDistribution below, which stays all-zero (today's honest
// state per governance/service.ts) to prove the "—" / no-fabrication path too.
const MOCK_MODEL: ModelPerformanceResult = {
  analyses: [
    { patientId: 'patient-a', modelVersion: 'gpt-5.5', createdTs: '2026-07-01T00:00:00.000Z' },
    { patientId: 'patient-b', modelVersion: 'gpt-5.5', createdTs: '2026-07-02T00:00:00.000Z' },
  ],
  confidenceDistribution: [
    { range: '0-0.5', count: 0 },
    { range: '0.5-0.7', count: 0 },
    { range: '0.7-0.85', count: 0 },
    { range: '0.85-1.0', count: 0 },
  ],
};

const MOCK_PARITY: ParityResult = {
  byAgeBand: [
    { group: '65+', patientCount: 2, avgRiskScore: 85 },
    { group: '18-34', patientCount: 1, avgRiskScore: 15 },
  ],
  bySex: [{ group: 'female', patientCount: 3, avgRiskScore: 60 }],
  byRace: [{ group: 'White', patientCount: 3, avgRiskScore: 60 }],
  byEthnicity: [{ group: 'Not Hispanic or Latino', patientCount: 3, avgRiskScore: 60 }],
};

function renderGovernance() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Governance />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Governance — W06 dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getAuditTrail).mockResolvedValue(MOCK_AUDIT);
    vi.mocked(client.getModelPerformance).mockResolvedValue(MOCK_MODEL);
    vi.mocked(client.getParityMetrics).mockResolvedValue(MOCK_PARITY);
    vi.mocked(client.getEvalSummary).mockResolvedValue({ available: false });
  });

  it('renders the banner title and an honest audited-events chip (not the mockups static Model/Regulatory chips)', async () => {
    renderGovernance();
    expect(await screen.findByRole('heading', { name: 'AI Governance Center' })).toBeInTheDocument();
    expect(await screen.findByText(/37 audited events/)).toBeInTheDocument();
    expect(screen.queryByText(/CareSync-v2\.3\.1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Regulatory Posture/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Download Audit Report/i)).not.toBeInTheDocument();
  });

  it('renders the Analyses Cached tile from the real analyses count', async () => {
    renderGovernance();
    const tile = await screen.findByTestId('governance-tile-analyses-cached');
    expect(within(tile).getByText('2')).toBeInTheDocument();
  });

  it('renders "—" for Model Confidence (avg) when no confidence values exist yet, not a fabricated 0%', async () => {
    renderGovernance();
    const tile = await screen.findByTestId('governance-tile-confidence-avg');
    expect(within(tile).getByText('—')).toBeInTheDocument();
    expect(within(tile).queryByText('0%')).not.toBeInTheDocument();
  });

  it('computes Model Confidence (avg) from real bucket data when it exists', async () => {
    vi.mocked(client.getModelPerformance).mockResolvedValue({
      analyses: MOCK_MODEL.analyses,
      confidenceDistribution: [
        { range: '0-0.5', count: 0 },
        { range: '0.5-0.7', count: 0 },
        { range: '0.7-0.85', count: 0 },
        { range: '0.85-1.0', count: 4 },
      ],
    });
    renderGovernance();
    const tile = await screen.findByTestId('governance-tile-confidence-avg');
    expect(within(tile).getByText('93%')).toBeInTheDocument();
  });

  it('renders Flagged for Review from the lowest confidence bucket count', async () => {
    vi.mocked(client.getModelPerformance).mockResolvedValue({
      analyses: MOCK_MODEL.analyses,
      confidenceDistribution: [
        { range: '0-0.5', count: 3 },
        { range: '0.5-0.7', count: 0 },
        { range: '0.7-0.85', count: 0 },
        { range: '0.85-1.0', count: 0 },
      ],
    });
    renderGovernance();
    const tile = await screen.findByTestId('governance-tile-flagged');
    expect(within(tile).getByText('3')).toBeInTheDocument();
  });

  it('renders the audit trail entries most-recent-first with ts/actor/action/resource/outcome', async () => {
    renderGovernance();
    const trail = await screen.findByTestId('governance-audit-trail');
    expect(within(trail).getByText(/coord-1/)).toBeInTheDocument();
    expect(within(trail).getByText(/Patient\/maria-chen/)).toBeInTheDocument();
    expect(within(trail).getByText(/coord-2/)).toBeInTheDocument();
    // Not the mockup's fabricated per-entry fields (patient name, recommendation text, FHIR citation, confidence%).
    expect(within(trail).queryByText(/Maria Chen/)).not.toBeInTheDocument();
    expect(within(trail).queryByText(/%$/)).not.toBeInTheDocument();
  });

  it('pages the audit trail forward and back with Prev/Next, refetching with the new offset', async () => {
    renderGovernance();
    await screen.findByTestId('governance-audit-trail');
    expect(client.getAuditTrail).toHaveBeenCalledWith(20, 0);

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(client.getAuditTrail).toHaveBeenCalledWith(20, 20));

    fireEvent.click(screen.getByRole('button', { name: /prev/i }));
    await waitFor(() => expect(client.getAuditTrail).toHaveBeenCalledWith(20, 0));
  });

  it('renders the confidence chart and the raw analyses table (patientId/modelVersion/createdTs)', async () => {
    renderGovernance();
    const chart = await screen.findByTestId('governance-confidence-chart');
    expect(chart.querySelector('canvas')).toBeInTheDocument();
    expect(screen.getByText('patient-a')).toBeInTheDocument();
    expect(screen.getAllByText('gpt-5.5').length).toBeGreaterThan(0);
    // Dropped: no fabricated per-agent accuracy bars or version history.
    expect(screen.queryByText(/Agent Accuracy by Type/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Model Version History/i)).not.toBeInTheDocument();
  });

  it('renders the parity radar and the raw group-stat tables for all 4 dimensions', async () => {
    renderGovernance();
    const chart = await screen.findByTestId('governance-parity-chart');
    expect(chart.querySelector('canvas')).toBeInTheDocument();
    expect(screen.getByText('65+')).toBeInTheDocument();
    expect(screen.getByText('White')).toBeInTheDocument();
    // Dropped: no fabricated "Areas for Review" or "Compliance Attestations".
    expect(screen.queryByText(/Areas for Review/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Compliance Attestations/i)).not.toBeInTheDocument();
  });

  it('shows a loading state for the eval tile while the query is in flight', async () => {
    vi.mocked(client.getEvalSummary).mockReturnValue(new Promise(() => {}));
    renderGovernance();
    const tile = await screen.findByTestId('governance-eval-tile');
    expect(within(tile).getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows a graceful empty state when the S9 report is not available yet', async () => {
    renderGovernance();
    const tile = await screen.findByTestId('governance-eval-tile');
    expect(within(tile).getByText(/not yet available.*S9/i)).toBeInTheDocument();
  });

  it('renders the eval summary headline when the report is available', async () => {
    const available: EvalSummaryResult = { available: true, summary: { headline: 'Care Gap sensitivity 91%' } };
    vi.mocked(client.getEvalSummary).mockResolvedValue(available);
    renderGovernance();
    const tile = await screen.findByTestId('governance-eval-tile');
    expect(within(tile).getByText(/Care Gap sensitivity 91%/)).toBeInTheDocument();
  });

  it('does not crash on an unexpected eval summary shape', async () => {
    vi.mocked(client.getEvalSummary).mockResolvedValue({ available: true, summary: { totallyUnknownField: 42 } });
    renderGovernance();
    const tile = await screen.findByTestId('governance-eval-tile');
    expect(tile).toBeInTheDocument();
  });
});
