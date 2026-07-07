import { Link } from 'react-router-dom';
import { SHELL_SCREENS } from '../lib/shellScreens';

/**
 * S11 B1 — reachability index for the 11 GD9 shell screens (W08–W11, W13,
 * W15, W16, M06, M07, M09, M10). None of these has a defined role-owner in
 * the PRD, so rather than scattering 11 undefined links across the per-role
 * nav in `AppShell.tsx`, every authenticated role reaches this index via one
 * non-role-gated "More" link (see `AppShell.tsx`), and this page lists all
 * of them from the shared `SHELL_SCREENS` table.
 */
export function MoreScreens() {
  return (
    <div>
      <h1 className="text-section text-text font-bold mb-4">More</h1>
      <p className="text-body text-text-dim mb-4">
        These screens exist as navigation-only shells in this walking skeleton — none of them are functional yet.
      </p>
      <ul className="flex flex-col gap-2">
        {SHELL_SCREENS.map((s) => (
          <li key={s.id}>
            <Link to={s.path} className="text-label text-cyan hover:underline">
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
