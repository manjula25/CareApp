import clsx from 'clsx';

type Priority = 'critical' | 'high' | 'medium' | 'low';
type Status = 'open' | 'in_progress' | 'completed' | 'deferred';

interface BadgeProps {
  label: string;
  priority?: Priority;
  status?: Status;
  className?: string;
}

const priorityClasses: Record<Priority, string> = {
  critical: 'bg-red-dim text-red border border-red/30',
  high: 'bg-amber-dim text-amber border border-amber/30',
  medium: 'bg-cyan-dim text-cyan border border-cyan/30',
  low: 'bg-surface-raised text-text-muted border border-border',
};

const statusClasses: Record<Status, string> = {
  open: 'bg-cyan-dim text-cyan border border-cyan/30',
  in_progress: 'bg-violet-dim text-violet border border-violet/30',
  completed: 'bg-emerald-dim text-emerald border border-emerald/30',
  deferred: 'bg-surface-raised text-text-muted border border-border',
};

export function Badge({ label, priority, status, className }: BadgeProps) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider';
  const variant = priority
    ? priorityClasses[priority]
    : status
    ? statusClasses[status]
    : 'bg-surface-raised text-text-muted border border-border';

  return <span className={clsx(base, variant, className)}>{label}</span>;
}
