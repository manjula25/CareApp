import { useParams } from 'react-router-dom';
import { SHELL_SCREENS } from '../lib/shellScreens';
import { ComingSoon } from './ComingSoon';

/**
 * S11 B1 — one dynamic route (`/screens/:screenId`, wired in `App.tsx`)
 * backing every GD9 shell screen whose path isn't otherwise claimed (W13
 * keeps its own pre-existing `/task-center` route — see
 * `lib/shellScreens.ts`). Looks the id up in the shared table and renders
 * the shared `ComingSoon`; an id that doesn't match anything known gets an
 * honest fallback instead of crashing.
 */
export function ShellScreenPage() {
  const { screenId } = useParams<{ screenId: string }>();
  const screen = SHELL_SCREENS.find((s) => s.id.toLowerCase() === screenId?.toLowerCase());

  if (!screen) {
    return (
      <div className="text-center py-16">
        <p className="text-section text-text-muted">Unknown screen.</p>
        <p className="text-body text-text-dim mt-2">This route doesn't match a known shell screen.</p>
      </div>
    );
  }

  return <ComingSoon title={screen.label} />;
}
