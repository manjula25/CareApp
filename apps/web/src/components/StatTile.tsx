/**
 * Shared stat-tile atom — extracted from `Governance.tsx`'s original `Tile`
 * (S8) after `Team.tsx` (S11 A3) reimplemented an identical copy minus the
 * `note` prop. One component, not two near-duplicates.
 */
export function StatTile({
  value,
  label,
  note,
  valueClassName = 'text-cyan',
  testId,
}: {
  value: string;
  label: string;
  note?: string;
  valueClassName?: string;
  testId?: string;
}) {
  return (
    <div
      className="bg-surface border border-border rounded-card px-3.5 py-2.5 flex flex-col justify-center gap-0.5 min-w-0"
      data-testid={testId}
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted truncate">{label}</span>
      <span className={`text-title font-bold font-mono leading-tight ${valueClassName}`}>{value}</span>
      {note && <span className="text-xs text-text-dim truncate">{note}</span>}
    </div>
  );
}
