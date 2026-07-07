import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MoreScreens } from './MoreScreens';
import { SHELL_SCREENS } from '../lib/shellScreens';

describe('MoreScreens — S11 B1 shell screen reachability index', () => {
  it('links to every GD9 shell screen path/label from the shared table', () => {
    render(
      <MemoryRouter>
        <MoreScreens />
      </MemoryRouter>
    );

    SHELL_SCREENS.forEach((s) => {
      expect(screen.getByRole('link', { name: s.label })).toHaveAttribute('href', s.path);
    });
  });
});
