import { describe, it, expect } from 'vitest';
import { ageSexLabel, riskDotColor } from './patient';

describe('ageSexLabel', () => {
  it('formats birthDate + gender as the mockup does (e.g. "68F")', () => {
    const label = ageSexLabel('1958-04-12', 'female');
    expect(label).toMatch(/^\d+F$/);
  });

  it('uses M for male', () => {
    const label = ageSexLabel('1958-04-12', 'male');
    expect(label).toMatch(/^\d+M$/);
  });
});

describe('riskDotColor', () => {
  it('matches the reference mockup severity buckets', () => {
    expect(riskDotColor(87)).toBe('red');
    expect(riskDotColor(70)).toBe('amber');
    expect(riskDotColor(50)).toBe('violet');
    expect(riskDotColor(20)).toBe('emerald');
  });
});
