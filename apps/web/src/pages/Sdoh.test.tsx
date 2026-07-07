import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sdoh } from './Sdoh';
import * as client from '../api/client';
import type { CommunityResource } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getSdohResources: vi.fn(),
    postSdohReferral: vi.fn(),
  };
});

const MOCK_RESOURCES: CommunityResource[] = [
  {
    id: 'metro-transit-assistance',
    name: 'Metro Transit Assistance Program',
    category: 'transportation',
    description: 'Discounted bus and rail passes.',
    coverage: 'Free for Medicaid',
    phone: '555-0101',
  },
  {
    id: 'cityride-medical-transport',
    name: 'CityRide Medical Transport',
    category: 'transportation',
    description: 'Door-to-door non-emergency medical transport.',
    coverage: '$0 copay with prior auth',
  },
  {
    id: 'metro-food-bank',
    name: 'Metro Regional Food Bank',
    category: 'food',
    description: 'Weekly grocery boxes.',
    coverage: 'Free · Walk-in',
  },
];

function renderSdoh(patientId = 'maria-chen') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/patients/${patientId}/sdoh`]}>
        <Routes>
          <Route path="/patients/:id/sdoh" element={<Sdoh />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Sdoh — M05 resource directory + referral', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getSdohResources).mockResolvedValue(MOCK_RESOURCES);
    vi.mocked(client.postSdohReferral).mockResolvedValue({ id: 'sr-1' });
  });

  it('renders every resource grouped under the "All" tab by default', async () => {
    renderSdoh();
    expect(await screen.findByText('Metro Transit Assistance Program')).toBeInTheDocument();
    expect(screen.getByText('CityRide Medical Transport')).toBeInTheDocument();
    expect(screen.getByText('Metro Regional Food Bank')).toBeInTheDocument();
  });

  it('shows a category chip and coverage line on each card', async () => {
    renderSdoh();
    const card = (await screen.findByTestId('sdoh-resource-card-metro-transit-assistance'));
    expect(within(card).getByText(/transportation/i)).toBeInTheDocument();
    expect(within(card).getByText('Free for Medicaid')).toBeInTheDocument();
  });

  it('filters the resource list by category when a tab is clicked', async () => {
    renderSdoh();
    await screen.findByText('Metro Transit Assistance Program');

    fireEvent.click(screen.getByTestId('sdoh-category-tab-food'));

    expect(screen.queryByText('Metro Transit Assistance Program')).not.toBeInTheDocument();
    expect(screen.queryByText('CityRide Medical Transport')).not.toBeInTheDocument();
    expect(screen.getByText('Metro Regional Food Bank')).toBeInTheDocument();
  });

  it('returns to the full list when "All" is clicked again', async () => {
    renderSdoh();
    await screen.findByText('Metro Transit Assistance Program');
    fireEvent.click(screen.getByTestId('sdoh-category-tab-food'));
    fireEvent.click(screen.getByTestId('sdoh-category-tab-all'));

    expect(screen.getByText('Metro Transit Assistance Program')).toBeInTheDocument();
    expect(screen.getByText('Metro Regional Food Bank')).toBeInTheDocument();
  });

  it('clicking "Refer Patient" calls postSdohReferral with the patient and resource ids, and shows a success indicator', async () => {
    renderSdoh('maria-chen');
    const card = await screen.findByTestId('sdoh-resource-card-metro-transit-assistance');

    fireEvent.click(within(card).getByTestId('sdoh-refer-button-metro-transit-assistance'));

    await waitFor(() => expect(client.postSdohReferral).toHaveBeenCalledWith('maria-chen', 'metro-transit-assistance'));
    expect(await within(card).findByText(/referral sent/i)).toBeInTheDocument();
  });
});
