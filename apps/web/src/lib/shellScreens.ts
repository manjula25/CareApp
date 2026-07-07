export interface ShellScreen {
  id: string;
  path: string;
  label: string;
}

/**
 * S11 B1 — GD9's "shell (nav-only)" tier: 11 screen codes with no PRD story,
 * mockup, or defined functionality anywhere in this repo (plan.md's GD9
 * three-tier screen table). Ponytail instruction: one `ComingSoon` component
 * driven by this route→title table, not 11 bespoke page files.
 *
 * Labels are deliberately neutral ("Screen W08") rather than invented
 * feature names — none of these screens has a name, purpose, or user story
 * documented anywhere in `prd.md`/`plan.md`/`HANDOFF.md`, and guessing one
 * would misrepresent an undefined slot as a scoped, planned feature (honest
 * staging, gate G4).
 *
 * W13 is the one exception: it already has a defined identity from S7 B3
 * ("Task Management Center", PRD story 24, Coordinator-only) plus a live
 * `/task-center` route and nav link in `AppShell.tsx` that predates this
 * table. It's folded in here behind the same shared `ComingSoon` component
 * (see `App.tsx`), but keeps its real path/label so nothing regresses.
 */
export const SHELL_SCREENS: ShellScreen[] = [
  { id: 'W08', path: '/screens/w08', label: 'Screen W08' },
  { id: 'W09', path: '/screens/w09', label: 'Screen W09' },
  { id: 'W10', path: '/screens/w10', label: 'Screen W10' },
  { id: 'W11', path: '/screens/w11', label: 'Screen W11' },
  { id: 'W13', path: '/task-center', label: 'Task Management Center' },
  { id: 'W15', path: '/screens/w15', label: 'Screen W15' },
  { id: 'W16', path: '/screens/w16', label: 'Screen W16' },
  { id: 'M06', path: '/screens/m06', label: 'Screen M06' },
  { id: 'M07', path: '/screens/m07', label: 'Screen M07' },
  { id: 'M09', path: '/screens/m09', label: 'Screen M09' },
  { id: 'M10', path: '/screens/m10', label: 'Screen M10' },
];
