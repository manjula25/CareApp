import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { getAlerts, type AlertEntry } from '../api/client';
import { DemoFallbackBadge } from '../components/DemoFallbackBadge';

type Severity = AlertEntry['severity'];
type AlertCategory = AlertEntry['category'];

const MOCK_ALERTS: AlertEntry[] = [
  {
    id: 'a1', severity: 'critical', category: 'clinical',
    patientId: 'maria-chen-4829', patientName: 'Maria Chen',
    title: 'BNP critically elevated — CHF exacerbation risk',
    detail: 'BNP 680 pg/mL (ref <100). 3-fold increase from baseline. Immediate cardiology follow-up indicated.',
    fhirRef: 'Observation/bnp-4829', time: '14m ago', acknowledged: false,
  },
  {
    id: 'a2', severity: 'critical', category: 'medication',
    patientId: 'p2', patientName: 'Robert Torres',
    title: 'Medication non-adherence — COPD inhaler gap',
    detail: 'Albuterol refill overdue by 18 days. Patient reported running out last week. Exacerbation risk elevated.',
    fhirRef: 'MedicationRequest/albuterol-torres', time: '1h ago', acknowledged: false,
  },
  {
    id: 'a3', severity: 'high', category: 'gap',
    patientId: 'p7', patientName: 'Patricia Davis',
    title: 'Annual wellness visit overdue by 14 months',
    detail: 'Last AWV: May 2025. Preventive screenings including mammogram and colonoscopy also outstanding.',
    fhirRef: 'Appointment/awv-davis-2025', time: '2h ago', acknowledged: false,
  },
  {
    id: 'a4', severity: 'high', category: 'sdoh',
    patientId: 'p3', patientName: 'Dorothy Williams',
    title: 'Food insecurity screening positive',
    detail: 'AHC-HRSN screening returned positive for food insecurity. No active Meals on Wheels enrollment.',
    fhirRef: 'Observation/ahchrsn-williams', time: '3h ago', acknowledged: false,
  },
  {
    id: 'a5', severity: 'high', category: 'clinical',
    patientId: 'p4', patientName: 'James Anderson',
    title: 'HbA1c uncontrolled — 9.8%',
    detail: 'Latest HbA1c 9.8% (target <8%). Three consecutive readings above goal. Endocrinology referral pending.',
    fhirRef: 'Observation/hba1c-anderson', time: '5h ago', acknowledged: false,
  },
  {
    id: 'a6', severity: 'medium', category: 'medication',
    patientId: 'p5', patientName: 'Linda Martinez',
    title: 'ACE inhibitor dose reduction — monitor BP',
    detail: 'Lisinopril reduced from 20mg to 10mg per nephrologist note. Blood pressure monitoring every 48h.',
    fhirRef: 'MedicationRequest/lisinopril-martinez', time: '6h ago', acknowledged: false,
  },
  {
    id: 'a7', severity: 'medium', category: 'gap',
    patientId: 'maria-chen-4829', patientName: 'Maria Chen',
    title: 'Depression PHQ-9 screening overdue',
    detail: 'Last PHQ-9 completed 11 months ago. Annual screening required per care plan.',
    fhirRef: 'Observation/phq9-chen-2025', time: '8h ago', acknowledged: true,
  },
  {
    id: 'a8', severity: 'low', category: 'sdoh',
    patientId: 'p2', patientName: 'Robert Torres',
    title: 'Transport assistance referral completed',
    detail: 'Springfield Rides enrollment confirmed. First ride scheduled for 2026-07-08 PCP visit.',
    fhirRef: 'CommunicationRequest/transport-torres', time: '1d ago', acknowledged: true,
  },
];

const SEV_CONFIG: Record<Severity, { label: string; dot: string; text: string; bg: string; border: string }> = {
  critical: { label: 'Critical', dot: '#E84848', text: 'text-red',    bg: 'bg-red/5',    border: 'border-red/30' },
  high:     { label: 'High',     dot: '#F0970A', text: 'text-amber',  bg: 'bg-amber/5',  border: 'border-amber/30' },
  medium:   { label: 'Medium',   dot: '#00C8FF', text: 'text-cyan',   bg: 'bg-cyan/5',   border: 'border-cyan/30' },
  low:      { label: 'Low',      dot: '#0FC48A', text: 'text-emerald',bg: 'bg-emerald/5',border: 'border-emerald/30' },
};

const CAT_CONFIG: Record<AlertCategory, { label: string; icon: string }> = {
  clinical:   { label: 'Clinical',   icon: '🩺' },
  medication: { label: 'Medication', icon: '💊' },
  sdoh:       { label: 'SDOH',       icon: '🏘' },
  gap:        { label: 'Care Gap',   icon: '📋' },
};

const CATEGORIES: { label: string; value: AlertCategory | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: '🩺 Clinical', value: 'clinical' },
  { label: '💊 Medication', value: 'medication' },
  { label: '📋 Care Gap', value: 'gap' },
  { label: '🏘 SDOH', value: 'sdoh' },
];

/** Real alerts endpoint — derives from FHIR RiskAssessment + Encounter recency. */
async function fetchAlerts(): Promise<AlertEntry[]> {
  return getAlerts();
}

/**
 * Honest reason for the demo-fallback badge. A 401 never reaches here (it
 * clears auth and redirects to /login), so the remaining failure modes are a
 * network-level failure (API down/restarting — `fetch` throws before a
 * response) versus any other HTTP error surfaced by `apiFetch` as
 * "Request failed: <status>". Naming the difference keeps the badge from
 * claiming "server unreachable" when the server actually answered.
 */
function fallbackReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'server unreachable';
  return 'data unavailable';
}

export default function AlertsPage() {
  const navigate = useNavigate();
  // Real implementation is primary. `MOCK_ALERTS` is a SAFETY NET only —
  // kicks in when the API errors AND we have no real data, surfaced via
  // the `DemoFallbackBadge`. Same pattern as TaskQueue.tsx.
  const { data, isError, error } = useQuery({
    queryKey: ['alerts'],
    queryFn: fetchAlerts,
    retry: 1,
  });
  const isUsingFallback = isError;
  const [categoryFilter, setCategoryFilter] = useState<AlertCategory | 'all'>('all');
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  // Acknowledgement is local-only (no write endpoint yet): track the IDs the
  // user has acked this session and overlay them onto whatever list is live —
  // real query data or the MOCK_ALERTS safety net.
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(() => new Set());

  const baseAlerts: AlertEntry[] = isError ? MOCK_ALERTS : (data ?? []);
  const alerts: AlertEntry[] = baseAlerts.map((a) =>
    acknowledgedIds.has(a.id) ? { ...a, acknowledged: true } : a
  );

  function acknowledge(id: string) {
    setAcknowledgedIds((prev) => new Set(prev).add(id));
  }

  function acknowledgeAll() {
    setAcknowledgedIds((prev) => {
      const next = new Set(prev);
      alerts.forEach((a) => next.add(a.id));
      return next;
    });
  }

  const filtered = alerts.filter((a) => {
    if (!showAcknowledged && a.acknowledged) return false;
    if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;
    return true;
  });

  const unackCount = alerts.filter((a) => !a.acknowledged).length;
  const criticalCount = alerts.filter((a) => a.severity === 'critical' && !a.acknowledged).length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-text font-bold text-xl">Clinical Alerts</h1>
          <p className="text-text-dim text-sm mt-0.5">
            {unackCount} unacknowledged
            {criticalCount > 0 && (
              <span className="ml-2 text-red font-semibold">{criticalCount} critical</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isUsingFallback && <DemoFallbackBadge reason={fallbackReason(error)} />}
          {unackCount > 0 && !isUsingFallback && (
            <button
              onClick={acknowledgeAll}
              className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm hover:border-border-light transition-colors"
            >
              Acknowledge all
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCategoryFilter(c.value)}
            className={clsx(
              'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              categoryFilter === c.value
                ? 'bg-cyan/10 border-cyan/40 text-cyan'
                : 'bg-surface border-border text-text-muted hover:border-border-light'
            )}
          >
            {c.label}
          </button>
        ))}
        <button
          onClick={() => setShowAcknowledged((p) => !p)}
          className={clsx(
            'ml-auto px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
            showAcknowledged
              ? 'bg-surface-raised border-border-light text-text-muted'
              : 'bg-surface border-border text-text-dim'
          )}
        >
          {showAcknowledged ? 'Hide acknowledged' : 'Show acknowledged'}
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 ? (
          <div className="text-center py-20 text-text-dim">
            <div className="text-4xl mb-3">✓</div>
            <p className="text-sm font-medium">All clear — no alerts match this filter</p>
          </div>
        ) : (
          filtered.map((alert) => {
            const sev = SEV_CONFIG[alert.severity];
            const cat = CAT_CONFIG[alert.category];
            return (
              <div
                key={alert.id}
                className={clsx(
                  'bg-surface border rounded-xl p-4 transition-opacity',
                  sev.border,
                  alert.acknowledged && 'opacity-50'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-1.5 flex-shrink-0">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: sev.dot, boxShadow: alert.acknowledged ? 'none' : `0 0 6px ${sev.dot}` }}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={clsx('text-xs font-bold', sev.text)}>{sev.label}</span>
                      <span className="text-text-dim text-xs">·</span>
                      <span className="text-text-dim text-xs">{cat.icon} {cat.label}</span>
                      <span className="text-text-dim text-xs">·</span>
                      <button
                        onClick={() => navigate(`/patients/${alert.patientId}`)}
                        className="text-cyan text-xs font-medium hover:underline"
                      >
                        {alert.patientName}
                      </button>
                      <span className="ml-auto text-text-dim text-xs">{alert.time}</span>
                    </div>

                    <p className="text-text text-sm font-semibold mb-1">{alert.title}</p>
                    <p className="text-text-muted text-xs leading-relaxed mb-2">{alert.detail}</p>

                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-[10px] text-text-dim bg-surface-raised px-2 py-0.5 rounded border border-border">
                        {alert.fhirRef}
                      </span>
                      <div className="ml-auto flex gap-2">
                        <button
                          onClick={() => navigate(`/patients/${alert.patientId}`)}
                          className="text-xs text-text-muted hover:text-cyan transition-colors font-medium"
                        >
                          View Patient →
                        </button>
                        {!alert.acknowledged && (
                          <button
                            onClick={() => acknowledge(alert.id)}
                            className="text-xs font-medium px-3 py-1 rounded-lg bg-surface-raised border border-border text-text-muted hover:border-border-light transition-colors"
                          >
                            Acknowledge
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
