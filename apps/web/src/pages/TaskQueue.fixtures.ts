import type { TaskListEntry } from '../api/client';

/**
 * Demo insurance + helpers for `TaskQueue.tsx` — extracted from
 * `hl7-competition-caresyncai/apps/web/src/pages/mobile/TaskQueue.tsx`
 * during the S12 + UI-betterment Phase 3 port.
 *
 * Lead's `MOCK_TASKS` carried fields my real API doesn't return
 * (description, fhirResourceId, assignedTo, createdAt) — dropped here
 * because `TaskListEntry` only requires id/patientId/patientName/title/
 * priority/due/status/conditionTag. Lead's `urgent` priority maps to
 * my `critical`; lead's `low` priority isn't surfaced (my backend's
 * enum doesn't include it). Lead's `pending`/`completed` statuses
 * become my `Open`/`Done` (matching the existing `isOpenStatus` check
 * used elsewhere on this branch — see TaskQueue.tsx's
 * `isOpenStatus`/`PRIORITY_CLASS`/etc.).
 *
 * Date helpers `today`, `plus`, `ago` mirror lead's signatures so a
 * future mock refresh can stay in sync with the lead file.
 */

// Use full ISO timestamps (not date-only) so `dueLabel` correctly identifies
// "today" / "tomorrow" across timezones — `new Date('YYYY-MM-DD')` parses as
// UTC midnight, which crosses a calendar day in negative-offset zones like
// PST, so we follow the existing `lib/task.test.ts` convention of full
// ISO timestamps for these helpers.
const now = new Date();
const today = now.toISOString();
const plus = (d: number): string => new Date(now.getTime() + d * 86400000).toISOString();
const ago = (h: number): string => new Date(now.getTime() - h * 3600000).toISOString();

export const MOCK_TASKS: TaskListEntry[] = [
  { id: 't-d1', patientId: 'maria-chen-4829', patientName: 'Maria Chen', title: '48h post-discharge follow-up call', priority: 'critical', status: 'Open', due: today, conditionTag: 'CHF' },
  { id: 't-d2', patientId: 'p7', patientName: 'Patricia Davis', title: 'Meals on Wheels referral', priority: 'high', status: 'Open', due: plus(2), conditionTag: 'CHF' },
  { id: 't-d3', patientId: 'p2', patientName: 'Robert Torres', title: 'Transport coordination for PCP visit', priority: 'high', status: 'In Progress', due: plus(3), conditionTag: 'COPD' },
  { id: 't-d4', patientId: 'p3', patientName: 'Dorothy Williams', title: 'Diabetic eye exam referral', priority: 'high', status: 'Open', due: plus(7), conditionTag: 'T2DM' },
  { id: 't-d5', patientId: 'p4', patientName: 'James Anderson', title: 'Medication reconciliation review', priority: 'medium', status: 'Done', due: plus(-1), conditionTag: 'CHF' },
];

/** Filter chips at the top of the queue. Mapped from lead's `urgent` →
 *  `critical` per the Phase 3 brief; `testId` is what the test file
 *  queries against. */
export const FILTER_TABS = [
  { key: 'all', label: 'All', testId: 'task-queue-filter-all' },
  { key: 'critical', label: 'Critical', testId: 'task-queue-filter-critical' },
  { key: 'today', label: 'Today', testId: 'task-queue-filter-today' },
  { key: 'in_progress', label: 'In Progress', testId: 'task-queue-filter-in-progress' },
] as const;

export type TaskFilter = (typeof FILTER_TABS)[number]['key'];

export { today, plus, ago };