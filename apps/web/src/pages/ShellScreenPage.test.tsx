import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ShellScreenPage } from './ShellScreenPage';
import { ComingSoon } from './ComingSoon';
import { SHELL_SCREENS } from '../lib/shellScreens';

function renderAtDynamicRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/screens/:screenId" element={<ShellScreenPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// S11 B1 — one dynamic route backs every GD9 shell screen except W13, which
// keeps its own pre-existing `/task-center` route (see shellScreens.ts).
const DYNAMIC_ROUTE_SCREENS = SHELL_SCREENS.filter((s) => s.path.startsWith('/screens/'));

describe('ShellScreenPage — S11 B1 GD9 shell screens (one component, route→title table)', () => {
  it.each(DYNAMIC_ROUTE_SCREENS)('renders $id\'s label with an explicit not-yet-built treatment', (shellScreen) => {
    renderAtDynamicRoute(shellScreen.path);

    expect(screen.getByText(shellScreen.label)).toBeInTheDocument();
    expect(screen.getByText(/not yet built in this walking skeleton/i)).toBeInTheDocument();
  });

  it('renders an honest fallback for an unknown screen id instead of crashing', () => {
    renderAtDynamicRoute('/screens/zz99');

    expect(screen.getByText(/unknown screen/i)).toBeInTheDocument();
  });

  it('is case-insensitive on the id (routes are lowercase, table ids are uppercase)', () => {
    renderAtDynamicRoute('/screens/W08');

    expect(screen.getByText('Screen W08')).toBeInTheDocument();
  });
});

describe('W13 — folded into the shared shell pattern at its own dedicated /task-center route', () => {
  it("renders Task Management Center's label with the same shell treatment as App.tsx wires it", () => {
    const w13 = SHELL_SCREENS.find((s) => s.id === 'W13')!;

    render(
      <MemoryRouter initialEntries={[w13.path]}>
        <Routes>
          <Route path={w13.path} element={<ComingSoon title={w13.label} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Task Management Center')).toBeInTheDocument();
    expect(screen.getByText(/not yet built in this walking skeleton/i)).toBeInTheDocument();
  });
});
