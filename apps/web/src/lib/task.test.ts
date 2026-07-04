import { describe, it, expect } from 'vitest';
import { PRIORITY_LABEL, dueLabel } from './task';

describe('PRIORITY_LABEL', () => {
  it('matches the reference mockup pill text', () => {
    expect(PRIORITY_LABEL.critical).toBe('CRITICAL');
    expect(PRIORITY_LABEL.high).toBe('HIGH');
    expect(PRIORITY_LABEL.medium).toBe('MEDIUM');
  });
});

describe('dueLabel', () => {
  it('labels a due date of today as "Today"', () => {
    const today = new Date().toISOString();
    expect(dueLabel(today)).toBe('Today');
  });

  it('labels a due date of tomorrow as "Tomorrow"', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(dueLabel(tomorrow)).toBe('Tomorrow');
  });

  it('labels a due date further out by weekday', () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    expect(dueLabel(future.toISOString())).toBe(
      future.toLocaleDateString(undefined, { weekday: 'short' })
    );
  });
});
