import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAssignedPanel } from '../api/client';
import { ageSexLabel, riskDotColor, type RiskDotColor } from '../lib/patient';
import { FilterIcon, ChevronRightIcon } from '../icons';

const DOT_CLASS: Record<RiskDotColor, string> = {
  red: 'bg-red shadow-[0_0_8px_theme(colors.red)]',
  amber: 'bg-amber shadow-[0_0_8px_theme(colors.amber)]',
  violet: 'bg-violet shadow-[0_0_8px_theme(colors.violet)]',
  emerald: 'bg-emerald shadow-[0_0_8px_theme(colors.emerald)]',
};

export function PatientPanel() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['assigned-panel'], queryFn: getAssignedPanel });
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return q ? data.filter((p) => p.name.toLowerCase().includes(q)) : data;
  }, [data, query]);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-body font-bold text-text">My Patients</span>
        <span className="text-label text-text-dim flex-1">({data?.length ?? 0})</span>
        <FilterIcon className="text-text-muted" />
      </div>

      <input
        type="text"
        placeholder="Search patients…"
        aria-label="Search patients"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full mb-3 bg-bg border border-border rounded-chip px-2.5 py-1.5 text-label text-text placeholder:text-text-dim focus:outline-none focus:border-border-light"
      />

      {isLoading && <p className="text-body text-text-muted">Loading panel…</p>}
      {isError && <p className="text-body text-red">Could not load your patient panel.</p>}

      {data && (
        <div className="border border-border rounded-card overflow-hidden bg-surface">
          {filtered.map((patient) => (
            <Link
              key={patient.id}
              to={`/patients/${patient.id}`}
              className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border last:border-b-0 border-l-[3px] border-l-transparent hover:bg-surface-hover transition-colors"
            >
              <span className={`w-2 h-2 rounded-full flex-none ${DOT_CLASS[riskDotColor(patient.riskScore)]}`} />
              <div className="flex-1 min-w-0">
                <div className="text-label font-semibold text-text truncate">
                  {patient.name}
                  <span className="text-text-muted font-normal ml-1.5 text-xs">
                    {ageSexLabel(patient.birthDate, patient.gender)}
                  </span>
                </div>
                <div className="flex gap-1 mt-0.5 flex-wrap">
                  {patient.conditionTags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs text-text-muted bg-bg border border-border rounded-chip px-1.5 py-px whitespace-nowrap"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-none">
                {patient.taskCount > 0 && (
                  <span className="text-xs font-semibold text-cyan bg-cyan-dim border border-cyan rounded-pill px-2 py-0.5">
                    {patient.taskCount} task{patient.taskCount === 1 ? '' : 's'}
                  </span>
                )}
                <span className="font-mono text-xs text-text-dim" title="Risk score">
                  {patient.riskScore}
                </span>
                <ChevronRightIcon className="w-4 h-4 text-text-dim" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
