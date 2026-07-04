import type { TaskSummary } from '../api/client';

/** Priority pill text the way reference-materials/caresync-ai.html's `.prio` spans render it. */
export const PRIORITY_LABEL: Record<TaskSummary['priority'], string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
};

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Formats a due ISO date the way the mockup's `.due` span does, e.g. "Today", "Tomorrow", "Fri". */
export function dueLabel(due: string): string {
  const target = new Date(due);
  const dayDiff = Math.round((startOfDay(target) - startOfDay(new Date())) / (24 * 60 * 60 * 1000));
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Tomorrow';
  return target.toLocaleDateString(undefined, { weekday: 'short' });
}
