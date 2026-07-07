import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientProfile } from './PatientProfile';
import * as client from '../api/client';
import {
  MARIA_ID,
  MARIA_GET_PATIENT_RESULT,
  MARIA_PHONE,
  MOCK_PATIENTS,
  buildMockGetPatientResult,
} from './PatientProfile.fixtures';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, getPatient: vi.fn() };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPatientProfile(patientId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/patients/${patientId}/profile`]}>
        <Routes>
          <Route path="/patients/:id/profile" element={<PatientProfile />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Waits for the patient name heading to read the real-data name — `getByTestId`
 *  itself fires the moment the JSX renders, BEFORE the TanStack query resolves,
 *  so `waitFor` is required to read post-data values (per Phase 2's rule). */
async function settleOnRealData(name: string) {
  await waitFor(() => {
    expect(screen.getByTestId('patient-profile-name').textContent).toContain(name);
  });
}

describe('PatientProfile — Phase 3 lead-port: loading / error / real-data wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a Loading state while getPatient is pending', () => {
    vi.mocked(client.getPatient).mockReturnValue(new Promise(() => {})); // never resolves
    renderPatientProfile(MARIA_ID);
    expect(screen.getByTestId('patient-profile-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading patient…')).toBeInTheDocument();
  });

  it('renders an Error state when getPatient rejects', async () => {
    vi.mocked(client.getPatient).mockRejectedValue(new Error('down'));
    renderPatientProfile(MARIA_ID);
    await waitFor(() => {
      expect(screen.getByTestId('patient-profile-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Could not load this patient.')).toBeInTheDocument();
  });

  it('renders the patient name + age/sex from real getPatient data', async () => {
    vi.mocked(client.getPatient).mockResolvedValue(MARIA_GET_PATIENT_RESULT);
    renderPatientProfile(MARIA_ID);
    await settleOnRealData('Maria Chen');

    const heading = screen.getByTestId('patient-profile-name');
    expect(heading.textContent).toContain('Maria Chen');

    // ageSexLabel("1957-03-14", "female") returns "<age>F" by 2026-07-07 — lead's
    // hardcoded age was 68 but real-DOB-derived age is 69 by today; that's expected.
    // Loose check: must contain a number + "F" (female).
    const demographics = screen.getByTestId('patient-profile-demographics').textContent ?? '';
    expect(demographics).toMatch(/\d+F/);
    // Also expect the long-form sex word AND the MRN placeholder.
    expect(demographics).toMatch(/Female/);
    expect(demographics).toContain('MRN');
  });

  it('renders the conditions list from real getPatient().conditions', async () => {
    vi.mocked(client.getPatient).mockResolvedValue(MARIA_GET_PATIENT_RESULT);
    renderPatientProfile(MARIA_ID);
    await settleOnRealData('Maria Chen');

    const card = screen.getByTestId('patient-profile-conditions-card');
    expect(card.textContent).toContain('CHF');
    expect(card.textContent).toContain('T2DM');
    expect(card.textContent).toContain('Depression');

    // Each fixture condition should have a list item with its own testid,
    // and a nested span with the display-text testid (used by the visual
    // condition-dot row layout).
    MARIA_GET_PATIENT_RESULT.conditions.forEach((c) => {
      expect(screen.getByTestId(`patient-profile-condition-${c.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`patient-profile-condition-${c.id}-display`)).toBeInTheDocument();
    });
  });

  it('shows the "Risk score unavailable" pill (real API does not return riskScore)', async () => {
    vi.mocked(client.getPatient).mockResolvedValue(MARIA_GET_PATIENT_RESULT);
    renderPatientProfile(MARIA_ID);
    await settleOnRealData('Maria Chen');
    expect(screen.getByTestId('patient-profile-risk-unknown')).toBeInTheDocument();
  });
});

describe('PatientProfile — Key Labs (fixture fallback vs empty state)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows fixture MARIA_LABS for Maria (real API has no labs)', async () => {
    vi.mocked(client.getPatient).mockResolvedValue(MARIA_GET_PATIENT_RESULT);
    renderPatientProfile(MARIA_ID);
    await settleOnRealData('Maria Chen');

    const card = screen.getByTestId('patient-profile-labs-card');
    expect(screen.getByTestId('patient-profile-labs-list')).toBeInTheDocument();
    expect(card.textContent).toContain('HbA1c');
    expect(card.textContent).toContain('NT-proBNP');
    expect(card.textContent).toContain('GFR');
    expect(card.textContent).toContain('Potassium');
    // Empty-state placeholder must NOT appear for Maria.
    expect(screen.queryByTestId('patient-profile-labs-empty')).not.toBeInTheDocument();
  });

  it('shows "No recent labs on file" for non-Maria patients', async () => {
    const robert = MOCK_PATIENTS.find((p) => p.id === 'p2')!; // Robert Torres
    vi.mocked(client.getPatient).mockResolvedValue(buildMockGetPatientResult(robert));
    renderPatientProfile('p2');
    await settleOnRealData('Robert Torres');

    const card = screen.getByTestId('patient-profile-labs-card');
    expect(screen.getByTestId('patient-profile-labs-empty')).toBeInTheDocument();
    expect(card.textContent).toContain('No recent labs on file');
    // MARIA_LABS must NOT leak in.
    expect(card.textContent).not.toContain('HbA1c');
    expect(screen.queryByTestId('patient-profile-labs-list')).not.toBeInTheDocument();
  });
});

describe('PatientProfile — Medications (fixture fallback vs empty state)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows fixture MARIA_MEDS for Maria', async () => {
    vi.mocked(client.getPatient).mockResolvedValue(MARIA_GET_PATIENT_RESULT);
    renderPatientProfile(MARIA_ID);
    await settleOnRealData('Maria Chen');

    const card = screen.getByTestId('patient-profile-meds-card');
    expect(screen.getByTestId('patient-profile-meds-list')).toBeInTheDocument();
    expect(card.textContent).toContain('Metformin 1000mg BID');
    expect(card.textContent).toContain('Lisinopril 10mg daily');
    expect(card.textContent).toContain('Furosemide 40mg daily');
    expect(card.textContent).toContain('Sertraline 50mg daily');
  });

  it('shows "Medication list not available in demo" for non-Maria patients', async () => {
    const dorothy = MOCK_PATIENTS.find((p) => p.id === 'p3')!; // Dorothy Williams
    vi.mocked(client.getPatient).mockResolvedValue(buildMockGetPatientResult(dorothy));
    renderPatientProfile('p3');
    await settleOnRealData('Dorothy Williams');

    const card = screen.getByTestId('patient-profile-meds-card');
    expect(screen.getByTestId('patient-profile-meds-empty')).toBeInTheDocument();
    expect(card.textContent).toContain('Medication list not available in demo');
    expect(screen.queryByTestId('patient-profile-meds-list')).not.toBeInTheDocument();
  });
});

describe('PatientProfile — SDOH Flags card (Maria-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the SDOH Flags card for Maria with the 2 fixture flags', async () => {
    vi.mocked(client.getPatient).mockResolvedValue(MARIA_GET_PATIENT_RESULT);
    renderPatientProfile(MARIA_ID);
    await settleOnRealData('Maria Chen');

    const card = screen.getByTestId('patient-profile-sdoh-card');
    expect(card).toBeInTheDocument();
    expect(card.textContent).toContain('Transportation barrier');
    expect(card.textContent).toContain('Food insecurity');
    // Lead always rendered 2 flag entries — assert the matching <li>-equivalent count.
    expect(screen.getAllByTestId('patient-profile-sdoh-flag')).toHaveLength(2);
  });

  it('hides the SDOH Flags card for non-Maria patients', async () => {
    const robert = MOCK_PATIENTS.find((p) => p.id === 'p2')!; // Robert Torres
    vi.mocked(client.getPatient).mockResolvedValue(buildMockGetPatientResult(robert));
    renderPatientProfile('p2');
    await settleOnRealData('Robert Torres');

    expect(screen.queryByTestId('patient-profile-sdoh-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('patient-profile-sdoh-flag')).not.toBeInTheDocument();
  });
});

describe('PatientProfile — Quick Actions (Create Task / Call Patient / SDOH link)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Create Task button navigating to /tasks', async () => {
    vi.mocked(client.getPatient).mockResolvedValue(MARIA_GET_PATIENT_RESULT);
    renderPatientProfile(MARIA_ID);
    await settleOnRealData('Maria Chen');

    const btn = screen.getByTestId('patient-profile-create-task');
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledWith('/tasks');
  });

  it('renders the Call Patient tel: link with the Maria fixture phone (only Maria has a phone)', async () => {
    vi.mocked(client.getPatient).mockResolvedValue(MARIA_GET_PATIENT_RESULT);
    renderPatientProfile(MARIA_ID);
    await settleOnRealData('Maria Chen');

    const link = screen.getByTestId('patient-profile-call-patient');
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe(`tel:${MARIA_PHONE}`);
  });

  it('does NOT render the Call Patient button for non-Maria patients (no phone available)', async () => {
    const robert = MOCK_PATIENTS.find((p) => p.id === 'p2')!; // Robert Torres
    vi.mocked(client.getPatient).mockResolvedValue(buildMockGetPatientResult(robert));
    renderPatientProfile('p2');
    await settleOnRealData('Robert Torres');

    expect(screen.queryByTestId('patient-profile-call-patient')).not.toBeInTheDocument();
  });

  it('renders the SDOH Resources link pointing to /patients/:id/sdoh', async () => {
    vi.mocked(client.getPatient).mockResolvedValue(MARIA_GET_PATIENT_RESULT);
    renderPatientProfile(MARIA_ID);
    await settleOnRealData('Maria Chen');

    const btn = screen.getByTestId('patient-profile-sdoh-link');
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledWith(`/patients/${MARIA_ID}/sdoh`);
  });
});

describe('PatientProfile — placeholder fields (no fabricated data)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "—" placeholder for MRN (real API does not return MRN)', async () => {
    vi.mocked(client.getPatient).mockResolvedValue(MARIA_GET_PATIENT_RESULT);
    renderPatientProfile(MARIA_ID);
    await settleOnRealData('Maria Chen');

    const mrn = screen.getByTestId('patient-profile-mrn');
    expect(mrn.textContent).toBe('—');
    // Sanity: the lead's hardcoded "4829-FHIR" string must never appear.
    const demographics = screen.getByTestId('patient-profile-demographics').textContent ?? '';
    expect(demographics).not.toContain('4829-FHIR');
  });
});
