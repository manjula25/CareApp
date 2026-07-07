import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPatient } from '../api/client';
import { ageSexLabel, sexLabel } from '../lib/patient';
import {
  MARIA_ID,
  MARIA_LABS,
  MARIA_MEDS,
  MARIA_PHONE,
  SDOH_FLAGS,
  conditionDotBgClass,
} from './PatientProfile.fixtures';

/**
 * Phase 3 — `PatientProfile.tsx`
 *
 * Lead: `hl7-competition-caresyncai/apps/web/src/pages/mobile/PatientProfile.tsx`
 *       (200 lines, mock-driven, 390px phone frame, inline `MobileNav`).
 *       Surface: per-patient profile view (header card → conditions → key labs
 *       → medications → SDOH flags → quick actions).
 *
 * Lead provides: MOCK_PATIENTS / MARIA_LABS / MARIA_MEDS / SDOH flags / risk
 * badge / conditions list / quick actions (Create Task + Call Patient).
 *
 * HONEST-STAGING DEVIATIONS from the lead (committed openly — no fabrication):
 *   - Dropped the 390px phone frame per user direction. Lead used
 *     `min-h-screen bg-bg` with pt-12 for the status-bar gap; kept `bg-bg`
 *     but dropped the phone-shape constraints and the pt-12.
 *   - Dropped `MobileNav` overlay — my `AppShell` already provides
 *     `Header` + `Sidebar` + the layout's own `MobileNav`. Adding another
 *     tab bar on top would conflict visually.
 *   - Real API `getPatient` (see `apps/web/src/api/client.ts` lines 86-94)
 *     only returns
 *       { patient: {id, name, gender, birthDate},
 *         conditions: [{id, code, display}],
 *         tasks: TaskSummary[] }
 *     No MRN, no riskScore, no labs, no medications, no SDOH flags, no phone.
 *     These are rendered as "—" / "not available in demo" placeholders, NOT
 *     fabricated.
 *   - MRN shown as "—" because the real API's `Patient` shape doesn't carry
 *     an MRN field. Honest > fabricated demographics.
 *   - Risk score / riskLevel / "last contact" badge hidden — no real source
 *     for any of them in `PatientDetail`. Replaced with a muted
 *     "Risk score unavailable" pill that reads as "demo only."
 *   - Age computed from `birthDate` via `lib/patient.ageSexLabel()` rather
 *     than from the lead's hardcoded `age` field (which doesn't appear on
 *     my API). Same for sex (`gender` is "female"/"male" not "F"/"M").
 *   - SDOH Flags card only shown for Maria (matches lead's `isMaria` branch).
 *     For other patients an "SDOH Resources" link is exposed in the Quick
 *     Actions row pointing to `/patients/:id/sdoh` (matches `Sdoh.tsx`'s
 *     routing convention).
 *   - Phone: `PatientDetail` doesn't carry one. Maria's hardcoded
 *     `tel:+1-555-0142` from the real HAPI seed is reused as a fixture-only fallback
 *     — the Call Patient button is rendered only when a phone is in scope
 *     (Maria only), with a `tel:` href.
 *   - Back link: `<Link to="/tasks">← Back to Tasks</Link>` (mirrors
 *     `Sdoh.tsx`'s "← Back to Patient" convention).
 */

function FlagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
    </svg>
  );
}

export function PatientProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => getPatient(id!),
    enabled: !!id,
    retry: false,
  });

  if (!id) {
    return <p className="p-6 text-body text-red">No patient id in URL.</p>;
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-body text-text-muted" data-testid="patient-profile-loading">Loading patient…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link to="/tasks" className="text-label text-cyan hover:underline">← Back to Tasks</Link>
        <p className="text-body text-red mt-2" data-testid="patient-profile-error">Could not load this patient.</p>
      </div>
    );
  }

  const patient = data.patient;
  const conditions = data.conditions ?? [];
  const isMaria = patient.id === MARIA_ID;
  const phone = isMaria ? MARIA_PHONE : undefined;

  // Lead had `age` as a hardcoded integer; my API only carries `birthDate` +
  // `gender`. `ageSexLabel()` returns the codebase-standard "68F" / "69M"
  // format (matches `Population.fixtures.ts`'s sex column); `sexLabel()`
  // returns the long-form "Female" / "Male" for the demographic block.
  const ageSex = ageSexLabel(patient.birthDate, patient.gender);
  const sex = sexLabel(patient.gender);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link to="/tasks" className="text-label text-cyan hover:underline">← Back to Tasks</Link>

      {/* Header card */}
      <header
        className="bg-surface border border-border rounded-card p-4 mt-3 mb-4"
        data-testid="patient-profile-header"
      >
        <h1 className="text-section text-text font-bold leading-tight" data-testid="patient-profile-name">
          {patient.name}
        </h1>
        <p
          className="text-body text-text-muted mt-1"
          data-testid="patient-profile-demographics"
        >
          {ageSex}{sex ? ` · ${sex}` : ''} · MRN{' '}
          <span data-testid="patient-profile-mrn">—</span>
        </p>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-label font-bold bg-surface-raised border border-border text-text-muted"
            data-testid="patient-profile-risk-unknown"
            title="Real API's PatientDetail doesn't include a riskScore"
          >
            Risk score unavailable
          </span>
        </div>
      </header>

      {/* Conditions card */}
      <section
        className="bg-surface border border-border rounded-card p-4 mb-4"
        data-testid="patient-profile-conditions-card"
      >
        <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3">Conditions</h2>
        {conditions.length === 0 ? (
          <p className="text-body text-text-muted italic">No conditions on file.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {conditions.map((c, i) => (
              <li
                key={c.id}
                className="flex items-center gap-2 text-body text-text"
                data-testid={`patient-profile-condition-${c.id}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${conditionDotBgClass(i)}`} aria-hidden="true" />
                <span data-testid={`patient-profile-condition-${c.id}-display`}>{c.display}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Key Labs card */}
      <section
        className="bg-surface border border-border rounded-card p-4 mb-4"
        data-testid="patient-profile-labs-card"
      >
        <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3">Key Labs</h2>
        {isMaria ? (
          <div className="flex flex-col gap-2" data-testid="patient-profile-labs-list">
            {MARIA_LABS.map((lab) => (
              <div
                key={lab.name}
                className="flex items-center justify-between"
                data-testid={`patient-profile-lab-${lab.name}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-body text-text font-medium">{lab.name}</span>
                  <span
                    className={`text-[10px] font-bold px-1 rounded ${
                      lab.status === 'H' ? 'text-red bg-red-dim' : 'text-amber bg-amber-dim'
                    }`}
                  >
                    {lab.status}
                  </span>
                </div>
                <div className="text-right">
                  <span
                    className={`text-body font-semibold ${
                      lab.status === 'H' ? 'text-red' : 'text-amber'
                    }`}
                  >
                    {lab.value}
                  </span>
                  <p className="text-[10px] text-text-dim">{lab.date}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p
            className="text-body text-text-muted italic"
            data-testid="patient-profile-labs-empty"
          >
            No recent labs on file
          </p>
        )}
      </section>

      {/* Medications card */}
      <section
        className="bg-surface border border-border rounded-card p-4 mb-4"
        data-testid="patient-profile-meds-card"
      >
        <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3">Medications</h2>
        {isMaria ? (
          <ul className="flex flex-col gap-2" data-testid="patient-profile-meds-list">
            {MARIA_MEDS.map((med) => (
              <li
                key={med}
                className="flex items-start gap-2 text-body text-text"
                data-testid="patient-profile-med"
              >
                <span className="w-1.5 h-1.5 bg-cyan rounded-full mt-2 shrink-0" aria-hidden="true" />
                {med}
              </li>
            ))}
          </ul>
        ) : (
          <p
            className="text-body text-text-muted italic"
            data-testid="patient-profile-meds-empty"
          >
            Medication list not available in demo
          </p>
        )}
      </section>

      {/* SDOH Flags card — Maria only (matches lead's isMaria branch) */}
      {isMaria && (
        <section
          className="bg-surface border border-border rounded-card p-4 mb-4"
          data-testid="patient-profile-sdoh-card"
        >
          <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3">SDOH Flags</h2>
          <div className="flex flex-col gap-2">
            {SDOH_FLAGS.map((flag) => (
              <div
                key={flag}
                className="flex items-center gap-2 text-body text-amber"
                data-testid="patient-profile-sdoh-flag"
              >
                <FlagIcon />
                {flag}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quick actions */}
      <div className="flex gap-2 mt-2 flex-wrap">
        <button
          type="button"
          onClick={() => navigate('/tasks')}
          data-testid="patient-profile-create-task"
          className="flex-1 min-w-[140px] py-3 rounded-card bg-surface border border-border text-cyan text-body font-semibold hover:bg-surface-hover transition-colors"
        >
          Create Task
        </button>

        {phone && (
          <a
            href={`tel:${phone}`}
            data-testid="patient-profile-call-patient"
            className="flex-1 min-w-[140px] py-3 rounded-card bg-surface border border-border text-text text-body font-semibold text-center hover:bg-surface-hover transition-colors"
          >
            Call Patient
          </a>
        )}

        <button
          type="button"
          onClick={() => navigate(`/patients/${id}/sdoh`)}
          data-testid="patient-profile-sdoh-link"
          className="flex-1 min-w-[140px] py-3 rounded-card bg-surface border border-border text-text text-body font-semibold hover:bg-surface-hover transition-colors"
        >
          SDOH Resources
        </button>
      </div>
    </div>
  );
}
