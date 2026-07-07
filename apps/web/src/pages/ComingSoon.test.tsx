import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComingSoon } from './ComingSoon';

describe('ComingSoon', () => {
  it('renders the original S1 generic message when no title is given (regression guard for /coming-soon)', () => {
    render(<ComingSoon />);

    expect(screen.getByText(/home screen isn't built yet in this walking skeleton/i)).toBeInTheDocument();
    expect(screen.getByText(/Only the Care Coordinator path \(My Patient Panel\) ships in S1/i)).toBeInTheDocument();
  });

  it('renders a screen-specific title plus an explicit not-yet-built treatment when a title is given', () => {
    render(<ComingSoon title="Screen W08" />);

    expect(screen.getByText('Screen W08')).toBeInTheDocument();
    expect(screen.getByText(/not yet built in this walking skeleton/i)).toBeInTheDocument();
  });
});
