import type { TaskSummary } from '../api/client';

/** Priority pill text the way reference-materials/caresync-ai.html's `.prio` spans render it. */
export const PRIORITY_LABEL: Record<TaskSummary['priority'], string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
};

/** Priority pill color classes — shared by PatientDetail's task list and the M02 Task Queue (S7 B1). */
export const PRIORITY_CLASS: Record<TaskSummary['priority'], string> = {
  critical: 'text-red bg-red-dim border-red',
  high: 'text-amber bg-amber-dim border-amber',
  medium: 'text-violet bg-violet-dim border-violet',
};

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Formats a due ISO date the way the mockup's `.due` span does, e.g. "Today", "Tomorrow", "Fri". */
export function dueLabel(due: string | undefined): string {
  if (!due) return '—';
  const target = new Date(due);
  const dayDiff = Math.round((startOfDay(target) - startOfDay(new Date())) / (24 * 60 * 60 * 1000));
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Tomorrow';
  return target.toLocaleDateString(undefined, { weekday: 'short' });
}

/** True if the due ISO string (date OR datetime) is strictly before today's local midnight. */
export function isOverdue(due: string | undefined): boolean {
  if (!due) return false;
  return new Date(due).getTime() < startOfDay(new Date());
}
