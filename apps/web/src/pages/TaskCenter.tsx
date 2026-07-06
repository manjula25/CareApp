// W13 — per plan.md GD9 (locked), this screen is scoped as "Shell (nav only,
// placeholder content)", not one of the demo-critical fully-functional
// screens. Honest nav-only placeholder, matching ComingSoon.tsx's pattern —
// not a fake task-management UI. The real, testable cross-surface-sync part
// of S7 B3 lives on PatientDetail instead (see its S7 B3 relay subscription).
export function TaskCenter() {
  return (
    <div className="text-center py-16">
      <p className="text-section text-text-muted">Task Management Center</p>
      <p className="text-body text-text-dim mt-2">
        Full web view coming in a later slice (W13 is a nav-only shell per GD9).
      </p>
    </div>
  );
}
