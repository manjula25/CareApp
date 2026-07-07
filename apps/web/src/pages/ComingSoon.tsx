interface ComingSoonProps {
  title?: string;
}

/**
 * S1's original generic "no home screen yet" message (no `title`, still
 * backing `/coming-soon` unchanged) plus, since S11 B1, a parameterized
 * per-screen shell treatment (`title` set) reused by all 11 GD9 shell
 * screens — see `lib/shellScreens.ts`'s route→title table and
 * `ShellScreenPage.tsx`. One component driven by data, not 11 bespoke pages.
 */
export function ComingSoon({ title }: ComingSoonProps) {
  if (title) {
    return (
      <div className="text-center py-16">
        <p className="text-section text-text-muted">{title}</p>
        <p className="text-body text-text-dim mt-2">Not yet built in this walking skeleton — coming in a later slice.</p>
      </div>
    );
  }

  return (
    <div className="text-center py-16">
      <p className="text-section text-text-muted">This role's home screen isn't built yet in this walking skeleton.</p>
      <p className="text-body text-text-dim mt-2">Only the Care Coordinator path (My Patient Panel) ships in S1.</p>
    </div>
  );
}
