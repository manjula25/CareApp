import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { getAssignedPanel, type PanelPatient } from '../../api/client';
import { DemoFallbackBadge } from '../../components/DemoFallbackBadge';
import { MOCK_PANEL_PATIENTS, type MockPanelPatient } from '../../lib/demoFallbacks';

/**
 * Caresync-coordinator-grid-my-patients — port of the lead project's
 * `pages/coordinator/MyPatients.tsx` (grid view of the assigned patient
 * panel). Adapted to this project's API contract:
 *
 *   - Real implementation is primary: `useQuery(getAssignedPanel)`. Real
 *     `/api/patients/assigned` returns a `PanelPatient[]` with
 *     `{id, name, gender, birthDate, riskScore, taskCount, conditionTags}`.
 *   - Fallback only on API error: `MOCK_PANEL_PATIENTS` (same shape plus
 *     `daysSinceContact` + `riskLevel` so the contact-status + risk-pill
 *     subcomponents have everything they need). The `DemoFallbackBadge`
 *     makes the fallback visible — mock data is never allowed to silently
 *     impersonate real data (G4 / HL7-Challenge-Evaluation.md).
 *   - Risk level is derived from `riskScore` for real data
 *     (critical ≥ 70, high ≥ 50, medium ≥ 30, low < 30). Mock data carries
 *     `riskLevel` directly to match the lead project's seed values.
 *   - The "Add Task" inline form from the lead port is intentionally
 *     skipped — there's no `POST /api/tasks` route in this project, so
 *     wiring the form to a stub would either 404 in production or require
 *     a backend slice that is out of scope for the visual-alignment goal.
 *     The "View" button (→ `/patients/:id`) is the only patient-card action.
 */

type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
type FilterType = 'all' | 'critical' | 'high' | 'needs_contact';

interface DisplayPatient {
  id: string;
  name: string;
  age: number;
  sex: string;
  conditions: string[];
  riskScore: number;
  riskLevel: RiskLevel;
  daysSinceContact: number | null;
}

const RISK_CONFIG: Record<RiskLevel, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: 'text-red', bg: 'bg-red-dim border-red/30' },
  high: { label: 'High', color: 'text-amber', bg: 'bg-amber-dim border-amber/30' },
  medium: { label: 'Medium', color: 'text-cyan', bg: 'bg-cyan-dim border-cyan/30' },
  low: { label: 'Low', color: 'text-emerald', bg: 'bg-emerald-dim border-emerald/30' },
};

function deriveRiskLevel(score: number): RiskLevel {
  if (score >= 70) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function ageFromBirthDate(birthDate: string): number {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hadBirthday =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hadBirthday) age -= 1;
  return age;
}

function shortSex(gender: string): string {
  return gender === 'female' ? 'F' : gender === 'male' ? 'M' : '';
}

function contactColor(days: number | null): { className: string; label: string } {
  if (days === null) return { className: 'text-text-dim', label: '—' };
  if (days > 14) return { className: 'text-red', label: `${days}d since contact` };
  if (days > 7) return { className: 'text-amber', label: `${days}d since contact` };
  if (days === 0) return { className: 'text-emerald', label: 'Contacted today' };
  return { className: 'text-emerald', label: `${days}d since contact` };
}

function toDisplay(p: PanelPatient | MockPanelPatient): DisplayPatient {
  const days =
    'daysSinceContact' in p && typeof p.daysSinceContact === 'number' ? p.daysSinceContact : null;
  const level: RiskLevel =
    'riskLevel' in p && (p as MockPanelPatient).riskLevel
      ? (p as MockPanelPatient).riskLevel
      : deriveRiskLevel(p.riskScore);
  return {
    id: p.id,
    name: p.name,
    age: ageFromBirthDate(p.birthDate),
    sex: shortSex(p.gender),
    conditions: p.conditionTags,
    riskScore: p.riskScore,
    riskLevel: level,
    daysSinceContact: days,
  };
}

const FILTERS: { label: string; value: FilterType }[] = [
  { label: 'All', value: 'all' },
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Needs Contact', value: 'needs_contact' },
];

export function MyPatients() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterType>('all');

  // Real-first: useQuery hits `/api/patients/assigned`. Mock only fires when
  // the API has errored AND there's no real data — same pattern as
  // TaskManagement.tsx (S12 C.1) so the badge + behaviour stay consistent.
  const panelQuery = useQuery({
    queryKey: ['assigned-panel-grid'],
    queryFn: getAssignedPanel,
    retry: 1,
  });

  const isUsingFallback = panelQuery.isError;
  const sourcePatients: Array<PanelPatient | MockPanelPatient> = isUsingFallback
    ? MOCK_PANEL_PATIENTS
    : (panelQuery.data ?? []);

  const patients = useMemo(() => sourcePatients.map(toDisplay), [sourcePatients]);

  const filtered = patients.filter((p) => {
    if (filter === 'critical') return p.riskLevel === 'critical';
    if (filter === 'high') return p.riskLevel === 'high';
    if (filter === 'needs_contact') return p.daysSinceContact !== null && p.daysSinceContact > 14;
    return true;
  });

  const pendingTasks = patients.reduce((sum, p) => sum + (p.riskScore > 50 ? 1 : 0), 0);
  const needContact = patients.filter((p) => p.daysSinceContact !== null && p.daysSinceContact > 14).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-text font-bold text-xl">My Patients</h1>
          <p className="text-text-dim text-sm mt-0.5">Assigned patient panel</p>
        </div>
        {isUsingFallback && <DemoFallbackBadge />}
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-3 mb-6">
        {[
          { label: 'Patients', value: patients.length, color: 'text-cyan' },
          { label: 'Pending Tasks', value: pendingTasks, color: 'text-amber' },
          { label: 'Need Contact', value: needContact, color: 'text-red' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3"
          >
            <span className={clsx('text-xl font-bold', stat.color)}>{stat.value}</span>
            <span className="text-text-muted text-sm">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={clsx(
              'px-4 py-1.5 rounded-full text-xs font-medium border transition-colors',
              filter === f.value
                ? 'bg-cyan/10 border-cyan/40 text-cyan'
                : 'bg-surface border-border text-text-muted hover:border-border-light'
            )}
          >
            {f.label}
            {f.value === 'needs_contact' && needContact > 0 && (
              <span className="ml-1.5 bg-red text-white text-[9px] w-4 h-4 rounded-full inline-flex items-center justify-center font-bold">
                {needContact}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Patient grid */}
      {panelQuery.isLoading ? (
        <p className="text-sm text-text-muted">Loading assigned panel…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-text-dim">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-3 opacity-40"
            aria-hidden="true"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <p className="text-sm">No patients match this filter</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((p) => {
            const risk = RISK_CONFIG[p.riskLevel];
            const contact = contactColor(p.daysSinceContact);
            return (
              <div
                key={p.id}
                className="bg-surface border border-border rounded-xl overflow-hidden hover:border-border-light transition-colors"
                data-testid={`my-patient-card-${p.id}`}
              >
                <div className="p-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-3 gap-3">
                    <div>
                      <h3 className="text-text font-semibold text-sm">{p.name}</h3>
                      <p className="text-text-dim text-xs mt-0.5">
                        {p.age}y {p.sex}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        'text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap',
                        risk.color,
                        risk.bg
                      )}
                    >
                      {p.riskScore} · {risk.label}
                    </span>
                  </div>

                  {/* Conditions */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {p.conditions.slice(0, 3).map((c) => (
                      <span
                        key={c}
                        className="bg-surface-raised text-text-muted text-[10px] px-2 py-0.5 rounded-full border border-border"
                      >
                        {c}
                      </span>
                    ))}
                  </div>

                  {/* Contact info */}
                  <div className="flex items-center gap-1 mb-4">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-text-dim"
                      aria-hidden="true"
                    >
                      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                      <line x1="12" y1="18" x2="12.01" y2="18" />
                    </svg>
                    <span className={clsx('text-xs font-medium', contact.className)}>{contact.label}</span>
                  </div>

                  {/* Action button */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigate(`/patients/${p.id}`)}
                      className="w-full bg-surface-raised hover:bg-surface-hover border border-border text-text-muted text-xs font-medium py-1.5 rounded-lg transition-colors"
                    >
                      View
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MyPatients;